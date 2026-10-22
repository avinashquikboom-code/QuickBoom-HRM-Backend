import { getIstMonthRange } from '../utils/commissionHelper';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/db';

export const payrollPeriodKey = (employeeId: number, month: number, year: number) =>
  `payroll-period:${employeeId}:${year}:${month}`;

export async function getRkdPayrollEarnings(employeeId: number, month: number, year: number, db: Prisma.TransactionClient = prisma, payrollId?: number, includeUncredited = true) {
  const targetPayrollId = payrollId ?? (await db.payslip.findUnique({
    where: { employeeId_month_year: { employeeId, month, year } },
    select: { id: true },
  }))?.id;
  const eligible: Prisma.RkdRequestWhereInput[] = [];
  if (targetPayrollId !== undefined) eligible.push({ payrollId: targetPayrollId, isSalaryCredited: true });
  if (includeUncredited) eligible.push({
    salaryMonth: month, salaryYear: year, isSalaryCredited: false,
    OR: [{ payrollId: null }, ...(targetPayrollId !== undefined ? [{ payrollId: targetPayrollId }] : [])],
  });
  const whereClause: Prisma.RkdRequestWhereInput = {
    employeeId, status: 'APPROVED', OR: eligible,
  };

  const requests = await db.rkdRequest.findMany({
    where: whereClause,
    orderBy: { id: 'asc' },
  });

  return {
    amount: Math.round(requests.reduce((sum, request) => sum + request.commissionAmount, 0) * 100) / 100,
    requestIds: requests.map(request => request.id),
    references: requests.map(request => `RKD-${request.id}`),
    requests: requests.map(request => ({
      id: request.id,
      reference: `RKD-${request.id}`,
      amount: request.commissionAmount,
      productName: request.productName,
      particulars: request.particulars,
      description: 'RKD Incentive',
      status: request.isSalaryCredited && request.payrollId
        ? 'Credited in Payroll'
        : 'Approved (Awaiting Payroll Adjustment)',
      adjustmentStatus: request.isSalaryCredited && request.payrollId
        ? 'ADJUSTED_IN_PAYROLL'
        : (request.salaryMonth && request.salaryYear ? 'APPROVED' : 'AWAITING_PAYROLL_ADJUSTMENT'),
      isSalaryCredited: Boolean(request.isSalaryCredited),
      payrollId: request.payrollId,
    })),
  };
}

/** Earnings projection only. Never increments Wallet.availableBalance. */
export async function getRkdWalletEarnings(employeeId: number) {
  const requests = await prisma.rkdRequest.findMany({
    where: { employeeId, status: 'APPROVED' }, orderBy: { reviewedAt: 'desc' },
  });
  return requests.map(request => ({
    id: `RKD-${request.id}`, requestId: request.id, reference: `RKD-${request.id}`,
    description: 'RKD Incentive', amount: request.commissionAmount,
    approvedAt: request.reviewedAt?.toISOString() || null,
    status: request.salaryMonth && request.salaryYear ? 'APPROVED_EARNING' : 'AWAITING_PAYROLL_ADJUSTMENT',
    salaryMonth: request.salaryMonth, salaryYear: request.salaryYear,
    payrollId: request.payrollId, includedInPayslip: request.isSalaryCredited && request.payrollId !== null,
    withdrawable: false,
  }));
}

// Nullable legacy event/reference values remain ordinary commission.
export const ordinaryCommissionFilter: Prisma.CommissionTransactionWhereInput = {
  AND: [
    { OR: [{ eventType: null }, { eventType: { not: 'RKD_REQUEST' } }] },
    { OR: [{ billId: null }, { billId: { not: { startsWith: 'RKD-' } } }] },
  ],
};

/** Visible explanation for unallocated approved earnings; never included in frozen totals. */
export async function getRkdPendingAdjustments(employeeId: number, month: number, year: number) {
  const { monthStart, monthEnd } = getIstMonthRange(year, month);
  const rows = await prisma.rkdRequest.findMany({ where: {
    employeeId, status: 'APPROVED', salaryMonth: null, salaryYear: null,
    reviewedAt: { gte: monthStart, lte: monthEnd },
  }, orderBy: { id: 'asc' } });
  return rows.map(row => ({ reference: `RKD-${row.id}`, requestId: row.id,
    amount: row.commissionAmount, approvedAt: row.reviewedAt?.toISOString() || null,
    status: 'AWAITING_PAYROLL_ADJUSTMENT', description: 'RKD Incentive',
  }));
}

const CLOSED_PAYROLL_STATUSES = new Set(['PAID', 'FINALIZED', 'DISBURSED', 'COMPLETED', 'REJECTED', 'CANCELLED']);
const OPEN_PAYROLL_STATUSES = new Set(['OPEN', 'DRAFT', 'PENDING', 'PENDING APPROVAL', 'PROCESSING', 'APPROVED']);

export function isLockedRkdPayrollStatus(status: unknown): boolean {
  return ['PAID', 'FINALIZED', 'DISBURSED', 'COMPLETED'].includes(String(status || '').trim().toUpperCase());
}

/** Only unfinalized/open payroll states can receive a new RKD allocation. */
export function isOpenRkdPayrollStatus(status: string): boolean {
  const s = String(status || '').trim().toUpperCase();
  if (CLOSED_PAYROLL_STATUSES.has(s)) return false;
  return OPEN_PAYROLL_STATUSES.has(s);
}
