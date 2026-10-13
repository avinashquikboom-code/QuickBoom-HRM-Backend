import { enrichProductBreakdown } from '../utils/productLineMeta';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import {
  getCommissionStats,
  resolveEmployeeId,
  isEligibleCommissionEmployee,
  safeParseDate,
  getNumericInvoiceNumber,
  parseIstStartOfDay,
  parseIstEndOfDay,
  getTransactionNetContribution,
  extractWebhookMeta,
  resolveBillAndCommissionReconciliation,
  calculateEffectiveCommissionForLineItem
} from '../utils/commissionHelper';
import { deduplicateCommissionTransactions } from '../utils/commissionDeduplicator';
import { notifyEmployee, sendHRNotification } from '../utils/hrNotificationHelper';

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
    const raw = req.body;
    const policyData: any = {
      name: raw.name,
      description: raw.description || null,
      commissionType: raw.commissionType || 'PERCENTAGE',
      commissionValue: parseFloat(raw.commissionValue || 0),
      priority: raw.priority !== undefined ? parseInt(raw.priority, 10) : 0,
      isActive: raw.isActive !== undefined ? Boolean(raw.isActive) : true,
      companyId: raw.companyId ? parseInt(raw.companyId, 10) : ((req.user as any)?.companyId || 1),
      storeId: raw.storeId ? parseInt(raw.storeId, 10) : null,
      employeeId: raw.employeeId ? parseInt(raw.employeeId, 10) : null,
      categoryId: raw.categoryId ? parseInt(raw.categoryId, 10) : null,
      productId: raw.productId ? parseInt(raw.productId, 10) : null,
      brandId: raw.brandId ? parseInt(raw.brandId, 10) : null,
      departmentId: raw.departmentId ? parseInt(raw.departmentId, 10) : null,
      designationId: raw.designationId ? parseInt(raw.designationId, 10) : null,
      minSaleAmount: raw.minSaleAmount ? parseFloat(raw.minSaleAmount) : null,
      maxSaleAmount: raw.maxSaleAmount ? parseFloat(raw.maxSaleAmount) : null,
      startDate: raw.startDate ? new Date(raw.startDate) : (raw.effectiveFrom ? new Date(raw.effectiveFrom) : null),
      endDate: raw.endDate ? new Date(raw.endDate) : (raw.effectiveTo ? new Date(raw.effectiveTo) : null),
    };

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
    const { storeId, employeeId, isActive, categoryId, productId } = req.query;

    const whereClause: any = {};
    if (storeId && !isNaN(parseInt(storeId as string, 10))) whereClause.storeId = parseInt(storeId as string, 10);
    if (employeeId && !isNaN(parseInt(employeeId as string, 10))) whereClause.employeeId = parseInt(employeeId as string, 10);
    if (categoryId && !isNaN(parseInt(categoryId as string, 10))) whereClause.categoryId = parseInt(categoryId as string, 10);
    if (productId && !isNaN(parseInt(productId as string, 10))) whereClause.productId = parseInt(productId as string, 10);
    if (isActive !== undefined && isActive !== 'all') whereClause.isActive = isActive === 'true';

    let policies: any[] = [];
    try {
      policies = await prisma.commissionPolicy.findMany({
        where: whereClause,
        include: {
          employee: true,
          store: true,
          department: true,
          designation: true,
        },
        orderBy: { priority: 'asc' },
      });
    } catch (queryErr) {
      console.warn('Failed to query policies with relations, attempting fallback:', queryErr);
      policies = await prisma.commissionPolicy.findMany({
        where: whereClause,
        orderBy: { priority: 'asc' },
      }).catch(() => []);
    }

    res.json({ success: true, policies });
  } catch (error) {
    console.error('Get commission policies error:', error);
    res.json({ success: true, policies: [] });
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
    const raw = req.body;

    const policyData: any = {};
    if (raw.name !== undefined) policyData.name = raw.name;
    if (raw.description !== undefined) policyData.description = raw.description || null;
    if (raw.commissionType !== undefined) policyData.commissionType = raw.commissionType;
    if (raw.commissionValue !== undefined) policyData.commissionValue = parseFloat(raw.commissionValue);
    if (raw.priority !== undefined) policyData.priority = parseInt(raw.priority, 10);
    if (raw.isActive !== undefined) policyData.isActive = Boolean(raw.isActive);
    if (raw.storeId !== undefined) policyData.storeId = raw.storeId ? parseInt(raw.storeId, 10) : null;
    if (raw.employeeId !== undefined) policyData.employeeId = raw.employeeId ? parseInt(raw.employeeId, 10) : null;
    if (raw.categoryId !== undefined) policyData.categoryId = raw.categoryId ? parseInt(raw.categoryId, 10) : null;
    if (raw.productId !== undefined) policyData.productId = raw.productId ? parseInt(raw.productId, 10) : null;
    if (raw.brandId !== undefined) policyData.brandId = raw.brandId ? parseInt(raw.brandId, 10) : null;
    if (raw.departmentId !== undefined) policyData.departmentId = raw.departmentId ? parseInt(raw.departmentId, 10) : null;
    if (raw.designationId !== undefined) policyData.designationId = raw.designationId ? parseInt(raw.designationId, 10) : null;
    if (raw.minSaleAmount !== undefined) policyData.minSaleAmount = raw.minSaleAmount ? parseFloat(raw.minSaleAmount) : null;
    if (raw.maxSaleAmount !== undefined) policyData.maxSaleAmount = raw.maxSaleAmount ? parseFloat(raw.maxSaleAmount) : null;
    if (raw.startDate !== undefined) policyData.startDate = raw.startDate ? new Date(raw.startDate) : null;
    if (raw.endDate !== undefined) policyData.endDate = raw.endDate ? new Date(raw.endDate) : null;
    if (raw.effectiveFrom !== undefined && !raw.startDate) policyData.startDate = raw.effectiveFrom ? new Date(raw.effectiveFrom) : null;
    if (raw.effectiveTo !== undefined && !raw.endDate) policyData.endDate = raw.effectiveTo ? new Date(raw.effectiveTo) : null;

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
      const numericUserId = typeof req.user.id === 'string' ? parseInt(req.user.id, 10) : Number(req.user.id);
      if (!isNaN(numericUserId)) {
        const currentEmp = await prisma.employee.findFirst({
          where: { userId: numericUserId }
        }).catch(() => null);
        if (currentEmp) {
          conditions.push({ employeeId: currentEmp.id });
        }
      }
    } else if (req.user?.role === 'STORE_MANAGER' && (!storeId || storeId === 'all')) {
      const numericUserId = typeof req.user.id === 'string' ? parseInt(req.user.id, 10) : Number(req.user.id);
      if (!isNaN(numericUserId)) {
        const mgrEmp = await prisma.employee.findFirst({
          where: { userId: numericUserId },
          select: { storeId: true }
        }).catch(() => null);
        if (mgrEmp?.storeId) {
          conditions.push({
            OR: [
              { storeId: mgrEmp.storeId },
              { employee: { storeId: mgrEmp.storeId } },
            ]
          });
        }
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
    if (status && status !== 'all' && status !== '' && status !== 'undefined') {
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

    let rawTransactions: any[] = [];
    try {
      rawTransactions = await prisma.commissionTransaction.findMany({
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
    } catch (queryErr) {
      console.warn('[Commission API] Failed with policy include, retrying without policy:', queryErr);
      try {
        rawTransactions = await prisma.commissionTransaction.findMany({
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
          orderBy: [{ id: 'desc' }, { createdAt: 'desc' }],
        });
      } catch (innerErr) {
        console.warn('[Commission API] Failed with store include, retrying with minimal relations:', innerErr);
        rawTransactions = await prisma.commissionTransaction.findMany({
          where: whereClause,
          include: {
            employee: true,
          },
          orderBy: [{ id: 'desc' }, { createdAt: 'desc' }],
        }).catch(() => []);
      }
    }

    const eligible = (rawTransactions || []).filter((t) => isEligibleCommissionEmployee(t?.employee));
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
        }).catch((err) => {
          console.warn('[Commission API] WebhookLog lookup skipped:', err);
          return [];
        })
      : [];

    const billActiveMap = new Map<string, boolean>();
    const billLineItemsMap = new Map<string, unknown[]>();
    for (const log of relevantLogs) {
      if (!log.billId) continue;
      try {
        const parsed = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
        const meta = extractWebhookMeta(parsed);
        if (meta.lineItems?.length && !billLineItemsMap.has(log.billId)) {
          billLineItemsMap.set(log.billId, meta.lineItems);
          billLineItemsMap.set(log.billId.replace(/^HWM-/, ''), meta.lineItems);
          billLineItemsMap.set(`HWM-${log.billId}`, meta.lineItems);
        }
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

    const normKey = (s: any) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    const salesMap = new Map<string, any>();
    for (const s of (allSales || [])) {
      if (s?.billId) {
        salesMap.set(String(s.billId).trim().toLowerCase(), s);
        salesMap.set(normKey(s.billId), s);
      }
    }

    const cnMap = new Map<string, any>();
    for (const c of (creditNotes || [])) {
      if (c?.creditNoteNo) {
        cnMap.set(String(c.creditNoteNo).trim().toLowerCase(), c);
        cnMap.set(normKey(c.creditNoteNo), c);
      }
      if (c?.invoiceNo) {
        cnMap.set(String(c.invoiceNo).trim().toLowerCase(), c);
        cnMap.set(normKey(c.invoiceNo), c);
      }
    }

    const exMap = new Map<string, any>();
    for (const e of (salesExchanges || [])) {
      if (!e) continue;
      if (e.exchangeNo) {
        const clean = String(e.exchangeNo).trim().toLowerCase();
        exMap.set(clean, e);
        exMap.set(normKey(e.exchangeNo), e);
      }
      if (e.newInvoiceNo) {
        const clean = String(e.newInvoiceNo).trim().toLowerCase();
        exMap.set(clean, e);
        exMap.set(normKey(e.newInvoiceNo), e);
        exMap.set(normKey(clean.replace(/-(NEW|RET)$/i, '')), e);
        exMap.set(normKey(clean.replace(/^HWM-/i, '')), e);
      }
      if (e.originalInvoiceNo) {
        const clean = String(e.originalInvoiceNo).trim().toLowerCase();
        exMap.set(clean, e);
        exMap.set(normKey(e.originalInvoiceNo), e);
        exMap.set(normKey(clean.replace(/^HWM-/i, '')), e);
      }
      if (e.id) {
        exMap.set(normKey(e.id), e);
      }
    }

    const allTxMap = new Map<string, any>();
    for (const tx of dedupedTransactions) {
      if (!tx) continue;
      if (tx.billId) {
        allTxMap.set(String(tx.billId).trim().toLowerCase(), tx);
        allTxMap.set(normKey(tx.billId), tx);
      }
      if (tx.invoiceNumber) {
        allTxMap.set(String(tx.invoiceNumber).trim().toLowerCase(), tx);
        allTxMap.set(normKey(tx.invoiceNumber), tx);
      }
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

      const rate = t.commissionPercent !== null && t.commissionPercent !== undefined
        ? Number(t.commissionPercent)
        : (t.saleAmount > 0 && t.commissionAmount > 0
            ? Math.round(((t.commissionAmount / t.saleAmount) * 100) * 100) / 100
            : (t.employee?.commissionPercentage !== null && t.employee?.commissionPercentage !== undefined ? Number(t.employee?.commissionPercentage) : 0));

      let recon: any = {
        oldBillAmount: t.oldAmount || null,
        newBillAmount: t.newAmount || null,
        differenceAmount: 0,
        oldBillCommission: t.oldCommission || null,
        newBillCommission: t.commissionAmount || 0,
        commissionDifference: 0,
      };

      try {
        recon = resolveBillAndCommissionReconciliation({
          eventType: t.eventType,
          billId: t.billId,
          invoiceNumber: t.invoiceNumber,
          invoiceNo: t.invoiceNumber,
          amount: t.saleAmount,
          commissionAmount: t.commissionAmount,
          commissionPercent: rate,
          employeeRate: rate,
          notes: t.notes,
          oldAmount: t.oldAmount,
          oldBillAmount: (t as any).oldBillAmount ?? t.oldAmount,
          newAmount: t.newAmount,
          newBillAmount: (t as any).newBillAmount ?? t.newAmount,
          differenceAmount: (t as any).differenceAmount,
          oldCommission: t.oldCommission,
          oldBillCommission: (t as any).oldBillCommission ?? t.oldCommission,
          newCommission: t.newCommission,
          newBillCommission: (t as any).newBillCommission ?? t.newCommission,
          commissionDifference: (t as any).commissionDifference ?? t.commissionDifference,
          lookups: {
            salesMap,
            creditNotesMap: cnMap,
            exchangesMap: exMap,
            transactionsMap: allTxMap,
          }
        }) || recon;
      } catch (reconErr) {
        console.warn('[Commission API] Reconciliation calculation notice:', reconErr);
      }

      const rawLines = billLineItemsMap.get(bIdStr) ?? billLineItemsMap.get(invStr) ?? billLineItemsMap.get(bIdStr.replace(/^HWM-/, ''));
      let enrichedBreakdown = null;
      try {
        enrichedBreakdown = enrichProductBreakdown(t.productBreakdown, rawLines);
      } catch {}

      return {
        ...t,
        ...(enrichedBreakdown ? { productBreakdown: enrichedBreakdown } : {}),
        isActive: activeVal,
        oldAmount: recon.oldBillAmount,
        oldBillAmount: recon.oldBillAmount,
        differenceAmount: recon.differenceAmount,
        newAmount: recon.newBillAmount,
        newBillAmount: recon.newBillAmount,
        oldCommission: recon.oldBillCommission,
        oldBillCommission: recon.oldBillCommission,
        commissionDifference: recon.commissionDifference,
        newCommission: recon.newBillCommission,
        newBillCommission: recon.newBillCommission,
      };
    });

    console.log(`[Commission API]\nFilter:\nmonth: ${startDate ? String(startDate).slice(0, 7) : 'all'}\nstoreId: ${whereClause.storeId || 'all'}\nemployeeId: ${whereClause.employeeId || 'all'}\nstartDate: ${startDate || 'none'}\nendDate: ${endDate || 'none'}`);
    console.log(`[Commission API]\nTransactions found: ${transactions.length}`);
    console.log(`[Commission API]\nEmployees mapped: ${new Set(transactions.map(t => t.employeeId)).size}`);

    res.json({ success: true, transactions });
  } catch (error) {
    console.error('Get commission transactions error:', error);
    res.json({ success: true, transactions: [] });
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
    if (employeeId && !isNaN(parseInt(employeeId as string, 10))) whereClause.employeeId = parseInt(employeeId as string, 10);
    if (storeId && !isNaN(parseInt(storeId as string, 10))) whereClause.storeId = parseInt(storeId as string, 10);
    if (status && status !== 'all' && status !== 'undefined') whereClause.status = status;

    let targets: any[] = [];
    try {
      targets = await prisma.commissionTarget.findMany({
        where: whereClause,
        include: {
          employee: true,
          store: true,
          policy: true,
        },
        orderBy: { startDate: 'desc' },
      });
    } catch (queryErr) {
      console.warn('Failed to query targets with relations, attempting fallback:', queryErr);
      targets = await prisma.commissionTarget.findMany({
        where: whereClause,
        orderBy: { startDate: 'desc' },
      }).catch(() => []);
    }

    res.json({ success: true, targets });
  } catch (error) {
    console.error('Get commission targets error:', error);
    res.json({ success: true, targets: [] });
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
    const {
      employeeId,
      saleAmount,
      storeId,
      billId,
      invoiceNumber,
      categoryId,
      productId,
      categoryName,
      items,
      directCommissionRate,
      directCommissionAmount,
    } = req.body;

    // Find applicable employee
    let employee = null;
    if (employeeId) {
      const resolvedId = await resolveEmployeeId(String(employeeId));
      if (resolvedId !== null) {
        employee = await prisma.employee.findUnique({
          where: { id: resolvedId },
          include: {
            commissionPolicies: {
              where: { isActive: true },
              orderBy: { priority: 'asc' },
            },
          },
        });
      }
    }

    if (!employee && req.user?.id) {
      employee = await prisma.employee.findFirst({
        where: { userId: req.user.id },
        include: {
          commissionPolicies: {
            where: { isActive: true },
            orderBy: { priority: 'asc' },
          },
        },
      });
    }

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const activePolicies = await prisma.commissionPolicy.findMany({
      where: { isActive: true },
      orderBy: { priority: 'asc' },
    });

    const parsedSaleAmount = parseFloat(saleAmount || 0);
    const targetStoreId = storeId ? parseInt(storeId, 10) : employee.storeId;

    if (Array.isArray(items) && items.length > 0) {
      let totalCommission = 0;
      const productBreakdown: any[] = [];
      for (const item of items) {
        const itemAmt = Number(item.amount ?? item.Total ?? item.price ?? item.productNetAmount ?? 0);
        if (isNaN(itemAmt) || itemAmt <= 0) continue;
        const itemProdId = item.productId ?? item.productID ?? item.id;
        const itemCatId = item.categoryId ?? item.CategoryID ?? item.category_id;
        const itemCatName = item.category ?? item.categoryName;

        const lineRes = calculateEffectiveCommissionForLineItem({
          saleAmount: itemAmt,
          productId: itemProdId,
          productName: item.productName ?? item.name,
          categoryId: itemCatId,
          categoryName: itemCatName,
          policies: activePolicies,
          salesman: {
            id: employee.id,
            employeeCode: employee.employeeCode,
            commissionPercentage: employee.commissionPercentage,
            storeId: employee.storeId,
          },
          storeId: targetStoreId,
          directCommissionRate: item.directCommissionRate,
          directCommissionAmount: item.directCommissionAmount,
        });

        totalCommission += lineRes.commissionAmount;
        productBreakdown.push({
          productID: itemProdId,
          productName: item.productName ?? item.name ?? 'Product',
          quantity: Number(item.qty ?? item.quantity ?? 1),
          saleAmount: itemAmt,
          commissionRate: lineRes.commissionRate,
          commissionAmount: lineRes.commissionAmount,
          category: itemCatName || (itemCatId ? `Category #${itemCatId}` : undefined),
          categoryId: itemCatId,
        });
      }

      totalCommission = Math.round(totalCommission * 100) / 100;
      const blendedRate = parsedSaleAmount > 0
        ? Math.round(((totalCommission / parsedSaleAmount) * 100) * 100) / 100
        : 0;

      res.json({
        success: true,
        commission: totalCommission,
        commissionPercent: blendedRate,
        productBreakdown,
        employee,
        message: 'Commission calculated successfully across items.',
      });
      return;
    }

    const singleRes = calculateEffectiveCommissionForLineItem({
      saleAmount: parsedSaleAmount,
      productId,
      productName: req.body.productName,
      categoryId,
      categoryName,
      policies: activePolicies,
      salesman: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        commissionPercentage: employee.commissionPercentage,
        storeId: employee.storeId,
      },
      storeId: targetStoreId,
      directCommissionRate,
      directCommissionAmount,
    });

    res.json({
      success: true,
      commission: singleRes.commissionAmount,
      commissionPercent: singleRes.commissionRate,
      policyId: singleRes.policyId,
      policyName: singleRes.policyName,
      ruleApplied: singleRes.appliedLevel,
      employee,
      message: singleRes.policyId ? 'Commission calculated successfully.' : 'Calculated using employee default/fallback rate.',
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

    // Notify employee and HR asynchronously
    (async () => {
      try {
        const emp = await prisma.employee.findUnique({
          where: { id: parseInt(employeeId) },
          select: { id: true, userId: true, firstName: true, lastName: true },
        });
        if (emp) {
          const empName = `${emp.firstName} ${emp.lastName}`.trim();
          await notifyEmployee({
            targetUserId: emp.userId,
            targetEmployeeId: emp.id,
            title: 'Commission Settlement Generated',
            body: `Your commission settlement of ₹${totalCommission.toLocaleString('en-IN')} has been generated.`,
            category: 'COMMISSION',
            actionId: settlement.id,
            actionType: 'commission_settlement',
          });

          await sendHRNotification({
            title: 'Commission Settlement Created',
            body: `Commission settlement of ₹${totalCommission.toLocaleString('en-IN')} generated for ${empName}.`,
            category: 'COMMISSION',
            actionId: settlement.id,
            actionType: 'commission_settlement',
            employeeId: emp.id,
            employeeName: empName,
            requiredModuleId: 'pa-commission',
          });
        }
      } catch (err) {
        console.error('Commission settlement notification error:', err);
      }
    })();

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
