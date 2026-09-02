import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { getCommissionStats, resolveEmployeeId, isEligibleCommissionEmployee, safeParseDate, getNumericInvoiceNumber, parseIstStartOfDay, parseIstEndOfDay, getTransactionNetContribution, extractWebhookMeta } from '../utils/commissionHelper';
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

    const numInv = getNumericInvoiceNumber(sale);
    res.json({
      success: true,
      data: {
        sale: {
          id: sale.id,
          billId: numInv,
          invoiceNumber: sale.invoiceNumber || `HWM-${numInv}`,
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

    const conditions: any[] = [];
    if (employeeId) {
      const resolvedId = await resolveEmployeeId(employeeId as string);
      conditions.push({ employeeId: resolvedId !== null ? resolvedId : -1 });
    } else if (req.user?.role === 'EMPLOYEE' && req.user?.id) {
      const currentEmp = await prisma.employee.findFirst({
        where: { userId: req.user.id }
      });
      if (currentEmp) {
        conditions.push({ employeeId: currentEmp.id });
      }
    }
    
    if (storeId && storeId !== 'all' && storeId !== '' && !isNaN(parseInt(storeId as string, 10))) {
      const sId = parseInt(storeId as string, 10);
      conditions.push({
        OR: [
          { storeId: sId },
          { employee: { storeId: sId } },
        ]
      });
    }
    if (status && status !== 'all' && status !== '') {
      conditions.push({ status: status as string });
    }

    if (billId) {
      const bId = Array.isArray(billId) ? String(billId[0]) : String(billId);
      conditions.push({
        OR: [
          { billId: bId },
          { invoiceNumber: bId },
          { billId: `HWM-${bId}` },
          { invoiceNumber: `HWM-${bId}` },
        ]
      });
    } else if (search) {
      const term = Array.isArray(search) ? String(search[0]).trim() : String(search).trim();
      conditions.push({
        OR: [
          { billId: { contains: term, mode: 'insensitive' } },
          { invoiceNumber: { contains: term, mode: 'insensitive' } },
          { employee: { firstName: { contains: term, mode: 'insensitive' } } },
          { employee: { lastName: { contains: term, mode: 'insensitive' } } },
          { employee: { employeeCode: { contains: term, mode: 'insensitive' } } },
          { store: { name: { contains: term, mode: 'insensitive' } } },
          { employee: { store: { name: { contains: term, mode: 'insensitive' } } } },
        ]
      });
    }

    if (startDate || endDate) {
      const dateCond: any = {};
      if (startDate) {
        dateCond.gte = parseIstStartOfDay(startDate as string);
      }
      if (endDate) {
        dateCond.lte = parseIstEndOfDay(endDate as string);
      }
      conditions.push({ createdAt: dateCond });
    }

    const whereClause: any = conditions.length > 0 ? { AND: conditions } : {};

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
    const dedupedTransactions = deduplicateCommissionTransactions(eligible);

    // Enrich transactions with isActive from WebhookLog records or notes
    const billIds = dedupedTransactions.map((t) => String(t.billId || '')).filter(Boolean);
    const invoiceNumbers = dedupedTransactions.map((t) => String(t.invoiceNumber || '')).filter(Boolean);

    const relevantLogs = (billIds.length > 0 || invoiceNumbers.length > 0)
      ? await prisma.webhookLog.findMany({
          where: {
            OR: [
              { billId: { in: billIds } },
              { billId: { in: billIds.map((b) => String(b).replace(/^HWM-/, '')) } },
              { billId: { in: invoiceNumbers } },
            ],
          },
          select: { billId: true, payload: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const billActiveMap = new Map<string, boolean>();
    for (const log of relevantLogs) {
      if (!log.billId) continue;
      try {
        const parsed = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
        const meta = extractWebhookMeta(parsed);
        if (meta.isActive !== null && meta.isActive !== undefined && !billActiveMap.has(log.billId)) {
          billActiveMap.set(log.billId, meta.isActive);
          billActiveMap.set(`HWM-${log.billId}`, meta.isActive);
          billActiveMap.set(log.billId.replace(/^HWM-/, ''), meta.isActive);
          if (meta.invoiceNumber) {
            billActiveMap.set(meta.invoiceNumber, meta.isActive);
          }
        }
      } catch (e) {}
    }

    // Fetch related SalesExchanges, CreditNotes, and Sales to accurately resolve old/new bill reconciliation
    const [salesExchanges, creditNotes, allSales] = await Promise.all([
      prisma.salesExchange.findMany().catch(() => []),
      prisma.creditNote.findMany({ include: { lineItems: true } }).catch(() => []),
      prisma.sales.findMany({ select: { id: true, billId: true, netAmount: true, status: true, replacedBySaleId: true } }).catch(() => []),
    ]);

    const salesMap = new Map<string, any>();
    for (const s of allSales) {
      if (s.billId) salesMap.set(s.billId, s);
    }

    const transactions = dedupedTransactions.map((t) => {
      let activeVal: boolean | null = null;
      const bIdStr = String(t.billId || '');
      const invStr = String(t.invoiceNumber || '');
      if (bIdStr && billActiveMap.has(bIdStr)) {
        activeVal = billActiveMap.get(bIdStr)!;
      } else if (invStr && billActiveMap.has(invStr)) {
        activeVal = billActiveMap.get(invStr)!;
      } else if (bIdStr && billActiveMap.has(bIdStr.replace(/^HWM-/, ''))) {
        activeVal = billActiveMap.get(bIdStr.replace(/^HWM-/, ''))!;
      } else if (typeof t.notes === 'string') {
        const match = t.notes.match(/isActive:\s*(true|false)/i);
        if (match) {
          activeVal = match[1].toLowerCase() === 'true';
        }
      }

      const bill = String(t.billId || t.invoiceNumber || '').trim();
      const notes = String(t.notes || '').trim();
      const ev = String(t.eventType || '').toUpperCase();
      const rate = Number(t.commissionPercent ?? t.employee?.commissionPercentage ?? 1);

      // Match exchange
      const exMatch = notes.match(/\(EX:\s*([^)]+)\)/i);
      const exNo = exMatch ? exMatch[1].trim() : null;

      const matchedEx = salesExchanges.find(e => 
        (exNo && e.exchangeNo === exNo) ||
        e.newInvoiceNo === bill ||
        e.originalInvoiceNo === bill ||
        bill.startsWith(e.newInvoiceNo) ||
        bill.replace(/-NEW$/, '') === e.newInvoiceNo
      );

      // Match credit note
      const matchedCn = creditNotes.find(c => 
        c.creditNoteNo === bill ||
        c.invoiceNo === bill ||
        bill.startsWith(c.creditNoteNo)
      );

      const isCreditNote =
        ev.includes('CREDIT_NOTE') ||
        bill.startsWith('CN-') ||
        bill.startsWith('HKACN') ||
        notes.toUpperCase().includes('CREDIT NOTE') ||
        notes.toUpperCase().includes('CREDIT_NOTE') ||
        !!matchedCn;

      const isExchange =
        ev.includes('EXCHANGE') ||
        bill.startsWith('EX-') ||
        bill.startsWith('INV-EX-') ||
        notes.toUpperCase().includes('EXCHANGE') ||
        !!matchedEx;

      const oldNotesMatch = notes.match(/Old Amount:\s*[₹$]?([0-9.]+)/i);
      const newNotesMatch = notes.match(/New Amount:\s*[₹$]?([0-9.]+)/i);
      const notesOld = oldNotesMatch ? Number(oldNotesMatch[1]) : null;
      const notesNew = newNotesMatch ? Number(newNotesMatch[1]) : null;

      let oldBillAmount: number | null = null;
      let newBillAmount: number = Number(t.newAmount !== undefined && t.newAmount !== null && Number(t.newAmount) > 0 ? t.newAmount : (t.saleAmount || 0));
      let differenceAmount: number | null = null;
      let oldBillCommission: number | null = null;
      let newBillCommission: number = Number(t.newCommission !== undefined && t.newCommission !== null && Number(t.newCommission) > 0 ? t.newCommission : (t.commissionAmount || 0));
      let commissionDifference: number | null = null;

      if (isExchange) {
        const origAmt = matchedEx
          ? Number(matchedEx.originalAmount)
          : (t.oldAmount !== null && t.oldAmount !== undefined && Number(t.oldAmount) > 0 ? Number(t.oldAmount) : notesOld);
        const newAmt = matchedEx
          ? Number(matchedEx.newAmount)
          : (notesNew !== null ? notesNew : (t.newAmount && Number(t.newAmount) > 0 ? Number(t.newAmount) : Number(t.saleAmount || 0)));

        if (origAmt !== null && origAmt > 0) {
          oldBillAmount = origAmt;
          newBillAmount = newAmt;
          differenceAmount = Math.round((oldBillAmount - newBillAmount) * 100) / 100;
          oldBillCommission = matchedEx && Number(matchedEx.originalCommission) > 0
            ? Number(matchedEx.originalCommission)
            : (t.oldCommission && Number(t.oldCommission) > 0 ? Number(t.oldCommission) : Math.round(((oldBillAmount * rate) / 100) * 100) / 100);
          newBillCommission = matchedEx && Number(matchedEx.newCommission) > 0
            ? Number(matchedEx.newCommission)
            : (t.newCommission && Number(t.newCommission) > 0 ? Number(t.newCommission) : Math.round(((newBillAmount * rate) / 100) * 100) / 100);
          commissionDifference = Math.round((oldBillCommission - newBillCommission) * 100) / 100;
        }
      } else if (isCreditNote) {
        let origAmt: number | null = null;
        if (matchedCn?.invoiceNo && salesMap.has(matchedCn.invoiceNo)) {
          origAmt = Number(salesMap.get(matchedCn.invoiceNo).netAmount);
        } else if (t.oldAmount && Number(t.oldAmount) > 0) {
          origAmt = Number(t.oldAmount);
        } else if (notesOld !== null && notesOld > 0) {
          origAmt = notesOld;
        }
        const cnAmt = matchedCn ? Number(matchedCn.creditAmount) : (notesNew !== null ? notesNew : Number(t.newAmount || t.saleAmount || 0));

        if (origAmt !== null && origAmt > 0) {
          oldBillAmount = origAmt;
          newBillAmount = cnAmt;
          differenceAmount = Math.round((oldBillAmount - newBillAmount) * 100) / 100;
          oldBillCommission = Math.round(((oldBillAmount * rate) / 100) * 100) / 100;
          newBillCommission = Math.round(((newBillAmount * rate) / 100) * 100) / 100;
          commissionDifference = Math.round((oldBillCommission - newBillCommission) * 100) / 100;
        }
      } else if (ev === 'INVOICE_UPDATED' || (notesOld !== null && notesOld > 0) || (t.oldAmount && Number(t.oldAmount) > 0)) {
        const origAmt = t.oldAmount && Number(t.oldAmount) > 0 ? Number(t.oldAmount) : notesOld;
        const newAmt = notesNew !== null ? notesNew : Number(t.newAmount || t.saleAmount || 0);

        if (origAmt !== null && origAmt > 0) {
          oldBillAmount = origAmt;
          newBillAmount = newAmt;
          differenceAmount = Math.round((oldBillAmount - newBillAmount) * 100) / 100;
          oldBillCommission = t.oldCommission && Number(t.oldCommission) > 0
            ? Number(t.oldCommission)
            : Math.round(((oldBillAmount * rate) / 100) * 100) / 100;
          newBillCommission = t.newCommission && Number(t.newCommission) > 0
            ? Number(t.newCommission)
            : Math.round(((newBillAmount * rate) / 100) * 100) / 100;
          commissionDifference = Math.round((oldBillCommission - newBillCommission) * 100) / 100;
        }
      }

      return {
        ...t,
        isActive: activeVal,
        oldAmount: oldBillAmount,
        oldBillAmount,
        differenceAmount,
        newAmount: newBillAmount,
        newBillAmount,
        oldCommission: oldBillCommission,
        oldBillCommission,
        commissionDifference,
        newCommission: newBillCommission,
        newBillCommission,
      };
    });

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
      gteDate = parseIstStartOfDay(fromStr);
    }
    if (toStr) {
      lteDate = parseIstEndOfDay(toStr);
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

      const { netSales, netCommission } = getTransactionNetContribution(tx);
      if (netSales >= 0) {
        groups[key].sales += netSales;
      } else {
        groups[key].credits += Math.abs(netSales);
      }

      groups[key].commissionAmount += netCommission;
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
