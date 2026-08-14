import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { getCommissionStats } from '../utils/commissionHelper';
import { getEffectiveUserPermissions } from '../utils/permissionHelper';
import { CommissionService } from '../services/commissionService';

async function getEmployeeForUser(userId?: number) {
  if (!userId) return null;

  let employee = await prisma.employee.findFirst({
    where: { userId },
    include: { store: true }
  });

  if (!employee) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user && user.employeeID) {
      employee = await prisma.employee.findFirst({
        where: {
          OR: [
            { employeeID: user.employeeID },
            { employeeCode: user.employeeID }
          ]
        },
        include: { store: true }
      });

      if (employee) {
        await prisma.employee.update({
          where: { id: employee.id },
          data: { userId }
        }).catch(() => {});
      }
    }
  }

  return employee;
}

export const fetchCommissionWallet = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (req.user?.id) {
      const perms = await getEffectiveUserPermissions(req.user.id);
      if (perms.canViewCommission === false) {
        res.status(403).json({ success: false, message: 'Access denied: Commission viewing disabled by HR.' });
        return;
      }
    }

    const employee = await getEmployeeForUser(req.user?.id);

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
    const today = await CommissionService.getDailyMetrics(employee.id);
    const weekly = await CommissionService.getWeeklyMetrics(employee.id);
    const monthly = await CommissionService.getMonthlyMetrics(employee.id);

    const lastMonthStart    = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd      = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const lastMonthTxns    = approvedOrPaid.filter(t => {
      const dt = new Date(t.createdAt);
      return dt >= lastMonthStart && dt <= lastMonthEnd;
    });
    const lastMonthCommission = lastMonthTxns.reduce((sum, t) => sum + t.commissionAmount, 0);

    const todayCommission = today.commission;
    const todaySales = today.netSales;
    const currentMonthCommission = monthly.commission;
    const todayTxnsCount = today.billCount;
    const currentMonthTxnsCount = monthly.billCount;

    // Map recent transactions (limit to 50 for complete bill visibility)
    const recentTransactions = allTransactions.slice(0, 50).map(t => ({
      id: t.id.toString(),
      invoiceNumber: t.invoiceNumber || t.billId || `TXN-${t.id}`,
      customerName: t.notes || 'Retail Sale',
      billAmount: t.saleAmount,
      commissionPercentage: t.commissionPercent || 0,
      commissionEarned: t.commissionAmount,
      generatedDate: t.createdAt.toISOString(),
      paymentDate: t.paidAt ? t.paidAt.toISOString() : null,
      status: t.status === 'PAID' ? 'Paid' : (t.status === 'APPROVED' ? 'Approved' : 'Pending'),
      remarks: t.notes,
    }));

    const totalSalesAmount = approvedOrPaid.reduce((sum, t) => sum + t.saleAmount, 0);

    const latestPayslip = await prisma.payslip.findFirst({
      where: { employeeId: employee.id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    const netSalary = latestPayslip ? latestPayslip.netSalary : 0;

    const todayDateStr  = today.date;
    const monthStr      = monthly.month;

    res.json({
      success: true,
      data: {
        netSalary,
        totalEarnings: netSalary + pendingCommission,
        totalCommissionBalance: pendingCommission,
        currentMonthCommission,
        lastMonthCommission,
        lifetimeCommission,
        pendingCommission,
        paidCommission,
        recentTransactions,

        // ═══════════════════════════════════════════════════════
        // TODAY'S COMMISSION (Resets at 00:00 IST every day)
        // ═══════════════════════════════════════════════════════
        today: {
          date: todayDateStr,
          totalSales: todaySales,
          totalCommission: todayCommission,
          billCount: todayTxnsCount,
          label: "Today's Commission",
        },

        // ═══════════════════════════════════════════════════════
        // WEEK'S COMMISSION (IST MON - SUN)
        // ═══════════════════════════════════════════════════════
        thisWeek: {
          from: weekly.start,
          to: weekly.end,
          totalSales: weekly.netSales,
          totalCommission: weekly.commission,
          billCount: weekly.billCount,
          label: "This Week's Commission",
        },

        // ═══════════════════════════════════════════════════════
        // THIS MONTH'S COMMISSION (Aggregated full month)
        // ═══════════════════════════════════════════════════════
        thisMonth: {
          month: monthStr,
          monthName: now.toLocaleString('default', { month: 'long' }),
          year: now.getFullYear().toString(),
          totalSales: monthly.netSales,
          totalCommission: currentMonthCommission,
          billCount: currentMonthTxnsCount,
          pendingCommission: pendingCommission,
          paidCommission: paidCommission,
          label: `${now.toLocaleString('default', { month: 'long' })} Commission`,
        },

        monthlySummary: {
          month: now.toLocaleString('default', { month: 'long' }),
          year: now.getFullYear().toString(),
          totalBills: currentMonthTxnsCount,
          totalSalesAmount: monthly.netSales,
          totalCommissionEarned: currentMonthCommission,
          paidCommission: paidCommission,
          pendingCommission: pendingCommission,
        },
        statistics: {
          totalBillsGenerated: approvedOrPaid.length,
          totalSalesAmount: approvedOrPaid.reduce((sum, t) => sum + t.saleAmount, 0),
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
    const employee = await getEmployeeForUser(req.user?.id);

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

    let transactions = await prisma.commissionTransaction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string, 10),
      skip: skipVal,
    });

    let totalCount = await prisma.commissionTransaction.count({ where: whereClause });

    // Fallback: If no transactions found for employee in CommissionTransaction table, pull live POS Webhook logs
    if (totalCount === 0 && !status && !startDate && !month) {
      const webhookLogs = await prisma.hopkidWebhookLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string, 10),
        skip: skipVal,
      });

      if (webhookLogs.length > 0) {
        totalCount = await prisma.hopkidWebhookLog.count();
        const mappedFromLogs = webhookLogs.map(log => {
          let meta: any = {};
          try {
            if (typeof log.rawPayload === 'string') {
              meta = JSON.parse(log.rawPayload);
            } else if (log.rawPayload) {
              meta = log.rawPayload;
            }
          } catch (e) {}

          const invoiceNo = log.billId || meta.invoiceNumber || meta.billId || `WH-${log.id}`;
          const amount = log.amount || meta.grossAmount || meta.grandTotal || 0;
          const comm = meta.commissionAmount || 0;
          const pct = amount > 0 ? (comm / amount) * 100 : 0;
          const cust = meta.customerName || meta.customerPhone || 'POS Customer';

          return {
            id: `WH-${log.id}`,
            invoiceNumber: invoiceNo,
            customerName: cust,
            billAmount: amount,
            commissionPercentage: Math.round(pct * 10) / 10,
            commissionEarned: comm,
            generatedDate: log.createdAt.toISOString(),
            paymentDate: log.createdAt.toISOString(),
            status: 'Paid',
            remarks: meta.eventType || log.description || 'POS Sale Event',
          };
        });

        res.json({
          success: true,
          data: {
            transactions: mappedFromLogs,
            totalCount,
            currentPage: parseInt(page as string, 10),
            totalPages: Math.ceil(totalCount / parseInt(limit as string, 10)) || 1,
          }
        });
        return;
      }
    }

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
          status: t.status === 'PAID' ? 'Paid' : (t.status === 'APPROVED' ? 'Approved' : 'Pending'),
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
    const employee = await getEmployeeForUser(req.user?.id);

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee record not found.' });
      return;
    }

    const allTransactions = await prisma.commissionTransaction.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' }
    });

    let approvedOrPaid = allTransactions.filter(t => t.status !== 'REJECTED' && t.status !== 'CANCELLED');

    // Fallback: If no commission transactions exist in table, pull live POS Webhook logs
    if (approvedOrPaid.length === 0) {
      const webhookLogs = await prisma.hopkidWebhookLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      if (webhookLogs.length > 0) {
        const topPerformingBills = webhookLogs.map(log => {
          let meta: any = {};
          try {
            if (typeof log.rawPayload === 'string') {
              meta = JSON.parse(log.rawPayload);
            } else if (log.rawPayload) {
              meta = log.rawPayload;
            }
          } catch (e) {}

          const invoiceNo = log.billId || meta.invoiceNumber || meta.billId || `WH-${log.id}`;
          const amount = log.amount || meta.grossAmount || meta.grandTotal || 0;
          const comm = meta.commissionAmount || 0;
          const cust = meta.customerName || meta.customerPhone || 'POS Customer';

          return {
            invoiceNumber: invoiceNo,
            customerName: cust,
            billAmount: amount,
            commissionEarned: comm,
            date: log.createdAt.toISOString(),
          };
        });

        const totalSales = topPerformingBills.reduce((sum, b) => sum + b.billAmount, 0);
        const totalComm = topPerformingBills.reduce((sum, b) => sum + b.commissionEarned, 0);

        res.json({
          success: true,
          data: {
            employeeName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Employee',
            employeeId: employee.employeeCode || `EMP-${employee.id}`,
            designation: employee.designation || 'Sales Executive',
            performanceSummary: {
              totalBillsGenerated: topPerformingBills.length,
              totalSalesAmount: totalSales,
              totalCommissionEarned: totalComm,
              paidCommission: totalComm,
              pendingCommission: 0,
              averageCommissionPerBill: topPerformingBills.length > 0 ? totalComm / topPerformingBills.length : 0,
              totalCustomers: topPerformingBills.length,
            },
            monthlyBreakdown: [
              {
                month: new Date().toLocaleString('default', { month: 'long' }),
                year: new Date().getFullYear().toString(),
                commissionEarned: totalComm,
                salesAmount: totalSales,
                billCount: topPerformingBills.length,
              }
            ],
            topPerformingBills,
          }
        });
        return;
      }
    }

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

    const stats = await getCommissionStats({ employeeId: employee.id });

    res.json({
      success: true,
      data: {
        todayCommission: stats.today.commission,
        currentMonthCommission: stats.month.commission,
        pendingCommission: stats.pending.commission,
        lifetimeCommission: stats.lifetime.commission,
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

    let transactions: any[] = [];
    let queryDescription = '';

    if (!isNaN(parsedPayrollId)) {
      // Strategy 1: exact payrollId (formal payroll run exists)
      queryDescription = `payrollId=${parsedPayrollId}`;
      transactions = await prisma.commissionTransaction.findMany({
        where: {
          employeeId: employee.id,
          payrollId: parsedPayrollId,
        }
      });
      console.log(`[COMMISSION-DIAG] fetchSalarySlipCommission | employee.id=${employee.id}, ${queryDescription}, found ${transactions.length} txns`);
    }

    // Strategy 2: if no results from payrollId (or payrollId was NaN/month-string),
    // fallback to current-month date range so salary slip always shows real commission.
    if (transactions.length === 0) {
      const now = new Date();
      // If payrollIdString looks like "YYYY-MM", use that month; otherwise use current month.
      let year = now.getFullYear();
      let month = now.getMonth(); // 0-based
      const monthMatch = /^(\d{4})-(\d{2})$/.exec(payrollIdString);
      if (monthMatch) {
        year = parseInt(monthMatch[1], 10);
        month = parseInt(monthMatch[2], 10) - 1;
      }
      const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
      const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
      queryDescription = `month=${year}-${String(month + 1).padStart(2, '0')} (${monthStart.toISOString()} to ${monthEnd.toISOString()})`;

      transactions = await prisma.commissionTransaction.findMany({
        where: {
          employeeId: employee.id,
          status: { in: ['PENDING', 'APPROVED', 'PAID'] },
          createdAt: { gte: monthStart, lte: monthEnd },
        }
      });
      console.log(`[COMMISSION-DIAG] fetchSalarySlipCommission fallback | employee.id=${employee.id}, ${queryDescription}, found ${transactions.length} txns`);
    }

    const totalSalesAmount = transactions.reduce((sum, t) => sum + t.saleAmount, 0);
    const totalCommissionEarned = transactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const paidCommission = transactions.filter(t => t.status === 'PAID').reduce((sum, t) => sum + t.commissionAmount, 0);
    const pendingCommission = transactions.filter(t => t.status !== 'PAID').reduce((sum, t) => sum + t.commissionAmount, 0);

    const avgPercentage = transactions.length > 0
      ? transactions.reduce((sum, t) => sum + (t.commissionPercent || 0), 0) / transactions.length
      : 0;

    console.log(`[COMMISSION-DIAG] fetchSalarySlipCommission result | totalSalesAmount=${totalSalesAmount}, totalCommissionEarned=${totalCommissionEarned}, avgPercentage=${avgPercentage}`);

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
