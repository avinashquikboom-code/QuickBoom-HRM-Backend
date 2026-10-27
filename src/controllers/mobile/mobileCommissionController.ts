import { projectInvoiceCommissionsForRead, projectInvoiceCommissionForRead } from '../../services/invoiceCommissionReadProjection';
import { recordedInvoiceCommission } from '../../services/recordedInvoiceCommission';
import { mobileInvoiceDetail, calculateInvoiceCommission, resolveInvoiceStore } from '../../services/invoiceCommissionService';
import { hasUnresolvedInvoiceItems } from '../../services/invoiceCommissionCompleteness';
import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { getCommissionStats, extractWebhookMeta, safeParseAmount, getTransactionNetContribution, getNumericInvoiceNumber, parseIstStartOfDay, parseIstEndOfDay } from '../../utils/commissionHelper';
import { getEffectiveUserPermissions } from '../../utils/permissionHelper';
import { CommissionService } from '../../services/commissionService';
import { deduplicateCommissionTransactions } from '../../utils/commissionDeduplicator';
import { getEmployeeRetailCommissionBillDetail } from '../../pos/retailCommissions';

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
          commissionRate: employee.commissionPercentage !== null && employee.commissionPercentage !== undefined ? Number(employee.commissionPercentage) : null,
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
        whereClause.createdAt.gte = parseIstStartOfDay(startDate as string);
      }
      if (endDate) {
        whereClause.createdAt.lte = parseIstEndOfDay(endDate as string);
      }
    }

    const allMatchingRaw = await projectInvoiceCommissionsForRead(await prisma.commissionTransaction.findMany({
      where: whereClause,
      orderBy: [{ id: 'desc' }, { createdAt: 'desc' }],
    }));

    const allMatchingDeduplicated = deduplicateCommissionTransactions(allMatchingRaw);

    const total = allMatchingDeduplicated.length;
    const limitNum = parseInt(limit as string) || 50;
    const offsetNum = parseInt(offset as string) || 0;
    const transactions = allMatchingDeduplicated.slice(offsetNum, offsetNum + limitNum);

    console.log(`[MOBILE-COMMISSION-DIAG] Transactions retrieved for employee id=${employee.id} | page=${transactions.length}, total=${total}`);

function sanitizeHopKidNote(note: string | null | undefined, numInv: number): string {
  if (!note || note === 'Retail Sale' || note === 'Retail product') {
    return `HopKid Invoice #${numInv}`;
  }
  const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(note.trim());
  if (isUuid) {
    return `HopKid Invoice #${numInv}`;
  }
  return note.replace(/HopKid\s+Invoice\s+[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/gi, `HopKid Invoice #${numInv}`);
}

    const mappedTransactions = transactions.map((t) => {
      const numInv = getNumericInvoiceNumber(t);
      const recorded = recordedInvoiceCommission(t);
      const effectiveSale = Number(t.saleAmount);
      const comm = recorded.commissionEarned;
      const unresolved = recorded.hasUnresolvedInvoiceItems;
      const rate = recorded.commissionRate;

      const noteClean = sanitizeHopKidNote(t.notes, numInv);
      const {
        commission: _recordedCommission,
        commissionType: _recordedCommissionType,
        commissionPercent: _recordedPercent,
        commissionPercentage: _recordedPercentage,
        commissionRate: _recordedRate,
        commissionAmount: _recordedAmount,
        commissionEarned: _recordedEarned,
        totalCommission: _recordedTotal,
        hasUnresolvedInvoiceItems: _recordedUnresolved,
        ...recordedMetadata
      } = recorded;

      return {
        id: t.id,
        billId: numInv,
        billNumber: numInv,
        invoiceNumber: t.invoiceNumber || `HWM-${numInv}`,
        invoiceNo: t.invoiceNumber || `HWM-${numInv}`,
        invoiceId: t.billId || String(t.id),
        hopkidInvoiceNumber: `HopKid Invoice #${numInv}`,
        customerName: noteClean,
        ...recordedMetadata,
        amount: effectiveSale,
        saleAmount: effectiveSale,
        billAmount: effectiveSale,
        commission: comm,
        commissionType: t.commissionType,
        commissionPercent: rate,
        commissionPercentage: rate,
        commissionRate: rate,
        commissionAmount: comm,
        commissionEarned: comm,
        totalCommission: comm,
        hasUnresolvedInvoiceItems: unresolved,
        oldAmount: Number(t.oldAmount || 0),
        newAmount: effectiveSale,
        oldCommission: Number(t.oldCommission || 0),
        newCommission: comm,
        status: t.status,
        date: t.createdAt,
        createdAt: t.createdAt,
        approvedAt: t.approvedAt,
        paidAt: t.paidAt,
        description: noteClean,
        notes: noteClean,
      };
    });

    const summary = {
      totalSales: allMatchingDeduplicated.reduce((sum, t) => sum + getTransactionNetContribution(t).netSales, 0),
      totalCommission: allMatchingDeduplicated.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0),
      transactionCount: allMatchingDeduplicated.length,
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

    const bills = transactions.map(t => {
      const numInv = getNumericInvoiceNumber(t);
      return {
        billId: numInv,
        invoiceNumber: t.invoiceNumber || `HWM-${numInv}`,
        billNumber: numInv,
        invoiceNo: t.invoiceNumber || `HWM-${numInv}`,
        amount: t.saleAmount,
        commission: t.commissionAmount,
        time: t.createdAt,
      };
    });

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

    // Pre-fetch employee's Commission Transactions to correlate accurate commissions and statuses
    let empCommissionTransactions: any[] = [];
    try {
      empCommissionTransactions = await prisma.commissionTransaction.findMany({
        where: { employeeId: employee.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      empCommissionTransactions=await projectInvoiceCommissionsForRead(empCommissionTransactions);
    } catch (_) {}

    const invoiceKey = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/^(?:hwm-|inv-)(\d+)$/, '$1');
    const findMatchingTx = async (billIdStr: string | null, invNoStr: string | null, storeId?: number | null) => {
      const keys = [billIdStr, invNoStr].filter(Boolean).map(invoiceKey);
      const matches = empCommissionTransactions.filter(tx => (!storeId || !tx.storeId || tx.storeId === storeId) &&
        [tx.billId, tx.invoiceNumber].filter(Boolean).some(value => keys.includes(invoiceKey(value))));
      const scoped = storeId && matches.some(tx => tx.storeId === storeId)
        ? matches.filter(tx => tx.storeId === storeId) : matches;
      if (scoped.length) return scoped.length === 1 ? scoped[0] : null;
      // Activity may reference an invoice outside the latest 100 transactions.
      const aliases = [...new Set(keys.flatMap(key => /^\d+$/.test(key) ? [key, `HWM-${key}`, `INV-${key}`] : [key]))];
      if (!aliases.length) return null;
      const older = await prisma.commissionTransaction.findMany({where:{employeeId:employee.id,
        ...(storeId ? {OR:[{storeId},{storeId:null}]} : {}),
        AND:[{OR:[{billId:{in:aliases,mode:'insensitive'}},{invoiceNumber:{in:aliases,mode:'insensitive'}}]}]},take:2});
      return older.length === 1 ? await projectInvoiceCommissionForRead(older[0]) : null;
    };

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
        const numInv = getNumericInvoiceNumber({ invoiceNumber: meta.invoiceNumber, billId: log.billId || meta.billId, id: log.id });
        const cleanInvoiceNo = (meta.invoiceNumber && !/^[0-9a-fA-F-]{36}$/.test(meta.invoiceNumber))
          ? meta.invoiceNumber
          : (matchedCnLine ? matchedCnLine.creditNote.invoiceNo : `HWM-${numInv}`);

        const amtVal = isCreditNote && matchedCnLine ? Number(matchedCnLine.creditAmount) : Number(log.amount ?? meta.amount ?? 0);

        const matchedTx = !isCreditNote ? await findMatchingTx(log.billId || meta.billId, meta.invoiceNumber, meta.storeId) : null;
        let recorded = matchedTx ? recordedInvoiceCommission(matchedTx) : null;
        let commAmt = isCreditNote && matchedCnLine ? -Number(matchedCnLine.commissionAdjustment) : recorded?.commissionAmount ?? null;

        if (!isCreditNote && (commAmt == null || recorded?.commissionState === 'INVOICE_DATA_MISSING')) {
          try {
            const raw = JSON.parse(log.payload);
            const rawMeta = extractWebhookMeta(raw);
            const resolvedStoreId = await resolveInvoiceStore(prisma, {
              sale: matchedTx,
              meta: rawMeta,
              aliases: [log.billId, meta.billId, meta.invoiceNumber, String(numInv)].filter((v): v is string => Boolean(v)),
              employee
            });
            if (resolvedStoreId) {
              const calcResult = await calculateInvoiceCommission(prisma, matchedTx, raw, {
                storeId: resolvedStoreId,
                at: log.createdAt,
                reference: log.billId || meta.billId || meta.invoiceNumber || String(numInv),
                sourceRecordedAt: log.createdAt,
                employeeIdentifiers: [employee.employeeCode, employee.mobileNumber].filter((v): v is string => Boolean(v))
              });
              if (calcResult.commissionAmount !== null) {
                commAmt = calcResult.commissionAmount;
                recorded = {
                  commissionRate: calcResult.commissionRate,
                  commissionPercent: calcResult.commissionRate,
                  commissionPercentage: calcResult.commissionRate,
                  commissionType: calcResult.productCommissionBreakdown.every((l: any) => l.commissionType === 'FIXED') ? 'FIXED' : 'PERCENTAGE',
                  fixedBasis: 'UNIT',
                  commissionAmount: calcResult.commissionAmount,
                  commissionEarned: calcResult.commissionAmount,
                  commission: calcResult.commissionAmount,
                  totalCommission: calcResult.commissionAmount,
                  hasUnresolvedInvoiceItems: false,
                  hasMissingConfiguration: false,
                  hasMissingInvoiceData: false,
                  productCommissionBreakdown: calcResult.productCommissionBreakdown,
                  productWiseCommission: calcResult.productCommissionBreakdown,
                  commissionSource: calcResult.commissionSource,
                  saleOccurredAt: (calcResult as any).saleOccurredAt ?? null,
                  saleTimestampField: (calcResult as any).saleTimestampField ?? null,
                  saleTimeZone: (calcResult as any).saleTimeZone ?? null,
                  saleTimeZoneSource: (calcResult as any).saleTimeZoneSource ?? null,
                  commissionState: 'COMPLETE',
                  missingReason: null,
                  rateDisplay: calcResult.rateDisplay,
                };
              }
            }
          } catch (_) {}
        }

        const eventStatus = log.status === 'FAILED' || log.status === 'REJECTED' ? log.status : (log.status || 'SUCCESS');
        const commState = recorded?.commissionState ?? (commAmt !== null ? 'COMPLETE' : 'UNKNOWN');
        results.push({
          id: log.id,
          eventType: log.eventType || meta.eventType || 'INVOICE_CREATED',
          status: eventStatus,
          deliveryStatus: log.status || 'SUCCESS',
          approvalStatus: matchedTx?.status ?? 'PENDING',
          billId: numInv,
          invoiceNo: cleanInvoiceNo,
          invoiceNumber: cleanInvoiceNo,
          amount: amtVal,
          oldAmount: null,
          oldBillAmount: null,
          newAmount: amtVal,
          newBillAmount: amtVal,
          differenceAmount: null,
          ...(recorded ?? {commissionState: commState, hasMissingConfiguration: false, hasMissingInvoiceData: commAmt == null}),
          commissionAmount: commAmt,
          commissionEarned: commAmt,
          totalCommission: commAmt,
          commissionRate: recorded?.commissionRate ?? null,
          commissionPercent: recorded?.commissionPercent ?? null,
          commissionPercentage: recorded?.commissionPercentage ?? null,
          commissionStatus: commState,
          rateDisplay: recorded?.rateDisplay ?? (commAmt !== null ? (recorded?.commissionRate != null ? `${recorded.commissionRate}%` : null) : 'Invoice item data unavailable'),
          customerName: meta.customerName && meta.customerName !== 'N/A' ? meta.customerName : '-',
          errorMessage: log.errorMessage || null,
          createdAt: log.createdAt,
          externalEventId: meta.eventId || log.id,
        });
      }
    } catch (_) { /* table may not exist */ }

    // Fallback: If any CreditNoteLine for this employee is missing from WebhookLog, add log item
    for (const line of empCreditNoteLines) {
      const cnNo = line.creditNote.creditNoteNo;
      const numCnInv = getNumericInvoiceNumber({ invoiceNumber: line.creditNote.invoiceNo, billId: cnNo, id: line.id });
      if (!results.some((r) => r.billId === numCnInv || r.invoiceNo === line.creditNote.invoiceNo)) {
        const cnLineAmt = Number(line.creditAmount);
        results.push({
          id: `cn-${line.id}`,
          eventType: 'CREDIT_NOTE_CREATED',
          status: 'SUCCESS',
          billId: numCnInv,
          invoiceNo: line.creditNote.invoiceNo || `HWM-${numCnInv}`,
          invoiceNumber: line.creditNote.invoiceNo || `HWM-${numCnInv}`,
          amount: cnLineAmt,
          oldAmount: null,
          oldBillAmount: null,
          newAmount: cnLineAmt,
          newBillAmount: cnLineAmt,
          differenceAmount: null,
          commissionAmount: -Number(line.commissionAdjustment),
          commissionPercent: null,
          rateDisplay: null,
          customerName: 'Customer',
          errorMessage: null,
          createdAt: line.createdAt,
          externalEventId: cnNo,
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

        const numInv = getNumericInvoiceNumber({ invoiceNumber: meta.invoiceNumber, billId: log.billId || meta.billId, id: log.id });
        const cleanInvoiceNo = (meta.invoiceNumber && !/^[0-9a-fA-F-]{36}$/.test(meta.invoiceNumber)) ? meta.invoiceNumber : `HWM-${numInv}`;

        // Skip if already covered by WebhookLog (same billId)
        if (numInv && results.some((r) => r.billId === numInv)) continue;

        const hAmtVal = Number(log.amount ?? meta.amount ?? 0);

        const matchedTx = await findMatchingTx(log.billId || meta.billId, meta.invoiceNumber, meta.storeId ?? log.storeId);
        let recorded = matchedTx ? recordedInvoiceCommission(matchedTx) : null;
        let commAmt = recorded?.commissionAmount ?? null;

        if (commAmt == null || recorded?.commissionState === 'INVOICE_DATA_MISSING') {
          try {
            const raw = JSON.parse(log.rawPayload);
            const rawMeta = extractWebhookMeta(raw);
            const resolvedStoreId = await resolveInvoiceStore(prisma, {
              sale: matchedTx,
              meta: rawMeta,
              aliases: [log.billId, meta.billId, meta.invoiceNumber, String(numInv)].filter((v): v is string => Boolean(v)),
              employee
            });
            if (resolvedStoreId) {
              const calcResult = await calculateInvoiceCommission(prisma, matchedTx, raw, {
                storeId: resolvedStoreId,
                at: log.createdAt,
                reference: log.billId || meta.billId || meta.invoiceNumber || String(numInv),
                sourceRecordedAt: log.createdAt,
                employeeIdentifiers: [employee.employeeCode, employee.mobileNumber].filter((v): v is string => Boolean(v))
              });
              if (calcResult.commissionAmount !== null) {
                commAmt = calcResult.commissionAmount;
                recorded = {
                  commissionRate: calcResult.commissionRate,
                  commissionPercent: calcResult.commissionRate,
                  commissionPercentage: calcResult.commissionRate,
                  commissionType: calcResult.productCommissionBreakdown.every((l: any) => l.commissionType === 'FIXED') ? 'FIXED' : 'PERCENTAGE',
                  fixedBasis: 'UNIT',
                  commissionAmount: calcResult.commissionAmount,
                  commissionEarned: calcResult.commissionAmount,
                  commission: calcResult.commissionAmount,
                  totalCommission: calcResult.commissionAmount,
                  hasUnresolvedInvoiceItems: false,
                  hasMissingConfiguration: false,
                  hasMissingInvoiceData: false,
                  productCommissionBreakdown: calcResult.productCommissionBreakdown,
                  productWiseCommission: calcResult.productCommissionBreakdown,
                  commissionSource: calcResult.commissionSource,
                  saleOccurredAt: (calcResult as any).saleOccurredAt ?? null,
                  saleTimestampField: (calcResult as any).saleTimestampField ?? null,
                  saleTimeZone: (calcResult as any).saleTimeZone ?? null,
                  saleTimeZoneSource: (calcResult as any).saleTimeZoneSource ?? null,
                  commissionState: 'COMPLETE',
                  missingReason: null,
                  rateDisplay: calcResult.rateDisplay,
                };
              }
            }
          } catch (_) {}
        }

        const commState = recorded?.commissionState ?? (commAmt !== null ? 'COMPLETE' : 'UNKNOWN');
        results.push({
          id: `hopkid-${log.id}`,
          eventType: meta.eventType || 'INVOICE_CREATED',
          status: 'SUCCESS',
          deliveryStatus: 'SUCCESS',
          approvalStatus: matchedTx?.status ?? 'PENDING',
          billId: numInv,
          invoiceNo: cleanInvoiceNo,
          invoiceNumber: cleanInvoiceNo,
          amount: hAmtVal,
          oldAmount: null,
          oldBillAmount: null,
          newAmount: hAmtVal,
          newBillAmount: hAmtVal,
          differenceAmount: null,
          ...(recorded ?? {commissionState: commState, hasMissingConfiguration: false, hasMissingInvoiceData: commAmt == null}),
          commissionAmount: commAmt,
          commissionEarned: commAmt,
          totalCommission: commAmt,
          commissionRate: recorded?.commissionRate ?? null,
          commissionPercent: recorded?.commissionPercent ?? null,
          commissionPercentage: recorded?.commissionPercentage ?? null,
          commissionStatus: commState,
          rateDisplay: recorded?.rateDisplay ?? (commAmt !== null ? (recorded?.commissionRate != null ? `${recorded.commissionRate}%` : null) : 'Invoice item data unavailable'),
          customerName: meta.customerName || 'N/A',
          errorMessage: null,
          createdAt: log.createdAt,
          externalEventId: meta.eventId || log.id,
        });
      }
    } catch (_) { /* table may not exist */ }

    // 4. Fallback: Any CommissionTransaction for this employee not yet captured in webhook activity
    for (const tx of empCommissionTransactions) {
      const numInv = getNumericInvoiceNumber({ invoiceNumber: tx.invoiceNumber, billId: tx.billId, id: tx.id });
      const cleanInvoiceNo = (tx.invoiceNumber && !/^[0-9a-fA-F-]{36}$/.test(tx.invoiceNumber))
        ? tx.invoiceNumber
        : (numInv ? `HWM-${numInv}` : '—');

      const alreadyPresent = results.some(r =>
        (numInv && r.billId === numInv) ||
        (cleanInvoiceNo && (r.invoiceNo === cleanInvoiceNo || r.invoiceNumber === cleanInvoiceNo))
      );

      if (!alreadyPresent) {
        const recorded = recordedInvoiceCommission(tx);
        results.push({
          id: `tx-${tx.id}`,
          eventType: tx.eventType || 'INVOICE_CREATED',
          status: tx.status === 'REJECTED' ? 'FAILED' : 'SUCCESS',
          deliveryStatus: 'SUCCESS',
          approvalStatus: tx.status,
          billId: numInv,
          invoiceNo: cleanInvoiceNo,
          invoiceNumber: cleanInvoiceNo,
          amount: Number(tx.saleAmount || 0),
          oldAmount: tx.oldAmount !== null ? Number(tx.oldAmount) : null,
          oldBillAmount: tx.oldAmount !== null ? Number(tx.oldAmount) : null,
          newAmount: Number(tx.saleAmount || 0),
          newBillAmount: Number(tx.saleAmount || 0),
          differenceAmount: tx.commissionDifference !== null ? Number(tx.commissionDifference) : null,
          ...recorded,
          commissionStatus: recorded.commissionState,
          customerName: 'POS Customer',
          errorMessage: null,
          createdAt: tx.createdAt,
          externalEventId: tx.billId || `TX-${tx.id}`,
        });
      }
    }

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
    const allTransactions = await projectInvoiceCommissionsForRead(await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employee.id,
        status: { in: ['PENDING', 'APPROVED', 'PAID'] }
      }
    }));

    const pendingCommission = allTransactions
      .filter(t => t.status === 'PENDING' || t.status === 'APPROVED')
      .reduce((sum, t) => sum + t.commissionAmount, 0);

    const paidCommission = allTransactions
      .filter(t => t.status === 'PAID')
      .reduce((sum, t) => sum + t.commissionAmount, 0);

    const lifetimeCommission = allTransactions
      .reduce((sum, t) => sum + t.commissionAmount, 0);

    const commissionRate = employee.commissionPercentage !== null && employee.commissionPercentage !== undefined ? Number(employee.commissionPercentage) : null;

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
            totalSales: summary.today.totalSales ?? summary.today.netSales,
            netSales: summary.today.netSales,
            totalSalesAmount: summary.today.netSales,
            totalCommission: summary.today.totalCommission ?? summary.today.commission,
            commission: summary.today.commission,
            totalCommissionEarned: summary.today.commission,
            commissionAmount: summary.today.commission,
            billCount: summary.today.billCount,
            label: "Today's Performance"
          },

          // ═════════════════════════════════════════════════════════════
          // WEEK'S METRICS (IST MON - SUN)
          // ═════════════════════════════════════════════════════════════
          thisWeek: {
            from: summary.weekly.start,
            to: summary.weekly.end,
            totalSales: summary.weekly.totalSales ?? summary.weekly.netSales,
            netSales: summary.weekly.netSales,
            totalSalesAmount: summary.weekly.netSales,
            totalCommission: summary.weekly.totalCommission ?? summary.weekly.commission,
            commission: summary.weekly.commission,
            totalCommissionEarned: summary.weekly.commission,
            commissionAmount: summary.weekly.commission,
            billCount: summary.weekly.billCount,
            label: "This Week's Performance"
          },

          // ═════════════════════════════════════════════════════════════
          // THIS MONTH'S METRICS (AGGREGATED)
          // ═════════════════════════════════════════════════════════════
          thisMonth: {
            month: summary.thisMonth.month,
            monthName: summary.thisMonth.monthName ?? summary.thisMonth.month,
            year: summary.thisMonth.year ?? summary.thisMonth.month.split('-')[0],
            totalSales: summary.thisMonth.totalSales ?? summary.thisMonth.netSales,
            netSales: summary.thisMonth.netSales,
            totalSalesAmount: summary.thisMonth.netSales,
            totalCommission: summary.thisMonth.totalCommission ?? summary.thisMonth.commission,
            commission: summary.thisMonth.commission,
            totalCommissionEarned: summary.thisMonth.commission,
            commissionAmount: summary.thisMonth.commission,
            billCount: summary.thisMonth.billCount,
            label: "This Month's Performance"
          },

          // ═════════════════════════════════════════════════════════════
          // LATEST SALE (MOST RECENT TRANSACTION)
          // ═════════════════════════════════════════════════════════════
          latestSale: summary.latestSale ? {
            billId: getNumericInvoiceNumber(summary.latestSale),
            invoiceNumber: summary.latestSale.invoiceNumber || `HWM-${getNumericInvoiceNumber(summary.latestSale)}`,
            billNumber: getNumericInvoiceNumber(summary.latestSale),
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
        fromDate = from ? parseIstStartOfDay(from as string) : new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
        toDate   = to   ? parseIstEndOfDay(to as string)   : new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
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

    const txs = await projectInvoiceCommissionsForRead(await prisma.commissionTransaction.findMany({
      where,
      orderBy: [{ id: 'desc' }, { createdAt: 'desc' }],
      take: limitNum,
      skip: offsetNum,
    }));

    const totalTxs = await prisma.commissionTransaction.count({ where });

    const bills: any[] = txs.map((t) => {
      const numInv = getNumericInvoiceNumber(t);
      const recorded = recordedInvoiceCommission(t);
      const effectiveSale = Number(t.saleAmount);
      const comm = recorded.commissionEarned;
      const unresolved = recorded.hasUnresolvedInvoiceItems;
      const rate = recorded.commissionRate;
      const {
        commission: _recordedCommission,
        commissionType: _recordedCommissionType,
        commissionAmount: _recordedAmount,
        commissionEarned: _recordedEarned,
        commissionRate: _recordedRate,
        commissionPercentage: _recordedPercentage,
        commissionPercent: _recordedPercent,
        hasUnresolvedInvoiceItems: _recordedUnresolved,
        totalCommission: _recordedTotal,
        ...recordedMetadata
      } = recorded;

      return {
        id: String(t.id),
        billId: numInv,
        billNumber: numInv,
        invoiceNumber: t.invoiceNumber || `HWM-${numInv}`,
        invoiceNo: t.invoiceNumber || `HWM-${numInv}`,
        ...recordedMetadata,
        saleAmount: effectiveSale,
        billAmount: effectiveSale,
        commission: comm,
        commissionType: t.commissionType,
        commissionAmount: comm,
        commissionEarned: comm,
        commissionRate: rate,
        commissionPercentage: rate,
        commissionPercent: rate,
        hasUnresolvedInvoiceItems: unresolved,
        oldAmount: Number(t.oldAmount || 0),
        newAmount: effectiveSale,
        oldCommission: Number(t.oldCommission || 0),
        newCommission: comm,
        totalCommission: comm,
        date: t.createdAt,
        status: t.status,
        description: t.notes,
        eventType: t.eventType,
      };
    });

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
          const numCnInv = getNumericInvoiceNumber({ invoiceNumber: line.creditNote.invoiceNo, billId: cnNo, id: line.id });
          bills.push({
            id: `cn-${line.id}`,
            billId: cnNo,
            invoiceNo: line.creditNote.invoiceNo,
            invoiceNumber: numCnInv,
            billNumber: numCnInv,
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
export const getMobileCommissionBillDetail = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const raw=req.params.billId;
    const data=await mobileInvoiceDetail(req.user!.id,Array.isArray(raw)?String(raw[0]):String(raw),req.user!.role);
    res.json({success:true,data});
  } catch(error:any) {
    const status=error.status??500;
    if(status===500) console.error('[Invoice commission detail]',error.message);
    res.status(status).json({success:false,message:status===500?'Unable to load invoice commission details':error.message});
  }
};
