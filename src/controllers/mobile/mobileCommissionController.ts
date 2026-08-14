import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { getCommissionStats, extractWebhookMeta, safeParseAmount } from '../../utils/commissionHelper';
import { getEffectiveUserPermissions } from '../../utils/permissionHelper';
import { CommissionService } from '../../services/commissionService';

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

    const { status, startDate, endDate, limit = 50, offset = 0 } = req.query;
    const whereClause: any = { employeeId: employee.id };
    if (status) whereClause.status = status;
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        const dateOnly = startDate.toString().split('T')[0];
        whereClause.createdAt.gte = new Date(`${dateOnly}T00:00:00+05:30`);
      }
      if (endDate) {
        const dateOnly = endDate.toString().split('T')[0];
        whereClause.createdAt.lte = new Date(`${dateOnly}T23:59:59.999+05:30`);
      }
    }

    const transactions = await prisma.commissionTransaction.findMany({
      where: whereClause,
      orderBy: [{ id: 'desc' }, { createdAt: 'desc' }],
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
      orderBy: { id: 'desc' },
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

    // Pre-fetch employee's Credit Note line items
    let empCreditNoteLines: any[] = [];
    try {
      empCreditNoteLines = await prisma.creditNoteLine.findMany({
        where: { employeeId: employee.id },
        include: { creditNote: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    } catch (_) {}

    const cnBillIds = empCreditNoteLines.map(c => c.creditNote.creditNoteNo).filter(Boolean);
    const cnInvoiceNos = empCreditNoteLines.map(c => c.creditNote.invoiceNo).filter(Boolean);

    // 2. WebhookLog — filter by employeeId directly OR linked Credit Note numbers
    try {
      const wLogs = await prisma.webhookLog.findMany({
        where: {
          OR: [
            { employeeId: employee.id },
            cnBillIds.length > 0 ? { billId: { in: cnBillIds } } : {},
            cnInvoiceNos.length > 0 ? { billId: { in: cnInvoiceNos } } : {},
          ].filter(o => Object.keys(o).length > 0)
        },
        orderBy: { createdAt: 'desc' },
        take: limitNum * 2,
      });

      for (const log of wLogs) {
        const meta = extractWebhookMeta(log.payload);
        const isCreditNote = String(log.eventType || '').toUpperCase().includes('CREDIT_NOTE') || String(log.billId || '').startsWith('CN-');
        const matchedCnLine = empCreditNoteLines.find(c => c.creditNote.creditNoteNo === log.billId);

        results.push({
          id: log.id,
          eventType: log.eventType || meta.eventType || 'INVOICE_CREATED',
          status: log.status || 'SUCCESS',
          billId: log.billId || meta.billId || null,
          invoiceNo: meta.invoiceNumber || (matchedCnLine ? matchedCnLine.creditNote.invoiceNo : null),
          amount: isCreditNote && matchedCnLine ? Number(matchedCnLine.creditAmount) : (log.amount ?? meta.amount ?? 0),
          commissionAmount: isCreditNote && matchedCnLine ? -Number(matchedCnLine.commissionAdjustment) : (meta.commissionAmount ?? 0),
          customerName: meta.customerName && meta.customerName !== 'N/A' ? meta.customerName : '-',
          errorMessage: log.errorMessage || null,
          createdAt: log.createdAt,
        });
      }
    } catch (_) { /* table may not exist */ }

    // Fallback: If any CreditNoteLine for this employee is missing from WebhookLog, add log item
    for (const line of empCreditNoteLines) {
      const cnNo = line.creditNote.creditNoteNo;
      if (!results.some((r) => r.billId === cnNo)) {
        results.push({
          id: `cn-${line.id}`,
          eventType: 'CREDIT_NOTE_CREATED',
          status: 'SUCCESS',
          billId: cnNo,
          invoiceNo: line.creditNote.invoiceNo,
          amount: Number(line.creditAmount),
          commissionAmount: -Number(line.commissionAdjustment),
          customerName: 'Customer',
          errorMessage: null,
          createdAt: line.createdAt,
        });
      }
    }

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
          invoiceNo: meta.invoiceNumber || null,
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

    // Get complete summary using the new CommissionService
    const summary = await CommissionService.getCompleteSummary(employee.id);

    // Calculate actual status-based pending and paid commission sums
    const allTransactions = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employee.id,
        status: { in: ['PENDING', 'APPROVED', 'PAID'] }
      }
    });

    const pendingCommission = allTransactions
      .filter(t => t.status === 'PENDING' || t.status === 'APPROVED')
      .reduce((sum, t) => sum + t.commissionAmount, 0);

    const paidCommission = allTransactions
      .filter(t => t.status === 'PAID')
      .reduce((sum, t) => sum + t.commissionAmount, 0);

    const lifetimeCommission = allTransactions
      .reduce((sum, t) => sum + t.commissionAmount, 0);

    const commissionRate = employee.commissionPercentage || 0;

    res.json({
      success: true,
      data: {
        summary: {
          // Backward compatibility fields
          totalSales: summary.thisMonth.netSales,
          totalCommissionEarned: Math.round(lifetimeCommission * 100) / 100,
          pendingCommission: Math.round(pendingCommission * 100) / 100,
          approvedCommission: Math.round(pendingCommission * 100) / 100,
          paidCommission: Math.round(paidCommission * 100) / 100,
          commissionRate,
          transactionCount: allTransactions.length,

          // ═════════════════════════════════════════════════════════════
          // TODAY'S METRICS (RESETS DAILY AT 00:00)
          // ═════════════════════════════════════════════════════════════
          today: {
            date: summary.today.date,
            netSales: summary.today.netSales,
            commission: summary.today.commission,
            billCount: summary.today.billCount,
            label: "Today's Performance"
          },

          // ═════════════════════════════════════════════════════════════
          // WEEK'S METRICS (IST MON - SUN)
          // ═════════════════════════════════════════════════════════════
          thisWeek: {
            from: summary.weekly.start,
            to: summary.weekly.end,
            netSales: summary.weekly.netSales,
            commission: summary.weekly.commission,
            billCount: summary.weekly.billCount,
            label: "This Week's Performance"
          },

          // ═════════════════════════════════════════════════════════════
          // THIS MONTH'S METRICS (AGGREGATED)
          // ═════════════════════════════════════════════════════════════
          thisMonth: {
            month: summary.thisMonth.month,
            netSales: summary.thisMonth.netSales,
            commission: summary.thisMonth.commission,
            billCount: summary.thisMonth.billCount,
            label: 'This Month'
          },

          // ═════════════════════════════════════════════════════════════
          // LATEST SALE (MOST RECENT TRANSACTION)
          // ═════════════════════════════════════════════════════════════
          latestSale: summary.latestSale ? {
            billId: summary.latestSale.billId,
            date: summary.latestSale.date.toISOString().split('T')[0],
            displayDate: new Date(summary.latestSale.date).toLocaleDateString('en-IN'),
            displayTime: new Date(summary.latestSale.date).toLocaleTimeString('en-IN'),
            netAmount: summary.latestSale.netAmount,
            commission: summary.latestSale.commission,
            commissionRate: summary.latestSale.commissionRate
          } : null,

          // ═════════════════════════════════════════════════════════════
          // QUICK STATS
          // ═════════════════════════════════════════════════════════════
          stats: {
            todayPercentage: summary.thisMonth.netSales > 0
              ? ((summary.today.netSales / summary.thisMonth.netSales) * 100).toFixed(1)
              : "0.0",
            description: `Today is ${summary.thisMonth.netSales > 0 ? ((summary.today.netSales / summary.thisMonth.netSales) * 100).toFixed(1) : 0}% of monthly target`
          }
        }
      }
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

    // Calculate IST time
    const nowUtcMs = Date.now();
    const istMs = nowUtcMs + 5.5 * 60 * 60 * 1000;
    const istNow = new Date(istMs);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const dateVal = istNow.getUTCDate();

    switch (period) {
      case 'today': {
        fromDate = new Date(Date.UTC(year, month, dateVal, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
        toDate   = new Date(Date.UTC(year, month, dateVal, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
        break;
      }
      case 'this_week':
      case 'last_7_days': {
        fromDate  = new Date(Date.UTC(year, month, dateVal - 6, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
        toDate    = new Date(Date.UTC(year, month, dateVal, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
        break;
      }
      case 'last_week': {
        const dow = istNow.getUTCDay() === 0 ? 6 : istNow.getUTCDay() - 1;
        const weekStartMs = Date.UTC(year, month, dateVal - dow, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000;
        toDate    = new Date(weekStartMs - 1);
        fromDate  = new Date(Date.UTC(year, month, dateVal - dow - 7, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
        break;
      }
      case 'previous_month':
        fromDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
        toDate   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
        break;
      case 'all_time':
        fromDate = new Date(2020, 0, 1);
        toDate   = new Date(year + 1, 0, 1);
        break;
      case 'custom_range':
        fromDate = from ? new Date(from as string) : new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
        toDate   = to   ? new Date(to as string)   : new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
        break;
      case 'current_month':
      default:
        fromDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
        toDate   = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
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
      orderBy: [{ id: 'desc' }, { createdAt: 'desc' }],
      take: limitNum,
      skip: offsetNum,
    });

    const totalTxs = await prisma.commissionTransaction.count({ where });

    const bills: any[] = txs.map((t) => ({
      id: String(t.id),
      billId: t.billId || t.invoiceNumber || `TXN-${t.id}`,
      saleAmount: t.saleAmount,
      commission: t.commissionAmount,
      date: t.createdAt,
      status: t.status,
      description: t.notes,
    }));

    // Pre-fetch employee's Credit Note line item reversals in range
    try {
      const cnLines = await prisma.creditNoteLine.findMany({
        where: {
          employeeId: employee.id,
          createdAt: {
            gte: fromDate,
            lte: toDate,
          },
        },
        include: { creditNote: true },
        orderBy: { createdAt: 'desc' },
      });

      for (const line of cnLines) {
        const cnNo = line.creditNote.creditNoteNo;
        if (!bills.some((b) => b.billId === cnNo)) {
          bills.push({
            id: `cn-${line.id}`,
            billId: cnNo,
            invoiceNo: line.creditNote.invoiceNo,
            saleAmount: -Number(line.creditAmount),
            commission: -Number(line.commissionAdjustment),
            date: line.createdAt,
            status: 'REVERSED',
            description: `Credit Note (${cnNo}) - Reversal: ${line.productDescription}`,
            eventType: 'CREDIT_NOTE_CREATED',
          });
        }
      }
    } catch (_) {}

    // Sort merged list by date desc
    bills.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const total = totalTxs + bills.filter(b => b.id.startsWith('cn-')).length;

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
      include: { store: true }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    const rawBillId = req.params.billId;
    const billIdStr = Array.isArray(rawBillId) ? String(rawBillId[0]) : String(rawBillId);

    // 1. Try finding sale by current employee ID first
    let sale = await prisma.commissionTransaction.findFirst({
      where: {
        employeeId: employee.id,
        OR: [
          { billId: billIdStr },
          { invoiceNumber: billIdStr },
          ...(isNaN(Number(billIdStr.replace('TXN-', ''))) ? [] : [{ id: Number(billIdStr.replace('TXN-', '')) }])
        ],
      },
      include: { store: true }
    });

    // 2. Fallback: Search across all commission transactions if not matched to logged-in employee ID directly
    if (!sale) {
      sale = await prisma.commissionTransaction.findFirst({
        where: {
          OR: [
            { billId: billIdStr },
            { invoiceNumber: billIdStr },
            ...(isNaN(Number(billIdStr.replace('TXN-', ''))) ? [] : [{ id: Number(billIdStr.replace('TXN-', '')) }])
          ],
        },
        include: { store: true }
      });
    }

    // Try to load HopkidWebhookLog to get rich metadata
    let webhookLog = await prisma.hopkidWebhookLog.findFirst({
      where: { billId: billIdStr }
    });

    if (!webhookLog) {
      // Match parent billId robustly against hyphenated invoice numbers
      const logs = await prisma.hopkidWebhookLog.findMany({
        where: { billId: { not: null } },
        orderBy: { id: 'desc' },
        take: 100,
      });
      webhookLog = logs.find(l => l.billId && (billIdStr === l.billId || billIdStr.startsWith(l.billId) || l.billId.startsWith(billIdStr))) || null;
    }

    // 3. If no commissionTransaction exists, but a Webhook Log exists, construct detail response directly from Webhook Log
    if (!sale && webhookLog) {
      const meta = extractWebhookMeta(webhookLog.rawPayload);
      const invoiceData = meta.invoice || {};
      const grossSale = safeParseAmount(webhookLog.amount || invoiceData.grandTotal || invoiceData.grossAmount || 0);
      const discount = safeParseAmount(invoiceData.discount || invoiceData.discountAmount || 0);
      const tax = safeParseAmount(invoiceData.tax || invoiceData.taxAmount || 0);
      const commAmount = safeParseAmount(meta.commissionAmount || 0);

      let products: any[] = [];
      if (meta.lineItems && meta.lineItems.length > 0) {
        products = meta.lineItems.map((item: any) => ({
          name: item.productName || item.name || 'Unknown Product',
          quantity: item.qty || item.quantity || 1,
          price: safeParseAmount(item.productPrice || item.price || item.productNetAmount || item.amount || 0)
        }));
      } else {
        products = [{
          name: meta.firstItem?.productName || 'HopKid POS Product',
          quantity: 1,
          price: grossSale,
        }];
      }

      res.json({
        success: true,
        data: {
          billId: meta.invoiceNumber || webhookLog.billId || billIdStr,
          saleAmount: grossSale,
          netAmount: grossSale,
          commissionRate: employee.commissionPercentage ?? 0,
          commissionAmount: commAmount,
          date: webhookLog.createdAt,
          status: 'APPROVED',
          description: `Live POS Webhook Event (${meta.eventType || 'INVOICE_CREATED'})`,
          createdAt: webhookLog.createdAt,
          customerName: meta.customerName || 'Retail Customer',
          customerPhone: meta.customerPhone || '-',
          paymentMode: meta.paymentMode || '-',
          storeName: meta.storeName || employee.store?.name || 'HopKid Store',
          products,
          grossSale,
          discount,
          tax,
          employee: {
            name: `${employee.firstName} ${employee.lastName}`.trim(),
            code: employee.employeeCode,
          },
        },
      });
      return;
    }

    if (!sale) {
      res.status(404).json({
        success: false,
        message: `Bill details not found for ID: ${billIdStr}`,
      });
      return;
    }

    let customerName = 'Retail Customer';
    let customerPhone = '-';
    let paymentMode = '-';
    let storeName = sale.store?.name || employee.store?.name || 'Unassigned Store';
    let products: any[] = [];
    let grossSale = sale.saleAmount;
    let discount = 0;
    let tax = 0;

    if (webhookLog) {
      const meta = extractWebhookMeta(webhookLog.rawPayload);
      customerName = meta.customerName || customerName;
      customerPhone = meta.customerPhone || customerPhone;
      paymentMode = meta.paymentMode || paymentMode;
      storeName = meta.storeName || storeName;

      // Extract products from line items
      if (meta.lineItems && meta.lineItems.length > 0) {
        products = meta.lineItems.map((item: any) => ({
          name: item.productName || item.name || 'Unknown Product',
          quantity: item.qty || item.quantity || 1,
          price: safeParseAmount(item.productPrice || item.price || item.productNetAmount || item.amount || 0)
        }));
      } else {
        products = [{
          name: meta.firstItem?.productName || 'HopKid Product',
          quantity: 1,
          price: sale.saleAmount
        }];
      }

      // Parse invoice properties
      const invoiceData = meta.invoice || {};
      grossSale = safeParseAmount(invoiceData.grandTotal || invoiceData.grossAmount || sale.saleAmount);
      discount = safeParseAmount(invoiceData.discount || invoiceData.discountAmount || 0);
      tax = safeParseAmount(invoiceData.tax || invoiceData.taxAmount || invoiceData.vat || 0);
    }

    // Fallback: If products array is missing, query sibling CommissionTransactions sharing parent invoice
    if (!products || products.length === 0) {
      const parentInvoiceNo = sale.invoiceNumber || sale.billId?.replace(/-[^-]+$/, '') || billIdStr;
      const siblingTxs = await prisma.commissionTransaction.findMany({
        where: {
          employeeId: employee.id,
          OR: [
            { billId: parentInvoiceNo },
            { invoiceNumber: parentInvoiceNo },
            { billId: { startsWith: `${parentInvoiceNo}-` } },
          ],
        },
        orderBy: { id: 'asc' },
      });

      if (siblingTxs.length > 0) {
        products = siblingTxs.map(t => ({
          name: t.notes?.replace(/^HopKid Invoice [^\s]+ - Product:\s*/i, '') || t.notes || 'Retail product',
          quantity: 1,
          price: t.saleAmount,
        }));
        grossSale = siblingTxs.reduce((sum, t) => sum + t.saleAmount, 0);
      } else {
        products = [{
          name: sale.notes || 'Retail product',
          quantity: 1,
          price: sale.saleAmount
        }];
      }
    }

    const rate = sale.commissionPercent ?? employee.commissionPercentage ?? 0;
    const empName = `${employee.firstName} ${employee.lastName}`.trim();

    console.log(`[MOBILE-BILL-DETAIL] Returning detail for billId=${billIdStr} | products=${products.length} | saleAmount=₹${sale.saleAmount} | date=${sale.createdAt.toISOString()}`);

    res.json({
      success: true,
      data: {
        billId: sale.billId || sale.invoiceNumber,
        saleAmount: sale.saleAmount,
        netAmount: sale.saleAmount,
        commissionRate: rate,
        commissionAmount: sale.commissionAmount,
        date: sale.createdAt,
        status: sale.status,
        description: sale.notes,
        createdAt: sale.createdAt,
        customerName,
        customerPhone,
        paymentMode,
        storeName,
        products,
        grossSale,
        discount,
        tax,
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

