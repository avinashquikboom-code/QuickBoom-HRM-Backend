import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/db';
import { notifyEmployee, sendHRNotification } from '../utils/hrNotificationHelper';

export interface CreateRkdInput {
  employeeId: number;
  productName: string;
  quantity: number;
  commissionAmount: number;
  saleReference?: string | null;
  particulars: string;
}

export async function createRkdRequestOnce(
  data: CreateRkdInput,
  requestId?: string
) {
  const submissionKey = requestId
    ? createHash('sha256').update(`${data.employeeId}:${requestId}`).digest('hex')
    : null;

  const sameRequest = (req: {
    employeeId: number;
    productName: string;
    quantity: number;
    commissionAmount: number;
    particulars: string;
    saleReference: string | null;
  }) =>
    req.employeeId === data.employeeId &&
    req.productName === data.productName &&
    req.quantity === data.quantity &&
    req.commissionAmount === data.commissionAmount &&
    req.particulars === data.particulars &&
    (req.saleReference || null) === (data.saleReference || null);

  const replay = async () => {
    const existing = await prisma.rkdRequest.findUniqueOrThrow({
      where: { submissionKey: submissionKey! },
      include: { employee: true },
    });
    if (!sameRequest(existing)) {
      throw Object.assign(
        new Error('Submission key was already used for a different RKD request'),
        { code: 'rkd/idempotency-conflict' }
      );
    }
    return { rkd: existing, created: false };
  };

  if (submissionKey) {
    const found = await prisma.rkdRequest.findUnique({
      where: { submissionKey },
      include: { employee: true },
    });
    if (found) return replay();
  }

  try {
    const rkd = await prisma.rkdRequest.create({
      data: {
        employeeId: data.employeeId,
        productName: data.productName,
        quantity: data.quantity,
        commissionAmount: data.commissionAmount,
        saleReference: data.saleReference || null,
        particulars: data.particulars,
        status: 'PENDING',
        submissionKey,
      },
      include: { employee: true },
    });
    return { rkd, created: true };
  } catch (error) {
    if (submissionKey && (error as { code?: string }).code === 'P2002') {
      return replay();
    }
    throw error;
  }
}

export async function notifyRkdSubmitted(
  rkd: { id: number; employeeId: number; productName: string; commissionAmount: number },
  employeeName: string
) {
  return sendHRNotification({
    employeeId: rkd.employeeId,
    title: 'New RKD Request',
    body: `A new RKD request has been submitted by ${employeeName}. Please review it.`,
    category: 'COMMISSION',
    actionType: 'RKD_SUBMITTED',
    actionId: String(rkd.id),
    requiredModuleId: 'pa-commission',
    extraData: {
      rkdId: String(rkd.id),
      employeeName,
      productName: rkd.productName,
      commissionAmount: String(rkd.commissionAmount),
    },
  });
}

export async function transitionRkdReview(
  id: number,
  status: 'APPROVED' | 'REJECTED' | 'RETURNED',
  reviewerUserId: number,
  reviewerName: string,
  rejectionReason?: string
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.rkdRequest.findUniqueOrThrow({
      where: { id },
      include: { employee: true },
    });

    // If already in target status, idempotent return
    if (existing.status === status) {
      return { changed: false, rkd: existing };
    }

    // Only pending requests or returned requests can be approved/rejected
    if (existing.status === 'APPROVED' && status !== 'APPROVED') {
      throw Object.assign(new Error('Cannot modify an already approved RKD request'), {
        code: 'rkd/already-approved',
      });
    }

    const updateData: Prisma.RkdRequestUpdateInput = {
      status,
      reviewedBy: reviewerUserId,
      reviewedByName: reviewerName,
      reviewedAt: new Date(),
      rejectionReason: rejectionReason || null,
    };

    if (status === 'APPROVED') {
      updateData.isSalaryCredited = true;
      updateData.salaryCreditedAt = new Date();

      // Upsert into CommissionTransaction for payroll inclusion and auditability
      const billId = `RKD-${existing.id}`;
      const commissionTx = await tx.commissionTransaction.upsert({
        where: {
          billId_employeeId: {
            billId,
            employeeId: existing.employeeId,
          },
        },
        create: {
          billId,
          invoiceNumber: existing.saleReference || billId,
          employeeId: existing.employeeId,
          saleAmount: existing.commissionAmount,
          commissionType: 'FIXED',
          commissionPercent: 100,
          commissionAmount: existing.commissionAmount,
          eventType: 'RKD_REQUEST',
          status: 'APPROVED',
          approvedBy: reviewerUserId,
          approvedAt: new Date(),
          notes: `Approved RKD Request #${existing.id}: ${existing.productName} (Qty: ${existing.quantity}) - ${existing.particulars}`,
        },
        update: {
          commissionAmount: existing.commissionAmount,
          status: 'APPROVED',
          approvedBy: reviewerUserId,
          approvedAt: new Date(),
          notes: `Approved RKD Request #${existing.id}: ${existing.productName} (Qty: ${existing.quantity}) - ${existing.particulars}`,
        },
      });

      // Record in CommissionHistory
      await tx.commissionHistory.create({
        data: {
          transactionId: commissionTx.id,
          employeeId: existing.employeeId,
          action: 'APPROVED',
          previousStatus: existing.status,
          newStatus: 'APPROVED',
          previousAmount: 0,
          newAmount: existing.commissionAmount,
          reason: `RKD Request #${existing.id} approved by ${reviewerName}`,
          performedBy: reviewerUserId,
        },
      });

      updateData.commissionTxId = commissionTx.id;
    } else if (status === 'REJECTED' || status === 'RETURNED') {
      updateData.isSalaryCredited = false;
      // If a commission transaction exists, cancel or mark it rejected
      if (existing.commissionTxId) {
        await tx.commissionTransaction.update({
          where: { id: existing.commissionTxId },
          data: { status: 'REJECTED' },
        });
      }
    }

    const updated = await tx.rkdRequest.update({
      where: { id },
      data: updateData,
      include: { employee: true },
    });

    return { changed: true, rkd: updated };
  });
}

export async function notifyRkdReviewed(
  rkd: {
    id: number;
    employeeId: number;
    status: string;
    productName: string;
    commissionAmount: number;
    rejectionReason: string | null;
    employee: { userId: number | null };
  }
) {
  if (rkd.status === 'APPROVED') {
    return notifyEmployee({
      employeeId: rkd.employeeId,
      userId: rkd.employee.userId || undefined,
      title: 'RKD Request Approved',
      body: `Your RKD request #${rkd.id} has been approved. The approved amount will be included in the applicable payroll according to payroll rules.`,
      category: 'COMMISSION',
      actionType: 'RKD_APPROVED',
      actionId: String(rkd.id),
      screen: '/rkd-requests',
      extraData: {
        rkdId: String(rkd.id),
        status: 'APPROVED',
        amount: String(rkd.commissionAmount),
      },
    });
  }

  if (rkd.status === 'REJECTED' || rkd.status === 'RETURNED') {
    const reasonText = rkd.rejectionReason || 'No reason specified';
    return notifyEmployee({
      employeeId: rkd.employeeId,
      userId: rkd.employee.userId || undefined,
      title: 'RKD Request Rejected',
      body: `Your RKD request #${rkd.id} was rejected. Reason: ${reasonText}`,
      category: 'COMMISSION',
      actionType: 'RKD_REJECTED',
      actionId: String(rkd.id),
      screen: '/rkd-requests',
      extraData: {
        rkdId: String(rkd.id),
        status: rkd.status,
        reason: reasonText,
      },
    });
  }
}
