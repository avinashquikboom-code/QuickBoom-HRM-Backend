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

  if (str.includes('Z') || str.includes('+')) {
    // Has explicit timezone info — parse as-is
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
  } else if (str.includes('T')) {
    // DateTime WITHOUT timezone (e.g. HopKid: "2026-08-12T14:30:00")
    const [datePart, timePart] = str.split('T');
    const dateParts = datePart.split('-');
    const timeParts = (timePart || '12:00:00').split(':');
    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const day = parseInt(dateParts[2], 10);
    const hour = parseInt(timeParts[0], 10) || 0;
    const min = parseInt(timeParts[1], 10) || 0;
    const sec = parseInt((timeParts[2] || '0').split('.')[0], 10) || 0;
    const utcMs = Date.UTC(year, month, day, hour, min, sec) - 5.5 * 60 * 60 * 1000;
    const d = new Date(utcMs);
    if (!isNaN(d.getTime())) return d;
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
      };
    }
  }

  const invoice = payload?.data?.invoice || payload?.invoice || {};
  const lineItems = Array.isArray(payload?.data?.lineItems)
    ? payload.data.lineItems
    : Array.isArray(payload?.lineItems)
    ? payload.lineItems
    : [];
  const firstItem = lineItems[0] || {};

  const eventId = payload?.eventId || payload?.id || payload?.data?.eventId || null;

  const billId =
    invoice.invoiceNo ||
    invoice.billId ||
    invoice.billNo ||
    invoice.invoiceNumber ||
    payload?.data?.invoiceNo ||
    payload?.invoiceNo ||
    payload?.data?.billId ||
    payload?.billId ||
    payload?.data?.billNo ||
    payload?.billNo ||
    payload?.data?.invoiceNumber ||
    payload?.invoiceNumber ||
    firstItem?.invoiceNo ||
    firstItem?.billId ||
    firstItem?.billNo ||
    eventId ||
    null;

  const invoiceNumber = invoice.invoiceNumber || invoice.invoiceNo || billId || null;

  const rawAmount =
    invoice.netAmount ??
    invoice.totalAmount ??
    invoice.grandTotal ??
    payload?.data?.invoice?.netAmount ??
    payload?.data?.invoice?.totalAmount ??
    payload?.data?.netAmount ??
    payload?.data?.totalAmount ??
    payload?.data?.grandTotal ??
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

  const amount = safeParseAmount(rawAmount);

  const eventType = payload?.eventType || payload?.topic || payload?.event || 'INVOICE_CREATED';

  const customerName =
    payload?.customerName ||
    payload?.data?.customerName ||
    invoice.customerName ||
    invoice.customer ||
    firstItem?.customerName ||
    payload?.name ||
    null;

  const customerPhone =
    payload?.customerPhone ||
    payload?.data?.customerPhone ||
    invoice.customerPhone ||
    firstItem?.customerPhone ||
    null;

  const paymentMode =
    payload?.paymentMode ||
    payload?.data?.paymentMode ||
    invoice.paymentMode ||
    invoice.paymentType ||
    null;

  const branchName =
    invoice.branchName ||
    payload?.branchName ||
    payload?.data?.branchName ||
    firstItem?.branchName ||
    null;

  const storeName =
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

  const storeIdParsed = invoice.storeId ? parseInt(String(invoice.storeId), 10) : (payload?.storeId ? parseInt(String(payload.storeId), 10) : null);
  const storeId = isNaN(storeIdParsed as number) ? null : storeIdParsed;

  const employeeIdentifier =
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
    firstItem?.employeeName ||
    firstItem?.salesmanName ||
    firstItem?.salesman ||
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
  if (!emp) return false;

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
  startDate?: Date;
  endDate?: Date;
}): Promise<CommissionSummaryStats> {
  const whereClause: any = {};
  if (params?.employeeId) {
    whereClause.employeeId = params.employeeId;
  }
  if (params?.storeId) {
    whereClause.storeId = params.storeId;
  }

  if (params?.startDate || params?.endDate) {
    whereClause.createdAt = {};
    if (params.startDate) {
      const startOf = new Date(params.startDate);
      startOf.setHours(0, 0, 0, 0);
      whereClause.createdAt.gte = startOf;
    }
    if (params.endDate) {
      const endOf = new Date(params.endDate);
      endOf.setHours(23, 59, 59, 999);
      whereClause.createdAt.lte = endOf;
    }
  }

  // Filter out rejected or cancelled transactions
  whereClause.status = { in: ['PENDING', 'APPROVED', 'PAID'] };
  whereClause.employee = {
    source: { not: 'MANUAL' },
  };

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
    orderBy: { id: 'desc' },
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
  const monthTxns = allTransactions.filter((t) => new Date(t.createdAt) >= monthStart);
  const pendingTxns = allTransactions.filter(
    (t) => t.status === 'PENDING' || t.status === 'APPROVED'
  );
  const paidTxns = allTransactions.filter((t) => t.status === 'PAID');

  const todayComm = todayTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);
  const todaySales = todayTxns.reduce((sum, t) => sum + (t.saleAmount || 0), 0);

  const monthComm = monthTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);
  const monthSales = monthTxns.reduce((sum, t) => sum + (t.saleAmount || 0), 0);

  const pendingComm = pendingTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);
  const paidComm = paidTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);

  const lifetimeComm = allTransactions.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);
  const lifetimeSales = allTransactions.reduce((sum, t) => sum + (t.saleAmount || 0), 0);

  // Group top performers — seed all active HopKid employees
  const performerMap = new Map<number, { employee: any; totalCommission: number; totalSales: number }>();
  
  const rawActiveEmps = await prisma.employee.findMany({
    where: {
      status: 'active',
      source: { not: 'MANUAL' },
      ...(params?.storeId ? { storeId: params.storeId } : {}),
    },
    select: {
      id: true,
      employeeID: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      designation: true,
      source: true,
      commissionPercentage: true,
      status: true,
      store: { select: { id: true, name: true } },
      user: { select: { role: true } },
    },
  });

  const activeEmps = rawActiveEmps.filter(isEligibleCommissionEmployee);

  activeEmps.forEach((emp) => {
    performerMap.set(emp.id, {
      employee: emp,
      totalCommission: 0,
      totalSales: 0,
    });
  });

  allTransactions.forEach((t) => {
    if (!t.employee) return;
    const empId = t.employeeId;
    const existing = performerMap.get(empId);
    if (existing) {
      existing.totalCommission += t.commissionAmount || 0;
      existing.totalSales += t.saleAmount || 0;
    } else {
      performerMap.set(empId, {
        employee: t.employee,
        totalCommission: t.commissionAmount || 0,
        totalSales: t.saleAmount || 0,
      });
    }
  });

  const topPerformers = Array.from(performerMap.values())
    .sort((a, b) => (b.totalCommission - a.totalCommission) || (b.totalSales - a.totalSales))
    .slice(0, 10);

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

