import { prisma } from './db';

/**
 * Safely parses any amount value (number or string with currency symbols/commas).
 * Example: "1,056.00" -> 1056, "₹1,056.00" -> 1056.
 */
export function safeParseAmount(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.abs(val);
  const cleanStr = String(val).replace(/,/g, '').replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleanStr);
  return isNaN(num) ? 0 : Math.abs(num);
}

/**
 * Resolves the IsOld flag from a transaction or line item.
 * IsOld = 1 / true -> Returned / Old Item / Credit Note (Commission SUBTRACTED / REVERSED)
 * IsOld = 0 / false -> New Sold Item / POS Sale (Commission ADDED / POSITIVE)
 */
export function parseIsOld(item: any): boolean {
  if (item === null || item === undefined) return false;
  const val = item.IsOld ?? item.isOld ?? item.is_old ?? item.Is_Old ?? item.isOldItem;
  if (val === true || val === 1 || val === '1' || String(val).trim().toLowerCase() === 'true') {
    return true;
  }
  return false;
}

/**
 * Calculates the current/effective contribution of a commission transaction:
 * - Returns the current/effective sale amount and commission amount.
 * - Historical old values are preserved in the record for audit/history, but are never added to current earnings.
 */
export function getTransactionNetContribution(t: {
  eventType?: string | null;
  saleAmount: number | string;
  commissionAmount: number | string;
  oldAmount?: number | string | null;
  newAmount?: number | string | null;
  oldCommission?: number | string | null;
  newCommission?: number | string | null;
  commissionDifference?: number | string | null;
}): { netSales: number; netCommission: number } {
  const currentSales = t.newAmount !== null && t.newAmount !== undefined && Number(t.newAmount) > 0
    ? Number(t.newAmount)
    : Number(t.saleAmount || 0);

  const currentCommission = t.newCommission !== null && t.newCommission !== undefined && Number(t.newCommission) > 0
    ? Number(t.newCommission)
    : Number(t.commissionAmount || 0);

  return {
    netSales: currentSales,
    netCommission: currentCommission,
  };
}

/**
 * Safely parses any date value (ISO strings, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, or timestamps).
 * Resolves Indian date format (DD/MM/YYYY or DD-MM-YYYY) correctly without treating day as month,
 * and ensures date-only strings land on the correct day without shifting to the previous day in UTC.
 */
export function safeParseDate(val: any): Date {
  if (val === undefined || val === null || val === '') return new Date();
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
  if (typeof val === 'number') {
    const ms = val < 1e11 ? val * 1000 : val;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  const str = String(val).trim();
  if (!str) return new Date();

  // Check if string is pure numeric timestamp
  if (/^\d+$/.test(str)) {
    const num = Number(str);
    const ms = num < 1e11 ? num * 1000 : num;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d;
  }

  // Check DD/MM/YYYY or DD-MM-YYYY (with optional time HH:mm:ss)
  const dmyMatch = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hasTime = dmyMatch[4] !== undefined;
    const hour = hasTime ? parseInt(dmyMatch[4], 10) : 12; // Default to 12:00 noon if no time given
    const min = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const sec = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
    const utcMs = Date.UTC(year, month, day, hour, min, sec) - 5.5 * 60 * 60 * 1000;
    const d = new Date(utcMs);
    if (!isNaN(d.getTime())) return d;
  }

  // If string contains explicit numeric timezone offset (e.g. +05:30, -04:00)
  if (/[\+\-]\d{2}:?\d{2}$/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
  }

  // Parse ISO / DateTime strings (e.g. "2026-08-12T11:30:00", "2026-08-12T11:30:00Z", "2026-08-12 11:30:00")
  // Treat numerical hours/mins as IST local clock time (UTC+5:30)
  const cleanIso = str.replace(/Z$/i, '');
  if (cleanIso.includes('T') || cleanIso.includes(' ')) {
    const separator = cleanIso.includes('T') ? 'T' : ' ';
    const [datePart, timePart] = cleanIso.split(separator);
    const dateParts = datePart.split('-');
    const timeParts = (timePart || '12:00:00').split(':');
    if (dateParts.length >= 3) {
      const year = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1;
      const day = parseInt(dateParts[2], 10);
      const hour = parseInt(timeParts[0], 10) || 0;
      const min = parseInt(timeParts[1], 10) || 0;
      const sec = parseInt((timeParts[2] || '0').split('.')[0], 10) || 0;
      const utcMs = Date.UTC(year, month, day, hour, min, sec) - 5.5 * 60 * 60 * 1000;
      const d = new Date(utcMs);
      if (!isNaN(d.getTime())) return d;
    }
  } else if (str.includes('-')) {
    // Date-only YYYY-MM-DD -> treat as 12:00 noon IST to avoid UTC day-shift
    const parts = str.split('-');
    if (parts.length >= 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const utcMs = Date.UTC(year, month, day, 12, 0, 0, 0) - 5.5 * 60 * 60 * 1000;
      const d = new Date(utcMs);
      if (!isNaN(d.getTime())) return d;
    }
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Parse sale date correctly handling timezone, ISO, YYYY-MM-DD, and Indian date formats.
 */
export async function parseSaleDateCorrectly(invoiceDateString: string): Promise<Date> {
  console.log('[Date Parse] Input:', invoiceDateString);
  try {
    const date = safeParseDate(invoiceDateString);
    console.log('[Date Parse] Parsed ISO:', date.toISOString());
    console.log('[Date Parse] Local String:', date.toString());
    return date;
  } catch (error: any) {
    console.error('[Date Parse] ❌ Error parsing date:', error.message);
    return new Date();
  }
}

/**
 * Resolves an employee identifier (GUID string, employeeCode, or integer ID)
 * to the canonical local Employee DB primary key (id).
 */
export async function resolveEmployeeId(identifier?: string | number | null): Promise<number | null> {
  if (!identifier) return null;
  const str = String(identifier).trim();
  if (!str) return null;

  // 1. Check for GUID match on employeeID (case-insensitive)
  const byGuid = await prisma.employee.findFirst({
    where: { employeeID: { equals: str, mode: 'insensitive' } },
  });
  if (byGuid) return byGuid.id;

  // 2. Check for employeeCode match
  const byCode = await prisma.employee.findFirst({
    where: { employeeCode: { equals: str, mode: 'insensitive' } },
  });
  if (byCode) return byCode.id;

  // 3. Check for DB integer primary key match
  // Guard: skip if it looks like a phone number (7+ pure digits which would overflow PostgreSQL int)
  const parsedInt = parseInt(str, 10);
  const isPureDigits = /^\d+$/.test(str);
  if (!isNaN(parsedInt) && parsedInt > 0 && parsedInt <= 2147483647 && !(isPureDigits && str.length >= 7)) {
    const byPk = await prisma.employee.findUnique({ where: { id: parsedInt } }).catch(() => null);
    if (byPk) return byPk.id;
  }

  // 4. Check for mobileNumber match (matching last 10 digits)
  const digitsOnly = str.replace(/\D/g, '');
  if (digitsOnly.length >= 10) {
    const last10 = digitsOnly.slice(-10);
    const byMobile = await prisma.employee.findFirst({
      where: { mobileNumber: { contains: last10 } },
    });
    if (byMobile) return byMobile.id;
  }

  // 5. Check for First/Last Name match (case-insensitive)
  const nameParts = str.trim().split(/\s+/);
  const byName = await prisma.employee.findFirst({
    where: {
      OR: [
        { firstName: { equals: str, mode: 'insensitive' } },
        { lastName: { equals: str, mode: 'insensitive' } },
        nameParts.length >= 2 ? {
          AND: [
            { firstName: { equals: nameParts[0], mode: 'insensitive' } },
            { lastName: { equals: nameParts.slice(1).join(' '), mode: 'insensitive' } },
          ],
        } : { firstName: { equals: str, mode: 'insensitive' } },
      ],
    },
  });
  if (byName) return byName.id;

  return null;
}


export interface ExtractedWebhookMeta {
  billId: string | null;
  invoiceNumber: string | null;
  amount: number;
  eventType: string;
  customerName: string | null;
  customerPhone: string | null;
  paymentMode: string | null;
  branchName: string | null;
  storeName: string | null;
  storeId: number | null;
  invoice: any;
  lineItems: any[];
  firstItem: any;
  employeeIdentifier: string | null;
  employeeName: string | null;
  commissionAmount: number | null;
  eventId: string | null;
  salesmen: any[];
}

export function extractWebhookMeta(data: any): ExtractedWebhookMeta {
  if (!data) {
    return {
      billId: null,
      invoiceNumber: null,
      amount: 0,
      eventType: 'INVOICE_CREATED',
      customerName: null,
      customerPhone: null,
      paymentMode: null,
      branchName: null,
      storeName: null,
      storeId: null,
      invoice: {},
      lineItems: [],
      firstItem: {},
      employeeIdentifier: null,
      employeeName: null,
      commissionAmount: null,
      eventId: null,
      salesmen: [],
    };
  }

  let payload = data;
  if (typeof data === 'string') {
    try {
      payload = JSON.parse(data);
    } catch (_) {
      return {
        billId: null,
        invoiceNumber: null,
        amount: 0,
        eventType: 'INVOICE_CREATED',
        customerName: null,
        customerPhone: null,
        paymentMode: null,
        branchName: null,
        storeName: null,
        storeId: null,
        invoice: {},
        lineItems: [],
        firstItem: {},
        employeeIdentifier: null,
        employeeName: null,
        commissionAmount: null,
        eventId: null,
        salesmen: [],
      };
    }
  }

  const creditNote = payload?.data?.creditNote || payload?.creditNote || payload?.data?.salesExchange || payload?.salesExchange || payload?.data || payload || {};
  const invoice = payload?.data?.invoice || payload?.invoice || {};

  const rawSalesmen =
    payload?.data?.salesmen ||
    payload?.salesmen ||
    payload?.data?.salesPersons ||
    payload?.salesPersons ||
    payload?.data?.salesmanList ||
    payload?.salesmanList ||
    payload?.data?.employees ||
    payload?.employees ||
    invoice?.salesmen ||
    invoice?.salesPersons ||
    invoice?.salesmanList ||
    invoice?.employees ||
    creditNote?.salesmen ||
    creditNote?.salesPersons ||
    [];
  const salesmen = Array.isArray(rawSalesmen) ? rawSalesmen : [];

  const lineItems = Array.isArray(payload?.data?.lineItems)
    ? payload.data.lineItems
    : Array.isArray(payload?.lineItems)
    ? payload.lineItems
    : Array.isArray(payload?.data?.CreditNoteProducts)
    ? payload.data.CreditNoteProducts
    : Array.isArray(payload?.CreditNoteProducts)
    ? payload.CreditNoteProducts
    : Array.isArray(creditNote?.CreditNoteProducts)
    ? creditNote.CreditNoteProducts
    : Array.isArray(payload?.data?.SalesExchangeProductList)
    ? payload.data.SalesExchangeProductList
    : Array.isArray(payload?.SalesExchangeProductList)
    ? payload.SalesExchangeProductList
    : Array.isArray(payload?.data?.products)
    ? payload.data.products
    : Array.isArray(payload?.products)
    ? payload.products
    : [];

  const firstItem = lineItems[0] || {};
  const eventId =
    payload?.eventId ||
    payload?.event_id ||
    payload?.webhookEventId ||
    payload?.webhook_event_id ||
    payload?.id ||
    payload?.data?.eventId ||
    payload?.data?.event_id ||
    payload?.data?.id ||
    null;

  // 1. Resolve raw string invoice number / code (e.g. "HWM-89", "HWM-93", "CN-12", "INV-102")
  const rawInvoiceNumber =
    creditNote.InvoiceNo ||
    creditNote.invoiceNo ||
    creditNote.invoiceNumber ||
    creditNote.SalesID ||
    creditNote.CNNo ||
    creditNote.creditNoteNo ||
    payload?.InvoiceNo ||
    payload?.SalesID ||
    payload?.data?.InvoiceNo ||
    payload?.data?.SalesID ||
    invoice.invoiceNumber ||
    invoice.invoiceNo ||
    invoice.invoiceId ||
    invoice.invoice_id ||
    payload?.data?.invoiceNumber ||
    payload?.data?.invoiceNo ||
    payload?.data?.invoiceId ||
    payload?.data?.invoice_id ||
    payload?.invoiceNumber ||
    payload?.invoiceNo ||
    payload?.invoiceId ||
    payload?.invoice_id ||
    firstItem?.invoiceNumber ||
    firstItem?.invoiceNo ||
    firstItem?.invoiceId ||
    null;

  // 2. Resolve numeric Bill ID (strictly numeric, never a UUID)
  const isUuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;
  let resolvedBillId: string | null = null;

  const billCandidates = [
    creditNote.CNID,
    creditNote.CNNo,
    creditNote.creditNoteNo,
    creditNote.number,
    creditNote.exchangeNo,
    invoice.billId,
    invoice.bill_id,
    invoice.billNumber,
    invoice.billNo,
    invoice.invoiceId,
    invoice.invoice_id,
    payload?.data?.billId,
    payload?.data?.bill_id,
    payload?.data?.billNumber,
    payload?.data?.billNo,
    payload?.data?.invoiceId,
    payload?.data?.invoice_id,
    payload?.billId,
    payload?.bill_id,
    payload?.billNumber,
    payload?.billNo,
    payload?.invoiceId,
    payload?.invoice_id,
    firstItem?.billId,
    firstItem?.bill_id,
    firstItem?.billNo,
    firstItem?.invoiceId,
    rawInvoiceNumber,
  ];

  for (const cand of billCandidates) {
    if (cand === null || cand === undefined) continue;
    if (typeof cand === 'number' && cand > 0 && cand <= 2147483647) {
      resolvedBillId = String(cand);
      break;
    }
    const candStr = String(cand).trim();
    if (!candStr || isUuidPattern.test(candStr)) continue;
    // Extract digits
    const digits = candStr.replace(/\D/g, '');
    if (digits.length > 0 && digits.length <= 9) {
      const parsed = parseInt(digits, 10);
      if (parsed > 0 && parsed <= 2147483647) {
        resolvedBillId = String(parsed);
        break;
      }
    }
  }

  // Fallback: If no digits found but rawInvoiceNumber is a clean string code
  if (!resolvedBillId && rawInvoiceNumber && !isUuidPattern.test(String(rawInvoiceNumber))) {
    resolvedBillId = String(rawInvoiceNumber).trim();
  }

  const billId = resolvedBillId;

  // 3. Resolve formatted invoice number
  let invoiceNumber: string | null = null;
  if (rawInvoiceNumber && !isUuidPattern.test(String(rawInvoiceNumber))) {
    invoiceNumber = String(rawInvoiceNumber).trim();
  } else if (billId && /^\d+$/.test(billId)) {
    invoiceNumber = `HWM-${billId}`;
  } else if (billId) {
    invoiceNumber = billId;
  }

  let rawAmount =
    creditNote.CNAmount ??
    creditNote.creditAmount ??
    creditNote.RefundAmount ??
    creditNote.BillAmount ??
    creditNote.totalAmount ??
    creditNote.newAmount ??
    creditNote.amount ??
    payload?.CNAmount ??
    payload?.creditAmount ??
    payload?.RefundAmount ??
    payload?.BillAmount ??
    payload?.data?.CNAmount ??
    payload?.data?.RefundAmount ??
    invoice.netAmount ??
    invoice.totalAmount ??
    invoice.grandTotal ??
    payload?.data?.invoice?.netAmount ??
    payload?.data?.invoice?.totalAmount ??
    payload?.data?.netAmount ??
    payload?.data?.totalAmount ??
    payload?.data?.grandTotal ??
    firstItem?.CNAmount ??
    firstItem?.creditAmount ??
    firstItem?.productNetAmount ??
    firstItem?.netAmount ??
    firstItem?.amount ??
    payload?.data?.amount ??
    payload?.data?.saleAmount ??
    payload?.amount ??
    payload?.saleAmount ??
    payload?.totalAmount ??
    payload?.grandTotal ??
    payload?.netAmount;

  let amount = safeParseAmount(rawAmount);

  // If amount is 0 and line items exist, calculate sum from returned items
  if (amount === 0 && lineItems.length > 0) {
    let sum = 0;
    for (const item of lineItems) {
      const itemAmt = Number(
        item.CNAmount ??
        item.creditAmount ??
        item.Amount ??
        item.amount ??
        item.productNetAmount ??
        (Number(item.Price || item.price || 0) * Number(item.Quantity || item.quantity || 1))
      ) || 0;
      sum += itemAmt;
    }
    if (sum > 0) amount = Math.round(sum * 100) / 100;
  }

  const rawEventType = payload?.eventType || payload?.topic || payload?.event || null;
  const eventType = normalizeEventType(rawEventType, 'INVOICE_CREATED', payload);

  const customerName =
    creditNote.CustomerName ||
    creditNote.customerName ||
    creditNote.Customer ||
    creditNote.customer ||
    payload?.CustomerName ||
    payload?.customerName ||
    payload?.data?.CustomerName ||
    payload?.data?.customerName ||
    invoice.customerName ||
    invoice.customer ||
    firstItem?.CustomerName ||
    firstItem?.customerName ||
    payload?.name ||
    null;

  const customerPhone =
    creditNote.PhoneNumber ||
    creditNote.customerPhone ||
    creditNote.phone ||
    payload?.PhoneNumber ||
    payload?.customerPhone ||
    payload?.data?.PhoneNumber ||
    payload?.data?.customerPhone ||
    invoice.customerPhone ||
    firstItem?.PhoneNumber ||
    firstItem?.customerPhone ||
    null;

  const rawPaymentMode =
    creditNote.PaymentMode ||
    creditNote.paymentMode ||
    creditNote.payment_mode ||
    creditNote.PaymentMethod ||
    creditNote.paymentMethod ||
    creditNote.paymentType ||
    creditNote.payMode ||
    payload?.PaymentMode ||
    payload?.paymentMode ||
    payload?.payment_mode ||
    payload?.PaymentMethod ||
    payload?.paymentMethod ||
    payload?.paymentType ||
    payload?.payMode ||
    payload?.pay_mode ||
    payload?.tenderMode ||
    payload?.modeOfPayment ||
    payload?.data?.PaymentMode ||
    payload?.data?.paymentMode ||
    payload?.data?.payment_mode ||
    payload?.data?.PaymentMethod ||
    payload?.data?.paymentMethod ||
    payload?.data?.paymentType ||
    payload?.data?.payMode ||
    payload?.data?.tenderMode ||
    payload?.data?.modeOfPayment ||
    payload?.invoice?.PaymentMode ||
    payload?.invoice?.paymentMode ||
    payload?.invoice?.payment_mode ||
    payload?.invoice?.paymentType ||
    invoice.PaymentMode ||
    invoice.paymentMode ||
    invoice.payment_mode ||
    invoice.PaymentMethod ||
    invoice.paymentMethod ||
    invoice.paymentType ||
    invoice.payMode ||
    invoice.tenderMode ||
    invoice.modeOfPayment ||
    firstItem?.PaymentMode ||
    firstItem?.paymentMode ||
    firstItem?.payment_mode ||
    firstItem?.payMode ||
    firstItem?.tenderMode ||
    (Array.isArray(payload?.payments) && (payload.payments[0]?.mode || payload.payments[0]?.paymentMode || payload.payments[0]?.paymentType)) ||
    (Array.isArray(payload?.data?.payments) && (payload.data.payments[0]?.mode || payload.data.payments[0]?.paymentMode || payload.data.payments[0]?.paymentType)) ||
    (Array.isArray(invoice.payments) && (invoice.payments[0]?.mode || invoice.payments[0]?.paymentMode || invoice.payments[0]?.paymentType)) ||
    (Array.isArray(invoice.paymentDetails) && (invoice.paymentDetails[0]?.paymentMode || invoice.paymentDetails[0]?.mode)) ||
    (Array.isArray(payload?.tenders) && (payload.tenders[0]?.tenderType || payload.tenders[0]?.mode)) ||
    null;

  let paymentMode: string | null = null;
  if (rawPaymentMode) {
    const str = String(rawPaymentMode).trim();
    if (str.length > 0 && str !== '-' && str.toLowerCase() !== 'null' && str.toLowerCase() !== 'undefined') {
      paymentMode = str.toUpperCase();
    }
  }

  const branchName =
    creditNote.branchName ||
    invoice.branchName ||
    payload?.branchName ||
    payload?.data?.branchName ||
    firstItem?.branchName ||
    null;

  const storeName =
    creditNote.storeName ||
    invoice.storeName ||
    invoice.branchName ||
    invoice.store ||
    invoice.branch ||
    payload?.data?.storeName ||
    payload?.data?.branchName ||
    payload?.data?.store ||
    payload?.data?.branch ||
    payload?.storeName ||
    payload?.branchName ||
    payload?.store ||
    payload?.branch ||
    firstItem?.storeName ||
    firstItem?.branchName ||
    firstItem?.store ||
    firstItem?.branch ||
    null;

  const storeIdParsed = creditNote.storeId ? parseInt(String(creditNote.storeId), 10) : (invoice.storeId ? parseInt(String(invoice.storeId), 10) : (payload?.storeId ? parseInt(String(payload.storeId), 10) : null));
  const storeId = isNaN(storeIdParsed as number) ? null : storeIdParsed;

  const employeeIdentifier =
    creditNote.Salesman ||
    creditNote.CreatedBy ||
    creditNote.salesmanName ||
    creditNote.employeeCode ||
    creditNote.salesmanCode ||
    creditNote.employeeId ||
    creditNote.salesmanId ||
    payload?.Salesman ||
    payload?.CreatedBy ||
    payload?.salesmanName ||
    payload?.data?.Salesman ||
    payload?.data?.CreatedBy ||
    firstItem?.Salesman ||
    firstItem?.salesman ||
    firstItem?.employeeCode ||
    firstItem?.salesmanCode ||
    firstItem?.code ||
    firstItem?.empCode ||
    firstItem?.hopkidCode ||
    firstItem?.employeeId ||
    firstItem?.salesmanId ||
    firstItem?.employeePhoneNo ||
    firstItem?.employeeContactNo ||
    firstItem?.mobileNo ||
    firstItem?.mobileNumber ||
    firstItem?.phone ||
    firstItem?.phoneNumber ||
    firstItem?.employeeName ||
    firstItem?.name ||
    invoice?.employeeCode ||
    invoice?.salesmanCode ||
    invoice?.empCode ||
    invoice?.hopkidCode ||
    invoice?.employeeId ||
    invoice?.salesmanId ||
    invoice?.mobileNo ||
    invoice?.mobileNumber ||
    invoice?.phone ||
    invoice?.phoneNumber ||
    invoice?.employeeName ||
    invoice?.salesmanName ||
    invoice?.salesman ||
    payload?.data?.employeeCode ||
    payload?.data?.salesmanCode ||
    payload?.data?.employeeId ||
    payload?.data?.salesmanId ||
    payload?.data?.mobileNo ||
    payload?.data?.mobileNumber ||
    payload?.data?.employeeName ||
    payload?.employeeCode ||
    payload?.code ||
    payload?.empCode ||
    payload?.hopkidCode ||
    payload?.mobileNo ||
    payload?.mobileNumber ||
    payload?.phone ||
    payload?.phoneNumber ||
    payload?.employeeName ||
    payload?.name ||
    null;

  const employeeName =
    creditNote.Salesman ||
    creditNote.CreatedBy ||
    creditNote.salesmanName ||
    creditNote.employeeName ||
    payload?.Salesman ||
    payload?.CreatedBy ||
    payload?.salesmanName ||
    payload?.data?.Salesman ||
    payload?.data?.CreatedBy ||
    firstItem?.Salesman ||
    firstItem?.salesman ||
    firstItem?.employeeName ||
    firstItem?.salesmanName ||
    firstItem?.salesPerson ||
    firstItem?.salespersonName ||
    firstItem?.empName ||
    firstItem?.name ||
    invoice?.employeeName ||
    invoice?.salesmanName ||
    invoice?.salesman ||
    invoice?.salesPerson ||
    invoice?.salespersonName ||
    invoice?.empName ||
    payload?.data?.employeeName ||
    payload?.data?.salesmanName ||
    payload?.data?.salesman ||
    payload?.data?.salesPerson ||
    payload?.data?.salespersonName ||
    payload?.data?.empName ||
    payload?.employeeName ||
    payload?.salesmanName ||
    payload?.salesman ||
    payload?.salesPerson ||
    payload?.salespersonName ||
    payload?.empName ||
    payload?.name ||
    null;
  const rawComm = payload?.commissionAmount || payload?.data?.commissionAmount;
  const commissionAmount = rawComm !== undefined && rawComm !== null ? parseFloat(String(rawComm)) : null;

  return {
    billId: billId ? String(billId) : null,
    invoiceNumber: invoiceNumber ? String(invoiceNumber) : null,
    amount,
    eventType: String(eventType),
    customerName: customerName ? String(customerName) : null,
    customerPhone: customerPhone ? String(customerPhone) : null,
    paymentMode: paymentMode ? String(paymentMode) : null,
    branchName: branchName ? String(branchName) : null,
    storeName: storeName ? String(storeName) : null,
    storeId,
    invoice,
    lineItems,
    firstItem,
    employeeIdentifier: employeeIdentifier ? String(employeeIdentifier) : null,
    employeeName: employeeName ? String(employeeName) : null,
    commissionAmount: commissionAmount && !isNaN(commissionAmount) ? commissionAmount : null,
    eventId: eventId ? String(eventId) : null,
    salesmen,
  };
}

/**
 * Fetches full HopKid invoice details from external HopKid API if webhook payload is sparse/event-only
 */
export async function fetchHopkidInvoiceDetails(identifier: string): Promise<any | null> {
  if (!identifier) return null;
  try {
    const { getIntegrationSettings } = await import('./configService');
    const { hopkidApiUrl, hopkidApiKey } = await getIntegrationSettings();
    const baseUrl = hopkidApiUrl.replace(/\/Employee\/.*$/i, '');

    const endpoints = [
      `${baseUrl}/Sales/GetInvoiceDetail`,
      `${baseUrl}/Sales/GetSalesDetail`,
      `${baseUrl}/Sales/GetSalesList`,
    ];

    for (const endpoint of endpoints) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'x-api-key': hopkidApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              InvoiceNo: identifier,
              BillId: identifier,
              EventId: identifier,
              SalesID: identifier,
            }),
          });

          if (response.ok) {
            const json = (await response.json()) as any;
            if (json && (json.data || json.invoice || json.lineItems)) {
              console.log(`✅ [fetchHopkidInvoiceDetails] Successfully fetched full invoice for ${identifier} from ${endpoint}`);
              return json.data || json;
            }
          }
        } catch (attemptErr) {
          console.warn(`⚠️ [fetchHopkidInvoiceDetails] Attempt ${attempt} failed for ${endpoint}:`, attemptErr);
        }
        await new Promise((r) => setTimeout(r, attempt * 400));
      }
    }
  } catch (err) {
    console.error('❌ [fetchHopkidInvoiceDetails] Error fetching invoice from HopKid API:', err);
  }
  return null;
}

export function isEligibleCommissionEmployee(emp: any): boolean {
  if (!emp) return true;

  // Must not be MANUAL source
  const source = String(emp.source || 'HOPKID').toUpperCase();
  if (source === 'MANUAL') return false;

  return true;
}

export interface CommissionSummaryStats {
  today: {
    commission: number;
    sales: number;
    transactions: number;
  };
  month: {
    commission: number;
    sales: number;
    transactions: number;
  };
  pending: {
    commission: number;
    transactions: number;
  };
  paid: {
    commission: number;
    transactions: number;
  };
  lifetime: {
    commission: number;
    sales: number;
    transactions: number;
  };
  topPerformers: Array<{
    employee: any;
    totalCommission: number;
    totalSales: number;
  }>;
}

export async function getCommissionStats(params?: {
  employeeId?: number | null;
  storeId?: number | null;
  startDate?: Date | string;
  endDate?: Date | string;
}): Promise<CommissionSummaryStats> {
  const whereClause: any = {};
  if (params?.employeeId && params.employeeId !== -1) {
    whereClause.employeeId = params.employeeId;
  }
  if (params?.storeId && !isNaN(params.storeId) && params.storeId > 0) {
    whereClause.storeId = params.storeId;
  }

  if (params?.startDate || params?.endDate) {
    whereClause.createdAt = {};
    if (params.startDate) {
      const startOf = safeParseDate(params.startDate);
      startOf.setHours(0, 0, 0, 0);
      whereClause.createdAt.gte = startOf;
    }
    if (params.endDate) {
      const endOf = safeParseDate(params.endDate);
      endOf.setHours(23, 59, 59, 999);
      whereClause.createdAt.lte = endOf;
    }
  }

  // Filter for valid active/approved/paid/pending commission transactions
  whereClause.status = { in: ['PENDING', 'APPROVED', 'PAID'] };

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
    orderBy: [{ id: 'desc' }, { createdAt: 'desc' }],
  });

  const allTransactions = rawTransactions.filter((t) => isEligibleCommissionEmployee(t.employee));

  const now = new Date();
  // Convert UTC time to IST (UTC+5:30)
  const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istTime);

  const year = istDate.getUTCFullYear();
  const month = istDate.getUTCMonth();
  const dateVal = istDate.getUTCDate();

  // todayStart in UTC corresponding to 00:00:00.000 IST today
  const todayStart = new Date(Date.UTC(year, month, dateVal) - 5.5 * 60 * 60 * 1000);
  // todayEnd in UTC corresponding to 23:59:59.999 IST today
  const todayEnd = new Date(Date.UTC(year, month, dateVal, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
  // monthStart in UTC corresponding to 00:00:00.000 IST 1st of month
  const monthStart = new Date(Date.UTC(year, month, 1) - 5.5 * 60 * 60 * 1000);

  const todayTxns = allTransactions.filter(
    (t) => new Date(t.createdAt) >= todayStart && new Date(t.createdAt) <= todayEnd
  );
  // If dateRange filter was explicitly provided, allTransactions is the filtered set; otherwise filter by current month
  const monthTxns = (params?.startDate || params?.endDate)
    ? allTransactions
    : allTransactions.filter((t) => new Date(t.createdAt) >= monthStart);

  const pendingTxns = allTransactions.filter(
    (t) => t.status === 'PENDING' || t.status === 'APPROVED'
  );
  const paidTxns = allTransactions.filter((t) => t.status === 'PAID');

  const todayComm = todayTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0);
  const todaySales = todayTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netSales, 0);

  const monthComm = monthTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0);
  const monthSales = monthTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netSales, 0);

  const pendingComm = pendingTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0);
  const paidComm = paidTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0);

  const lifetimeComm = allTransactions.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0);
  const lifetimeSales = allTransactions.reduce((sum, t) => sum + getTransactionNetContribution(t).netSales, 0);

  // Group top performers from the active transaction set using net contribution (accounting for deltas)
  const performerMap = new Map<number, { employee: any; totalCommission: number; totalSales: number }>();

  monthTxns.forEach((t) => {
    if (!t.employee) return;
    const empId = t.employeeId;
    const { netSales, netCommission } = getTransactionNetContribution(t);
    const existing = performerMap.get(empId);
    if (existing) {
      existing.totalCommission += netCommission;
      existing.totalSales += netSales;
    } else {
      performerMap.set(empId, {
        employee: t.employee,
        totalCommission: netCommission,
        totalSales: netSales,
      });
    }
  });

  const topPerformers = Array.from(performerMap.values())
    .map(p => ({
      ...p,
      totalCommission: Math.round(p.totalCommission * 100) / 100,
      totalSales: Math.round(p.totalSales * 100) / 100,
    }))
    .filter((p) => p.totalSales > 0 || p.totalCommission > 0)
    .sort((a, b) => (b.totalCommission - a.totalCommission) || (b.totalSales - a.totalSales))
    .slice(0, 10);

  console.log(`[Commission Dashboard]\nFilters:\nstartDate: ${params?.startDate || 'none'}\nendDate: ${params?.endDate || 'none'}\nstoreId: ${params?.storeId || 'all'}\nemployeeId: ${params?.employeeId || 'all'}`);
  console.log(`[Commission Dashboard]\nTransactions found: ${monthTxns.length}\nTop performers found: ${topPerformers.length}\nTotal sales: ₹${Math.round(monthSales * 100) / 100}\nTotal commission: ₹${Math.round(monthComm * 100) / 100}`);

  return {
    today: {
      commission: Math.round(todayComm * 100) / 100,
      sales: Math.round(todaySales * 100) / 100,
      transactions: todayTxns.length,
    },
    month: {
      commission: Math.round(monthComm * 100) / 100,
      sales: Math.round(monthSales * 100) / 100,
      transactions: monthTxns.length,
    },
    pending: {
      commission: Math.round(pendingComm * 100) / 100,
      transactions: pendingTxns.length,
    },
    paid: {
      commission: Math.round(paidComm * 100) / 100,
      transactions: paidTxns.length,
    },
    lifetime: {
      commission: Math.round(lifetimeComm * 100) / 100,
      sales: Math.round(lifetimeSales * 100) / 100,
      transactions: allTransactions.length,
    },
    topPerformers,
  };
}

/**
 * Updates an Employee's Wallet balance and records a WalletTransaction for commission credit/debit.
 */
export async function updateEmployeeWalletCommission(
  employeeId: number,
  amount: number,
  isCredit: boolean,
  description: string,
  title: string = isCredit ? 'Commission Earned' : 'Commission Reversed'
): Promise<void> {
  const roundedAmount = Math.round(amount * 100) / 100;
  if (roundedAmount <= 0) return;

  try {
    let wallet = await prisma.wallet.findUnique({
      where: { employeeId }
    });

    if (!wallet) {
      const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
      const empCode = emp?.employeeCode || String(employeeId);
      wallet = await prisma.wallet.create({
        data: {
          employeeId,
          availableBalance: 0,
          advanceLimit: 25000,
          pendingClaims: 0,
          cardNumber: `QB-${empCode.replace(/\D/g, '')}-XXXX`,
          isActive: true
        }
      });
    }

    const currentBalance = wallet.availableBalance || 0;
    const newBalance = isCredit
      ? currentBalance + roundedAmount
      : Math.max(0, currentBalance - roundedAmount);

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: newBalance }
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        title,
        category: 'Commission',
        amount: roundedAmount,
        date: new Date(),
        status: 'COMPLETED',
        isCredit,
        description
      }
    });

    console.log(`[Wallet] ✅ Employee ${employeeId} wallet updated: ${isCredit ? '+' : '-'}₹${roundedAmount}. New Balance: ₹${newBalance}`);
  } catch (err: any) {
    console.error(`[Wallet Error] ❌ Failed to update wallet for Employee ${employeeId}:`, err.message);
  }
}

/**
 * Emits real-time WebSocket updates for employee commission, dashboard, and reports.
 */
export async function broadcastCommissionEvent(employeeId: number, eventData: any): Promise<void> {
  try {
    const { getWebSocketInstance } = require('./websocketSingleton');
    const ws = getWebSocketInstance();
    if (ws) {
      console.log(`[WebSocket] Broadcasting event for Employee ID ${employeeId}`);
      if (typeof ws.broadcastCommissionUpdate === 'function') {
        await ws.broadcastCommissionUpdate(employeeId, eventData);
      } else if (ws.getServer()) {
        ws.getServer().to(`employee_${employeeId}`).emit('commissionUpdate', eventData);
      }
    }
  } catch (err: any) {
    console.error('[WebSocket Error] Broadcast failed:', err.message);
  }
}

/**
 * Normalizes event type strings to canonical uppercase format:
 * INVOICE_CREATED, INVOICE_UPDATED, CREDIT_NOTE_CREATED, CREDIT_NOTE_UPDATED,
 * SALES_EXCHANGE_CREATED, SALES_EXCHANGE_UPDATED, EMPLOYEE_CREATED, EMPLOYEE_UPDATED, EMPLOYEE_DELETED
 */
export function normalizeEventType(rawType?: string | null, routeDefault: string = 'INVOICE_CREATED', payload?: any): string {
  if (rawType && typeof rawType === 'string' && rawType.trim()) {
    const s = rawType.trim().toLowerCase().replace(/[\.\-]/g, '_');
    if (s.includes('credit') && (s.includes('update') || s.includes('cancel') || s.includes('reverse'))) return 'CREDIT_NOTE_UPDATED';
    if (s.includes('credit') && (s.includes('create') || s.includes('add'))) return 'CREDIT_NOTE_CREATED';
    if (s.includes('credit')) return 'CREDIT_NOTE_CREATED';

    if (s.includes('exchange') && (s.includes('update') || s.includes('cancel') || s.includes('reverse'))) return 'SALES_EXCHANGE_UPDATED';
    if (s.includes('exchange') && (s.includes('create') || s.includes('add'))) return 'SALES_EXCHANGE_CREATED';
    if (s.includes('exchange')) return 'SALES_EXCHANGE_CREATED';

    if (s.includes('invoice') && s.includes('update')) return 'INVOICE_UPDATED';
    if (s.includes('invoice') && s.includes('create')) return 'INVOICE_CREATED';

    if (s.includes('employee') && s.includes('delete')) return 'EMPLOYEE_DELETED';
    if (s.includes('employee') && s.includes('update')) return 'EMPLOYEE_UPDATED';
    if (s.includes('employee') && (s.includes('create') || s.includes('add'))) return 'EMPLOYEE_CREATED';

    return rawType.toUpperCase().replace(/[\.\-]/g, '_');
  }

  if (payload) {
    const dataStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const lowerStr = dataStr.toLowerCase();
    if (lowerStr.includes('creditnote') || lowerStr.includes('credit_note')) {
      if (lowerStr.includes('cancel') || lowerStr.includes('update') || lowerStr.includes('reverse')) return 'CREDIT_NOTE_UPDATED';
      return 'CREDIT_NOTE_CREATED';
    }
    if (lowerStr.includes('salesexchange') || lowerStr.includes('sales_exchange') || lowerStr.includes('exchangeno')) {
      if (lowerStr.includes('cancel') || lowerStr.includes('update') || lowerStr.includes('reverse')) return 'SALES_EXCHANGE_UPDATED';
      return 'SALES_EXCHANGE_CREATED';
    }
  }

  return routeDefault;
}

/**
 * Creates an explicit WebhookLog entry in DB with authoritative event type.
 */
export async function createWebhookLog(data: {
  eventType: string;
  status: string;
  payload: any;
  billId?: string | null;
  eventId?: string | null;
  amount?: number | null;
  employeeId?: number | null;
  errorMessage?: string | null;
}): Promise<any> {
  try {
    const normalizedType = normalizeEventType(data.eventType, 'INVOICE_CREATED', data.payload);
    const payloadStr = typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload);
    const meta = extractWebhookMeta(data.payload);
    const resolvedEventId = data.eventId || meta.eventId || null;

    const log = await prisma.webhookLog.create({
      data: {
        eventType: normalizedType,
        status: data.status || 'SUCCESS',
        payload: payloadStr,
        billId: data.billId || meta.billId || null,
        eventId: resolvedEventId ? String(resolvedEventId) : null,
        amount: data.amount !== undefined && data.amount !== null ? Number(data.amount) : (meta.amount || null),
        employeeId: data.employeeId || null,
        errorMessage: data.errorMessage || null,
        processedAt: new Date(),
      },
    });
    console.log(`[WEBHOOK LOG] ✅ Recorded Log ID ${log.id} | EventType: ${normalizedType} | Status: ${log.status} | EventId: ${log.eventId || 'N/A'}`);
    return log;
  } catch (err: any) {
    console.error('[WEBHOOK LOG] ❌ Failed to record log:', err.message);
    return null;
  }
}

/**
 * Resolves a clean integer invoice / bill number for mobile UI and API responses.
 * Reuses numeric billId or invoiceNumber if present; otherwise derives a sequential integer (1000 + id).
 * Example: 89, 93, 1001, 1002...
 */
export function getNumericInvoiceNumber(item: {
  id?: number | string | null;
  invoiceNumber?: string | number | null;
  billId?: string | number | null;
  billNumber?: number | null;
}): number {
  if (item.billNumber && typeof item.billNumber === 'number' && item.billNumber > 0) {
    return item.billNumber;
  }
  if (item.billId !== null && item.billId !== undefined) {
    if (typeof item.billId === 'number' && item.billId > 0 && item.billId <= 2147483647) {
      return item.billId;
    }
    const str = String(item.billId).trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    if (!isUuid) {
      const digits = str.replace(/\D/g, '');
      if (digits.length > 0 && digits.length <= 9) {
        const num = parseInt(digits, 10);
        if (num > 0 && num <= 2147483647) return num;
      }
    }
  }
  if (item.invoiceNumber !== null && item.invoiceNumber !== undefined) {
    if (typeof item.invoiceNumber === 'number' && item.invoiceNumber > 0 && item.invoiceNumber <= 2147483647) {
      return item.invoiceNumber;
    }
    const str = String(item.invoiceNumber).trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    if (!isUuid) {
      const digits = str.replace(/\D/g, '');
      if (digits.length > 0 && digits.length <= 9) {
        const num = parseInt(digits, 10);
        if (num > 0 && num <= 2147483647) return num;
      }
    }
  }

  // Deterministic fallback based on autoincrement ID (starts at 1000 + id)
  let idNum = 1;
  if (typeof item.id === 'number' && Number.isSafeInteger(item.id)) {
    idNum = item.id;
  } else if (item.id) {
    const rawId = String(item.id);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
    if (isUuid) {
      idNum = (parseInt(rawId.replace(/-/g, '').slice(0, 6), 16) % 9000) + 1;
    } else {
      const digits = rawId.replace(/\D/g, '').slice(0, 6);
      idNum = digits ? parseInt(digits, 10) : 1;
    }
  }
  return 1000 + (idNum > 0 ? idNum : 1);
}

/**
 * Calculates commission for standard created invoice.
 * commission = (saleAmount * rate) / 100
 */
export function calculateCommissionAmount(saleAmount: number, rate: number): number {
  if (!saleAmount || !rate || isNaN(saleAmount) || isNaN(rate)) return 0;
  return Math.round(((Math.abs(saleAmount) * rate) / 100) * 100) / 100;
}

/**
 * Calculates commission breakdown for invoice update.
 * Old commission = (oldAmount * rate) / 100
 * New commission = (newAmount * rate) / 100
 * Total commission earned = Old commission + New commission
 */
export function calculateInvoiceUpdateCommission(
  oldAmount: number,
  newAmount: number,
  rate: number
): {
  oldCommission: number;
  newCommission: number;
  totalCommission: number;
  commissionDifference: number;
} {
  const safeRate = isNaN(rate) ? 0 : rate;
  const oldComm = Math.round(((Math.abs(oldAmount || 0) * safeRate) / 100) * 100) / 100;
  const newComm = Math.round(((Math.abs(newAmount || 0) * safeRate) / 100) * 100) / 100;
  const totalCommission = Math.round((oldComm + newComm) * 100) / 100;
  const commissionDifference = Math.round((newComm - oldComm) * 100) / 100;
  return {
    oldCommission: oldComm,
    newCommission: newComm,
    totalCommission,
    commissionDifference,
  };
}

