import { prisma } from './db';

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
  const parsedInt = parseInt(str, 10);
  if (!isNaN(parsedInt)) {
    const byPk = await prisma.employee.findUnique({ where: { id: parsedInt } });
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
  const byName = await prisma.employee.findFirst({
    where: {
      OR: [
        { firstName: { equals: str, mode: 'insensitive' } },
        { lastName: { equals: str, mode: 'insensitive' } },
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
    firstItem?.productNetAmount ??
    firstItem?.netAmount ??
    firstItem?.amount ??
    invoice.netAmount ??
    invoice.totalAmount ??
    invoice.grandTotal ??
    payload?.data?.netAmount ??
    payload?.data?.totalAmount ??
    payload?.data?.grandTotal ??
    payload?.data?.amount ??
    payload?.data?.saleAmount ??
    payload?.amount ??
    payload?.saleAmount ??
    payload?.totalAmount ??
    payload?.grandTotal ??
    payload?.netAmount;

  const parsedAmount = rawAmount !== undefined && rawAmount !== null ? parseFloat(String(rawAmount)) : 0;
  const amount = isNaN(parsedAmount) ? 0 : parsedAmount;

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
    firstItem?.code ||
    firstItem?.empCode ||
    firstItem?.hopkidCode ||
    firstItem?.employeePhoneNo ||
    firstItem?.employeeContactNo ||
    firstItem?.mobileNo ||
    firstItem?.mobileNumber ||
    firstItem?.phone ||
    firstItem?.phoneNumber ||
    firstItem?.employeeName ||
    firstItem?.name ||
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
    orderBy: { createdAt: 'desc' },
  });

  const allTransactions = rawTransactions.filter((t) => isEligibleCommissionEmployee(t.employee));

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

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
