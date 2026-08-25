import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { getCommissionStats, resolveEmployeeId, isEligibleCommissionEmployee, safeParseDate } from '../utils/commissionHelper';
import { deduplicateCommissionTransactions } from '../utils/commissionDeduplicator';

// Commission Dashboard Stats
export const getCommissionDashboard = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, storeId, startDate, endDate } = req.query;

    let targetEmpId: number | null = null;
    if (employeeId) {
      targetEmpId = await resolveEmployeeId(employeeId as string);
      if (targetEmpId === null) targetEmpId = -1;
    }

    let parsedStoreId: number | null = null;
    if (storeId && storeId !== 'all' && storeId !== '' && !isNaN(parseInt(storeId as string, 10))) {
      parsedStoreId = parseInt(storeId as string, 10);
    }

    const start = startDate ? String(startDate) : undefined;
    const end = endDate ? String(endDate) : undefined;

    console.log(`[Commission API]\nFilter:\nmonth: ${startDate ? String(startDate).slice(0, 7) : 'all'}\nstoreId: ${parsedStoreId || 'all'}\nemployeeId: ${targetEmpId || 'all'}\nstartDate: ${start || 'none'}\nendDate: ${end || 'none'}`);

    const stats = await getCommissionStats({
      employeeId: targetEmpId,
      storeId: parsedStoreId,
      startDate: start,
      endDate: end,
    });

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Get commission dashboard error:', error);
    res.json({
      success: true,
      stats: {
        today: { commission: 0, sales: 0, transactions: 0 },
        month: { commission: 0, sales: 0, transactions: 0 },
        pending: { commission: 0, transactions: 0 },
        paid: { commission: 0, transactions: 0 },
        lifetime: { commission: 0, sales: 0, transactions: 0 },
        topPerformers: [],
      },
    });
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
    if (storeId) whereClause.storeId = parseInt(storeId as string);
    if (employeeId) whereClause.employeeId = parseInt(employeeId as string);
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
      where: { id: parseInt(policyId) },
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
      where: { id: parseInt(policyId) },
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
      where: { id: parseInt(policyId) },
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
    let transaction;
    if (transactionData.billId && transactionData.employeeId) {
      transaction = await prisma.commissionTransaction.upsert({
        where: {
          billId_employeeId: {
            billId: String(transactionData.billId),
            employeeId: parseInt(transactionData.employeeId, 10),
          }
        },
        update: {
          ...transactionData,
          employeeId: parseInt(transactionData.employeeId, 10),
          billId: String(transactionData.billId),
        },
        create: {
          ...transactionData,
          employeeId: parseInt(transactionData.employeeId, 10),
          billId: String(transactionData.billId),
        },
        include: {
          employee: true,
          store: true,
          policy: true,
        },
      });
    } else {
      transaction = await prisma.commissionTransaction.create({
        data: transactionData,
        include: {
          employee: true,
          store: true,
          policy: true,
        },
      });
    }

    res.status(201).json({
      success: true,
      message: 'Commission transaction processed successfully.',
      transaction,
    });
  } catch (error) {
    console.error('Create commission transaction error:', error);
    res.status(500).json({ success: false, message: 'Failed to create commission transaction.' });
  }
};

export const searchSalesByBillId = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const rawBillId = req.params.billId;
    const billIdStr = Array.isArray(rawBillId) ? String(rawBillId[0]) : String(rawBillId);

    console.log('[Search] Bill ID:', billIdStr);

    const sale = await prisma.commissionTransaction.findFirst({
      where: {
        OR: [
          { billId: billIdStr },
          { invoiceNumber: billIdStr },
        ],
      },
      include: {
        employee: true,
        store: true,
      },
    });

    if (!sale) {
      res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
      return;
    }

    const emp = sale.employee;
    const empName = emp ? `${emp.firstName} ${emp.lastName}`.trim() : null;
    const rate = sale.commissionPercent ?? emp?.commissionPercentage ?? 0;
    const commission = sale.commissionAmount || (sale.saleAmount * rate) / 100;

    console.log('[Search] Found:', {
      billId: sale.billId || sale.invoiceNumber,
      amount: sale.saleAmount,
      employee: empName,
      commission,
    });

    res.json({
      success: true,
      data: {
        sale: {
          id: sale.id,
          billId: sale.billId || sale.invoiceNumber,
          amount: sale.saleAmount,
          saleDate: sale.createdAt,
          source: 'HOPKID_WEBHOOK',
          description: sale.notes,
        },
        employee: {
          id: emp?.id,
          name: empName,
          code: emp?.employeeCode,
          phone: emp?.mobileNumber,
          commissionRate: emp?.commissionPercentage,
        },
        calculation: {
          saleAmount: sale.saleAmount,
          commissionRate: rate,
          commission: Math.round(commission * 100) / 100,
        },
      },
    });
  } catch (error: any) {
    console.error('[Search] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCommissionTransactions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, storeId, status, startDate, endDate, search, billId } = req.query;

    const whereClause: any = {};
    if (employeeId) {
      const resolvedId = await resolveEmployeeId(employeeId as string);
      whereClause.employeeId = resolvedId !== null ? resolvedId : -1;
    } else if (req.user?.role === 'EMPLOYEE' && req.user?.id) {
      const currentEmp = await prisma.employee.findFirst({
        where: { userId: req.user.id }
      });
      if (currentEmp) {
        whereClause.employeeId = currentEmp.id;
      }
    }
    
    if (storeId && storeId !== 'all' && storeId !== '' && !isNaN(parseInt(storeId as string, 10))) {
      whereClause.storeId = parseInt(storeId as string, 10);
    }
    if (status && status !== 'all' && status !== '') {
      whereClause.status = status as string;
    }

    if (billId) {
      const bId = Array.isArray(billId) ? String(billId[0]) : String(billId);
      whereClause.OR = [
        { billId: bId },
        { invoiceNumber: bId },
      ];
    } else if (search) {
      const term = Array.isArray(search) ? String(search[0]).trim() : String(search).trim();
      whereClause.OR = [
        { billId: { contains: term, mode: 'insensitive' } },
        { invoiceNumber: { contains: term, mode: 'insensitive' } },
        { employee: { firstName: { contains: term, mode: 'insensitive' } } },
        { employee: { lastName: { contains: term, mode: 'insensitive' } } },
        { employee: { employeeCode: { contains: term, mode: 'insensitive' } } },
      ];
    }

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        const startOf = safeParseDate(startDate as string);
        startOf.setHours(0, 0, 0, 0);
        whereClause.createdAt.gte = startOf;
      }
      if (endDate) {
        const endOf = safeParseDate(endDate as string);
        endOf.setHours(23, 59, 59, 999);
        whereClause.createdAt.lte = endOf;
      }
    }

    const rawTransactions = await prisma.commissionTransaction.findMany({
      where: whereClause,
      include: {
        employee: {
          include: {
            store: true,
            user: true,
          },
        },
        store: true,
        policy: true,
      },
      orderBy: [{ id: 'desc' }, { createdAt: 'desc' }],
    });

    const eligible = rawTransactions.filter((t) => isEligibleCommissionEmployee(t.employee));
    const transactions = deduplicateCommissionTransactions(eligible);

    console.log(`[Commission API]\nFilter:\nmonth: ${startDate ? String(startDate).slice(0, 7) : 'all'}\nstoreId: ${whereClause.storeId || 'all'}\nemployeeId: ${whereClause.employeeId || 'all'}\nstartDate: ${startDate || 'none'}\nendDate: ${endDate || 'none'}`);
    console.log(`[Commission API]\nTransactions found: ${transactions.length}`);
    console.log(`[Commission API]\nEmployees mapped: ${new Set(transactions.map(t => t.employeeId)).size}`);

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
      where: { id: parseInt(transactionId) },
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
      where: { id: parseInt(transactionId) },
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
    if (employeeId) whereClause.employeeId = parseInt(employeeId as string);
    if (storeId) whereClause.storeId = parseInt(storeId as string);
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
      where: { id: parseInt(targetId) },
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
      where: { id: parseInt(employeeId) },
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
        where: { id: parseInt(storeId) },
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
        employeeId: parseInt(employeeId),
        status: 'APPROVED',
        paidAt: null,
      },
    });

    const totalCommission = transactions.reduce((sum, t) => sum + t.commissionAmount, 0);

    const settlement = await prisma.commissionSettlement.create({
      data: {
        employeeId: parseInt(employeeId),
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
  employeeId: number;
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
      const d = new Date(fromStr.includes('T') ? fromStr : `${fromStr}T00:00:00+05:30`);
      if (isNaN(d.getTime())) {
        res.status(400).json({
          success: false,
          message: 'Invalid "from" date format. Use ISO 8601 format (YYYY-MM-DD).',
        });
        return;
      }
      gteDate = d;
    }
    if (toStr) {
      const d = new Date(toStr.includes('T') ? toStr : `${toStr}T23:59:59.999+05:30`);
      if (isNaN(d.getTime())) {
        res.status(400).json({
          success: false,
          message: 'Invalid "to" date format. Use ISO 8601 format (YYYY-MM-DD).',
        });
        return;
      }
      lteDate = d;
    }

    if (gteDate && lteDate && gteDate > lteDate) {
      const temp = gteDate;
      gteDate = lteDate;
      lteDate = temp;
    }

    let targetEmployeeId: number | undefined;
    const mobileRoles = ['EMPLOYEE', 'SALESMAN', 'STORE_MANAGER', 'HELPER'];
    if (req.user?.role && mobileRoles.includes(req.user.role)) {
      const employee = await prisma.employee.findUnique({
        where: { userId: req.user.id },
      });
      if (!employee) {
        res.json({
          success: true,
          data: [],
          report: [],
          summary: {
            totalSales: 0,
            totalCredits: 0,
            netSales: 0,
            totalCommission: 0,
            transactionCount: 0,
            averageSale: 0,
            periodCount: 0,
            dateRange: { from: fromStr || null, to: toStr || null },
          },
        });
        return;
      }
      targetEmployeeId = employee.id;
    } else if (req.query.employeeId) {
      const resolvedId = await resolveEmployeeId(req.query.employeeId as string);
      targetEmployeeId = resolvedId !== null ? resolvedId : -1;
    }

    let targetStoreId: number | undefined;
    if (req.query.storeId) {
      const parsedStoreId = parseInt(req.query.storeId as string, 10);
      if (!isNaN(parsedStoreId)) {
        targetStoreId = parsedStoreId;
      }
    }

    const whereClause: any = {
      employee: {
        source: { not: 'MANUAL' },
      },
    };

    if (gteDate || lteDate) {
      whereClause.createdAt = {};
      if (gteDate) whereClause.createdAt.gte = gteDate;
      if (lteDate) whereClause.createdAt.lte = lteDate;
    }

    if (targetEmployeeId !== undefined) whereClause.employeeId = targetEmployeeId;
    if (targetStoreId !== undefined) whereClause.storeId = targetStoreId;

    const rawTransactions = await prisma.commissionTransaction.findMany({
      where: whereClause,
      include: {
        employee: {
          include: {
            store: true,
            user: true,
          },
        },
        store: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 10000,
    });

    const transactions = rawTransactions.filter((t) => isEligibleCommissionEmployee(t.employee));

    const empWhere: any = {
      status: 'active',
      source: { not: 'MANUAL' },
    };
    if (targetEmployeeId !== undefined) empWhere.id = targetEmployeeId;
    if (targetStoreId !== undefined) empWhere.storeId = targetStoreId;

    const rawAllEmployees = await prisma.employee.findMany({
      where: empWhere,
      include: { store: true, user: true },
      take: 2000,
    });

    const allEmployees = rawAllEmployees.filter(isEligibleCommissionEmployee);

    const groups: {
      [key: string]: {
        periodStart: string;
        periodEnd: string;
        employeeId: number;
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
      try {
        if (!d || isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
        return d.toISOString().split('T')[0];
      } catch (_) {
        return new Date().toISOString().split('T')[0];
      }
    };

    const defaultStart = fromStr || formatDateString(new Date());
    const defaultEnd = toStr || formatDateString(new Date());

    for (const emp of allEmployees) {
      const empName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee';
      const empCode = emp.employeeCode || '';
      const branchName = emp.store?.name || 'Unassigned';
      const key = `${emp.id}_${defaultStart}`;

      groups[key] = {
        periodStart: defaultStart,
        periodEnd: defaultEnd,
        employeeId: emp.id,
        employeeName: empName,
        employeeCode: empCode,
        branchName: branchName,
        sales: 0,
        credits: 0,
        commissionAmount: 0,
        rates: emp.commissionPercentage !== null && emp.commissionPercentage !== undefined ? [emp.commissionPercentage] : [0],
      };
    }

    const getPeriodBoundaries = (dateInput: any, type: string) => {
      const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
      const validDate = (!d || isNaN(d.getTime())) ? new Date() : d;
      const istDate = new Date(validDate.getTime() + 5.5 * 60 * 60 * 1000);

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

    for (const tx of transactions) {
      const { start, end } = getPeriodBoundaries(tx.createdAt, groupBy);
      const empId = tx.employeeId;
      let empName = 'Employee';
      let empCode = '';
      let branchName = '';
      if (tx.employee) {
        empName = `${tx.employee.firstName || ''} ${tx.employee.lastName || ''}`.trim() || 'Employee';
        empCode = tx.employee.employeeCode || '';
        branchName = (tx as any).store?.name || tx.employee.store?.name || '';
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

      const amount = tx.saleAmount || 0;
      if (amount > 0) {
        groups[key].sales += amount;
      } else {
        groups[key].credits += Math.abs(amount);
      }

      groups[key].commissionAmount += (tx.commissionAmount || 0);
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

    report.sort((a, b) => {
      if (b.commissionAmount !== a.commissionAmount) {
        return b.commissionAmount - a.commissionAmount;
      }
      if (b.netSales !== a.netSales) {
        return b.netSales - a.netSales;
      }
      return a.employeeName.localeCompare(b.employeeName);
    });

    const totalSales = report.reduce((sum, r) => sum + r.totalSales, 0);
    const totalCredits = report.reduce((sum, r) => sum + r.totalCredits, 0);
    const netSales = report.reduce((sum, r) => sum + r.netSales, 0);
    const totalCommission = report.reduce((sum, r) => sum + r.commissionAmount, 0);
    const transactionCount = transactions.length;
    const averageSale = transactionCount > 0 ? totalSales / transactionCount : 0;

    const summary = {
      totalSales: Number(totalSales.toFixed(2)),
      totalCredits: Number(totalCredits.toFixed(2)),
      netSales: Number(netSales.toFixed(2)),
      totalCommission: Number(totalCommission.toFixed(2)),
      transactionCount,
      averageSale: Number(averageSale.toFixed(2)),
      periodCount: report.length,
      dateRange: {
        from: fromStr || (gteDate ? formatDateString(gteDate) : null),
        to: toStr || (lteDate ? formatDateString(lteDate) : null),
      },
    };

    res.json({
      success: true,
      data: report,
      report,
      summary,
    });
  } catch (error: any) {
    console.error('Fetch commission report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate commission report.',
      error: error?.message || 'Server error',
    });
  }
};
