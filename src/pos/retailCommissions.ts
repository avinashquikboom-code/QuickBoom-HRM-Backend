import { Prisma } from "@prisma/client";
import { prisma } from "../utils/db";
import { Actor, permission, scope, storeFilter } from "./auth";
import { dateRange, ensure, keys, object, text, uuid } from "./validation";
import { refundAllocation, round } from "./finance";
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
    await tx.pOSRetailCommission.upsert({ where: { saleItemId: item.id }, update: {}, create: {
      saleItemId: item.id, saleId, storeId: sale.storeId, invoiceNumber: sale.invoiceNo,
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
  const gte = new Date(`${fStr}T00:00:00+05:30`);
  const lt = new Date(new Date(`${tStr}T00:00:00+05:30`).getTime() + 86400000);
  return { gte, lt, displayFrom: fStr, displayTo: tStr };
}

export function resolveActorFromRequest(req: any): Actor {
  if (req.actor) return req.actor;
  const user = req.user || {};
  const role = user.role || "ADMIN";
  const isAdmin = ["SUPER_ADMIN", "ADMIN", "SUPERADMIN", "PLATFORM_ADMIN"].includes(role);
  return {
    userId: user.id || user.userId || 1,
    role,
    employeeId: user.employeeId,
    storeId: user.storeId,
    admin: isAdmin,
    isPosStoreSession: false,
    permissions: {
      "pos.read": true,
      "pos.reports": true,
      "pos.configure": isAdmin,
      "pos.commissionApprove": isAdmin,
      ...(user.permissions || {}),
    },
  };
}

export async function retailCommissionReport(actor: Actor, query: Record<string, any>) {
  permission(actor, "reports");
  const storeId = storeFilter(actor, query.storeId);
  const subcategoryId = query.subcategoryId && query.subcategoryId !== "all" ? query.subcategoryId : null;
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
  const subcategoryId = query.subcategoryId && query.subcategoryId !== "all" ? query.subcategoryId : null;
  const status = query.status && query.status !== "ALL" ? query.status : "ACTIVE";
  const search = query.search ? `%${String(query.search).trim()}%` : null;
  const range = parseFlexibleDateRange(query);

  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
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
  const subcategoryId = query.subcategoryId && query.subcategoryId !== "all" ? query.subcategoryId : null;
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

