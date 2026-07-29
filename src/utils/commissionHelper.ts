import { prisma } from './db';

/**
 * Resolves an employee identifier (GUID string, employeeCode, or integer ID)
 * to the canonical local Employee DB primary key (id).
 */
export async function resolveEmployeeId(identifier?: string | number | null): Promise<number | null> {
  if (!identifier) return null;
  const str = String(identifier).trim();
  if (!str) return null;

  // 1. Check for GUID match on employeeID (case-insensitive)
  const byGuid = await prisma.employee.findFirst({
    where: { employeeID: { equals: str, mode: 'insensitive' } },
  });
  if (byGuid) return byGuid.id;

  // 2. Check for employeeCode match
  const byCode = await prisma.employee.findFirst({
    where: { employeeCode: { equals: str, mode: 'insensitive' } },
  });
  if (byCode) return byCode.id;

  // 3. Check for DB integer primary key match
  const parsedInt = parseInt(str, 10);
  if (!isNaN(parsedInt)) {
    const byPk = await prisma.employee.findUnique({ where: { id: parsedInt } });
    if (byPk) return byPk.id;
  }

  return null;
}

export interface CommissionSummaryStats {
  today: {
    commission: number;
    sales: number;
    transactions: number;
  };
  month: {
    commission: number;
    sales: number;
    transactions: number;
  };
  pending: {
    commission: number;
    transactions: number;
  };
  paid: {
    commission: number;
    transactions: number;
  };
  lifetime: {
    commission: number;
    sales: number;
    transactions: number;
  };
  topPerformers: Array<{
    employee: any;
    totalCommission: number;
    totalSales: number;
  }>;
}

export async function getCommissionStats(params?: {
  employeeId?: number | null;
  storeId?: number | null;
  startDate?: Date;
  endDate?: Date;
}): Promise<CommissionSummaryStats> {
  const whereClause: any = {};
  if (params?.employeeId) {
    whereClause.employeeId = params.employeeId;
  }
  if (params?.storeId) {
    whereClause.storeId = params.storeId;
  }

  if (params?.startDate || params?.endDate) {
    whereClause.createdAt = {};
    if (params.startDate) whereClause.createdAt.gte = params.startDate;
    if (params.endDate) whereClause.createdAt.lte = params.endDate;
  }

  // Filter out rejected or cancelled transactions
  whereClause.status = { in: ['PENDING', 'APPROVED', 'PAID'] };

  const allTransactions = await prisma.commissionTransaction.findMany({
    where: whereClause,
    include: {
      employee: {
        include: {
          store: true,
        },
      },
      store: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  const todayTxns = allTransactions.filter(
    (t) => new Date(t.createdAt) >= todayStart && new Date(t.createdAt) <= todayEnd
  );
  const monthTxns = allTransactions.filter((t) => new Date(t.createdAt) >= monthStart);
  const pendingTxns = allTransactions.filter(
    (t) => t.status === 'PENDING' || t.status === 'APPROVED'
  );
  const paidTxns = allTransactions.filter((t) => t.status === 'PAID');

  const todayComm = todayTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);
  const todaySales = todayTxns.reduce((sum, t) => sum + (t.saleAmount || 0), 0);

  const monthComm = monthTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);
  const monthSales = monthTxns.reduce((sum, t) => sum + (t.saleAmount || 0), 0);

  const pendingComm = pendingTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);
  const paidComm = paidTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);

  const lifetimeComm = allTransactions.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);
  const lifetimeSales = allTransactions.reduce((sum, t) => sum + (t.saleAmount || 0), 0);

  // Group top performers
  const performerMap = new Map<number, { employee: any; totalCommission: number; totalSales: number }>();
  allTransactions.forEach((t) => {
    if (!t.employee) return;
    const empId = t.employeeId;
    const existing = performerMap.get(empId);
    if (existing) {
      existing.totalCommission += t.commissionAmount || 0;
      existing.totalSales += t.saleAmount || 0;
    } else {
      performerMap.set(empId, {
        employee: t.employee,
        totalCommission: t.commissionAmount || 0,
        totalSales: t.saleAmount || 0,
      });
    }
  });

  const topPerformers = Array.from(performerMap.values())
    .sort((a, b) => b.totalCommission - a.totalCommission)
    .slice(0, 10);

  return {
    today: {
      commission: Math.round(todayComm * 100) / 100,
      sales: Math.round(todaySales * 100) / 100,
      transactions: todayTxns.length,
    },
    month: {
      commission: Math.round(monthComm * 100) / 100,
      sales: Math.round(monthSales * 100) / 100,
      transactions: monthTxns.length,
    },
    pending: {
      commission: Math.round(pendingComm * 100) / 100,
      transactions: pendingTxns.length,
    },
    paid: {
      commission: Math.round(paidComm * 100) / 100,
      transactions: paidTxns.length,
    },
    lifetime: {
      commission: Math.round(lifetimeComm * 100) / 100,
      sales: Math.round(lifetimeSales * 100) / 100,
      transactions: allTransactions.length,
    },
    topPerformers,
  };
}
