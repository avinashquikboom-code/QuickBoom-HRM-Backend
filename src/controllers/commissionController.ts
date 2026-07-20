import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

// Commission Dashboard Stats
export const getCommissionDashboard = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, storeId, startDate, endDate } = req.query;

    const whereClause: any = {};
    if (employeeId) {
      const parsedId = employeeId as string;
      if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(parsedId)) {
        whereClause.employeeId = parsedId;
      } else {
        const employee = await prisma.employee.findFirst({
          where: { employeeCode: employeeId as string }
        });
        if (employee) {
          whereClause.employeeId = employee.id;
        } else {
          whereClause.employeeId = '00000000-0000-0000-0000-000000000000';
        }
      }
    }
    
    if (storeId) {
      whereClause.storeId = storeId as string;
    }
    if (startDate && endDate) {
      whereClause.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }

    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayTransactions = await prisma.commissionTransaction.findMany({
      where: {
        ...whereClause,
        createdAt: { gte: today, lte: todayEnd },
      },
    });

    const todayCommission = todayTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const todaySales = todayTransactions.reduce((sum, t) => sum + t.saleAmount, 0);

    // Get month's stats
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthTransactions = await prisma.commissionTransaction.findMany({
      where: {
        ...whereClause,
        createdAt: { gte: monthStart },
      },
    });

    const monthCommission = monthTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const monthSales = monthTransactions.reduce((sum, t) => sum + t.saleAmount, 0);

    // Get pending stats
    const pendingTransactions = await prisma.commissionTransaction.findMany({
      where: {
        ...whereClause,
        status: 'PENDING',
      },
    });

    const pendingCommission = pendingTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);

    // Get paid stats
    const paidTransactions = await prisma.commissionTransaction.findMany({
      where: {
        ...whereClause,
        status: 'PAID',
      },
    });

    const paidCommission = paidTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);

    // Get top performers
    const allTransactions = await prisma.commissionTransaction.findMany({
      where: whereClause,
      include: {
        employee: true,
      },
    });

    const performerMap = new Map();
    allTransactions.forEach((t) => {
      if (!t.employee) return;
      const existing = performerMap.get(t.employeeId);
      if (existing) {
        existing.totalCommission += t.commissionAmount;
        existing.totalSales += t.saleAmount;
      } else {
        performerMap.set(t.employeeId, {
          employee: t.employee,
          totalCommission: t.commissionAmount,
          totalSales: t.saleAmount,
        });
      }
    });

    const topPerformers = Array.from(performerMap.values())
      .sort((a, b) => b.totalCommission - a.totalCommission)
      .slice(0, 10);

    const stats = {
      today: {
        commission: todayCommission,
        sales: todaySales,
        transactions: todayTransactions.length,
      },
      month: {
        commission: monthCommission,
        sales: monthSales,
        transactions: monthTransactions.length,
      },
      pending: {
        commission: pendingCommission,
        transactions: pendingTransactions.length,
      },
      paid: {
        commission: paidCommission,
        transactions: paidTransactions.length,
      },
      topPerformers,
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Get commission dashboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch commission dashboard.' });
  }
};

// Commission Policy CRUD
export const createCommissionPolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const policyData = req.body;
    const policy = await prisma.commissionPolicy.create({
      data: policyData,
      include: {
        employee: true,
        store: true,
        department: true,
        designation: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Commission policy created successfully.',
      policy,
    });
  } catch (error) {
    console.error('Create commission policy error:', error);
    res.status(500).json({ success: false, message: 'Failed to create commission policy.' });
  }
};

export const getCommissionPolicies = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { storeId, employeeId, isActive } = req.query;

    const whereClause: any = {};
    if (storeId) whereClause.storeId = storeId as string;
    if (employeeId) whereClause.employeeId = employeeId as string;
    if (isActive !== undefined) whereClause.isActive = isActive === 'true';

    const policies = await prisma.commissionPolicy.findMany({
      where: whereClause,
      include: {
        employee: true,
        store: true,
        department: true,
        designation: true,
      },
      orderBy: { priority: 'asc' },
    });

    res.json({ success: true, policies });
  } catch (error) {
    console.error('Get commission policies error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch commission policies.' });
  }
};

export const getCommissionPolicyById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const policyId = Array.isArray(id) ? id[0] : id;
    const policy = await prisma.commissionPolicy.findUnique({
      where: { id: policyId },
      include: {
        employee: true,
        store: true,
        department: true,
        designation: true,
      },
    });

    if (!policy) {
      res.status(404).json({ success: false, message: 'Commission policy not found.' });
      return;
    }

    res.json({ success: true, policy });
  } catch (error) {
    console.error('Get commission policy error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch commission policy.' });
  }
};

export const updateCommissionPolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const policyId = Array.isArray(id) ? id[0] : id;
    const policyData = req.body;

    const policy = await prisma.commissionPolicy.update({
      where: { id: policyId },
      data: policyData,
      include: {
        employee: true,
        store: true,
        department: true,
        designation: true,
      },
    });

    res.json({
      success: true,
      message: 'Commission policy updated successfully.',
      policy,
    });
  } catch (error) {
    console.error('Update commission policy error:', error);
    res.status(500).json({ success: false, message: 'Failed to update commission policy.' });
  }
};

export const deleteCommissionPolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const policyId = Array.isArray(id) ? id[0] : id;
    await prisma.commissionPolicy.delete({
      where: { id: policyId },
    });

    res.json({ success: true, message: 'Commission policy deleted successfully.' });
  } catch (error) {
    console.error('Delete commission policy error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete commission policy.' });
  }
};

// Commission Transaction CRUD
export const createCommissionTransaction = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const transactionData = req.body;
    const transaction = await prisma.commissionTransaction.create({
      data: transactionData,
      include: {
        employee: true,
        store: true,
        policy: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Commission transaction created successfully.',
      transaction,
    });
  } catch (error) {
    console.error('Create commission transaction error:', error);
    res.status(500).json({ success: false, message: 'Failed to create commission transaction.' });
  }
};

export const getCommissionTransactions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, storeId, status, startDate, endDate } = req.query;

    const whereClause: any = {};
    if (employeeId) {
      const parsedId = employeeId as string;
      if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(parsedId)) {
        whereClause.employeeId = parsedId;
      } else {
        const employee = await prisma.employee.findFirst({
          where: { employeeCode: employeeId as string }
        });
        if (employee) {
          whereClause.employeeId = employee.id;
        } else {
          whereClause.employeeId = '00000000-0000-0000-0000-000000000000';
        }
      }
    }
    
    if (storeId) {
      whereClause.storeId = storeId as string;
    }
    if (status) whereClause.status = status;
    if (startDate && endDate) {
      whereClause.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }

    const transactions = await prisma.commissionTransaction.findMany({
      where: whereClause,
      include: {
        employee: true,
        store: true,
        policy: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, transactions });
  } catch (error) {
    console.error('Get commission transactions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch commission transactions.' });
  }
};

export const approveCommissionTransaction = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const transactionId = Array.isArray(id) ? id[0] : id;
    const { notes } = req.body;

    const transaction = await prisma.commissionTransaction.update({
      where: { id: transactionId },
      data: {
        status: 'APPROVED',
        approvedBy: req.user?.id,
        approvedAt: new Date(),
        notes,
      },
      include: {
        employee: true,
        store: true,
        policy: true,
      },
    });

    res.json({
      success: true,
      message: 'Commission transaction approved successfully.',
      transaction,
    });
  } catch (error) {
    console.error('Approve commission transaction error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve commission transaction.' });
  }
};

export const rejectCommissionTransaction = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const transactionId = Array.isArray(id) ? id[0] : id;
    const { notes } = req.body;

    const transaction = await prisma.commissionTransaction.update({
      where: { id: transactionId },
      data: {
        status: 'REJECTED',
        approvedBy: req.user?.id,
        approvedAt: new Date(),
        notes,
      },
      include: {
        employee: true,
        store: true,
        policy: true,
      },
    });

    res.json({
      success: true,
      message: 'Commission transaction rejected successfully.',
      transaction,
    });
  } catch (error) {
    console.error('Reject commission transaction error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject commission transaction.' });
  }
};

// Commission Target CRUD
export const createCommissionTarget = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const targetData = req.body;
    const target = await prisma.commissionTarget.create({
      data: targetData,
      include: {
        employee: true,
        store: true,
        policy: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Commission target created successfully.',
      target,
    });
  } catch (error) {
    console.error('Create commission target error:', error);
    res.status(500).json({ success: false, message: 'Failed to create commission target.' });
  }
};

export const getCommissionTargets = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, storeId, status } = req.query;

    const whereClause: any = {};
    if (employeeId) whereClause.employeeId = employeeId as string;
    if (storeId) whereClause.storeId = storeId as string;
    if (status) whereClause.status = status;

    const targets = await prisma.commissionTarget.findMany({
      where: whereClause,
      include: {
        employee: true,
        store: true,
        policy: true,
      },
      orderBy: { startDate: 'desc' },
    });

    res.json({ success: true, targets });
  } catch (error) {
    console.error('Get commission targets error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch commission targets.' });
  }
};

export const updateCommissionTarget = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const targetId = Array.isArray(id) ? id[0] : id;
    const targetData = req.body;

    const target = await prisma.commissionTarget.update({
      where: { id: targetId },
      data: targetData,
      include: {
        employee: true,
        store: true,
        policy: true,
      },
    });

    res.json({
      success: true,
      message: 'Commission target updated successfully.',
      target,
    });
  } catch (error) {
    console.error('Update commission target error:', error);
    res.status(500).json({ success: false, message: 'Failed to update commission target.' });
  }
};

// Commission Calculation
export const calculateCommission = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, saleAmount, storeId, billId, invoiceNumber } = req.body;

    // Find applicable policy for the employee
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        commissionPolicies: {
          where: { isActive: true },
          orderBy: { priority: 'asc' },
        },
      },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    // Find the most specific policy
    let policy = employee.commissionPolicies[0];
    
    // If no employee-specific policy, check store policy
    if (!policy && storeId) {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        include: {
          commissionPolicies: {
            where: { isActive: true },
            orderBy: { priority: 'asc' },
          },
        },
      });
      if (store && store.commissionPolicies.length > 0) {
        policy = store.commissionPolicies[0];
      }
    }

    let commission = 0;
    let commissionPercent = 0;

    if (policy) {
      if (policy.commissionType === 'PERCENTAGE') {
        commission = (saleAmount * policy.commissionValue) / 100;
        commissionPercent = policy.commissionValue;
      } else if (policy.commissionType === 'FIXED') {
        commission = policy.commissionValue;
      }
    }

    res.json({
      success: true,
      commission,
      commissionPercent,
      policy,
      employee,
      message: policy ? 'Commission calculated successfully.' : 'No applicable commission policy found.',
    });
  } catch (error) {
    console.error('Calculate commission error:', error);
    res.status(500).json({ success: false, message: 'Failed to calculate commission.' });
  }
};

// Commission Settlement
export const createCommissionSettlement = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, settlementDate, notes } = req.body;

    // Calculate total commission for the employee
    const transactions = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employeeId,
        status: 'APPROVED',
        paidAt: null,
      },
    });

    const totalCommission = transactions.reduce((sum, t) => sum + t.commissionAmount, 0);

    const settlement = await prisma.commissionSettlement.create({
      data: {
        employeeId: employeeId,
        settlementDate: new Date(settlementDate),
        totalCommission,
        totalBonus: 0,
        totalDeduction: 0,
        netAmount: totalCommission,
        status: 'PENDING',
        notes,
      },
    });

    // Mark transactions as paid
    await prisma.commissionTransaction.updateMany({
      where: {
        id: { in: transactions.map(t => t.id) },
      },
      data: {
        payrollId: settlement.id,
        paidAt: new Date(),
        status: 'PAID',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Commission settlement created successfully.',
      settlement,
    });
  } catch (error) {
    console.error('Create commission settlement error:', error);
    res.status(500).json({ success: false, message: 'Failed to create commission settlement.' });
  }
};

interface GroupedReport {
  periodStart: string;
  periodEnd: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  branchName: string;
  totalSales: number;
  totalCredits: number;
  netSales: number;
  commissionRate: number;
  commissionAmount: number;
}

export const fetchCommissionReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const fromStr = req.query.from as string;
    const toStr = req.query.to as string;
    const groupBy = ((req.query.groupBy as string) || 'day').toLowerCase();

    if (groupBy !== 'day' && groupBy !== 'week' && groupBy !== 'month') {
      res.status(400).json({
        success: false,
        message: 'Invalid groupBy parameter. Must be day, week, or month.',
      });
      return;
    }

    let gteDate: Date | undefined;
    let lteDate: Date | undefined;
    if (fromStr) {
      gteDate = new Date(`${fromStr}T00:00:00+05:30`);
    }
    if (toStr) {
      lteDate = new Date(`${toStr}T23:59:59.999+05:30`);
    }

    let targetEmployeeId: string | undefined;
    // For all mobile-authenticated users (not HR/Admin), scope report to their own records
    const mobileRoles = ['EMPLOYEE', 'SALESMAN', 'STORE_MANAGER', 'HELPER'];
    if (req.user?.role && mobileRoles.includes(req.user.role)) {
      const employee = await prisma.employee.findUnique({
        where: { userId: req.user.id },
      });
      if (!employee) {
        res.json({ success: true, data: [] });
        return;
      }
      targetEmployeeId = employee.id;
    } else if (req.query.employeeId) {
      const parsedId = req.query.employeeId as string;
      if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(parsedId)) {
        targetEmployeeId = parsedId;
      } else {
        const employee = await prisma.employee.findFirst({
          where: { employeeCode: req.query.employeeId as string }
        });
        if (employee) {
          targetEmployeeId = employee.id;
        } else {
          targetEmployeeId = '00000000-0000-0000-0000-000000000000';
        }
      }
    }

    const transactions = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: targetEmployeeId,
        createdAt: {
          gte: gteDate,
          lte: lteDate,
        },
      },
      include: {
        employee: {
          include: {
            store: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const groups: {
      [key: string]: {
        periodStart: string;
        periodEnd: string;
        employeeId: string;
        employeeName: string;
        employeeCode: string;
        branchName: string;
        sales: number;
        credits: number;
        commissionAmount: number;
        rates: number[];
      };
    } = {};

    const formatDateString = (d: Date) => {
      return d.toISOString().split('T')[0];
    };

    const getPeriodBoundaries = (date: Date, type: string) => {
      const istDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);

      if (type === 'day') {
        const start = new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate()));
        return {
          start: formatDateString(start),
          end: formatDateString(start),
        };
      } else if (type === 'week') {
        const utcDay = istDate.getUTCDay();
        const dayDiff = utcDay === 0 ? -6 : 1 - utcDay;

        const monday = new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate() + dayDiff));
        const sunday = new Date(monday);
        sunday.setUTCDate(monday.getUTCDate() + 6);

        return {
          start: formatDateString(monday),
          end: formatDateString(sunday),
        };
      } else {
        const firstDay = new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), 1));
        const lastDay = new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth() + 1, 0));
        return {
          start: formatDateString(firstDay),
          end: formatDateString(lastDay),
        };
      }
    };

    for (const tx of transactions as any[]) {
      const { start, end } = getPeriodBoundaries(tx.createdAt, groupBy);
      const empId = tx.employeeId;
      let empName = 'Employee';
      let empCode = '';
      let branchName = '';
      if (tx.employee) {
        empName = `${tx.employee.firstName || ''} ${tx.employee.lastName || ''}`.trim() || 'Employee';
        empCode = tx.employee.employeeCode || '';
        branchName = tx.employee.store?.name || '';
      }

      const key = `${empId}_${start}`;
      if (!groups[key]) {
        groups[key] = {
          periodStart: start,
          periodEnd: end,
          employeeId: empId,
          employeeName: empName,
          employeeCode: empCode,
          branchName: branchName,
          sales: 0,
          credits: 0,
          commissionAmount: 0,
          rates: [],
        };
      }

      const amount = tx.saleAmount;
      if (amount > 0) {
        groups[key].sales += amount;
      } else {
        groups[key].credits += Math.abs(amount);
      }

      groups[key].commissionAmount += tx.commissionAmount;
      if (tx.commissionPercent !== null && tx.commissionPercent !== undefined) {
        groups[key].rates.push(tx.commissionPercent);
      }
    }

    const report: GroupedReport[] = Object.values(groups).map((g) => {
      const netSales = g.sales - g.credits;
      let commissionRate = 0;
      if (g.rates.length > 0) {
        commissionRate = g.rates.reduce((sum, val) => sum + val, 0) / g.rates.length;
      } else if (netSales > 0) {
        commissionRate = (g.commissionAmount / netSales) * 100;
      }

      return {
        periodStart: g.periodStart,
        periodEnd: g.periodEnd,
        employeeId: g.employeeId,
        employeeName: g.employeeName,
        employeeCode: g.employeeCode,
        branchName: g.branchName,
        totalSales: Number(g.sales.toFixed(2)),
        totalCredits: Number(g.credits.toFixed(2)),
        netSales: Number(netSales.toFixed(2)),
        commissionRate: Number(commissionRate.toFixed(2)),
        commissionAmount: Number(g.commissionAmount.toFixed(2)),
      };
    });

    res.json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    console.error('Fetch commission report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate commission report.',
    });
  }
};
