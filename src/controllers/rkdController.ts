import payrollService from '../services/payrollService';
import { payrollPeriodKey, isOpenRkdPayrollStatus } from '../services/rkdPayrollService';
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

function parseRkdNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function getRkdAdjustmentStatus(r: {
  status: string;
  isSalaryCredited?: boolean;
  payrollId?: number | null;
  salaryMonth?: number | null;
  salaryYear?: number | null;
}): string {
  if (r.status !== 'APPROVED') return r.status;
  if (r.isSalaryCredited && r.payrollId) return 'ADJUSTED_IN_PAYROLL';
  if (r.salaryMonth && r.salaryYear) return 'APPROVED';
  return 'AWAITING_PAYROLL_ADJUSTMENT';
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
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ success: false, message: 'A JSON object is required.' });
      return;
    }
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

    const qty = parseRkdNumber(quantity);
    if (qty === null || !Number.isSafeInteger(qty) || qty <= 0 || qty > 2147483647) {
      res.status(400).json({
        success: false,
        message: 'Quantity sold must be a valid number greater than zero.',
      });
      return;
    }

    const commissionNotSupplied = commissionAmount == null || commissionAmount === '';
    let parsedCommission = commissionNotSupplied ? null : parseRkdNumber(commissionAmount);
    if (!commissionNotSupplied && parsedCommission === null) {
      res.status(400).json({ success: false, message: 'Commission amount must be a finite number.' });
      return;
    }
    if (parsedCommission === null || parsedCommission < 0) {
      // Preserve the existing salesman-rate fallback when missing or negative.
      const commissionRate = emp.commissionPercentage || 5.0;
      parsedCommission = Math.round(qty * 500 * (commissionRate / 100) * 100) / 100;
    }
    if (!Number.isFinite(parsedCommission)) {
      res.status(400).json({ success: false, message: 'Commission amount must be a finite number.' });
      return;
    }

    if (!particulars || typeof particulars !== 'string' || !particulars.trim()) {
      res.status(400).json({ success: false, message: 'Particulars / RKD details are required.' });
      return;
    }

    if (saleReference != null && typeof saleReference !== 'string') {
      res.status(400).json({ success: false, message: 'Sale reference must be a string or null.' });
      return;
    }
    const cleanSaleRef = typeof saleReference === 'string' ? saleReference.trim() || null : null;
    const suppliedKey: unknown = requestId ?? req.get('x-request-id') ?? req.body.submissionKey;
    if (suppliedKey != null && (typeof suppliedKey !== 'string' || !suppliedKey.trim())) {
      res.status(400).json({ success: false, message: 'Request ID must be a nonempty string.' });
      return;
    }
    const subKey = typeof suppliedKey === 'string' ? suppliedKey.trim() : undefined;

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
    if (error?.code === 'rkd/duplicate-sale-reference') {
      res.status(400).json({ success: false, message: error.message, errorCode: error.code, existingRequestId: error.existingRequestId });
      return;
    }
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
        payrollId: r.payrollId,
        salaryMonth: r.salaryMonth,
        salaryYear: r.salaryYear,
        isSalaryCredited: r.isSalaryCredited,
        salaryCreditedAt: r.salaryCreditedAt?.toISOString() || null,
        adjustmentStatus: getRkdAdjustmentStatus(r),
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
        payrollId: rkd.payrollId,
        salaryMonth: rkd.salaryMonth,
        salaryYear: rkd.salaryYear,
        isSalaryCredited: rkd.isSalaryCredited,
        salaryCreditedAt: rkd.salaryCreditedAt?.toISOString() || null,
        adjustmentStatus: getRkdAdjustmentStatus(rkd),
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
        payrollId: r.payrollId,
        salaryMonth: r.salaryMonth,
        salaryYear: r.salaryYear,
        isSalaryCredited: r.isSalaryCredited,
        salaryCreditedAt: r.salaryCreditedAt?.toISOString() || null,
        adjustmentStatus: getRkdAdjustmentStatus(r),
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
        payrollId: rkd.payrollId,
        salaryMonth: rkd.salaryMonth,
        salaryYear: rkd.salaryYear,
        isSalaryCredited: rkd.isSalaryCredited,
        salaryCreditedAt: rkd.salaryCreditedAt?.toISOString() || null,
        adjustmentStatus: getRkdAdjustmentStatus(rkd),
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
    if (changed) notificationDelivery = await notifyRkdReviewed(rkd);
    let isSalaryCredited = rkd.isSalaryCredited;
    // Retry an interrupted draft refresh without repeating approval or ledger credit.
    if (rkd.salaryMonth && rkd.salaryYear) {
      try {
        const slip = await prisma.payslip.findUnique({ where: { employeeId_month_year: {
          employeeId: rkd.employeeId, month: rkd.salaryMonth, year: rkd.salaryYear,
        } } });
        if (slip && !lockedPayslip(slip.status)) {
          const calculation = await payrollService.calculatePayroll(rkd.employeeId, rkd.salaryMonth, rkd.salaryYear);
          await payrollService.savePayslip(calculation);
          const current = await prisma.rkdRequest.findUnique({ where: { id: rkd.id } });
          isSalaryCredited = current?.isSalaryCredited ?? isSalaryCredited;
        }
      } catch { console.warn('[RKD] Approved earning awaits salary-slip refresh', { rkdId: rkd.id }); }
    }

    res.json({
      success: true,
      message: changed
        ? `RKD request #${id} approved successfully. RKD Incentive is eligible for payroll; finalized periods require manual adjustment.`
        : `RKD request #${id} was already approved.`,
      alreadyApproved: !changed,
      rkd: {
        id: rkd.id,
        status: rkd.status,
        reviewedByName: rkd.reviewedByName,
        reviewedAt: rkd.reviewedAt?.toISOString() || null,
        isSalaryCredited,
        salaryMonth: rkd.salaryMonth,
        salaryYear: rkd.salaryYear,
        payrollId: rkd.payrollId,
        adjustmentStatus: getRkdAdjustmentStatus({ ...rkd, isSalaryCredited }),
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

/**
 * 9. Adjust RKD Request for Payroll Period (Authorized HR/Admin Only)
 */
export async function adjustRkdPayrollPeriod(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const id = parseRkdRequestId(req.params.id);
    if (id === null) {
      res.status(400).json({ success: false, message: 'Invalid request ID.' });
      return;
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ success: false, message: 'A JSON object containing month and year is required.', errorCode: 'RKD_INVALID_PERIOD' });
      return;
    }
    const m = parseRkdNumber(req.body.month);
    const y = parseRkdNumber(req.body.year);
    if (m === null || !Number.isInteger(m) || m < 1 || m > 12 ||
        y === null || !Number.isInteger(y) || y < 2000 || y > 2100) {
      res.status(400).json({
        success: false,
        errorCode: 'RKD_INVALID_PERIOD',
        message: 'A valid month (1-12) and year (2000-2100) are required for payroll adjustment.',
        errors: {
          ...(m === null || !Number.isInteger(m) || m < 1 || m > 12 ? { month: 'Select a whole month from 1 to 12.' } : {}),
          ...(y === null || !Number.isInteger(y) || y < 2000 || y > 2100 ? { year: 'Enter a whole year from 2000 to 2100.' } : {}),
        },
      });
      return;
    }
    await ensureRkdTable();
    // Use the same locks as review and payroll generation, so a period cannot
    // become finalized between validation and allocation.
    const allocation = await prisma.$transaction(async (tx) => {
      const reviewLock = `rkd-review:${id}`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${reviewLock}, 0))`;
      const rkd = await tx.rkdRequest.findUnique({ where: { id }, include: { employee: true } });
      if (!rkd) return { error: { status: 404, code: 'RKD_NOT_FOUND', message: 'RKD request not found.' } };
      if (rkd.status !== 'APPROVED') return { error: {
        status: 400, code: 'RKD_NOT_APPROVED', message: 'Only approved RKD requests can be adjusted for payroll.',
      } };
      // A retry may arrive after the original request has refreshed its draft.
      // Return that persisted result without resetting its accounting markers.
      if (rkd.isSalaryCredited) {
        if (rkd.salaryMonth === m && rkd.salaryYear === y && rkd.payrollId) {
          return { updated: rkd, slip: null, employeeId: rkd.employeeId };
        }
        return { error: { status: 400, code: 'RKD_ALREADY_CREDITED', message: 'This RKD request is already credited to payroll and cannot be moved to another period.' } };
      }
      const periodLock = payrollPeriodKey(rkd.employeeId, m, y);
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${periodLock}, 0))`;
      const slip = await tx.payslip.findUnique({ where: {
        employeeId_month_year: { employeeId: rkd.employeeId, month: m, year: y },
      } });
      if (slip && lockedPayslip(slip.status)) return { error: {
        status: 400, code: 'RKD_PAYROLL_LOCKED',
        message: `Payroll for ${m}/${y} is already finalized/paid. Please select an open payroll period.`,
      } };
      if (!slip) return { error: {
        status: 400, code: 'RKD_PAYROLL_NOT_FOUND',
        message: 'The selected payroll period does not exist for this employee. Please create an open payroll period before proceeding.',
      } };
      if (!isOpenRkdPayrollStatus(slip.status)) return { error: {
        status: 400, code: 'RKD_PAYROLL_CLOSED',
        message: 'The selected payroll period is not open for adjustment. Please select an open payroll period.',
      } };
      const updated = await tx.rkdRequest.update({ where: { id }, data: {
        salaryMonth: m, salaryYear: y, isSalaryCredited: false,
      } });
      return { updated, slip, employeeId: rkd.employeeId };
    });
    if (allocation.error) {
      res.status(allocation.error.status).json({ success: false, message: allocation.error.message, errorCode: allocation.error.code });
      return;
    }
    const { slip, employeeId } = allocation;
    let updated = allocation.updated;

    // If an open draft payslip exists for that period, recalculate and update it
    if (slip && !lockedPayslip(slip.status)) {
      try {
        const calculation = await payrollService.calculatePayroll(employeeId, m, y);
        await payrollService.savePayslip(calculation);
      } catch (err) {
        console.warn('[RKD] Draft payroll update after adjustment deferred:', err);
      }
    }

    // Draft refresh may have credited it; return fresh persisted markers.
    updated = await prisma.rkdRequest.findUniqueOrThrow({ where: { id } });
    res.json({
      success: true,
      message: `RKD request #${id} allocated to payroll period ${m}/${y} successfully.`,
      rkd: {
        id: updated.id,
        status: updated.status,
        salaryMonth: updated.salaryMonth,
        salaryYear: updated.salaryYear,
        isSalaryCredited: updated.isSalaryCredited,
        payrollId: updated.payrollId,
        adjustmentStatus: updated.isSalaryCredited && updated.payrollId ? 'ADJUSTED_IN_PAYROLL' : 'APPROVED',
      },
    });
  } catch (error) {
    console.error('Adjust RKD payroll period error:', error);
    res.status(500).json({ success: false, message: 'Failed to adjust RKD payroll period.' });
  }
}
