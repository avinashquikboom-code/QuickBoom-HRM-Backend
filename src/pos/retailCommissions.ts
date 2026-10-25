import { Prisma } from "@prisma/client";
import { prisma } from "../utils/db";
import { Actor, DEFAULT_ROLE_POS_PERMISSIONS, permission, scope, storeFilter } from "./auth";
import { resolveUserEmployee, cashierName as employeeDisplayName } from "./cashierIdentity";
import { dateRange, ensure, keys, object, text, uuid } from "./validation";
import { refundAllocation, round } from "./finance";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

export function retailAmount(revenue: Prisma.Decimal, rate: Prisma.Decimal, type: string, quantity: number, fixedBasis: string) {
  return round(type === "PERCENTAGE" ? revenue.mul(rate).div(100) : rate.mul(fixedBasis === "UNIT" ? quantity : 1));
}

export async function accrueRetailCommission(tx: Tx, _actor: Actor, saleId: string) {
  const sale = await tx.pOSSale.findUniqueOrThrow({ where: { id: saleId }, include: {
    items: { include: { variant: { include: { product: { include: { category: true } } } } } },
  } });
  if (sale.status !== "COMPLETED") return;
  const config = await tx.pOSConfiguration.findUnique({ where: { storeId: sale.storeId } });
  if (!config?.commissionEnabled) return;
  ensure(["NET_EX_TAX", "NET_INCL_TAX"].includes(config.commissionBasis ?? ""), "Commission basis must be configured", 409);
  ensure(["UNIT", "LINE"].includes(config.fixedCommissionBasis ?? ""), "Fixed commission basis must be configured", 409);
  for (const item of sale.items) {
    const category = item.variant?.product.category;
    // Only the exact assigned child category qualifies; never inherit a parent/employee rate.
    const subcategory = category?.parentId ? category : null;
    const exclusionReason = !subcategory ? "NO_SUBCATEGORY" : subcategory.commissionRate == null || !subcategory.commissionType ? "NO_CONFIGURED_RATE" : null;
    const revenue = config.commissionBasis === "NET_INCL_TAX" ? item.lineTotal : item.lineTotal.minus(item.taxTotal);
    const amount = exclusionReason ? new D(0) : retailAmount(revenue, subcategory!.commissionRate!, subcategory!.commissionType!, item.quantity, config.fixedCommissionBasis!);
    const employeeId = item.salespersonId ?? sale.salespersonId ?? null;
    await tx.pOSRetailCommission.upsert({ where: { saleItemId: item.id }, update: { employeeId }, create: {
      saleItemId: item.id, saleId, storeId: sale.storeId, employeeId, invoiceNumber: sale.invoiceNo,
      subcategoryId: subcategory?.id, subcategoryName: subcategory?.name,
      commissionType: subcategory?.commissionType, rate: subcategory?.commissionRate,
      basis: config.commissionBasis!, fixedBasis: config.fixedCommissionBasis!,
      quantity: item.quantity, eligibleRevenue: exclusionReason ? new D(0) : revenue,
      amount, exclusionReason, createdAt: sale.createdAt,
    } });
  }
}

// Set cumulative original-value reversals, making retries harmless and preserving rounding on a full return.
export async function reverseRetailCommission(tx: Tx, returnId: string, items: { id: string; returnedQuantity: number }[]) {
  for (const item of items) {
    const line = await tx.pOSRetailCommission.findUnique({ where: { saleItemId: item.id } });
    if (!line || line.status !== "ACTIVE") continue;
    const reversedAmount = refundAllocation(line.amount, line.quantity, 0, item.returnedQuantity);
    const reversedRevenue = refundAllocation(line.eligibleRevenue, line.quantity, 0, item.returnedQuantity);
    if (reversedAmount.gt(line.reversedAmount)) await tx.pOSRetailCommissionAdjustment.upsert({
      where: { eventKey: `RETURN-${returnId}-${item.id}` }, update: {}, create: {
        eventKey: `RETURN-${returnId}-${item.id}`, saleId: line.saleId, saleItemId: item.id, storeId: line.storeId,
        amount: reversedAmount.minus(line.reversedAmount).negated(), eligibleRevenue: reversedRevenue.minus(line.reversedRevenue).negated(), reason: "RETURN",
      },
    });
    await tx.pOSRetailCommission.update({ where: { id: line.id }, data: {
      returnedQuantity: item.returnedQuantity,
      reversedAmount: refundAllocation(line.amount, line.quantity, 0, item.returnedQuantity),
      reversedRevenue: refundAllocation(line.eligibleRevenue, line.quantity, 0, item.returnedQuantity),
    } });
  }
}
export async function closeRetailCommission(tx: Tx, saleId: string, status: "CANCELLED" | "DELETED") {
  const lines = await tx.pOSRetailCommission.findMany({ where: { saleId } });
  for (const line of lines) {
    if (line.amount.gt(line.reversedAmount)) await tx.pOSRetailCommissionAdjustment.upsert({
      where: { eventKey: `${status}-${line.saleItemId}` }, update: {}, create: {
        eventKey: `${status}-${line.saleItemId}`, saleId, saleItemId: line.saleItemId, storeId: line.storeId,
        amount: line.amount.minus(line.reversedAmount).negated(), eligibleRevenue: line.eligibleRevenue.minus(line.reversedRevenue).negated(), reason: status,
      },
    });
    await tx.pOSRetailCommission.update({ where: { id: line.id }, data: {
      status, reversedAmount: line.amount, reversedRevenue: line.eligibleRevenue, returnedQuantity: line.quantity,
    } });
  }
}

export async function configureSubcategoryCommission(actor: Actor, id: string, raw: unknown) {
  permission(actor, "configure");
  ensure(actor.admin && !actor.isPosStoreSession, "Only administrators can configure global subcategory rates", 403);
  const b = object(raw); keys(b, ["commissionType", "commissionRate"]);
  const clear = b.commissionType === null && b.commissionRate === null;
  ensure(clear || ["PERCENTAGE", "FIXED"].includes(b.commissionType), "Choose PERCENTAGE or FIXED, or clear both fields");
  ensure(clear || (typeof b.commissionRate === "number" && Number.isFinite(b.commissionRate) && b.commissionRate >= 0 && b.commissionRate <= (b.commissionType === "PERCENTAGE" ? 100 : 99999999999.9999) && Math.abs(b.commissionRate * 10000 - Math.round(b.commissionRate * 10000)) < 0.001), "Invalid commission rate (maximum four decimal places)");
  return prisma.$transaction(async tx => {
    const category = await tx.pOSCategory.findUnique({ where: { id: uuid(id) } });
    ensure(category?.parentId, "Commission requires an existing subcategory with a parent", 400);
    const updated = await tx.pOSCategory.update({ where: { id }, data: {
      commissionType: clear ? null : b.commissionType, commissionRate: clear ? null : new D(b.commissionRate),
    } });
    await tx.pOSAuditLog.create({ data: { userId: actor.userId, action: "SUBCATEGORY_COMMISSION_CONFIGURED", entityId: id,
      metadata: { previousType: category.commissionType, previousRate: category.commissionRate?.toString() ?? null, commissionType: updated.commissionType, commissionRate: updated.commissionRate?.toString() ?? null } } });
    return updated;
  });
}

export function parseFlexibleDateRange(query: Record<string, any>) {
  const from = query.from || query.startDate;
  const to = query.to || query.endDate;
  const period = query.period || query.dateRange;

  const now = new Date(Date.now() + 19800000); // IST
  const todayStr = now.toISOString().slice(0, 10);

  if (period === "today") {
    const gte = new Date(`${todayStr}T00:00:00+05:30`);
    const lt = new Date(`${todayStr}T23:59:59.999+05:30`);
    return { gte, lt, displayFrom: todayStr, displayTo: todayStr };
  }

  if (period === "yesterday") {
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    const gte = new Date(`${yesterday}T00:00:00+05:30`);
    const lt = new Date(`${yesterday}T23:59:59.999+05:30`);
    return { gte, lt, displayFrom: yesterday, displayTo: yesterday };
  }

  if (period === "week") {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const gte = new Date(`${sevenDaysAgo}T00:00:00+05:30`);
    const lt = new Date(`${todayStr}T23:59:59.999+05:30`);
    return { gte, lt, displayFrom: sevenDaysAgo, displayTo: todayStr };
  }

  if (period === "month" || period === "current_month") {
    const monthStart = `${todayStr.slice(0, 7)}-01`;
    const gte = new Date(`${monthStart}T00:00:00+05:30`);
    const lt = new Date(`${todayStr}T23:59:59.999+05:30`);
    return { gte, lt, displayFrom: monthStart, displayTo: todayStr };
  }

  if (period === "all" || (!from && !to && !period)) {
    const gte = new Date("2020-01-01T00:00:00+05:30");
    const lt = new Date("2099-12-31T23:59:59+05:30");
    return { gte, lt, displayFrom: "2020-01-01", displayTo: todayStr };
  }

  const fStr = typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : "2020-01-01";
  const tStr = typeof to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : todayStr;
  let gte = new Date(`${fStr}T00:00:00+05:30`);
  let lt = new Date(new Date(`${tStr}T00:00:00+05:30`).getTime() + 86400000);

  if (isNaN(gte.getTime())) {
    gte = new Date("2020-01-01T00:00:00+05:30");
  }
  if (isNaN(lt.getTime())) {
    lt = new Date("2099-12-31T23:59:59+05:30");
  }
  if (gte.getTime() > lt.getTime()) {
    const tmp = gte;
    gte = lt;
    lt = tmp;
  }
  return { gte, lt, displayFrom: fStr, displayTo: tStr };
}

export async function resolveActorFromRequest(req: any): Promise<Actor> {
  if (req.actor) return req.actor;
  const user = req.user || {};
  const userId = Number(user.id || user.userId);
  let dbUser: any = null;
  let employee: any = null;
  let store: any = null;

  if (Number.isSafeInteger(userId) && userId > 0) {
    dbUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          include: { store: true },
        },
        profile: true,
        userPermission: true,
      },
    });
  }

  const role = String(dbUser?.role || user.role || "EMPLOYEE").toUpperCase();
  const isAdmin = ["SUPER_ADMIN", "ADMIN", "SUPERADMIN", "PLATFORM_ADMIN", "HR"].includes(role);

  if (dbUser) {
    employee = dbUser.employee ?? (await resolveUserEmployee(dbUser));
    if (employee && !employee.store && employee.storeId) {
      store = await prisma.store.findUnique({ where: { id: employee.storeId } });
    } else if (employee?.store) {
      store = employee.store;
    }
  }

  const defaultRolePerms = DEFAULT_ROLE_POS_PERMISSIONS[role] ?? {};
  const defaults = await prisma.rolePermission.findUnique({
    where: { role: (dbUser?.role || role) as any },
  }).catch(() => null);

  const actor: Actor = {
    userId: dbUser?.id || userId || 1,
    role,
    employeeId: employee?.id ?? user.employeeId,
    cashierName: dbUser ? employeeDisplayName({ employee, profile: dbUser.profile }) : undefined,
    employee: employee
      ? {
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          employeeCode: employee.employeeCode,
        }
      : undefined,
    storeId: employee?.storeId ?? user.storeId,
    storeName: store?.name ?? user.storeName,
    storeCode: store?.code ?? user.storeCode,
    storeIsActive: store ? Boolean(store.isActive) : (user.storeIsActive ?? undefined),
    admin: isAdmin,
    isPosStoreSession: Boolean(user.isPosStoreSession),
    permissions: {
      "pos.read": true,
      "pos.reports": true,
      "pos.configure": isAdmin,
      "pos.commissionApprove": isAdmin,
      ...(isAdmin ? { "pos.allStores": true, "pos.manageStores": true } : {}),
      ...defaultRolePerms,
      ...((defaults?.permissions ?? {}) as object),
      ...((dbUser?.userPermission?.permissions ?? {}) as object),
      ...(user.permissions || {}),
    },
  };

  req.actor = actor;
  return actor;
}

export async function retailCommissionReport(actor: Actor, query: Record<string, any>) {
  permission(actor, "reports");
  const storeId = storeFilter(actor, query.storeId);
  const rawSubcat = typeof query.subcategoryId === "string" ? query.subcategoryId.trim() : null;
  const subcategoryId = rawSubcat && rawSubcat !== "all" && UUID_REGEX.test(rawSubcat) ? rawSubcat : null;
  const search = query.search ? `%${String(query.search).trim()}%` : null;
  const range = parseFlexibleDateRange(query);

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT c."storeId", st.name AS store, c."subcategoryId", c."subcategoryName", c."commissionType", c.rate,
      c.basis, c."fixedBasis", c."exclusionReason",
      SUM(c."eligibleRevenue" - c."reversedRevenue") AS "eligibleRevenue",
      SUM(c.amount - c."reversedAmount") AS "commissionAmount",
      SUM(CASE WHEN c."exclusionReason" IS NULL THEN c.quantity - c."returnedQuantity" ELSE 0 END)::int AS "eligibleItems",
      COUNT(DISTINCT CASE WHEN c."exclusionReason" IS NULL AND c.quantity > c."returnedQuantity" THEN c."saleId" END)::int AS transactions
    FROM "POSRetailCommission" c JOIN "Store" st ON st.id=c."storeId"
    WHERE c.status='ACTIVE'
      AND c."createdAt" >= ${range.gte} AND c."createdAt" < ${range.lt}
      AND (${storeId ?? null}::int IS NULL OR c."storeId" = ${storeId ?? null}::int)
      AND (${subcategoryId ?? null}::uuid IS NULL OR c."subcategoryId" = ${subcategoryId ?? null}::uuid)
      AND (${search ?? null}::text IS NULL OR st.name ILIKE ${search} OR c."subcategoryName" ILIKE ${search} OR c."invoiceNumber" ILIKE ${search})
    GROUP BY c."storeId",st.name,c."subcategoryId",c."subcategoryName",c."commissionType",c.rate,c.basis,c."fixedBasis",c."exclusionReason"
    ORDER BY st.name,c."subcategoryName",c.rate`);

  const totals = rows.reduce(
    (sum, r) => ({
      eligibleRevenue: sum.eligibleRevenue.plus(r.eligibleRevenue || 0),
      commissionAmount: sum.commissionAmount.plus(r.commissionAmount || 0),
      eligibleItems: sum.eligibleItems + Number(r.eligibleItems || 0),
      transactions: sum.transactions + Number(r.transactions || 0),
    }),
    { eligibleRevenue: new D(0), commissionAmount: new D(0), eligibleItems: 0, transactions: 0 }
  );

  const storeTotals = new Map<number, { storeId: number; store: string; eligibleRevenue: Prisma.Decimal; commissionAmount: Prisma.Decimal; eligibleItems: number; transactions: number }>();
  for (const row of rows) {
    const total = storeTotals.get(row.storeId) ?? { storeId: row.storeId, store: row.store, eligibleRevenue: new D(0), commissionAmount: new D(0), eligibleItems: 0, transactions: 0 };
    total.eligibleRevenue = total.eligibleRevenue.plus(row.eligibleRevenue || 0);
    total.commissionAmount = total.commissionAmount.plus(row.commissionAmount || 0);
    total.eligibleItems += Number(row.eligibleItems || 0);
    total.transactions += Number(row.transactions || 0);
    storeTotals.set(row.storeId, total);
  }

  return {
    success: true,
    items: rows.map(r => ({
      ...r,
      eligibleRevenue: Number(r.eligibleRevenue || 0),
      commissionAmount: Number(r.commissionAmount || 0),
      rate: r.rate ? Number(r.rate) : null,
      eligibleItems: Number(r.eligibleItems || 0),
      transactions: Number(r.transactions || 0),
    })),
    total: rows.length,
    totals: {
      eligibleRevenue: totals.eligibleRevenue.toNumber(),
      commissionAmount: totals.commissionAmount.toNumber(),
      eligibleItems: totals.eligibleItems,
      transactions: totals.transactions,
    },
    storeTotals: [...storeTotals.values()].map(s => ({
      ...s,
      eligibleRevenue: s.eligibleRevenue.toNumber(),
      commissionAmount: s.commissionAmount.toNumber(),
    })),
    range,
    missingRateRule: "ZERO_WITH_EXCLUSION_REASON",
  };
}

export async function retailCommissionTransactions(actor: Actor, query: Record<string, any>) {
  permission(actor, "reports");
  const storeId = storeFilter(actor, query.storeId);
  const rawSubcat = typeof query.subcategoryId === "string" ? query.subcategoryId.trim() : null;
  const subcategoryId = rawSubcat && rawSubcat !== "all" && UUID_REGEX.test(rawSubcat) ? rawSubcat : null;
  const status = query.status && query.status !== "ALL" ? query.status : "ACTIVE";
  const search = query.search ? `%${String(query.search).trim()}%` : null;
  const range = parseFlexibleDateRange(query);

  const rawPage = parseInt(String(query.page || 1), 10);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawPageSize = parseInt(String(query.pageSize || 20), 10);
  const pageSize = Number.isSafeInteger(rawPageSize) && rawPageSize > 0 ? Math.min(100, rawPageSize) : 20;
  const offset = (page - 1) * pageSize;

  const countRows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT COUNT(*)::int AS total_count,
           COALESCE(SUM(c."eligibleRevenue" - c."reversedRevenue"), 0) AS total_revenue,
           COALESCE(SUM(c.amount - c."reversedAmount"), 0) AS total_commission
    FROM "POSRetailCommission" c JOIN "Store" st ON st.id=c."storeId"
    WHERE (${status} = 'ALL' OR c.status = ${status})
      AND c."createdAt" >= ${range.gte} AND c."createdAt" < ${range.lt}
      AND (${storeId ?? null}::int IS NULL OR c."storeId" = ${storeId ?? null}::int)
      AND (${subcategoryId ?? null}::uuid IS NULL OR c."subcategoryId" = ${subcategoryId ?? null}::uuid)
      AND (${search ?? null}::text IS NULL OR st.name ILIKE ${search} OR c."subcategoryName" ILIKE ${search} OR c."invoiceNumber" ILIKE ${search})
  `);

  const totalCount = countRows[0]?.total_count ?? 0;
  const totalRevenue = Number(countRows[0]?.total_revenue ?? 0);
  const totalCommission = Number(countRows[0]?.total_commission ?? 0);

  const transactions = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT c.id, c."saleItemId", c."saleId", c."storeId", st.name AS "storeName",
           c."invoiceNumber", c."subcategoryId", c."subcategoryName",
           c."commissionType", c.rate, c.basis, c."fixedBasis",
           c.quantity, c."returnedQuantity",
           (c."eligibleRevenue" - c."reversedRevenue") AS "netSales",
           (c.amount - c."reversedAmount") AS "commissionAmount",
           c."exclusionReason", c.status, c."createdAt"
    FROM "POSRetailCommission" c JOIN "Store" st ON st.id=c."storeId"
    WHERE (${status} = 'ALL' OR c.status = ${status})
      AND c."createdAt" >= ${range.gte} AND c."createdAt" < ${range.lt}
      AND (${storeId ?? null}::int IS NULL OR c."storeId" = ${storeId ?? null}::int)
      AND (${subcategoryId ?? null}::uuid IS NULL OR c."subcategoryId" = ${subcategoryId ?? null}::uuid)
      AND (${search ?? null}::text IS NULL OR st.name ILIKE ${search} OR c."subcategoryName" ILIKE ${search} OR c."invoiceNumber" ILIKE ${search})
    ORDER BY c."createdAt" DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  return {
    success: true,
    transactions: transactions.map(t => ({
      ...t,
      netSales: Number(t.netSales || 0),
      commissionAmount: Number(t.commissionAmount || 0),
      rate: t.rate ? Number(t.rate) : null,
    })),
    pagination: {
      page,
      pageSize,
      total: totalCount,
      totalPages: Math.ceil(totalCount / pageSize) || 1,
    },
    totals: {
      netSales: totalRevenue,
      commissionAmount: totalCommission,
      totalTransactions: totalCount,
    },
    range,
  };
}

export async function retailCommissionDashboard(actor: Actor, query: Record<string, any>) {
  permission(actor, "reports");
  const storeId = storeFilter(actor, query.storeId);
  const rawSubcat = typeof query.subcategoryId === "string" ? query.subcategoryId.trim() : null;
  const subcategoryId = rawSubcat && rawSubcat !== "all" && UUID_REGEX.test(rawSubcat) ? rawSubcat : null;
  const search = query.search ? `%${String(query.search).trim()}%` : null;
  const range = parseFlexibleDateRange(query);

  const now = new Date(Date.now() + 19800000);
  const todayStr = now.toISOString().slice(0, 10);
  const todayGte = new Date(`${todayStr}T00:00:00+05:30`);
  const todayLt = new Date(`${todayStr}T23:59:59.999+05:30`);

  const monthStartStr = `${todayStr.slice(0, 7)}-01`;
  const monthGte = new Date(`${monthStartStr}T00:00:00+05:30`);

  // Today metrics
  const todayRows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT COALESCE(SUM(c.amount - c."reversedAmount"), 0) AS commission,
           COALESCE(SUM(c."eligibleRevenue" - c."reversedRevenue"), 0) AS sales,
           COUNT(DISTINCT c."saleId")::int AS transactions
    FROM "POSRetailCommission" c
    WHERE c.status='ACTIVE' AND c."createdAt" >= ${todayGte} AND c."createdAt" <= ${todayLt}
      AND (${storeId ?? null}::int IS NULL OR c."storeId"=${storeId ?? null}::int)
      AND (${subcategoryId ?? null}::uuid IS NULL OR c."subcategoryId"=${subcategoryId ?? null}::uuid)
  `);

  // Month metrics
  const monthRows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT COALESCE(SUM(c.amount - c."reversedAmount"), 0) AS commission,
           COALESCE(SUM(c."eligibleRevenue" - c."reversedRevenue"), 0) AS sales,
           COUNT(DISTINCT c."saleId")::int AS transactions
    FROM "POSRetailCommission" c
    WHERE c.status='ACTIVE' AND c."createdAt" >= ${monthGte} AND c."createdAt" <= ${todayLt}
      AND (${storeId ?? null}::int IS NULL OR c."storeId"=${storeId ?? null}::int)
      AND (${subcategoryId ?? null}::uuid IS NULL OR c."subcategoryId"=${subcategoryId ?? null}::uuid)
  `);

  // Filtered period metrics
  const periodRows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT COALESCE(SUM(c.amount - c."reversedAmount"), 0) AS commission,
           COALESCE(SUM(c."eligibleRevenue" - c."reversedRevenue"), 0) AS sales,
           COUNT(DISTINCT c."saleId")::int AS transactions
    FROM "POSRetailCommission" c JOIN "Store" st ON st.id=c."storeId"
    WHERE c.status='ACTIVE' AND c."createdAt" >= ${range.gte} AND c."createdAt" < ${range.lt}
      AND (${storeId ?? null}::int IS NULL OR c."storeId"=${storeId ?? null}::int)
      AND (${subcategoryId ?? null}::uuid IS NULL OR c."subcategoryId"=${subcategoryId ?? null}::uuid)
      AND (${search ?? null}::text IS NULL OR st.name ILIKE ${search} OR c."subcategoryName" ILIKE ${search} OR c."invoiceNumber" ILIKE ${search})
  `);

  // Top performing subcategories
  const topSubcategories = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT c."subcategoryId",
           COALESCE(c."subcategoryName", 'Uncategorized') AS "subcategoryName",
           c."commissionType",
           c.rate,
           COALESCE(SUM(c."eligibleRevenue" - c."reversedRevenue"), 0) AS sales,
           COALESCE(SUM(c.amount - c."reversedAmount"), 0) AS commission,
           COUNT(DISTINCT c."saleId")::int AS transactions,
           SUM(CASE WHEN c."exclusionReason" IS NULL THEN c.quantity - c."returnedQuantity" ELSE 0 END)::int AS "eligibleItems"
    FROM "POSRetailCommission" c JOIN "Store" st ON st.id=c."storeId"
    WHERE c.status='ACTIVE' AND c."createdAt" >= ${range.gte} AND c."createdAt" < ${range.lt}
      AND (${storeId ?? null}::int IS NULL OR c."storeId"=${storeId ?? null}::int)
      AND (${subcategoryId ?? null}::uuid IS NULL OR c."subcategoryId"=${subcategoryId ?? null}::uuid)
      AND (${search ?? null}::text IS NULL OR st.name ILIKE ${search} OR c."subcategoryName" ILIKE ${search} OR c."invoiceNumber" ILIKE ${search})
    GROUP BY c."subcategoryId", c."subcategoryName", c."commissionType", c.rate
    ORDER BY commission DESC, sales DESC
    LIMIT 6
  `);

  // Recent transactions (10 rows)
  const recentTransactions = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT c.id, c."saleItemId", c."saleId", c."storeId", st.name AS "storeName",
           c."invoiceNumber", c."subcategoryId", c."subcategoryName",
           c."commissionType", c.rate, c.basis,
           c.quantity,
           (c."eligibleRevenue" - c."reversedRevenue") AS "netSales",
           (c.amount - c."reversedAmount") AS "commissionAmount",
           c."exclusionReason", c.status, c."createdAt"
    FROM "POSRetailCommission" c JOIN "Store" st ON st.id=c."storeId"
    WHERE c.status='ACTIVE' AND c."createdAt" >= ${range.gte} AND c."createdAt" < ${range.lt}
      AND (${storeId ?? null}::int IS NULL OR c."storeId"=${storeId ?? null}::int)
      AND (${subcategoryId ?? null}::uuid IS NULL OR c."subcategoryId"=${subcategoryId ?? null}::uuid)
      AND (${search ?? null}::text IS NULL OR st.name ILIKE ${search} OR c."subcategoryName" ILIKE ${search} OR c."invoiceNumber" ILIKE ${search})
    ORDER BY c."createdAt" DESC
    LIMIT 10
  `);

  return {
    success: true,
    stats: {
      today: {
        commission: Number(todayRows[0]?.commission ?? 0),
        sales: Number(todayRows[0]?.sales ?? 0),
        transactions: Number(todayRows[0]?.transactions ?? 0),
      },
      month: {
        commission: Number(monthRows[0]?.commission ?? 0),
        sales: Number(monthRows[0]?.sales ?? 0),
        transactions: Number(monthRows[0]?.transactions ?? 0),
      },
      period: {
        commission: Number(periodRows[0]?.commission ?? 0),
        sales: Number(periodRows[0]?.sales ?? 0),
        transactions: Number(periodRows[0]?.transactions ?? 0),
      },
      topSubcategories: topSubcategories.map(s => ({
        subcategoryId: s.subcategoryId,
        subcategoryName: s.subcategoryName,
        commissionType: s.commissionType,
        rate: s.rate ? Number(s.rate) : null,
        sales: Number(s.sales || 0),
        commission: Number(s.commission || 0),
        transactions: Number(s.transactions || 0),
        eligibleItems: Number(s.eligibleItems || 0),
      })),
      recentTransactions: recentTransactions.map(t => ({
        ...t,
        netSales: Number(t.netSales || 0),
        commissionAmount: Number(t.commissionAmount || 0),
        rate: t.rate ? Number(t.rate) : null,
      })),
    },
    range,
  };
}

export async function listSubcategories(actor: Actor) {
  permission(actor, "reports");
  const subcategories = await prisma.pOSCategory.findMany({
    where: { parentId: { not: null } },
    include: { parent: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  return {
    success: true,
    subcategories: subcategories.map(s => ({
      id: s.id,
      name: s.name,
      parentId: s.parentId,
      parentName: s.parent?.name,
      commissionType: s.commissionType,
      commissionRate: s.commissionRate ? Number(s.commissionRate) : null,
    })),
  };
}

export async function syncRetailCommissionsFromSales(actor: Actor, query?: { fromDate?: string; toDate?: string }) {
  permission(actor, "configure");
  const range = parseFlexibleDateRange(query || {});
  const sales = await prisma.pOSSale.findMany({
    where: {
      status: "COMPLETED",
      createdAt: { gte: range.gte, lt: range.lt },
    },
    select: { id: true },
  });

  let synced = 0;
  for (const s of sales) {
    await prisma.$transaction(async tx => {
      await accrueRetailCommission(tx, actor, s.id);
    });
    synced++;
  }

  const totalCommissions = await prisma.pOSRetailCommission.count();
  return {
    success: true,
    message: `Successfully synchronized ${synced} sales into retail commission snapshots`,
    result: { synced, skipped: 0, errors: 0, totalCommissions },
  };
}

export async function retailAdjustments(actor: Actor, query: Record<string, any>) {
  permission(actor, "reports");
  const range = parseFlexibleDateRange(query);
  return prisma.pOSRetailCommissionAdjustment.findMany({ where: {
    storeId: storeFilter(actor, query.storeId), createdAt: { gte: range.gte, lt: range.lt },
  }, orderBy: { createdAt: "desc" }, take: 500 });
}

export async function reviewRetailAdjustment(actor: Actor, id: string, raw: unknown) {
  permission(actor, "commissionApprove");
  const b = object(raw); keys(b, ["decision", "reason"]);
  ensure(["APPROVED", "REJECTED"].includes(b.decision), "Invalid decision");
  const reason = text(b.reason, "review reason", 1000);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "POSRetailCommissionAdjustment" WHERE id=${uuid(id)}::uuid FOR UPDATE`;
    const row = await tx.pOSRetailCommissionAdjustment.findUnique({ where: { id } });
    ensure(row, "Retail commission adjustment not found", 404); scope(actor, row.storeId);
    ensure(row.status === "PENDING", "Adjustment already reviewed", 409);
    const updated = await tx.pOSRetailCommissionAdjustment.update({ where: { id }, data: {
      status: b.decision, reviewedAt: new Date(), reviewedBy: actor.userId, reviewReason: reason,
    } });
    await tx.pOSAuditLog.create({ data: { userId: actor.userId, action: "RETAIL_COMMISSION_ADJUSTMENT_REVIEWED", entityId: id, metadata: { decision: b.decision, reason } } });
    return updated;
  });
}

/**
 * Mobile: Subcategory-wise commission summary for a specific employee
 */
export async function getEmployeeRetailCommissionSummary(employeeId: number, query: Record<string, any> = {}) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, firstName: true, lastName: true, employeeCode: true, storeId: true, commissionPercentage: true }
  });

  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth();
  const date = istNow.getUTCDate();

  // Day range
  const todayStart = new Date(Date.UTC(year, month, date, 0, 0, 0, 0) - istOffset);
  const todayEnd = new Date(Date.UTC(year, month, date, 23, 59, 59, 999) - istOffset);

  // Week range (Monday to Sunday)
  const dayOfWeek = istNow.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(Date.UTC(year, month, date - diffToMonday, 0, 0, 0, 0) - istOffset);
  const sunday = new Date(Date.UTC(year, month, date - diffToMonday + 6, 23, 59, 59, 999) - istOffset);

  // Month range
  const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - istOffset);
  const nextMonthStart = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - istOffset);
  const monthEnd = new Date(nextMonthStart.getTime() - 1);

  // Lifetime range
  const epoch = new Date(0);
  const farFuture = new Date(Date.UTC(2100, 0, 1));

  // Determine active query range
  const selectedPeriod = query.period || "current_month";
  let activeStart = monthStart;
  let activeEnd = monthEnd;

  if (selectedPeriod === "today") {
    activeStart = todayStart;
    activeEnd = todayEnd;
  } else if (selectedPeriod === "this_week" || selectedPeriod === "week") {
    activeStart = monday;
    activeEnd = sunday;
  } else if (selectedPeriod === "all" || selectedPeriod === "all_time") {
    activeStart = epoch;
    activeEnd = farFuture;
  } else if (query.from || query.to) {
    const custom = parseFlexibleDateRange(query);
    activeStart = custom.gte;
    activeEnd = custom.lt;
  }

  // Check if employee has direct records
  const directCount = await prisma.pOSRetailCommission.count({
    where: { employeeId: employeeId, status: "ACTIVE" }
  });
  const useStoreFallback = directCount === 0 && Boolean(employee?.storeId);
  const targetStoreId = useStoreFallback ? employee!.storeId! : null;

  async function queryMetrics(start: Date, end: Date) {
    const rows = await prisma.$queryRaw<Array<{ commission: number; sales: number; transactions: number; units: number }>>`
      SELECT 
        COALESCE(SUM(c.amount - c."reversedAmount"), 0)::float AS commission,
        COALESCE(SUM(c."eligibleRevenue" - c."reversedRevenue"), 0)::float AS sales,
        COUNT(DISTINCT c."saleId")::int AS transactions,
        COALESCE(SUM(CASE WHEN c."exclusionReason" IS NULL THEN c.quantity - c."returnedQuantity" ELSE 0 END), 0)::int AS units
      FROM "POSRetailCommission" c
      WHERE c.status = 'ACTIVE'
        AND c."createdAt" >= ${start} AND c."createdAt" <= ${end}
        AND (
          c."employeeId" = ${employeeId}
          OR (${useStoreFallback} AND c."employeeId" IS NULL AND c."storeId" = ${targetStoreId})
        )
    `;
    return rows[0] || { commission: 0, sales: 0, transactions: 0, units: 0 };
  }

  const [todayM, weekM, monthM, lifetimeM, subcategories, latest] = await Promise.all([
    queryMetrics(todayStart, todayEnd),
    queryMetrics(monday, sunday),
    queryMetrics(monthStart, monthEnd),
    queryMetrics(epoch, farFuture),
    prisma.$queryRaw<Array<{
      subcategoryId: string | null;
      subcategoryName: string;
      commissionType: string | null;
      rate: number | null;
      eligibleSales: number;
      commissionEarned: number;
      unitsSold: number;
      billCount: number;
    }>>`
      SELECT 
        c."subcategoryId",
        COALESCE(c."subcategoryName", 'General Retail') AS "subcategoryName",
        c."commissionType",
        c.rate::float AS rate,
        COALESCE(SUM(c."eligibleRevenue" - c."reversedRevenue"), 0)::float AS "eligibleSales",
        COALESCE(SUM(c.amount - c."reversedAmount"), 0)::float AS "commissionEarned",
        COALESCE(SUM(CASE WHEN c."exclusionReason" IS NULL THEN c.quantity - c."returnedQuantity" ELSE 0 END), 0)::int AS "unitsSold",
        COUNT(DISTINCT c."saleId")::int AS "billCount"
      FROM "POSRetailCommission" c
      WHERE c.status = 'ACTIVE'
        AND c."createdAt" >= ${activeStart} AND c."createdAt" <= ${activeEnd}
        AND (
          c."employeeId" = ${employeeId}
          OR (${useStoreFallback} AND c."employeeId" IS NULL AND c."storeId" = ${targetStoreId})
        )
      GROUP BY c."subcategoryId", c."subcategoryName", c."commissionType", c.rate
      ORDER BY "commissionEarned" DESC, "eligibleSales" DESC
    `,
    prisma.pOSRetailCommission.findFirst({
      where: {
        status: "ACTIVE",
        OR: [
          { employeeId },
          ...(useStoreFallback ? [{ storeId: targetStoreId!, employeeId: null }] : []),
        ]
      },
      orderBy: { createdAt: "desc" },
    })
  ]);

  const monthName = istNow.toLocaleString("en-US", { month: "long" });

  return {
    today: {
      date: `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`,
      totalSales: todayM.sales,
      netSales: todayM.sales,
      totalCommission: todayM.commission,
      commission: todayM.commission,
      billCount: todayM.transactions,
      unitsSold: todayM.units,
      label: "Today's Performance",
    },
    thisWeek: {
      from: monday.toISOString().slice(0, 10),
      to: sunday.toISOString().slice(0, 10),
      totalSales: weekM.sales,
      netSales: weekM.sales,
      totalCommission: weekM.commission,
      commission: weekM.commission,
      billCount: weekM.transactions,
      unitsSold: weekM.units,
      label: "This Week's Performance",
    },
    thisMonth: {
      month: `${year}-${String(month + 1).padStart(2, '0')}`,
      monthName,
      year: String(year),
      totalSales: monthM.sales,
      netSales: monthM.sales,
      totalCommission: monthM.commission,
      commission: monthM.commission,
      billCount: monthM.transactions,
      unitsSold: monthM.units,
      label: "This Month's Performance",
    },
    lifetime: {
      totalSales: lifetimeM.sales,
      totalCommission: lifetimeM.commission,
      billCount: lifetimeM.transactions,
      unitsSold: lifetimeM.units,
      label: "All Time",
    },
    subcategories: subcategories.map(s => ({
      subcategoryId: s.subcategoryId,
      subcategoryName: s.subcategoryName,
      commissionType: s.commissionType || "PERCENTAGE",
      commissionRate: s.rate !== null ? Number(s.rate) : 0,
      eligibleSales: Number(s.eligibleSales || 0),
      commissionEarned: Number(s.commissionEarned || 0),
      unitsSold: Number(s.unitsSold || 0),
      billCount: Number(s.billCount || 0),
    })),
    latestSale: latest ? {
      billId: latest.saleId,
      invoiceNumber: latest.invoiceNumber,
      date: latest.createdAt.toISOString().slice(0, 10),
      displayDate: latest.createdAt.toLocaleDateString("en-IN"),
      displayTime: latest.createdAt.toLocaleTimeString("en-IN"),
      netAmount: Number(latest.eligibleRevenue),
      commission: Number(latest.amount),
      commissionRate: latest.rate !== null ? Number(latest.rate) : 0,
      subcategoryName: latest.subcategoryName || "General Retail",
    } : null,
  };
}

/**
 * Mobile: Subcategory-wise bills history for a specific employee
 */
export async function getEmployeeRetailCommissionBills(
  employeeId: number,
  query: { period?: string; billId?: string; from?: string; to?: string; limit?: number; offset?: number } = {}
) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, storeId: true }
  });

  const range = parseFlexibleDateRange(query);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const offset = Math.max(0, Number(query.offset) || 0);

  const directCount = await prisma.pOSRetailCommission.count({
    where: { employeeId: employeeId, status: "ACTIVE" }
  });
  const useStoreFallback = directCount === 0 && Boolean(employee?.storeId);
  const targetStoreId = useStoreFallback ? employee!.storeId! : null;

  const isUuid = (val: unknown): val is string =>
    typeof val === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

  const andClauses: Prisma.POSRetailCommissionWhereInput[] = [
    {
      status: { in: ["ACTIVE", "COMPLETED", "PAID"] },
      createdAt: { gte: range.gte, lt: range.lt },
      OR: [
        { employeeId },
        ...(useStoreFallback ? [{ storeId: targetStoreId!, employeeId: null }] : []),
      ],
    },
  ];

  if (query.billId) {
    const billFilter: Prisma.POSRetailCommissionWhereInput[] = [
      { invoiceNumber: { contains: query.billId, mode: "insensitive" } },
    ];
    if (isUuid(query.billId)) {
      billFilter.push({ saleId: query.billId });
    }
    andClauses.push({ OR: billFilter });
  }

  const whereClause: Prisma.POSRetailCommissionWhereInput = {
    AND: andClauses,
  };

  const lines = await prisma.pOSRetailCommission.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const billsMap = new Map<string, {
    id: string;
    saleId: string;
    invoiceNumber: string;
    saleAmount: number;
    commission: number;
    date: Date;
    status: string;
    storeId: number;
    subcategories: Array<{
      subcategoryId: string | null;
      subcategoryName: string;
      rate: number;
      quantity: number;
      saleAmount: number;
      commissionAmount: number;
    }>;
  }>();

  for (const line of lines) {
    const netSale = Number(line.eligibleRevenue) - Number(line.reversedRevenue);
    const netComm = Number(line.amount) - Number(line.reversedAmount);
    const lineRate = line.rate !== null ? Number(line.rate) : 0;

    if (!billsMap.has(line.saleId)) {
      billsMap.set(line.saleId, {
        id: line.saleId,
        saleId: line.saleId,
        invoiceNumber: line.invoiceNumber,
        saleAmount: netSale,
        commission: netComm,
        date: line.createdAt,
        status: line.status,
        storeId: line.storeId,
        subcategories: [{
          subcategoryId: line.subcategoryId,
          subcategoryName: line.subcategoryName || "General Retail",
          rate: lineRate,
          quantity: line.quantity - line.returnedQuantity,
          saleAmount: netSale,
          commissionAmount: netComm,
        }],
      });
    } else {
      const b = billsMap.get(line.saleId)!;
      b.saleAmount += netSale;
      b.commission += netComm;
      b.subcategories.push({
        subcategoryId: line.subcategoryId,
        subcategoryName: line.subcategoryName || "General Retail",
        rate: lineRate,
        quantity: line.quantity - line.returnedQuantity,
        saleAmount: netSale,
        commissionAmount: netComm,
      });
    }
  }

  const allBills = Array.from(billsMap.values());
  const paginatedBills = allBills.slice(offset, offset + limit);

  return {
    bills: paginatedBills.map(b => {
      const parsedNumber = parseInt(b.invoiceNumber.replace(/\D/g, ""), 10) || 1;
      const effectiveRate = b.saleAmount > 0 ? (b.commission / b.saleAmount) * 100 : 0;
      return {
        id: b.saleId,
        billId: parsedNumber,
        invoiceNumber: b.invoiceNumber,
        saleAmount: Math.round(b.saleAmount * 100) / 100,
        commission: Math.round(b.commission * 100) / 100,
        commissionRate: Math.round(effectiveRate * 100) / 100,
        date: b.date.toISOString(),
        status: b.status,
        storeName: `Store #${b.storeId}`,
        products: b.subcategories.map(s => ({
          name: s.subcategoryName,
          quantity: s.quantity,
          price: s.saleAmount,
          rate: s.rate,
          commission: s.commissionAmount,
          category: s.subcategoryName,
        })),
        subcategories: b.subcategories,
      };
    }),
    pagination: {
      limit,
      offset,
      total: allBills.length,
      hasMore: offset + limit < allBills.length,
    },
  };
}

/**
 * Mobile: Detailed subcategory-wise lines for a specific bill
 */
export async function getEmployeeRetailCommissionBillDetail(employeeId: number, billId: string) {
  // Resolve numeric billId (e.g. CommissionTransaction.id = 38) to invoiceNumber via CommissionTransaction
  let resolvedInvoiceNumber: string | null = null;
  let resolvedSaleId: string | null = null;
  if (/^\d+$/.test(billId)) {
    const txn = await prisma.commissionTransaction.findFirst({
      where: {
        OR: [
          { id: parseInt(billId, 10) },
          { billId: billId },
        ],
        employeeId,
      },
      select: { invoiceNumber: true, billId: true },
    });
    if (txn) {
      resolvedInvoiceNumber = txn.invoiceNumber || null;
      // CommissionTransaction.billId is like "POSSALE-<uuid>"; extract the UUID part
      const saleUuid = txn.billId?.replace(/^POSSALE-/i, '') || null;
      resolvedSaleId = saleUuid && /^[0-9a-f-]{36}$/i.test(saleUuid) ? saleUuid : null;
    }
  }

  const isUuid = (val: unknown): val is string =>
    typeof val === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

  const orClauses: Prisma.POSRetailCommissionWhereInput[] = [
    { invoiceNumber: billId },
  ];
  if (/^\d+$/.test(billId)) {
    orClauses.push({ invoiceNumber: `HWM-${billId}` });
    orClauses.push({ invoiceNumber: `POS-${billId.padStart(10, '0')}` });
  }
  if (isUuid(billId)) {
    orClauses.push({ saleId: billId });
  }
  if (billId.startsWith('POSSALE-')) {
    const rawUuid = billId.slice(8);
    if (isUuid(rawUuid)) {
      orClauses.push({ saleId: rawUuid });
    }
  }
  if (resolvedInvoiceNumber) {
    orClauses.push({ invoiceNumber: resolvedInvoiceNumber });
  }
  if (resolvedSaleId && isUuid(resolvedSaleId)) {
    orClauses.push({ saleId: resolvedSaleId });
  }

  const lines = await prisma.pOSRetailCommission.findMany({
    where: {
      OR: orClauses,
      status: { not: "DELETED" },
    },
    orderBy: { createdAt: "desc" },
  });

  if (lines.length === 0) {
    return null;
  }

  const first = lines[0];
  const totalSale = lines.reduce((s, l) => s + (Number(l.eligibleRevenue) - Number(l.reversedRevenue)), 0);
  const totalComm = lines.reduce((s, l) => s + (Number(l.amount) - Number(l.reversedAmount)), 0);
  const effRate = totalSale > 0 ? (totalComm / totalSale) * 100 : 0;
  const parsedBillId = parseInt(first.invoiceNumber.replace(/\D/g, ""), 10) || 1;

  const store = await prisma.store.findUnique({ where: { id: first.storeId } });
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });

  // Build subcategory-wise product commission breakdown for the mobile invoice detail screen.
  // When rate is null it means no commission is configured for that subcategory — expose a
  // configurationNote instead of silently showing 0%.
  const productCommissionBreakdown = lines.map(l => ({
    productName: l.subcategoryName || "General Retail",
    category: l.subcategoryName,
    subcategoryId: l.subcategoryId,
    quantity: Number(l.quantity) - Number(l.returnedQuantity),
    saleAmount: Number(l.eligibleRevenue) - Number(l.reversedRevenue),
    commissionRate: l.rate !== null ? Number(l.rate) : 0,
    commissionAmount: Number(l.amount) - Number(l.reversedAmount),
    commissionType: l.commissionType || "PERCENTAGE",
    // Explicitly flag when no rate is configured so the UI can show a meaningful message
    configurationNote: l.rate === null
      ? "No commission rate configured for this subcategory"
      : undefined,
  }));

  return {
    billId: parsedBillId,
    invoiceNumber: first.invoiceNumber,
    saleAmount: Math.round(totalSale * 100) / 100,
    grossSale: Math.round(totalSale * 100) / 100,
    commissionRate: Math.round(effRate * 100) / 100,
    commissionAmount: Math.round(totalComm * 100) / 100,
    oldAmount: 0,
    newAmount: Math.round(totalSale * 100) / 100,
    oldCommission: 0,
    newCommission: Math.round(totalComm * 100) / 100,
    totalCommission: Math.round(totalComm * 100) / 100,
    date: first.createdAt.toISOString(),
    status: first.status,
    description: `Subcategory Commission - ${lines.map(l => l.subcategoryName).filter(Boolean).join(", ")}`,
    createdAt: first.createdAt.toISOString(),
    storeName: store?.name || `Store #${first.storeId}`,
    customerName: null as string | null,
    customerPhone: null as string | null,
    paymentMode: null as string | null,
    discount: 0,
    tax: 0,
    employee: {
      id: employee?.id || employeeId,
      name: employee ? `${employee.firstName} ${employee.lastName}` : "Sales Staff",
      code: employee?.employeeCode || `EMP-${employeeId}`,
      designation: employee?.designation || "Sales Staff",
    },
    store: {
      id: store?.id || first.storeId,
      name: store?.name || `Store #${first.storeId}`,
      code: store?.code || "",
    },
    // products array with fields compatible with both ProductItem and ProductCommissionLine models
    products: lines.map(l => ({
      name: l.subcategoryName || "General Retail",
      productName: l.subcategoryName || "General Retail",
      category: l.subcategoryName,
      quantity: Number(l.quantity) - Number(l.returnedQuantity),
      price: Number(l.eligibleRevenue) - Number(l.reversedRevenue),
      total: Number(l.eligibleRevenue) - Number(l.reversedRevenue),
      saleAmount: Number(l.eligibleRevenue) - Number(l.reversedRevenue),
      commissionRate: l.rate !== null ? Number(l.rate) : 0,
      commissionAmount: Number(l.amount) - Number(l.reversedAmount),
    })),
    productCommissionBreakdown,
    subcategories: lines.map(l => ({
      subcategoryId: l.subcategoryId,
      subcategoryName: l.subcategoryName || "General Retail",
      commissionRate: l.rate !== null ? Number(l.rate) : 0,
      commissionType: l.commissionType || "PERCENTAGE",
      eligibleSales: Number(l.eligibleRevenue) - Number(l.reversedRevenue),
      commissionEarned: Number(l.amount) - Number(l.reversedAmount),
      quantity: Number(l.quantity) - Number(l.returnedQuantity),
    })),
  };
}
