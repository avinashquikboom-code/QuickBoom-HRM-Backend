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
    if (employeeId) whereClause.employeeId = parseInt(employeeId as string);
    if (storeId) whereClause.storeId = parseInt(storeId as string);
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
        designationRelation: true,
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
        designationRelation: true,
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
        designationRelation: true,
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
        designationRelation: true,
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
    if (employeeId) whereClause.employeeId = parseInt(employeeId as string);
    if (storeId) whereClause.storeId = parseInt(storeId as string);
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
