import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { Role } from '@prisma/client';
import { extractWebhookMeta, getNumericInvoiceNumber, normalizeEventType, parseIsOld } from '../utils/commissionHelper';

const router = Router();

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.HR];
const SUPERADMIN_ROLES = [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN];

/**
 * Helper to safely parse raw payload if stored as JSON string
 */
function parseRawPayload(raw: any): any {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * GET /api/webhook/logs
 * 
 * Returns all webhook logs with global visibility across all employees, all stores,
 * and all webhook event types.
 */
router.get('/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, eventType, store, search, fromDate, toDate, limit, offset } = req.query;

    const limitNum = limit ? (parseInt(limit as string, 10) || 5000) : 5000;
    const offsetNum = parseInt(offset as string, 10) || 0;

    const statusFilter = status ? String(status).toUpperCase() : null;
    const eventTypeFilter = eventType ? normalizeEventType(String(eventType)) : null;
    const storeFilter = store && String(store) !== 'ALL' ? String(store).trim() : null;

    // 1. Pre-fetch employee lookup maps for resolving employee names, codes, and assigned stores
    let allEmployees: any[] = [];
    try {
      allEmployees = await prisma.employee.findMany({
        select: {
          id: true,
          employeeID: true,
          employeeCode: true,
          mobileNumber: true,
          firstName: true,
          lastName: true,
          storeId: true,
          store: { select: { id: true, name: true, code: true } }
        },
      });
    } catch (e) {
      allEmployees = [];
    }

    interface EmpInfo {
      id: number;
      name: string;
      code: string;
      storeName: string | null;
      storeId: number | null;
    }

    const empById = new Map<number, EmpInfo>();
    const empByGuid = new Map<string, EmpInfo>();
    const empByCode = new Map<string, EmpInfo>();
    const empByMobile = new Map<string, EmpInfo>();
    const empByName = new Map<string, EmpInfo>();

    for (const emp of allEmployees) {
      const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.employeeCode || `Employee #${emp.id}`;
      const storeName = emp.store?.name || null;
      const storeId = emp.storeId || emp.store?.id || null;
      const info: EmpInfo = { id: emp.id, name, code: emp.employeeCode, storeName, storeId };

      empById.set(emp.id, info);
      if (emp.employeeID) empByGuid.set(emp.employeeID.toLowerCase().trim(), info);
      if (emp.employeeCode) empByCode.set(emp.employeeCode.toLowerCase().trim(), info);
      if (emp.mobileNumber) {
        const mobClean = emp.mobileNumber.replace(/\D/g, '');
        if (mobClean.length >= 10) {
          empByMobile.set(mobClean.slice(-10), info);
        }
        empByMobile.set(emp.mobileNumber.toLowerCase().trim(), info);
      }
      if (name) empByName.set(name.toLowerCase(), info);
      if (emp.firstName) empByName.set(emp.firstName.toLowerCase().trim(), info);
    }

    // 2. Pre-fetch store lookup maps for resolving store names
    let allStores: any[] = [];
    try {
      allStores = await prisma.store.findMany({
        select: { id: true, name: true, code: true },
      });
    } catch (e) {
      allStores = [];
    }

    const storeById = new Map<number, string>();
    const storeByCode = new Map<string, string>();
    const storeByName = new Map<string, string>();

    for (const st of allStores) {
      if (st.name) {
        storeById.set(st.id, st.name);
        storeByName.set(st.name.toLowerCase().trim(), st.name);
        if (st.code) storeByCode.set(st.code.toLowerCase().trim(), st.name);
      }
    }

    const findEmpInfo = (empId: number | null, rawMeta: any, rawPayload: any): EmpInfo | null => {
      if (empId && empById.has(empId)) return empById.get(empId)!;

      const parsed = parseRawPayload(rawPayload);
      const firstSalesman = (Array.isArray(parsed.salesmen) && parsed.salesmen[0]) || 
                            (Array.isArray(parsed.data?.salesmen) && parsed.data.salesmen[0]) ||
                            (Array.isArray(rawMeta.salesmen) && rawMeta.salesmen[0]) || {};
      const firstItem = (Array.isArray(parsed.data?.lineItems) && parsed.data.lineItems[0]) ||
                        (Array.isArray(parsed.lineItems) && parsed.lineItems[0]) ||
                        (Array.isArray(parsed.CreditNoteProducts) && parsed.CreditNoteProducts[0]) ||
                        (Array.isArray(parsed.SalesExchangeProductList) && parsed.SalesExchangeProductList[0]) || {};

      const candidateIds = [
        rawMeta.employeeIdentifier,
        rawMeta.employeeName,
        firstSalesman.SalesmanCode,
        firstSalesman.salesmanCode,
        firstSalesman.Code,
        firstSalesman.code,
        firstSalesman.SalesmanId,
        firstSalesman.salesmanId,
        firstSalesman.employeeID,
        firstSalesman.employeeId,
        firstSalesman.SalesmanName,
        firstSalesman.salesmanName,
        firstSalesman.Name,
        firstSalesman.name,
        firstItem.Salesman,
        firstItem.salesman,
        firstItem.employeeCode,
        firstItem.salesmanCode,
        firstItem.employeeID,
        firstItem.employeeId,
        firstItem.employeeName,
        firstItem.name,
        parsed.employeeCode,
        parsed.employeeId,
        parsed.employeeID,
        parsed.id,
        parsed.data?.employeeCode,
        parsed.data?.employeeId,
        parsed.data?.employeeID,
        parsed.data?.employee?.employeeCode,
        parsed.data?.employee?.employeeID,
        parsed.data?.employee?.employeeId,
        parsed.data?.employee?.name,
        parsed.employee?.employeeCode,
        parsed.employee?.employeeID,
        parsed.employee?.employeeId,
        parsed.employee?.name,
        parsed.Salesman,
        parsed.CreatedBy,
        parsed.salesPerson,
        parsed.salespersonName,
      ].filter(Boolean);

      for (const cand of candidateIds) {
        const str = String(cand).trim();
        const strLower = str.toLowerCase();
        if (empByGuid.has(strLower)) return empByGuid.get(strLower)!;
        if (empByCode.has(strLower)) return empByCode.get(strLower)!;
        if (empByName.has(strLower)) return empByName.get(strLower)!;
        const digits = str.replace(/\D/g, '');
        if (digits.length >= 10 && empByMobile.has(digits.slice(-10))) {
          return empByMobile.get(digits.slice(-10))!;
        }
        const parsedInt = parseInt(str, 10);
        if (!isNaN(parsedInt) && empById.has(parsedInt)) return empById.get(parsedInt)!;
      }

      return null;
    };

    const resolveEmpName = (empId: number | null, rawMeta: any, rawLogName?: string | null, rawPayload?: any): string => {
      const info = findEmpInfo(empId, rawMeta, rawPayload);
      if (info) return info.name;

      if (rawMeta.employeeName && rawMeta.employeeName !== 'N/A') return rawMeta.employeeName;
      if (rawLogName && rawLogName !== 'N/A') return rawLogName;

      const parsed = parseRawPayload(rawPayload);
      const firstSalesman = (Array.isArray(parsed.salesmen) && parsed.salesmen[0]) || 
                            (Array.isArray(parsed.data?.salesmen) && parsed.data.salesmen[0]) || {};
      const sName = firstSalesman.SalesmanName || firstSalesman.salesmanName || firstSalesman.Name || firstSalesman.name || firstSalesman.employeeName;
      if (sName) return String(sName).trim();

      const firstItem = (Array.isArray(parsed.data?.lineItems) && parsed.data.lineItems[0]) ||
                        (Array.isArray(parsed.lineItems) && parsed.lineItems[0]) || {};
      const itemEmpName = firstItem.employeeName || firstItem.name || firstItem.salesmanName;
      if (itemEmpName) return String(itemEmpName).trim();

      const pName = parsed.name || parsed.employeeName || parsed.salesmanName || parsed.Salesman || parsed.CreatedBy || parsed.salesPerson ||
                    parsed.data?.name || parsed.data?.employeeName || parsed.data?.employee?.name || parsed.employee?.name;
      if (pName) return String(pName).trim();

      if (rawMeta.employeeIdentifier && rawMeta.employeeIdentifier !== 'N/A') return rawMeta.employeeIdentifier;

      return 'N/A';
    };

    const resolveStoreName = (rawMeta: any, rawLogStoreId?: number | null, empId?: number | null, rawPayload?: any, empInfo?: EmpInfo | null): string => {
      if (rawMeta.branchName && rawMeta.branchName !== 'N/A') return rawMeta.branchName;
      if (rawMeta.storeName && rawMeta.storeName !== 'N/A') return rawMeta.storeName;
      if (rawMeta.storeId && storeById.has(rawMeta.storeId)) return storeById.get(rawMeta.storeId)!;
      if (rawLogStoreId && storeById.has(rawLogStoreId)) return storeById.get(rawLogStoreId)!;

      const parsed = parseRawPayload(rawPayload);
      const pStore = parsed.data?.invoice?.branchName || parsed.data?.invoice?.BranchName ||
                    parsed.data?.invoice?.storeName || parsed.data?.invoice?.StoreName ||
                    parsed.invoice?.branchName || parsed.invoice?.BranchName ||
                    parsed.invoice?.storeName || parsed.invoice?.StoreName ||
                    parsed.branchName || parsed.storeName || parsed.BranchName || parsed.StoreName ||
                    parsed.store || parsed.branch || parsed.data?.branchName || parsed.data?.storeName ||
                    parsed.data?.BranchName || parsed.data?.StoreName || parsed.data?.store || parsed.data?.branch ||
                    parsed.creditNote?.storeName || parsed.creditNote?.branchName;
      
      if (pStore) {
        if (typeof pStore === 'string') {
          const lower = pStore.toLowerCase().trim();
          if (storeByName.has(lower)) return storeByName.get(lower)!;
          if (storeByCode.has(lower)) return storeByCode.get(lower)!;
          return pStore;
        }
        if (typeof pStore === 'object' && pStore !== null) {
          return pStore.name || pStore.storeName || pStore.code || 'N/A';
        }
      }

      if (empInfo?.storeName) return empInfo.storeName;

      const info = findEmpInfo(empId || null, rawMeta, rawPayload);
      if (info?.storeName) return info.storeName;

      return 'N/A';
    };

    // 1. Fetch from WebhookLog (all records)
    const where: any = {};
    if (statusFilter && statusFilter !== 'ALL') where.status = statusFilter;
    if (eventTypeFilter && eventTypeFilter !== 'ALL') {
      where.OR = [
        { eventType: { equals: eventTypeFilter, mode: 'insensitive' } },
        { eventType: { equals: eventTypeFilter.toLowerCase(), mode: 'insensitive' } },
      ];
    }
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(String(fromDate));
      if (toDate) where.createdAt.lte = new Date(String(toDate));
    }

    let webhookLogs: any[] = [];
    try {
      webhookLogs = await prisma.webhookLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    } catch (e) {
      webhookLogs = [];
    }

    // Map WebhookLog items
    const mappedWebhookLogs = webhookLogs.map((log) => {
      const parsedPayload = parseRawPayload(log.payload);
      const meta = extractWebhookMeta(parsedPayload);
      const amountVal = log.amount !== null && log.amount !== undefined && log.amount !== 0 ? Number(log.amount) : Number(meta.amount || 0);
      const numInv = getNumericInvoiceNumber({ invoiceNumber: meta.invoiceNumber, billId: log.billId || meta.billId, id: log.id });
      const cleanInvoiceNo = (meta.invoiceNumber && !/^[0-9a-fA-F-]{36}$/.test(meta.invoiceNumber)) ? meta.invoiceNumber : `HWM-${numInv}`;
      const empInfo = findEmpInfo(log.employeeId, meta, parsedPayload);
      const resolvedEmpName = resolveEmpName(log.employeeId, meta, null, parsedPayload);
      const resolvedStoreName = resolveStoreName(meta, null, log.employeeId, parsedPayload, empInfo);
      const resolvedEventId = log.eventId || meta.eventId || log.id;
      const normalizedEvType = normalizeEventType(log.eventType || meta.eventType, 'INVOICE_CREATED', parsedPayload);

      return {
        ...log,
        amount: amountVal || 0,
        oldAmount: null,
        oldBillAmount: null,
        newAmount: null,
        newBillAmount: null,
        differenceAmount: null,
        cnAmount: meta.cnAmount || 0,
        refundAmount: meta.refundAmount || 0,
        cnNo: meta.cnNo || null,
        billId: numInv,
        invoiceNo: cleanInvoiceNo,
        invoiceNumber: cleanInvoiceNo,
        customerName: meta.customerName || 'N/A',
        employeeName: resolvedEmpName,
        storeName: resolvedStoreName,
        commissionAmount: meta.commissionAmount || 0,
        eventType: normalizedEvType,
        eventId: resolvedEventId,
        externalEventId: resolvedEventId,
      };
    });

    const existingBillEmpKeys = new Set(mappedWebhookLogs.map((l) => `${l.billId}_${l.employeeName}`));
    const existingEventIds = new Set(mappedWebhookLogs.map((l) => l.eventId).filter(Boolean));

    // 2. Fetch from HopkidWebhookLog
    let hopkidLogsMapped: any[] = [];
    if (!statusFilter || statusFilter === 'ALL' || statusFilter === 'SUCCESS') {
      try {
        const hopkidRawLogs = await prisma.hopkidWebhookLog.findMany({
          orderBy: { createdAt: 'desc' },
        });

        for (const log of hopkidRawLogs) {
          const parsedPayload = parseRawPayload(log.rawPayload);
          const meta = extractWebhookMeta(parsedPayload);
          const amountVal = log.amount !== null && log.amount !== undefined ? Number(log.amount) : Number(meta.amount || 0);
          const numInv = getNumericInvoiceNumber({ invoiceNumber: meta.invoiceNumber, billId: log.billId || meta.billId, id: log.id });
          const cleanInvoiceNo = (meta.invoiceNumber && !/^[0-9a-fA-F-]{36}$/.test(meta.invoiceNumber)) ? meta.invoiceNumber : `HWM-${numInv}`;
          const resolvedEventId = meta.eventId || log.id;

          const empInfo = findEmpInfo(null, meta, parsedPayload);
          const resolvedEmpName = resolveEmpName(null, meta, log.name, parsedPayload);
          const resolvedStoreName = resolveStoreName(meta, log.storeId, null, parsedPayload, empInfo);
          const normalizedEvType = normalizeEventType(meta.eventType, 'INVOICE_CREATED', parsedPayload);

          const billEmpKey = `${numInv}_${resolvedEmpName}`;
          if (numInv && existingBillEmpKeys.has(billEmpKey)) continue;
          if (resolvedEventId && existingEventIds.has(resolvedEventId)) continue;

          hopkidLogsMapped.push({
            id: `hopkid-${log.id}`,
            eventType: normalizedEvType,
            status: 'SUCCESS',
            payload: log.rawPayload,
            employeeId: null,
            amount: amountVal || 0,
            oldAmount: null,
            oldBillAmount: null,
            newAmount: null,
            newBillAmount: null,
            differenceAmount: null,
            cnAmount: meta.cnAmount || 0,
            refundAmount: meta.refundAmount || 0,
            cnNo: meta.cnNo || null,
            billId: numInv,
            invoiceNo: cleanInvoiceNo,
            invoiceNumber: cleanInvoiceNo,
            customerName: meta.customerName || 'N/A',
            employeeName: resolvedEmpName,
            storeName: resolvedStoreName,
            commissionAmount: meta.commissionAmount || 0,
            errorMessage: null,
            processedAt: log.createdAt,
            createdAt: log.createdAt,
            eventId: resolvedEventId,
            externalEventId: resolvedEventId,
          });
        }
      } catch (e) {
        hopkidLogsMapped = [];
      }
    }

    // 3. Include CommissionTransaction records as unified webhook stream source
    let commLogsMapped: any[] = [];
    try {
      const commTransactions = await prisma.commissionTransaction.findMany({
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, storeId: true, store: { select: { name: true } } } },
          store: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      for (const t of commTransactions) {
        const numInv = getNumericInvoiceNumber({ invoiceNumber: t.invoiceNumber, billId: t.billId, id: t.id });
        const cleanInvoiceNo = t.invoiceNumber || `HWM-${numInv}`;
        const empName = t.employee ? `${t.employee.firstName || ''} ${t.employee.lastName || ''}`.trim() : 'N/A';
        const storeName = t.store?.name || t.employee?.store?.name || (t.storeId && storeById.get(t.storeId)) || 'N/A';

        const billEmpKey = `${numInv}_${empName}`;
        if (numInv && existingBillEmpKeys.has(billEmpKey)) continue;

        const syntheticPayload = {
          eventId: `COMM-${t.id}`,
          billId: t.billId || numInv,
          invoiceNumber: cleanInvoiceNo,
          amount: t.saleAmount,
          commissionAmount: t.commissionAmount,
          eventType: t.eventType || 'INVOICE_CREATED',
          employee: {
            id: t.employeeId,
            name: empName,
            code: t.employee?.employeeCode,
          },
          store: {
            id: t.storeId,
            name: storeName,
          },
          createdAt: t.createdAt,
        };

        const saleAmtVal = Number(t.saleAmount || 0);

        commLogsMapped.push({
          id: `comm-tx-${t.id}`,
          eventType: normalizeEventType(t.eventType, 'INVOICE_CREATED', syntheticPayload),
          status: t.status === 'REJECTED' ? 'FAILED' : 'SUCCESS',
          payload: JSON.stringify(syntheticPayload),
          employeeId: t.employeeId,
          amount: saleAmtVal,
          oldAmount: (t as any).oldAmount !== null && (t as any).oldAmount !== undefined ? Number((t as any).oldAmount) : null,
          oldBillAmount: (t as any).oldAmount !== null && (t as any).oldAmount !== undefined ? Number((t as any).oldAmount) : null,
          newAmount: (t as any).newAmount !== null && (t as any).newAmount !== undefined && Number((t as any).newAmount) > 0 ? Number((t as any).newAmount) : null,
          newBillAmount: (t as any).newAmount !== null && (t as any).newAmount !== undefined && Number((t as any).newAmount) > 0 ? Number((t as any).newAmount) : null,
          differenceAmount: (t as any).differenceAmount !== null && (t as any).differenceAmount !== undefined ? Number((t as any).differenceAmount) : null,
          billId: numInv,
          invoiceNo: cleanInvoiceNo,
          invoiceNumber: cleanInvoiceNo,
          customerName: 'N/A',
          employeeName: empName,
          storeName: storeName,
          commissionAmount: t.commissionAmount || 0,
          errorMessage: null,
          processedAt: t.createdAt,
          createdAt: t.createdAt,
          eventId: `COMM-${t.id}`,
          externalEventId: `COMM-${t.id}`,
        });
      }
    } catch (e) {
      commLogsMapped = [];
    }

    // Combine & deduplicate deterministically per event / bill + employee
    const { view, latestOnly } = req.query;
    const isLatestView = view === 'latest' || latestOnly === 'true';

    const combinedRaw = [...mappedWebhookLogs, ...hopkidLogsMapped, ...commLogsMapped];
    const uniqueLogsMap = new Map<string, any>();

    for (const log of combinedRaw) {
      const normType = normalizeEventType(log.eventType);
      const normBill = log.billId || log.invoiceNo || `LOG-${log.id}`;
      const empKey = log.employeeName || log.employeeId || 'ALL';
      
      const key = isLatestView
        ? `ENTITY_${normBill}_EMP_${empKey}`
        : `${normType}_BILL_${normBill}_EMP_${empKey}_ID_${log.id}`;

      if (!uniqueLogsMap.has(key)) {
        uniqueLogsMap.set(key, log);
      } else {
        const existing = uniqueLogsMap.get(key)!;
        const currentTime = new Date(log.createdAt || log.processedAt || 0).getTime();
        const existingTime = new Date(existing.createdAt || existing.processedAt || 0).getTime();

        if (log.status === 'SUCCESS' && existing.status !== 'SUCCESS') {
          uniqueLogsMap.set(key, log);
        } else if (currentTime > existingTime) {
          uniqueLogsMap.set(key, log);
        }
      }
    }

    let combined = Array.from(uniqueLogsMap.values());

    // Build lookup map for Invoices by normalized identifiers for precise reconciliation
    const normKey = (s: any) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    const invoiceLogMap = new Map<string, any>();
    for (const l of combined) {
      const evStr = String(l.eventType || '').toUpperCase();
      const isCn =
        evStr.includes('CREDIT_NOTE') ||
        String(l.billId || '').startsWith('CN-') ||
        String(l.billId || '').startsWith('HKACN') ||
        (l.cnAmount !== undefined && l.cnAmount !== null && Number(l.cnAmount) > 0);
      const isEx = evStr.includes('EXCHANGE') || String(l.billId || '').startsWith('EX-');

      if (!isCn && !isEx && Number(l.amount || 0) > 0) {
        if (l.invoiceNo) invoiceLogMap.set(normKey(l.invoiceNo), l);
        if (l.invoiceNumber) invoiceLogMap.set(normKey(l.invoiceNumber), l);
        if (l.billId) {
          invoiceLogMap.set(normKey(l.billId), l);
          invoiceLogMap.set(normKey(`HWM-${l.billId}`), l);
          invoiceLogMap.set(normKey(String(l.billId).replace(/^HWM-/, '')), l);
        }
        if (l.customerName && l.customerName !== 'N/A') {
          const custStoreKey = `${normKey(l.customerName)}_${normKey(l.storeName)}`;
          if (!invoiceLogMap.has(custStoreKey)) invoiceLogMap.set(custStoreKey, l);

          const custKey = normKey(l.customerName);
          if (!invoiceLogMap.has(custKey)) invoiceLogMap.set(custKey, l);
        }
      }
    }

    // Enrich logs (Credit Note, Exchange, Normal Invoices) to ensure accurate amount, oldBillAmount, differenceAmount, newBillAmount
    for (let i = 0; i < combined.length; i++) {
      const log = combined[i];
      const parsedPayload = parseRawPayload(log.payload);
      const meta = extractWebhookMeta(parsedPayload);
      const evStr = String(log.eventType || meta.eventType || '').toUpperCase();

      const isCreditNote =
        evStr.includes('CREDIT_NOTE') ||
        String(log.billId || '').startsWith('CN-') ||
        String(log.billId || '').startsWith('HKACN') ||
        (meta.cnAmount !== undefined && meta.cnAmount !== null && Number(meta.cnAmount) > 0) ||
        Boolean(parsedPayload?.data?.creditNote || parsedPayload?.creditNote);

      const isExchange =
        evStr.includes('EXCHANGE') ||
        String(log.billId || '').startsWith('EX-') ||
        Boolean(parsedPayload?.data?.salesExchange || parsedPayload?.salesExchange || parsedPayload?.SalesExchangeProductList || parsedPayload?.data?.SalesExchangeProductList);

      if (isCreditNote) {
        try {
          const cn = meta.creditNote || parsedPayload?.data?.creditNote || parsedPayload?.creditNote || {};
          const refInv = cn.invoiceNo || cn.invoiceNumber || cn.salesID || cn.salesExchangeID || meta.invoiceNumber || log.invoiceNo;

          let origRecord: any = null;
          if (refInv) {
            origRecord =
              invoiceLogMap.get(normKey(refInv)) ||
              invoiceLogMap.get(normKey(`HWM-${refInv}`)) ||
              invoiceLogMap.get(normKey(String(refInv).replace(/^HWM-/, '')));
          }
          if (!origRecord && (meta.customerName || log.customerName) && (meta.customerName !== 'N/A' || log.customerName !== 'N/A')) {
            const cust = meta.customerName || log.customerName;
            const store = meta.storeName || meta.branchName || log.storeName;
            const custStoreKey = `${normKey(cust)}_${normKey(store)}`;
            origRecord = invoiceLogMap.get(custStoreKey) || invoiceLogMap.get(normKey(cust));
          }

          let origBillAmt = origRecord ? Number(origRecord.amount || 0) : 0;
          let origBillComm = origRecord ? Number(origRecord.commissionAmount || 0) : 0;

          // If not in memory log map, search in database
          if (origBillAmt === 0 && refInv) {
            const dbSale = await prisma.sales.findFirst({
              where: {
                OR: [
                  { billId: String(refInv) },
                  { billId: `HWM-${refInv}` },
                  { billId: { contains: String(refInv) } },
                ]
              }
            });
            if (dbSale) {
              origBillAmt = Number(dbSale.netAmount || 0);
            }
          }

          const rawCnAmt = meta.cnAmount || (cn.cnAmount !== undefined ? Number(cn.cnAmount) : (log.cnAmount || log.amount || 0));
          const cnAmt = Number(rawCnAmt || 0);

          log.cnAmount = cnAmt;
          log.amount = cnAmt > 0 ? cnAmt : log.amount;

          if (origBillAmt > 0 && cnAmt > 0) {
            log.oldAmount = origBillAmt;
            log.oldBillAmount = origBillAmt;
            log.newAmount = cnAmt;
            log.newBillAmount = cnAmt;
            log.differenceAmount = Math.round((origBillAmt - cnAmt) * 100) / 100;
            log.oldCommission = origBillComm;
            log.newCommission = Number(log.commissionAmount || 0);
            log.commissionDifference = Math.round(((Number(log.commissionAmount || 0)) - origBillComm) * 100) / 100;
          } else {
            log.oldAmount = null;
            log.oldBillAmount = null;
            log.newAmount = cnAmt > 0 ? cnAmt : Number(log.amount || 0);
            log.newBillAmount = cnAmt > 0 ? cnAmt : Number(log.amount || 0);
            log.differenceAmount = null;
          }

          if (log.billId) {
            const cnRecord = await prisma.creditNote.findUnique({
              where: { creditNoteNo: String(log.billId) },
              include: { lineItems: true }
            }).catch(() => null);
            if (cnRecord) {
              if (!log.amount || log.amount === 0) {
                log.amount = Number(cnRecord.creditAmount) || 0;
                log.newAmount = Number(cnRecord.creditAmount) || 0;
                log.newBillAmount = Number(cnRecord.creditAmount) || 0;
              }
              if (!log.invoiceNo && cnRecord.invoiceNo) {
                log.invoiceNo = cnRecord.invoiceNo;
              }
              if ((!log.employeeName || log.employeeName === 'N/A') && cnRecord.invoiceNo) {
                const saleRecord = await prisma.sales.findFirst({
                  where: {
                    OR: [
                      { billId: cnRecord.invoiceNo },
                      { billId: { contains: cnRecord.invoiceNo } }
                    ]
                  }
                });
                if (saleRecord?.employeeId) {
                  const emp = allEmployees.find(e => e.id === saleRecord.employeeId);
                  if (emp) log.employeeName = `${emp.firstName} ${emp.lastName}`.trim();
                }
              }
            }
          }
        } catch (e) {
          // ignore enrichment error
        }
      } else if (isExchange) {
        try {
          const ex = parsedPayload?.data?.salesExchange || parsedPayload?.salesExchange || parsedPayload || {};
          const exLineItems = parsedPayload?.data?.lineItems ||
            ex.lineItems ||
            parsedPayload?.lineItems ||
            parsedPayload?.data?.SalesExchangeProductList ||
            ex.SalesExchangeProductList ||
            parsedPayload?.SalesExchangeProductList ||
            [];

          let lineOldSum = 0;
          let lineNewSum = 0;
          if (Array.isArray(exLineItems) && exLineItems.length > 0) {
            for (const item of exLineItems) {
              const isOld = parseIsOld(item);
              const itemAmt = Number(item.productNetAmount || item.netAmount || item.amount || item.Total || item.price || 0);
              if (!isNaN(itemAmt) && itemAmt > 0) {
                if (isOld) lineOldSum += itemAmt;
                else lineNewSum += itemAmt;
              }
            }
          }

          const originalInvoiceNo = ex.originalInvoiceNo || ex.originalInvoiceNumber || ex.originalBillId || ex.refInvoiceNo || meta.invoiceNumber;
          let origExAmt = lineOldSum > 0 ? lineOldSum : Number(ex.originalAmount || ex.oldAmount || ex.returnAmount || ex.oldBillAmount || 0);
          let newExAmt = lineNewSum > 0 ? lineNewSum : Number(ex.newAmount || ex.newSaleAmount || ex.newInvoiceAmount || ex.newBillAmount || log.amount || meta.amount || 0);

          if (origExAmt === 0 && originalInvoiceNo) {
            const dbSale = await prisma.sales.findFirst({
              where: {
                OR: [
                  { billId: String(originalInvoiceNo) },
                  { billId: `HWM-${originalInvoiceNo}` },
                  { billId: { contains: String(originalInvoiceNo) } },
                ]
              }
            });
            if (dbSale) {
              origExAmt = Number(dbSale.netAmount || 0);
            }
          }

          if (origExAmt === 0 && log.billId) {
            const dbEx = await prisma.salesExchange.findFirst({
              where: {
                OR: [
                  { exchangeNo: String(log.billId) },
                  { exchangeNo: { contains: String(log.billId) } }
                ]
              }
            });
            if (dbEx) {
              if (Number(dbEx.originalAmount) > 0) origExAmt = Number(dbEx.originalAmount);
              if (Number(dbEx.newAmount) > 0 && newExAmt === 0) newExAmt = Number(dbEx.newAmount);
            }
          }

          if (newExAmt <= 0) newExAmt = Number(log.amount || meta.amount || 0);

          log.amount = newExAmt;
          log.newAmount = newExAmt;
          log.newBillAmount = newExAmt;

          if (origExAmt > 0 && newExAmt > 0) {
            log.oldAmount = origExAmt;
            log.oldBillAmount = origExAmt;
            // Rule: DIFFERENCE AMOUNT = OLD BILL AMOUNT - NEW BILL AMOUNT (848 - 1398 = -550)
            log.differenceAmount = Math.round((origExAmt - newExAmt) * 100) / 100;
          } else {
            log.oldAmount = null;
            log.oldBillAmount = null;
            log.differenceAmount = null;
          }
        } catch (e) {
          // ignore exchange error
        }
      } else {
        // Normal Invoice Created / Other Standard Events:
        // AMOUNT = actual invoice amount
        // OLD BILL AMOUNT = null
        // DIFFERENCE AMOUNT = null
        // NEW BILL AMOUNT = null
        const actAmt = Number(log.amount !== undefined && log.amount !== null ? log.amount : (meta.amount || 0));
        log.amount = actAmt;
        log.oldAmount = null;
        log.oldBillAmount = null;
        log.differenceAmount = null;
        log.newAmount = null;
        log.newBillAmount = null;
      }
    }

    // Apply storeFilter and search if requested at API level
    if (storeFilter && storeFilter !== 'ALL') {
      combined = combined.filter((l) => l.storeName === storeFilter);
    }

    if (search && String(search).trim()) {
      const q = String(search).toLowerCase().trim();
      combined = combined.filter((l) =>
        String(l.billId || '').toLowerCase().includes(q) ||
        String(l.invoiceNo || '').toLowerCase().includes(q) ||
        String(l.customerName || '').toLowerCase().includes(q) ||
        String(l.employeeName || '').toLowerCase().includes(q) ||
        String(l.storeName || '').toLowerCase().includes(q) ||
        String(l.eventType || '').toLowerCase().includes(q) ||
        String(l.amount || '').includes(q)
      );
    }

    // Sort by createdAt desc
    combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = combined.length;
    const paginatedLogs = combined.slice(offsetNum, offsetNum + limitNum);

    res.json({
      success: true,
      data: paginatedLogs,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error: any) {
    console.error('Fetch webhook logs error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch webhook logs' });
  }
});

/**
 * GET /api/webhook/stats
 * 
 * Returns webhook stats (success, failed, total, totalAmount) across all events
 */
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const [webhookLogs, hopkidRawLogs, commTransactions] = await Promise.all([
      prisma.webhookLog.findMany().catch(() => []),
      prisma.hopkidWebhookLog.findMany().catch(() => []),
      prisma.commissionTransaction.findMany().catch(() => []),
    ]);

    const mappedWebhookLogs = webhookLogs.map((log) => {
      const parsed = parseRawPayload(log.payload);
      const meta = extractWebhookMeta(parsed);
      const amountVal = log.amount !== null && log.amount !== undefined ? log.amount : meta.amount;
      const billIdVal = log.billId || meta.billId;

      return {
        id: log.id,
        billId: billIdVal || null,
        status: log.status || 'SUCCESS',
        amount: amountVal || 0,
      };
    });

    const existingBillIds = new Set(mappedWebhookLogs.map((c) => c.billId).filter(Boolean));

    const combined = [...mappedWebhookLogs];

    for (const log of hopkidRawLogs) {
      const parsed = parseRawPayload(log.rawPayload);
      const meta = extractWebhookMeta(parsed);
      const amountVal = log.amount !== null && log.amount !== undefined ? log.amount : meta.amount;
      const billIdVal = log.billId || meta.billId;

      if (!billIdVal || !existingBillIds.has(billIdVal)) {
        combined.push({
          id: `hopkid-${log.id}`,
          billId: billIdVal || null,
          status: 'SUCCESS',
          amount: amountVal || 0,
        });
      }
    }

    for (const t of commTransactions) {
      if (t.billId && !existingBillIds.has(t.billId)) {
        combined.push({
          id: `comm-${t.id}`,
          billId: t.billId,
          status: t.status === 'REJECTED' ? 'FAILED' : 'SUCCESS',
          amount: t.saleAmount || 0,
        });
      }
    }

    const total = combined.length;
    const success = combined.filter((l) => l.status === 'SUCCESS').length;
    const failed = combined.filter((l) => l.status === 'FAILED').length;
    const processing = combined.filter((l) => l.status === 'PROCESSING').length;
    const sumAmount = combined.reduce((acc, l) => acc + (isNaN(l.amount) ? 0 : l.amount), 0);

    const successRate = total > 0 ? ((success / total) * 100).toFixed(2) + '%' : '100%';

    res.json({
      success: true,
      data: {
        total,
        success,
        failed,
        processing,
        successRate,
        totalAmount: sumAmount,
      },
    });
  } catch (error: any) {
    console.error('Fetch webhook stats error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch webhook stats' });
  }
});

/**
 * GET /api/webhook/logs/:id
 * 
 * Returns single webhook log detail
 */
router.get('/logs/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    let log: any = await prisma.webhookLog.findUnique({
      where: { id: id as string },
    }).catch(() => null);

    if (!log) {
      const hopkidLog = await prisma.hopkidWebhookLog.findUnique({
        where: { id: id as string },
      }).catch(() => null);

      if (hopkidLog) {
        const parsed = parseRawPayload(hopkidLog.rawPayload);
        const meta = extractWebhookMeta(parsed);
        log = {
          id: hopkidLog.id,
          eventType: meta.eventType || 'INVOICE_CREATED',
          status: 'SUCCESS',
          payload: hopkidLog.rawPayload,
          employeeId: null,
          amount: hopkidLog.amount ?? meta.amount,
          billId: hopkidLog.billId || meta.billId,
          errorMessage: null,
          processedAt: hopkidLog.createdAt,
          createdAt: hopkidLog.createdAt,
        };
      }
    }

    if (!log && String(id).startsWith('comm-tx-')) {
      const commId = parseInt(String(id).replace('comm-tx-', ''), 10);
      if (!isNaN(commId)) {
        const t = await prisma.commissionTransaction.findUnique({
          where: { id: commId },
          include: { employee: true, store: true }
        });
        if (t) {
          const syntheticPayload = {
            eventId: `COMM-${t.id}`,
            billId: t.billId,
            invoiceNumber: t.invoiceNumber,
            amount: t.saleAmount,
            commissionAmount: t.commissionAmount,
            eventType: t.eventType,
            employee: t.employee,
            store: t.store,
            createdAt: t.createdAt
          };
          log = {
            id: `comm-tx-${t.id}`,
            eventType: t.eventType || 'INVOICE_CREATED',
            status: t.status === 'REJECTED' ? 'FAILED' : 'SUCCESS',
            payload: JSON.stringify(syntheticPayload, null, 2),
            employeeId: t.employeeId,
            amount: t.saleAmount,
            billId: t.billId,
            errorMessage: null,
            processedAt: t.createdAt,
            createdAt: t.createdAt
          };
        }
      }
    }

    if (!log) {
      res.status(404).json({ success: false, message: 'Log not found' });
      return;
    }

    const parsed = parseRawPayload(log.payload);
    const meta = extractWebhookMeta(parsed);
    const evStr = String(log.eventType || meta.eventType || '').toUpperCase();

    const isCreditNote =
      evStr.includes('CREDIT_NOTE') ||
      String(log.billId || meta.billId || '').startsWith('CN-') ||
      String(log.billId || meta.billId || '').startsWith('HKACN') ||
      (meta.cnAmount !== undefined && meta.cnAmount !== null && Number(meta.cnAmount) > 0) ||
      Boolean(parsed?.data?.creditNote || parsed?.creditNote);

    const isExchange =
      evStr.includes('EXCHANGE') ||
      String(log.billId || meta.billId || '').startsWith('EX-') ||
      Boolean(parsed?.data?.salesExchange || parsed?.salesExchange || parsed?.SalesExchangeProductList || parsed?.data?.SalesExchangeProductList);

    const rawCnAmt = meta.cnAmount || (meta.creditNote?.cnAmount !== undefined ? Number(meta.creditNote.cnAmount) : (log.cnAmount || log.amount || 0));
    const cnAmt = Number(rawCnAmt || 0);

    let oldAmount: number | null = null;
    let oldBillAmount: number | null = null;
    let newAmount: number | null = null;
    let newBillAmount: number | null = null;
    let differenceAmount: number | null = null;
    let oldCommission: number | null = null;
    let newCommission: number | null = null;
    let commissionDifference: number | null = null;

    if (isCreditNote) {
      const cn = meta.creditNote || parsed?.data?.creditNote || parsed?.creditNote || {};
      const refInv = cn.invoiceNo || cn.invoiceNumber || cn.salesID || cn.salesExchangeID || meta.invoiceNumber || log.invoiceNo;

      let origSale = refInv ? await prisma.sales.findFirst({
        where: {
          OR: [
            { billId: String(refInv) },
            { billId: `HWM-${refInv}` },
            { billId: { contains: String(refInv) } },
          ]
        }
      }) : null;

      if (origSale && Number(origSale.netAmount || 0) > 0) {
        oldAmount = Number(origSale.netAmount);
        oldBillAmount = Number(origSale.netAmount);
        newAmount = cnAmt > 0 ? cnAmt : Number(log.amount ?? meta.amount ?? 0);
        newBillAmount = newAmount;
        differenceAmount = Math.round((oldBillAmount - newBillAmount) * 100) / 100;
        oldCommission = Math.round((oldBillAmount * 0.01) * 100) / 100;
        newCommission = Number(meta.commissionAmount || log.commissionAmount || (newBillAmount * 0.01));
        commissionDifference = Math.round(((oldCommission || 0) - (newCommission || 0)) * 100) / 100;
      } else {
        newAmount = cnAmt > 0 ? cnAmt : Number(log.amount ?? meta.amount ?? 0);
        newBillAmount = newAmount;
      }
    } else if (isExchange) {
      const ex = parsed?.data?.salesExchange || parsed?.salesExchange || parsed || {};
      const exLineItems = parsed?.data?.lineItems ||
        ex.lineItems ||
        parsed?.lineItems ||
        parsed?.data?.SalesExchangeProductList ||
        ex.SalesExchangeProductList ||
        parsed?.SalesExchangeProductList ||
        [];

      let lineOldSum = 0;
      let lineNewSum = 0;
      if (Array.isArray(exLineItems) && exLineItems.length > 0) {
        for (const item of exLineItems) {
          const isOld = parseIsOld(item);
          const itemAmt = Number(item.productNetAmount || item.netAmount || item.amount || item.Total || item.price || 0);
          if (!isNaN(itemAmt) && itemAmt > 0) {
            if (isOld) lineOldSum += itemAmt;
            else lineNewSum += itemAmt;
          }
        }
      }

      const originalInvoiceNo = ex.originalInvoiceNo || ex.originalInvoiceNumber || ex.originalBillId || ex.refInvoiceNo || meta.invoiceNumber;
      let origExAmt = lineOldSum > 0 ? lineOldSum : Number(ex.originalAmount || ex.oldAmount || ex.returnAmount || ex.oldBillAmount || 0);
      let newExAmt = lineNewSum > 0 ? lineNewSum : Number(ex.newAmount || ex.newSaleAmount || ex.newInvoiceAmount || ex.newBillAmount || log.amount || meta.amount || 0);

      if (origExAmt === 0 && originalInvoiceNo) {
        const dbSale = await prisma.sales.findFirst({
          where: {
            OR: [
              { billId: String(originalInvoiceNo) },
              { billId: `HWM-${originalInvoiceNo}` },
              { billId: { contains: String(originalInvoiceNo) } },
            ]
          }
        });
        if (dbSale) {
          origExAmt = Number(dbSale.netAmount || 0);
        }
      }

      if (newExAmt <= 0) newExAmt = Number(log.amount || meta.amount || 0);
      newAmount = newExAmt;
      newBillAmount = newExAmt;

      if (origExAmt > 0 && newExAmt > 0) {
        oldAmount = origExAmt;
        oldBillAmount = origExAmt;
        differenceAmount = Math.round((origExAmt - newExAmt) * 100) / 100;
      }
    } else {
      const actAmt = Number(log.amount !== undefined && log.amount !== null ? log.amount : (meta.amount || 0));
      oldAmount = null;
      oldBillAmount = null;
      differenceAmount = null;
      newAmount = null;
      newBillAmount = null;
    }

    log = {
      ...log,
      amount: isCreditNote && cnAmt > 0 ? cnAmt : (isExchange && newBillAmount !== null && newBillAmount > 0 ? newBillAmount : (log.amount ?? meta.amount)),
      cnAmount: isCreditNote ? cnAmt : meta.cnAmount,
      refundAmount: meta.refundAmount || 0,
      oldAmount,
      oldBillAmount,
      newAmount,
      newBillAmount,
      differenceAmount,
      oldCommission,
      newCommission,
      commissionDifference,
      billId: log.billId || meta.billId,
      eventType: normalizeEventType(log.eventType || meta.eventType, 'INVOICE_CREATED', parsed),
    };

    res.json({ success: true, data: log });
  } catch (error: any) {
    console.error('Fetch webhook log detail error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch webhook log detail' });
  }
});

/**
 * DELETE /api/webhook/logs/:id
 * 
 * Delete a webhook log
 */
router.delete('/logs/:id', authMiddleware, roleMiddleware(SUPERADMIN_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.webhookLog.delete({
      where: { id: id as string },
    }).catch(() => {
      return prisma.hopkidWebhookLog.delete({
        where: { id: id as string },
      });
    });

    res.json({ success: true, message: 'Log deleted' });
  } catch (error: any) {
    console.error('Delete webhook log error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete webhook log' });
  }
});

/**
 * POST /api/webhook/logs/clear
 * 
 * Clear old webhook logs (older than X days)
 */
router.post('/logs/clear', authMiddleware, roleMiddleware(SUPERADMIN_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const daysOld = parseInt(req.body?.daysOld || '30', 10);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const [wRes, hRes] = await Promise.allSettled([
      prisma.webhookLog.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      }),
      prisma.hopkidWebhookLog.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      }),
    ]);

    const count1 = wRes.status === 'fulfilled' ? wRes.value.count : 0;
    const count2 = hRes.status === 'fulfilled' ? hRes.value.count : 0;

    res.json({ 
      success: true, 
      message: `Deleted ${count1 + count2} logs older than ${daysOld} days` 
    });
  } catch (error: any) {
    console.error('Clear webhook logs error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to clear webhook logs' });
  }
});

export default router;
