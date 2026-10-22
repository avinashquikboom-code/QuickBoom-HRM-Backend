import payrollService from '../services/payrollService';
import { lockedPayslip } from '../utils/fixedThirtyDaySalary';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma, ensureRkdTable } from '../utils/db';
import { isSalesEmployee } from '../utils/salaryGross';
import {
  createRkdRequestOnce,
  notifyRkdSubmitted,
  transitionRkdReview,
  notifyRkdReviewed,
} from '../services/rkdNotificationWorkflow';

// RKD routes identify exactly one positive Prisma Int ID; arrays are ambiguous.
function parseRkdRequestId(value: string | string[] | undefined): number | null {
  if (Array.isArray(value) || typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

// Helper to resolve employee from authenticated request
async function getEmployeeFromReq(req: AuthenticatedRequest) {
  if (!req.user) return null;
  const userObj = req.user as any;

  let emp = await prisma.employee.findUnique({
    where: { userId: userObj.id },
    include: {
      department: true,
      office: true,
      store: true,
      user: { include: { profile: true } },
    },
  });

  if (emp) return emp;

  if (userObj.employeeID) {
    emp = await prisma.employee.findFirst({
      where: { employeeID: userObj.employeeID },
      include: {
        department: true,
        office: true,
        store: true,
        user: { include: { profile: true } },
      },
    });
    if (emp) return emp;
  }

  if (userObj.email) {
    const code = userObj.email.split('@')[0];
    emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: code },
          { user: { email: userObj.email } },
        ],
      },
      include: {
        department: true,
        office: true,
        store: true,
        user: { include: { profile: true } },
      },
    });
  }

  return emp;
}

/**
 * 1. Submit RKD Request (Sales Employee Only)
 */
export async function createRkdRequest(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    await ensureRkdTable();

    const emp = await getEmployeeFromReq(req);
    if (!emp) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    // Role check: Only Sales Employees can submit RKD requests
    if (!isSalesEmployee(emp)) {
      res.status(403).json({
        success: false,
        message: 'Forbidden: RKD Request module is restricted to Sales Employees.',
      });
      return;
    }

    const {
      productName,
      quantity,
      commissionAmount,
      saleReference,
      particulars,
      requestId,
    } = req.body;

    // Field validations
    if (!productName || typeof productName !== 'string' || !productName.trim()) {
      res.status(400).json({ success: false, message: 'Product name is required.' });
      return;
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      res.status(400).json({
        success: false,
        message: 'Quantity sold must be a valid number greater than zero.',
      });
      return;
    }

    let parsedCommission = parseFloat(commissionAmount);
    if (isNaN(parsedCommission) || parsedCommission < 0) {
      // If client didn't supply valid commission, calculate using salesman rate or standard formula
      const commissionRate = emp.commissionPercentage || 5.0; // default 5%
      parsedCommission = Math.round(qty * 500 * (commissionRate / 100) * 100) / 100;
    }

    if (!particulars || typeof particulars !== 'string' || !particulars.trim()) {
      res.status(400).json({ success: false, message: 'Particulars / RKD details are required.' });
      return;
    }

    const cleanSaleRef = saleReference ? String(saleReference).trim() : null;

    // Prevent duplicate RKD requests for the same sale reference if provided
    if (cleanSaleRef) {
      const existingSaleRef = await prisma.rkdRequest.findFirst({
        where: {
          employeeId: emp.id,
          saleReference: cleanSaleRef,
          status: { in: ['PENDING', 'APPROVED'] },
        },
      });

      if (existingSaleRef) {
        res.status(400).json({
          success: false,
          message: `An RKD request already exists for sale reference "${cleanSaleRef}".`,
        });
        return;
      }
    }

    const subKey = requestId || req.get('x-request-id') || req.body.submissionKey;

    const { rkd, created } = await createRkdRequestOnce(
      {
        employeeId: emp.id,
        productName: productName.trim(),
        quantity: qty,
        commissionAmount: parsedCommission,
        saleReference: cleanSaleRef,
        particulars: particulars.trim(),
      },
      subKey
    );

    let notificationDelivery;
    if (created) {
      const employeeName = `${emp.firstName} ${emp.lastName}`.trim();
      notificationDelivery = await notifyRkdSubmitted(rkd, employeeName);
    }

    res.status(201).json({
      success: true,
      message: created
        ? 'RKD Request submitted successfully!'
        : 'RKD Request retrieved (idempotent replay).',
      rkd: {
        id: rkd.id,
        employeeId: rkd.employeeId,
        productName: rkd.productName,
        quantity: rkd.quantity,
        commissionAmount: rkd.commissionAmount,
        saleReference: rkd.saleReference,
        particulars: rkd.particulars,
        status: rkd.status,
        createdAt: rkd.createdAt.toISOString(),
      },
      notificationDelivery,
    });
  } catch (error: any) {
    if (error?.code === 'rkd/idempotency-conflict') {
      res.status(409).json({ success: false, message: error.message });
      return;
    }
    console.error('Create RKD Request error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit RKD request.' });
  }
}

/**
 * 2. Get Employee's RKD Requests (Sales Employee Only)
 */
export async function getEmployeeRkdRequests(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    await ensureRkdTable();

    const emp = await getEmployeeFromReq(req);
    if (!emp) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    if (!isSalesEmployee(emp)) {
      res.status(403).json({
        success: false,
        message: 'Forbidden: RKD Request module is restricted to Sales Employees.',
      });
      return;
    }

    const { status, page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where: any = { employeeId: emp.id };
    if (status && status !== 'ALL') {
      where.status = String(status).toUpperCase();
    }

    const [requests, total] = await Promise.all([
      prisma.rkdRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.rkdRequest.count({ where }),
    ]);

    res.json({
      success: true,
      requests: requests.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        productName: r.productName,
        quantity: r.quantity,
        commissionAmount: r.commissionAmount,
        saleReference: r.saleReference,
        particulars: r.particulars,
        status: r.status,
        rejectionReason: r.rejectionReason,
        reviewedByName: r.reviewedByName,
        reviewedAt: r.reviewedAt?.toISOString() || null,
        isSalaryCredited: r.isSalaryCredited,
        createdAt: r.createdAt.toISOString(),
      })),
      pagination: {
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('Get employee RKD requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch RKD requests.' });
  }
}

/**
 * 3. Get Details of an Employee's RKD Request
 */
export async function getEmployeeRkdDetails(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const id = parseRkdRequestId(req.params.id);
    if (id === null) {
      res.status(400).json({ success: false, message: 'Invalid request ID.' });
      return;
    }

    await ensureRkdTable();

    const emp = await getEmployeeFromReq(req);
    if (!emp) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    const rkd = await prisma.rkdRequest.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!rkd || rkd.employeeId !== emp.id) {
      res.status(404).json({ success: false, message: 'RKD request not found.' });
      return;
    }

    res.json({
      success: true,
      rkd: {
        id: rkd.id,
        employeeId: rkd.employeeId,
        productName: rkd.productName,
        quantity: rkd.quantity,
        commissionAmount: rkd.commissionAmount,
        saleReference: rkd.saleReference,
        particulars: rkd.particulars,
        status: rkd.status,
        rejectionReason: rkd.rejectionReason,
        reviewedByName: rkd.reviewedByName,
        reviewedAt: rkd.reviewedAt?.toISOString() || null,
        isSalaryCredited: rkd.isSalaryCredited,
        createdAt: rkd.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Get employee RKD details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch RKD request details.' });
  }
}

/**
 * 4. Preview / Calculate Commission for Sales Employee Form
 */
export async function calculateRkdCommissionPreview(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await getEmployeeFromReq(req);
    if (!emp) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const { productName, quantity, saleAmount } = req.body;
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    const saleAmt = parseFloat(saleAmount) || 0;

    let commissionRate = emp.commissionPercentage || 0;
    let calculatedCommission = 0;

    // Check if there is an active commission policy for this employee or store
    const policy = await prisma.commissionPolicy.findFirst({
      where: {
        isActive: true,
        OR: [
          { employeeId: emp.id },
          { storeId: emp.storeId || undefined },
        ],
      },
      orderBy: { priority: 'asc' },
    });

    if (policy) {
      if (policy.commissionType === 'PERCENTAGE') {
        commissionRate = policy.commissionValue || commissionRate || 5.0;
        const base = saleAmt > 0 ? saleAmt : qty * 500;
        calculatedCommission = Math.round(base * (commissionRate / 100) * 100) / 100;
      } else {
        calculatedCommission = (policy.commissionValue || 500) * qty;
      }
    } else {
      if (commissionRate > 0) {
        const base = saleAmt > 0 ? saleAmt : qty * 500;
        calculatedCommission = Math.round(base * (commissionRate / 100) * 100) / 100;
      } else {
        // Standard baseline commission for RKD: 500 per unit or 5% of sale
        calculatedCommission = saleAmt > 0 ? Math.round(saleAmt * 0.05 * 100) / 100 : 500 * qty;
      }
    }


    res.json({
      success: true,
      commissionAmount: calculatedCommission,
      rate: commissionRate,
      productName: productName || 'Standard Product',
      quantity: qty,
    });
  } catch (error) {
    console.error('Calculate RKD commission preview error:', error);
    res.status(500).json({ success: false, message: 'Failed to calculate commission.' });
  }
}

/**
 * 5. Get All RKD Requests for HR Dashboard
 */
export async function getHrRkdRequests(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    await ensureRkdTable();

    const {
      status,
      search,
      employeeId,
      startDate,
      endDate,
      page = '1',
      limit = '20',
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (status && status !== 'ALL') {
      where.status = String(status).toUpperCase();
    }

    if (employeeId) {
      const parsedEmpId = parseInt(employeeId as string, 10);
      if (!isNaN(parsedEmpId)) {
        where.employeeId = parsedEmpId;
      }
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { productName: { contains: q, mode: 'insensitive' } },
        { saleReference: { contains: q, mode: 'insensitive' } },
        { particulars: { contains: q, mode: 'insensitive' } },
        {
          employee: {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { employeeCode: { contains: q, mode: 'insensitive' } },
              { employeeID: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const [requests, total, counts] = await Promise.all([
      prisma.rkdRequest.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              employeeID: true,
              designation: true,
              department: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.rkdRequest.count({ where }),
      prisma.rkdRequest.groupBy({
        by: ['status'],
        _count: { id: true },
        _sum: { commissionAmount: true },
      }),
    ]);

    const stats = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      approvedAmount: 0,
    };

    for (const c of counts) {
      const count = c._count.id;
      stats.total += count;
      if (c.status === 'PENDING') stats.pending = count;
      if (c.status === 'APPROVED') {
        stats.approved = count;
        stats.approvedAmount = c._sum.commissionAmount || 0;
      }
      if (c.status === 'REJECTED') stats.rejected = count;
    }

    res.json({
      success: true,
      requests: requests.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
        employeeCode: r.employee.employeeCode,
        employeeCompanyId: r.employee.employeeID || r.employee.employeeCode,
        department: r.employee.department?.name || 'Sales',
        designation: r.employee.designation || 'Sales Executive',
        productName: r.productName,
        quantity: r.quantity,
        commissionAmount: r.commissionAmount,
        saleReference: r.saleReference,
        particulars: r.particulars,
        status: r.status,
        rejectionReason: r.rejectionReason,
        reviewedByName: r.reviewedByName,
        reviewedAt: r.reviewedAt?.toISOString() || null,
        isSalaryCredited: r.isSalaryCredited,
        createdAt: r.createdAt.toISOString(),
      })),
      stats,
      pagination: {
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('Get HR RKD requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch RKD requests.' });
  }
}

/**
 * 6. Get Details of an RKD Request for HR
 */
export async function getHrRkdDetails(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const id = parseRkdRequestId(req.params.id);
    if (id === null) {
      res.status(400).json({ success: false, message: 'Invalid request ID.' });
      return;
    }

    await ensureRkdTable();

    const rkd = await prisma.rkdRequest.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            employeeID: true,
            designation: true,
            mobileNumber: true,
            department: { select: { name: true } },
            office: { select: { name: true } },
            store: { select: { name: true } },
          },
        },
      },
    });

    if (!rkd) {
      res.status(404).json({ success: false, message: 'RKD request not found.' });
      return;
    }

    res.json({
      success: true,
      rkd: {
        id: rkd.id,
        employeeId: rkd.employeeId,
        employeeName: `${rkd.employee.firstName} ${rkd.employee.lastName}`.trim(),
        employeeCode: rkd.employee.employeeCode,
        employeeCompanyId: rkd.employee.employeeID || rkd.employee.employeeCode,
        department: rkd.employee.department?.name || 'Sales',
        designation: rkd.employee.designation || 'Sales Executive',
        officeName: rkd.employee.office?.name || 'Main Office',
        storeName: rkd.employee.store?.name || 'Store',
        mobileNumber: rkd.employee.mobileNumber || '',
        productName: rkd.productName,
        quantity: rkd.quantity,
        commissionAmount: rkd.commissionAmount,
        saleReference: rkd.saleReference,
        particulars: rkd.particulars,
        status: rkd.status,
        rejectionReason: rkd.rejectionReason,
        reviewedByName: rkd.reviewedByName,
        reviewedAt: rkd.reviewedAt?.toISOString() || null,
        isSalaryCredited: rkd.isSalaryCredited,
        createdAt: rkd.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Get HR RKD details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch RKD request details.' });
  }
}

/**
 * 7. Accept / Approve RKD Request (Authorized HR Only)
 */
export async function approveHrRkdRequest(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const id = parseRkdRequestId(req.params.id);
    if (id === null) {
      res.status(400).json({ success: false, message: 'Invalid request ID.' });
      return;
    }

    await ensureRkdTable();

    const reviewerUserId = req.user?.id || 1;
    const reviewerProfile = await prisma.profile.findFirst({
      where: { userId: reviewerUserId },
    });
    const reviewerName = reviewerProfile?.fullName || 'HR Manager';

    const { changed, rkd } = await transitionRkdReview(
      id,
      'APPROVED',
      reviewerUserId,
      reviewerName
    );

    let notificationDelivery;
    if (changed) {
      notificationDelivery = await notifyRkdReviewed(rkd as any);
      if (rkd.salaryMonth && rkd.salaryYear) {
        try {
          const slip = await prisma.payslip.findUnique({ where: { employeeId_month_year: {
            employeeId: rkd.employeeId, month: rkd.salaryMonth, year: rkd.salaryYear,
          } } });
          if (slip && !lockedPayslip(slip.status)) {
            const calculation = await payrollService.calculatePayroll(rkd.employeeId, rkd.salaryMonth, rkd.salaryYear);
            await payrollService.savePayslip(calculation);
          }
        } catch { console.warn('[RKD] Approved earning awaits salary-slip refresh', { rkdId: rkd.id }); }
      }

    }

    res.json({
      success: true,
      message: changed
        ? `RKD request #${id} approved successfully. RKD Incentive is eligible for payroll; finalized periods require manual adjustment.`
        : `RKD request #${id} was already approved.`,
      rkd: {
        id: rkd.id,
        status: rkd.status,
        reviewedByName: rkd.reviewedByName,
        reviewedAt: rkd.reviewedAt?.toISOString() || null,
        isSalaryCredited: rkd.isSalaryCredited,
        commissionAmount: rkd.commissionAmount,
      },
      notificationDelivery,
    });
  } catch (error: any) {
    if (error?.code === 'rkd/already-approved') {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    console.error('Approve RKD request error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve RKD request.' });
  }
}

/**
 * 8. Reject RKD Request (Authorized HR Only)
 */
export async function rejectHrRkdRequest(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const id = parseRkdRequestId(req.params.id);

    if (id === null) {
      res.status(400).json({ success: false, message: 'Invalid request ID.' });
      return;
    }

    await ensureRkdTable();

    const { reason, rejectionReason } = req.body;
    const note = (reason || rejectionReason || '').trim();

    // Rejection reason is strictly required
    if (!note) {
      res.status(400).json({
        success: false,
        message: 'A rejection reason is required to reject an RKD request.',
      });
      return;
    }

    const reviewerUserId = req.user?.id || 1;
    const reviewerProfile = await prisma.profile.findFirst({
      where: { userId: reviewerUserId },
    });
    const reviewerName = reviewerProfile?.fullName || 'HR Manager';

    const { changed, rkd } = await transitionRkdReview(
      id,
      'REJECTED',
      reviewerUserId,
      reviewerName,
      note
    );

    let notificationDelivery;
    if (changed) {
      notificationDelivery = await notifyRkdReviewed(rkd as any);
    }

    res.json({
      success: true,
      message: changed
        ? `RKD request #${id} rejected.`
        : `RKD request #${id} status unchanged.`,
      rkd: {
        id: rkd.id,
        status: rkd.status,
        rejectionReason: rkd.rejectionReason,
        reviewedByName: rkd.reviewedByName,
        reviewedAt: rkd.reviewedAt?.toISOString() || null,
      },
      notificationDelivery,
    });
  } catch (error: any) {
    if (error?.code === 'rkd/already-approved') {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    console.error('Reject RKD request error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject RKD request.' });
  }
}
