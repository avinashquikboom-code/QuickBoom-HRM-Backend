import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { getCommissionStats, extractWebhookMeta } from '../../utils/commissionHelper';
import { getEffectiveUserPermissions } from '../../utils/permissionHelper';

// Get commission dashboard stats for logged-in user
export const getMobileCommissionDashboard = async (
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

    console.log(`[MOBILE-COMMISSION-DIAG] getMobileCommissionDashboard | user id=${req.user?.id}, role=${req.user?.role}`);
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { store: true }
    });

    if (!employee) {
      console.warn(`[MOBILE-COMMISSION-DIAG] getMobileCommissionDashboard | Employee NOT found for userId=${req.user?.id}`);
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const stats = await getCommissionStats({ employeeId: employee.id });
    console.log(`[MOBILE-COMMISSION-DIAG] Dashboard stats retrieved for employee id=${employee.id} (${employee.firstName} ${employee.lastName}) | todaySales=${stats.today.sales}, monthSales=${stats.month.sales}, monthComm=${stats.month.commission}`);

    // Get targets
    const targets = await prisma.commissionTarget.findMany({
      where: {
        employeeId: employee.id,
        status: 'ACTIVE',
      },
      orderBy: { startDate: 'desc' },
      take: 5,
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalSalesAmount: stats.month.sales,
          commissionAmount: stats.month.commission,
          approvedCommission: stats.month.commission,
          commissionRate: employee.commissionPercentage || 0,
          transactionCount: stats.month.transactions,
        },
        employee: {
          name: `${employee.firstName} ${employee.lastName}`,
          code: employee.employeeCode,
          designation: employee.designation,
        },
        today: {
          commission: stats.today.commission,
          sales: stats.today.sales,
        },
        month: {
          commission: stats.month.commission,
          sales: stats.month.sales,
        },
        pending: {
          commission: stats.pending.commission,
          count: stats.pending.transactions,
        },
        paid: {
          commission: stats.paid.commission,
          count: stats.paid.transactions,
        },
        targets: targets.map(t => ({
          id: t.id,
          targetType: t.targetType,
          targetAmount: t.targetAmount,
          achievedAmount: t.achievedAmount,
          progressPercent: t.progressPercent,
          startDate: t.startDate,
          endDate: t.endDate,
          status: t.status,
          bonusAmount: t.bonusAmount,
        })),
      }
    });
  } catch (error) {
    console.error('Get mobile commission dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve commission dashboard.'
    });
  }
};

// Get commission transactions for logged-in user
export const getMobileCommissionTransactions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    console.log(`[MOBILE-COMMISSION-DIAG] getMobileCommissionTransactions | user id=${req.user?.id}, role=${req.user?.role}`);
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      console.warn(`[MOBILE-COMMISSION-DIAG] getMobileCommissionTransactions | Employee NOT found for userId=${req.user?.id}`);
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const { status, limit = 50, offset = 0 } = req.query;
    const whereClause: any = { employeeId: employee.id };
    if (status) whereClause.status = status;

    const transactions = await prisma.commissionTransaction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
    });

    const total = await prisma.commissionTransaction.count({
      where: whereClause,
    });

    console.log(`[MOBILE-COMMISSION-DIAG] Transactions retrieved for employee id=${employee.id} | found=${transactions.length}, total=${total}`);

    const mappedTransactions = transactions.map(t => ({
      id: t.id,
      billId: t.billId || t.invoiceNumber || `TXN-${t.id}`,
      invoiceNumber: t.invoiceNumber,
      amount: t.saleAmount,
      saleAmount: t.saleAmount,
      commission: t.commissionAmount,
      commissionType: t.commissionType,
      commissionPercent: t.commissionPercent,
      commissionAmount: t.commissionAmount,
      status: t.status,
      date: t.createdAt,
      createdAt: t.createdAt,
      approvedAt: t.approvedAt,
      paidAt: t.paidAt,
      description: t.notes,
      notes: t.notes,
    }));

    const summary = {
      totalSales: transactions.reduce((sum, t) => sum + t.saleAmount, 0),
      totalCommission: transactions.reduce((sum, t) => sum + t.commissionAmount, 0),
      transactionCount: transactions.length,
    };

    res.json({
      success: true,
      data: {
        transactions: mappedTransactions,
        summary,
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      }
    });
  } catch (error) {
    console.error('Get mobile commission transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve commission transactions.'
    });
  }
};

// Get daily commission breakdown for logged-in user
export const getMobileCommissionDaily = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const { date } = req.query; // YYYY-MM-DD
    const queryDate = date ? new Date(date as string) : new Date();

    const dayStart = new Date(queryDate);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(queryDate);
    dayEnd.setHours(23, 59, 59, 999);

    const transactions = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employee.id,
        createdAt: {
          gte: dayStart,
          lte: dayEnd,
        },
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const bills = transactions.map(t => ({
      billId: t.billId || t.invoiceNumber || `TXN-${t.id}`,
      amount: t.saleAmount,
      commission: t.commissionAmount,
      time: t.createdAt,
    }));

    const summary = {
      date: queryDate.toISOString().split('T')[0],
      totalSales: transactions.reduce((sum, t) => sum + t.saleAmount, 0),
      totalCommission: transactions.reduce((sum, t) => sum + t.commissionAmount, 0),
      billCount: bills.length,
    };

    res.json({
      success: true,
      data: {
        bills,
        summary,
      }
    });
  } catch (error: any) {
    console.error('[Daily Commission] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get commission targets for logged-in user
export const getMobileCommissionTargets = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const { status } = req.query;
    const whereClause: any = { employeeId: employee.id };
    if (status) whereClause.status = status;

    const targets = await prisma.commissionTarget.findMany({
      where: whereClause,
      orderBy: { startDate: 'desc' },
    });

    res.json({
      success: true,
      data: targets.map(t => ({
        id: t.id,
        targetType: t.targetType,
        targetAmount: t.targetAmount,
        achievedAmount: t.achievedAmount,
        progressPercent: t.progressPercent,
        startDate: t.startDate,
        endDate: t.endDate,
        status: t.status,
        bonusAmount: t.bonusAmount,
        bonusPaid: t.bonusPaid,
      }))
    });
  } catch (error) {
    console.error('Get mobile commission targets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve commission targets.'
    });
  }
};

// Get commission settlements for logged-in user
export const getMobileCommissionSettlements = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const { status } = req.query;
    const whereClause: any = { employeeId: employee.id };
    if (status) whereClause.status = status;

    const settlements = await prisma.commissionSettlement.findMany({
      where: whereClause,
      orderBy: { settlementDate: 'desc' },
    });

    res.json({
      success: true,
      data: settlements.map(s => ({
        id: s.id,
        settlementDate: s.settlementDate,
        totalCommission: s.totalCommission,
        totalBonus: s.totalBonus,
        totalDeduction: s.totalDeduction,
        netAmount: s.netAmount,
        status: s.status,
        payrollId: s.payrollId,
        processedAt: s.processedAt,
        notes: s.notes,
      }))
    });
  } catch (error) {
    console.error('Get mobile commission settlements error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve commission settlements.' });
  }
};

// Get webhook logs scoped to the logged-in employee
export const getMobileWebhookLogs = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const limitNum = Math.min(parseInt((req.query.limit as string) || '10', 10), 50);

    // 1. Resolve employee for the authenticated user
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      select: { id: true, employeeCode: true, mobileNumber: true, firstName: true, lastName: true },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    const results: any[] = [];

    // 2. WebhookLog — filter by employeeId directly
    try {
      const wLogs = await prisma.webhookLog.findMany({
        where: { employeeId: employee.id },
        orderBy: { createdAt: 'desc' },
        take: limitNum,
      });

      for (const log of wLogs) {
        const meta = extractWebhookMeta(log.payload);
        results.push({
          id: log.id,
          eventType: log.eventType || meta.eventType || 'INVOICE_CREATED',
          status: log.status || 'SUCCESS',
          billId: log.billId || meta.billId || null,
          amount: log.amount ?? meta.amount ?? 0,
          commissionAmount: meta.commissionAmount ?? 0,
          customerName: meta.customerName || '-',
          errorMessage: log.errorMessage || null,
          createdAt: log.createdAt,
        });
      }
    } catch (_) { /* table may not exist */ }

    // 3. HopkidWebhookLog — match by employeeCode or mobileNumber in meta
    try {
      const hLogs = await prisma.hopkidWebhookLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200, // fetch enough to filter client-side
      });

      const empCodeLower = (employee.employeeCode || '').toLowerCase();
      const empMobileLower = (employee.mobileNumber || '').toLowerCase();

      for (const log of hLogs) {
        const meta = extractWebhookMeta(log.rawPayload);
        const identifier = String(meta.employeeIdentifier || '').toLowerCase();

        const isMatch =
          (empCodeLower && identifier === empCodeLower) ||
          (empMobileLower && identifier === empMobileLower);

        if (!isMatch) continue;

        // Skip if already covered by WebhookLog (same billId)
        const billId = log.billId || meta.billId || null;
        if (billId && results.some((r) => r.billId === billId)) continue;

        results.push({
          id: `hopkid-${log.id}`,
          eventType: meta.eventType || 'INVOICE_CREATED',
          status: 'SUCCESS',
          billId,
          amount: log.amount ?? meta.amount ?? 0,
          commissionAmount: meta.commissionAmount ?? 0,
          customerName: meta.customerName || 'N/A',
          errorMessage: null,
          createdAt: log.createdAt,
        });
      }
    } catch (_) { /* table may not exist */ }

    // Sort combined result by newest first and cap at limit
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const data = results.slice(0, limitNum);

    res.json({ success: true, data, total: data.length });
  } catch (error) {
    console.error('getMobileWebhookLogs error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve webhook logs.' });
  }
};

/**
 * GET /api/mobile/commission/summary
 * Commission summary with TODAY, THIS WEEK, THIS MONTH, LAST MONTH, LIFETIME breakdown
 */
export const getMobileCommissionSummary = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    console.log('[Commission Summary] Employee:', employee.id);

    const now = new Date();

    // ─── Date range helpers ─────────────────────────────────────────────────────
    const todayStart    = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd      = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // This week: Monday to today
    const dayOfWeek     = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0
    const weekStart     = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek, 0, 0, 0, 0);
    const weekEnd       = todayEnd;

    // Last week: previous Mon–Sun
    const lastWeekEnd   = new Date(weekStart.getTime() - 1);
    const lastWeekStart = new Date(lastWeekEnd.getFullYear(), lastWeekEnd.getMonth(), lastWeekEnd.getDate() - 6, 0, 0, 0, 0);

    // This month
    const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd      = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Last month
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    // Fetch all non-rejected transactions
    const allTxs = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employee.id,
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
      },
    });

    const calcPeriod = (start: Date, end: Date) => {
      const txs = allTxs.filter(t => {
        const dt = new Date(t.createdAt);
        return dt >= start && dt <= end;
      });
      return {
        totalSales:       txs.reduce((s, t) => s + t.saleAmount, 0),
        totalCommission:  txs.reduce((s, t) => s + t.commissionAmount, 0),
        billCount:        txs.length,
        pendingCommission: txs.filter(t => t.status !== 'PAID').reduce((s, t) => s + t.commissionAmount, 0),
        paidCommission:    txs.filter(t => t.status === 'PAID').reduce((s, t) => s + t.commissionAmount, 0),
      };
    };

    const todayData     = calcPeriod(todayStart, todayEnd);
    const weekData      = calcPeriod(weekStart, weekEnd);
    const lastWeekData  = calcPeriod(lastWeekStart, lastWeekEnd);
    const monthData     = calcPeriod(monthStart, monthEnd);
    const lastMonthData = calcPeriod(lastMonthStart, lastMonthEnd);
    const lifetimeSales = allTxs.reduce((s, t) => s + t.saleAmount, 0);
    const lifetimeComm  = allTxs.reduce((s, t) => s + t.commissionAmount, 0);

    const commissionRate = employee.commissionPercentage || 0;
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    res.json({
      success: true,
      data: {
        summary: {
          // Legacy fields (backward compat)
          totalSales:           monthData.totalSales,
          totalCommissionEarned: Math.round(monthData.totalCommission * 100) / 100,
          pendingCommission:     Math.max(0, Math.round(monthData.pendingCommission * 100) / 100),
          approvedCommission:    Math.round(monthData.totalCommission * 100) / 100,
          paidCommission:        Math.round(monthData.paidCommission * 100) / 100,
          commissionRate,
          transactionCount:      monthData.billCount,
          period: {
            from: monthStart.toISOString().split('T')[0],
            to:   monthEnd.toISOString().split('T')[0],
          },

          // ═══════════════════════════════════════════════
          // NEW: Multi-period breakdown
          // ═══════════════════════════════════════════════
          today: {
            date:            todayStr,
            totalSales:      Math.round(todayData.totalSales * 100) / 100,
            totalCommission: Math.round(todayData.totalCommission * 100) / 100,
            billCount:       todayData.billCount,
            label:           "Today",
          },
          thisWeek: {
            from:            weekStart.toISOString().split('T')[0],
            to:              todayStr,
            totalSales:      Math.round(weekData.totalSales * 100) / 100,
            totalCommission: Math.round(weekData.totalCommission * 100) / 100,
            billCount:       weekData.billCount,
            label:           "This Week",
          },
          lastWeek: {
            from:            lastWeekStart.toISOString().split('T')[0],
            to:              lastWeekEnd.toISOString().split('T')[0],
            totalSales:      Math.round(lastWeekData.totalSales * 100) / 100,
            totalCommission: Math.round(lastWeekData.totalCommission * 100) / 100,
            billCount:       lastWeekData.billCount,
            label:           "Last Week",
          },
          thisMonth: {
            month:             monthStr,
            monthName:         now.toLocaleString('en-IN', { month: 'long' }),
            year:              now.getFullYear().toString(),
            totalSales:        Math.round(monthData.totalSales * 100) / 100,
            totalCommission:   Math.round(monthData.totalCommission * 100) / 100,
            billCount:         monthData.billCount,
            pendingCommission: Math.round(monthData.pendingCommission * 100) / 100,
            paidCommission:    Math.round(monthData.paidCommission * 100) / 100,
            label:             now.toLocaleString('en-IN', { month: 'long' }),
          },
          lastMonth: {
            month:             `${lastMonthStart.getFullYear()}-${String(lastMonthStart.getMonth() + 1).padStart(2, '0')}`,
            monthName:         lastMonthStart.toLocaleString('en-IN', { month: 'long' }),
            year:              lastMonthStart.getFullYear().toString(),
            totalSales:        Math.round(lastMonthData.totalSales * 100) / 100,
            totalCommission:   Math.round(lastMonthData.totalCommission * 100) / 100,
            billCount:         lastMonthData.billCount,
            pendingCommission: Math.round(lastMonthData.pendingCommission * 100) / 100,
            paidCommission:    Math.round(lastMonthData.paidCommission * 100) / 100,
            label:             lastMonthStart.toLocaleString('en-IN', { month: 'long' }),
          },
          lifetime: {
            totalSales:      Math.round(lifetimeSales * 100) / 100,
            totalCommission: Math.round(lifetimeComm * 100) / 100,
            billCount:       allTxs.length,
            label:           "All Time",
          },
        },
      },
    });
  } catch (error: any) {
    console.error('[Commission Summary] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/mobile/commission/bills
 * Bill-wise commission history with period & search filters
 */
export const getMobileCommissionBills = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    const { from, to, billId, limit = 20, offset = 0, period = 'current_month' } = req.query;

    let fromDate: Date;
    let toDate = new Date();
    const now = toDate; // alias for switch cases

    switch (period) {
      case 'today': {
        const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        fromDate = s;
        toDate   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;
      }
      case 'this_week': {
        const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
        fromDate  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow, 0, 0, 0, 0);
        toDate    = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;
      }
      case 'last_week': {
        const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow, 0, 0, 0, 0);
        toDate    = new Date(weekStart.getTime() - 1);
        fromDate  = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() - 6, 0, 0, 0, 0);
        break;
      }
      case 'previous_month':
        fromDate = new Date(toDate.getFullYear(), toDate.getMonth() - 1, 1);
        toDate   = new Date(toDate.getFullYear(), toDate.getMonth(), 0, 23, 59, 59, 999);
        break;
      case 'all_time':
        fromDate = new Date(2020, 0, 1);
        toDate   = new Date(now.getFullYear() + 1, 0, 1);
        break;
      case 'custom_range':
        fromDate = from ? new Date(from as string) : new Date(toDate.getFullYear(), toDate.getMonth(), 1);
        toDate   = to   ? new Date(to as string)   : toDate;
        break;
      case 'current_month':
      default:
        fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
        toDate   = new Date(toDate.getFullYear(), toDate.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
    }

    const where: any = {
      employeeId: employee.id,
      createdAt: {
        gte: fromDate,
        lte: toDate,
      },
    };

    if (billId) {
      const bStr = String(billId).trim();
      where.OR = [
        { billId: { contains: bStr, mode: 'insensitive' } },
        { invoiceNumber: { contains: bStr, mode: 'insensitive' } },
      ];
    }

    const limitNum = parseInt(limit as string, 10) || 20;
    const offsetNum = parseInt(offset as string, 10) || 0;

    const txs = await prisma.commissionTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      skip: offsetNum,
    });

    const total = await prisma.commissionTransaction.count({ where });

    const bills = txs.map((t) => ({
      id: String(t.id),
      billId: t.billId || t.invoiceNumber || `TXN-${t.id}`,
      saleAmount: t.saleAmount,
      commission: t.commissionAmount,
      date: t.createdAt,
      status: t.status,
      description: t.notes,
    }));

    res.json({
      success: true,
      data: {
        bills,
        pagination: {
          total,
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + limitNum < total,
        },
      },
    });
  } catch (error: any) {
    console.error('[Commission Bills] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/mobile/commission/bill/:billId
 * Detailed commission info for a specific bill
 */
export const getMobileCommissionBillDetail = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    const rawBillId = req.params.billId;
    const billIdStr = Array.isArray(rawBillId) ? String(rawBillId[0]) : String(rawBillId);

    const sale = await prisma.commissionTransaction.findFirst({
      where: {
        employeeId: employee.id,
        OR: [{ billId: billIdStr }, { invoiceNumber: billIdStr }],
      },
    });

    if (!sale) {
      res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
      return;
    }

    const rate = sale.commissionPercent ?? employee.commissionPercentage ?? 0;
    const empName = `${employee.firstName} ${employee.lastName}`.trim();

    res.json({
      success: true,
      data: {
        billId: sale.billId || sale.invoiceNumber,
        saleAmount: sale.saleAmount,
        commissionRate: rate,
        commissionAmount: sale.commissionAmount,
        date: sale.createdAt,
        status: sale.status,
        description: sale.notes,
        createdAt: sale.createdAt,
        employee: {
          name: empName,
          code: employee.employeeCode,
        },
      },
    });
  } catch (error: any) {
    console.error('[Commission Detail] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

