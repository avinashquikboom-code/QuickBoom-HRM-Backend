import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

export const fetchCommissionWallet = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { store: true }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee record not found.' });
      return;
    }

    const allTransactions = await prisma.commissionTransaction.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' }
    });

    const approvedOrPaid = allTransactions.filter(t => t.status !== 'REJECTED' && t.status !== 'CANCELLED');
    const pendingTransactions = approvedOrPaid.filter(t => t.status === 'PENDING' || t.status === 'APPROVED');
    const paidTransactions = approvedOrPaid.filter(t => t.status === 'PAID');

    const pendingCommission = pendingTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const paidCommission = paidTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const lifetimeCommission = approvedOrPaid.reduce((sum, t) => sum + t.commissionAmount, 0);

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const currentMonthTxns = approvedOrPaid.filter(t => new Date(t.createdAt) >= currentMonthStart);
    const lastMonthTxns = approvedOrPaid.filter(t => {
      const dt = new Date(t.createdAt);
      return dt >= lastMonthStart && dt <= lastMonthEnd;
    });

    const currentMonthCommission = currentMonthTxns.reduce((sum, t) => sum + t.commissionAmount, 0);
    const lastMonthCommission = lastMonthTxns.reduce((sum, t) => sum + t.commissionAmount, 0);

    // Map recent transactions (limit to 10)
    const recentTransactions = allTransactions.slice(0, 10).map(t => ({
      id: t.id.toString(),
      invoiceNumber: t.invoiceNumber || t.billId || `TXN-${t.id}`,
      customerName: t.notes || 'Retail Sale',
      billAmount: t.saleAmount,
      commissionPercentage: t.commissionPercent || 0,
      commissionEarned: t.commissionAmount,
      generatedDate: t.createdAt.toISOString(),
      paymentDate: t.paidAt ? t.paidAt.toISOString() : null,
      status: t.status === 'PAID' ? 'Paid' : 'Pending',
      remarks: t.notes,
    }));

    const totalSalesAmount = approvedOrPaid.reduce((sum, t) => sum + t.saleAmount, 0);

    res.json({
      success: true,
      data: {
        totalCommissionBalance: pendingCommission,
        currentMonthCommission,
        lastMonthCommission,
        lifetimeCommission,
        pendingCommission,
        paidCommission,
        recentTransactions,
        monthlySummary: {
          month: now.toLocaleString('default', { month: 'long' }),
          year: now.getFullYear().toString(),
          totalBills: currentMonthTxns.length,
          totalSalesAmount: currentMonthTxns.reduce((sum, t) => sum + t.saleAmount, 0),
          totalCommissionEarned: currentMonthCommission,
          paidCommission: currentMonthTxns.filter(t => t.status === 'PAID').reduce((sum, t) => sum + t.commissionAmount, 0),
          pendingCommission: currentMonthTxns.filter(t => t.status !== 'PAID').reduce((sum, t) => sum + t.commissionAmount, 0),
        },
        statistics: {
          totalBillsGenerated: approvedOrPaid.length,
          totalSalesAmount,
          totalCommissionEarned: lifetimeCommission,
          paidCommission,
          pendingCommission,
          averageCommissionPerBill: approvedOrPaid.length > 0 ? lifetimeCommission / approvedOrPaid.length : 0,
          totalCustomers: approvedOrPaid.length,
        }
      }
    });
  } catch (error) {
    console.error('Fetch commission wallet error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve commission wallet data.' });
  }
};

export const fetchCommissionHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee record not found.' });
      return;
    }

    const { status, limit = 20, page = 1, startDate, endDate, month } = req.query;
    const skipVal = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);

    const whereClause: any = { employeeId: employee.id };
    if (status) {
      const upperStatus = (status as string).toUpperCase();
      whereClause.status = upperStatus;
    }

    if (startDate && endDate) {
      whereClause.createdAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    } else if (month) {
      const parts = (month as string).split('-');
      if (parts.length === 2) {
        const year = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        whereClause.createdAt = {
          gte: new Date(year, m, 1),
          lte: new Date(year, m + 1, 0, 23, 59, 59, 999),
        };
      }
    }

    const transactions = await prisma.commissionTransaction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string, 10),
      skip: skipVal,
    });

    const totalCount = await prisma.commissionTransaction.count({ where: whereClause });

    res.json({
      success: true,
      data: {
        transactions: transactions.map(t => ({
          id: t.id.toString(),
          invoiceNumber: t.invoiceNumber || t.billId || `TXN-${t.id}`,
          customerName: t.notes || 'Retail Sale',
          billAmount: t.saleAmount,
          commissionPercentage: t.commissionPercent || 0,
          commissionEarned: t.commissionAmount,
          generatedDate: t.createdAt.toISOString(),
          paymentDate: t.paidAt ? t.paidAt.toISOString() : null,
          status: t.status === 'PAID' ? 'Paid' : 'Pending',
          remarks: t.notes,
        })),
        totalCount,
        currentPage: parseInt(page as string, 10),
        totalPages: Math.ceil(totalCount / parseInt(limit as string, 10)) || 1,
      }
    });
  } catch (error) {
    console.error('Fetch commission history error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve commission history.' });
  }
};

export const fetchCommissionDetails = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee record not found.' });
      return;
    }

    const allTransactions = await prisma.commissionTransaction.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' }
    });

    const approvedOrPaid = allTransactions.filter(t => t.status !== 'REJECTED' && t.status !== 'CANCELLED');
    const pendingTransactions = approvedOrPaid.filter(t => t.status === 'PENDING' || t.status === 'APPROVED');
    const paidTransactions = approvedOrPaid.filter(t => t.status === 'PAID');

    const pendingCommission = pendingTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const paidCommission = paidTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const lifetimeCommission = approvedOrPaid.reduce((sum, t) => sum + t.commissionAmount, 0);
    const totalSalesAmount = approvedOrPaid.reduce((sum, t) => sum + t.saleAmount, 0);

    const groups: { [key: string]: { sales: number, commission: number, bills: number, monthName: string, year: string } } = {};
    approvedOrPaid.forEach(t => {
      const dt = new Date(t.createdAt);
      const key = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (!groups[key]) {
        groups[key] = {
          sales: 0,
          commission: 0,
          bills: 0,
          monthName: dt.toLocaleString('default', { month: 'long' }),
          year: dt.getFullYear().toString()
        };
      }
      groups[key].sales += t.saleAmount;
      groups[key].commission += t.commissionAmount;
      groups[key].bills += 1;
    });

    const monthlyBreakdown = Object.values(groups).map(g => ({
      month: g.monthName,
      year: g.year,
      commissionEarned: g.commission,
      salesAmount: g.sales,
      billCount: g.bills,
    }));

    const topPerformingBills = approvedOrPaid
      .sort((a, b) => b.commissionAmount - a.commissionAmount)
      .slice(0, 10)
      .map(t => ({
        invoiceNumber: t.invoiceNumber || t.billId || `TXN-${t.id}`,
        customerName: t.notes || 'Retail Sale',
        billAmount: t.saleAmount,
        commissionEarned: t.commissionAmount,
        date: t.createdAt.toISOString(),
      }));

    res.json({
      success: true,
      data: {
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeId: employee.employeeCode,
        designation: employee.designation,
        performanceSummary: {
          totalBillsGenerated: approvedOrPaid.length,
          totalSalesAmount,
          totalCommissionEarned: lifetimeCommission,
          paidCommission,
          pendingCommission,
          averageCommissionPerBill: approvedOrPaid.length > 0 ? lifetimeCommission / approvedOrPaid.length : 0,
          totalCustomers: approvedOrPaid.length,
        },
        monthlyBreakdown,
        topPerformingBills,
      }
    });
  } catch (error) {
    console.error('Fetch commission details error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve commission details.' });
  }
};

export const fetchCommissionDashboardWidget = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee record not found.' });
      return;
    }

    const allTransactions = await prisma.commissionTransaction.findMany({
      where: { employeeId: employee.id }
    });

    const approvedOrPaid = allTransactions.filter(t => t.status !== 'REJECTED' && t.status !== 'CANCELLED');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayTxns = approvedOrPaid.filter(t => {
      const dt = new Date(t.createdAt);
      return dt >= today && dt <= todayEnd;
    });

    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthTxns = approvedOrPaid.filter(t => new Date(t.createdAt) >= currentMonthStart);

    const todayCommission = todayTxns.reduce((sum, t) => sum + t.commissionAmount, 0);
    const currentMonthCommission = monthTxns.reduce((sum, t) => sum + t.commissionAmount, 0);
    const pendingCommission = approvedOrPaid.filter(t => t.status === 'PENDING' || t.status === 'APPROVED').reduce((sum, t) => sum + t.commissionAmount, 0);
    const lifetimeCommission = approvedOrPaid.reduce((sum, t) => sum + t.commissionAmount, 0);

    res.json({
      success: true,
      data: {
        todayCommission,
        currentMonthCommission,
        pendingCommission,
        lifetimeCommission,
      }
    });
  } catch (error) {
    console.error('Fetch commission dashboard widget error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve commission widget data.' });
  }
};

export const fetchSalarySlipCommission = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { payrollId } = req.params;
    const payrollIdString = Array.isArray(payrollId) ? payrollId[0] : payrollId;
    const parsedPayrollId = parseInt(payrollIdString, 10);

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee record not found.' });
      return;
    }

    const transactions = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employee.id,
        payrollId: parsedPayrollId,
      }
    });

    const totalSalesAmount = transactions.reduce((sum, t) => sum + t.saleAmount, 0);
    const totalCommissionEarned = transactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const paidCommission = transactions.filter(t => t.status === 'PAID').reduce((sum, t) => sum + t.commissionAmount, 0);
    const pendingCommission = transactions.filter(t => t.status !== 'PAID').reduce((sum, t) => sum + t.commissionAmount, 0);

    const avgPercentage = transactions.length > 0
      ? transactions.reduce((sum, t) => sum + (t.commissionPercent || 0), 0) / transactions.length
      : 0;

    res.json({
      success: true,
      data: {
        totalBillsGenerated: transactions.length,
        totalSalesAmount,
        commissionPercentage: avgPercentage,
        totalCommissionEarned,
        paidCommission,
        pendingCommission,
      }
    });
  } catch (error) {
    console.error('Fetch salary slip commission error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve salary slip commission.' });
  }
};
