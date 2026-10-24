import { recognizedSaleWhere, recognizedSaleSQL } from "./salesAccounting";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/db";
import { Actor, permission, storeFilter } from "./auth";
import { dateRange, page, ensure } from "./validation";
export async function report(actor: Actor, query: Record<string, any>) {
  permission(actor, "reports");
  const storeId = storeFilter(actor, query.storeId),
    range = dateRange(query),
    pagination = page(query);
  const filter = Prisma.sql`${recognizedSaleSQL} AND (${storeId ?? null}::integer IS NULL OR s."storeId" = ${storeId ?? null}::integer)`;
  const period = Prisma.sql`s."createdAt" >= ${range.gte} AND s."createdAt" < ${range.lt}`;
  // Aggregations run in one consistent database snapshot. Refunds are attributed to their posting date.
  return prisma.$transaction(
    async (tx) => {
      const sales = await tx.pOSSale.aggregate({
        where: { ...recognizedSaleWhere, storeId, createdAt: range },
        _sum: {
          subtotal: true,
          discountTotal: true,
          taxTotal: true,
          grandTotal: true,
        },
        _count: true,
      });
      const returns = await tx.pOSReturn.aggregate({
        where: { sale: { ...recognizedSaleWhere, storeId }, createdAt: range },
        _sum: { refundAmount: true },
        _count: true,
      });
      const payments = await tx.pOSSalePayment.groupBy({
        by: ["method"],
        where: { sale: { ...recognizedSaleWhere, storeId, createdAt: range } },
        _sum: { amount: true },
      });
      const refundsByMethod = await tx.pOSReturn.groupBy({
        by: ["refundMethod"],
        where: { sale: { ...recognizedSaleWhere, storeId }, createdAt: range },
        _sum: { refundAmount: true },
      });
      const byStore = await tx.pOSSale.groupBy({
        by: ["storeId"],
        where: { ...recognizedSaleWhere, storeId, createdAt: range },
        _sum: { grandTotal: true },
        _count: true,
      });
      const byCashier = await tx.pOSSale.groupBy({
        by: ["cashierId"],
        where: { ...recognizedSaleWhere, storeId, createdAt: range },
        _sum: { grandTotal: true },
        _count: true,
      });
      const bySalespersonRaw = await tx.$queryRaw<
        { salespersonId: number | null; total: Prisma.Decimal; count: number; firstName: string | null; lastName: string | null }[]
      >(
        Prisma.sql`
          SELECT 
            COALESCE(i."salespersonId", s."salespersonId") AS "salespersonId",
            e."firstName",
            e."lastName",
            SUM(i."lineTotal") AS "total",
            COUNT(DISTINCT s.id)::integer AS "count"
          FROM "POSSaleItem" i
          JOIN "POSSale" s ON s.id = i."saleId"
          LEFT JOIN "Employee" e ON e.id = COALESCE(i."salespersonId", s."salespersonId")
          WHERE ${filter} AND ${period}
          GROUP BY COALESCE(i."salespersonId", s."salespersonId"), e."firstName", e."lastName"
        `,
      );
      const bySalesperson = bySalespersonRaw.map((row) => ({
        salespersonId: row.salespersonId,
        salespersonName: row.firstName ? `${row.firstName} ${row.lastName || ""}`.trim() : "Unassigned",
        _sum: { grandTotal: row.total },
        _count: row.count,
      }));
      const dailyTrend = await tx.$queryRaw(
        Prisma.sql`SELECT to_char(s."createdAt" + interval '5 hours 30 minutes', 'YYYY-MM-DD') AS day, SUM(s."grandTotal") AS total, COUNT(*)::integer AS invoices FROM "POSSale" s WHERE ${filter} AND ${period} GROUP BY day ORDER BY day`,
      );
      const dimensions = await tx.$queryRaw(
        Prisma.sql`SELECT i."variantId", i.name, i.sku, i.brand, i.category, SUM(i.quantity)::integer AS quantity, SUM(i."unitPrice" * i.quantity) AS gross, SUM(i."discountTotal") AS discounts, SUM(i."taxTotal") AS taxes, SUM(i."lineTotal") AS collected, SUM(i."costPrice" * i.quantity) AS originalCost FROM "POSSaleItem" i JOIN "POSSale" s ON s.id = i."saleId" WHERE ${filter} AND ${period} GROUP BY i."variantId", i.name, i.sku, i.brand, i.category ORDER BY collected DESC LIMIT ${pagination.take} OFFSET ${pagination.skip}`,
      );
      const cost = await tx.$queryRaw<
        { revenue: Prisma.Decimal | null; cogs: Prisma.Decimal | null }[]
      >(
        Prisma.sql`SELECT SUM(i."unitPrice" * i.quantity - i."discountTotal") AS revenue, SUM(i."costPrice" * i.quantity) AS cogs FROM "POSSaleItem" i JOIN "POSSale" s ON s.id = i."saleId" WHERE ${filter} AND ${period}`,
      );
      const returnCost = await tx.$queryRaw<
        { revenue: Prisma.Decimal | null; cogs: Prisma.Decimal | null }[]
      >(
        Prisma.sql`SELECT SUM(ri."revenueRefund") AS revenue, SUM(CASE WHEN ri.resellable THEN i."costPrice" * ri.quantity ELSE 0 END) AS cogs FROM "POSReturnItem" ri JOIN "POSReturn" r ON r.id = ri."returnId" JOIN "POSSaleItem" i ON i.id = ri."saleItemId" JOIN "POSSale" s ON s.id = r."saleId" WHERE ${filter} AND r."createdAt" >= ${range.gte} AND r."createdAt" < ${range.lt}`,
      );
      const netRevenue = new Prisma.Decimal(cost[0]?.revenue ?? 0).minus(
          returnCost[0]?.revenue ?? 0,
        ),
        netCost = new Prisma.Decimal(cost[0]?.cogs ?? 0).minus(
          returnCost[0]?.cogs ?? 0,
        );
      const returnsReport = await tx.pOSReturn.findMany({
        where: { sale: { ...recognizedSaleWhere, storeId }, createdAt: range },
        select: {
          id: true,
          saleId: true,
          reason: true,
          refundMethod: true,
          refundAmount: true,
          createdAt: true,
          sale: { select: { invoiceNo: true } },
        },
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: "desc" },
      });
      const topVariants = await tx.$queryRaw(
        Prisma.sql`SELECT i."variantId", i.sku, i.name, SUM(i.quantity)::integer AS quantity, SUM(i."lineTotal") AS total FROM "POSSaleItem" i JOIN "POSSale" s ON s.id = i."saleId" WHERE ${filter} AND ${period} GROUP BY i."variantId", i.sku, i.name ORDER BY quantity DESC LIMIT 20`,
      );
      const valuation = await tx.$queryRaw<{ value: Prisma.Decimal | null }[]>(
        Prisma.sql`SELECT SUM(b.quantity * v."costPrice") AS value FROM "POSInventoryBalance" b JOIN "POSProductVariant" v ON v.id = b."variantId" WHERE (${storeId ?? null}::integer IS NULL OR b."storeId" = ${storeId ?? null}::integer)`,
      );
      const lowStock = await tx.$queryRaw(
        Prisma.sql`SELECT COALESCE(b.id::text,st.id::text || ':' || v.id::text) AS id,st.id AS "storeId",st.name AS "storeName",v.id AS "variantId",v.sku,p.name,COALESCE(b.quantity,0) AS quantity,COALESCE(b."lowStockThreshold",5) AS "lowStockThreshold" FROM "Store" st CROSS JOIN "POSProductVariant" v JOIN "POSProduct" p ON p.id=v."productId" LEFT JOIN "POSInventoryBalance" b ON b."storeId"=st.id AND b."variantId"=v.id WHERE st."isActive" AND p.active AND v.active AND COALESCE(b.quantity,0)<=COALESCE(b."lowStockThreshold",5) AND (${storeId ?? null}::integer IS NULL OR st.id=${storeId ?? null}::integer) ORDER BY quantity,st.id,v.sku LIMIT 100`,
      );
      const openSessions = await tx.pOSSession.findMany({
        where: { closedAt: null, register: { storeId } },
        include: { register: true },
        take: 100,
      });
      const gross = sales._sum.subtotal ?? new Prisma.Decimal(0),
        collected = sales._sum.grandTotal ?? new Prisma.Decimal(0),
        refunds = returns._sum.refundAmount ?? new Prisma.Decimal(0);
      return {
        page: pagination.page,
        pageSize: pagination.take,
        from: range.gte,
        toExclusive: range.lt,
        grossSales: gross,
        discounts: sales._sum.discountTotal ?? 0,
        taxes: sales._sum.taxTotal ?? 0,
        collectedSales: collected,
        refunds,
        netCollected: collected.minus(refunds),
        invoices: sales._count,
        returnCount: returns._count,
        averageOrderValue: sales._count
          ? collected.div(sales._count).toFixed(2)
          : "0.00",
        inventoryValuation: valuation[0]?.value ?? "0.00",
        byStore,
        byCashier,
        bySalesperson,
        payments,
        refundsByMethod,
        dailyTrend,
        dimensions,
        returnsReport,
        netRevenue,
        costOfGoodsSold: netCost,
        grossMargin: netRevenue.minus(netCost),
        topVariants,
        lowStock,
        openSessions,
        definitions: {
          grossSales:
            "Original tax-exclusive price times quantity before discounts",
          collectedSales: "Sales after discounts including tax",
          netCollected:
            "Sales in period minus refunds posted in period, including tax",
          inventoryValuation:
            "Current resellable stock times current variant cost; excludes damaged/in-transit stock",
          averageOrderValue:
            "Collected sales divided by original invoice count",
          grossMargin:
            "Tax-exclusive net revenue less snapshot COGS. Resellable returns reverse original COGS; damaged returns retain cost as loss. Refunds recognized on posting date. Operating expenses excluded.",
          timezone: "Asia/Kolkata",
        },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/** Signed event facts: refunds are recognized on their own posting date. */
export async function groupedSales(actor: Actor, query: Record<string, any>) {
  permission(actor, "reports");
  const storeId = storeFilter(actor, query.storeId),
    range = dateRange(query),
    p = page(query);
  const expressions: Record<string, Prisma.Sql> = {
    day: Prisma.sql`to_char(f.at + interval '5 hours 30 minutes','YYYY-MM-DD')`,
    week: Prisma.sql`to_char(date_trunc('week',f.at + interval '5 hours 30 minutes'),'YYYY-MM-DD')`,
    month: Prisma.sql`to_char(f.at + interval '5 hours 30 minutes','YYYY-MM')`,
    product: Prisma.sql`f.name`,
    category: Prisma.sql`COALESCE(f.category,'Uncategorized')`,
    brand: Prisma.sql`f.brand`,
    size: Prisma.sql`''`,
    color: Prisma.sql`''`,
    store: Prisma.sql`f."storeId"::text`,
    cashier: Prisma.sql`f."cashierId"::text`,
    salesperson: Prisma.sql`COALESCE((SELECT CONCAT(e."firstName", ' ', e."lastName") FROM "Employee" e WHERE e.id = f."salespersonId"), f."salespersonId"::text, 'Unassigned')`,
  };
  const dimension = expressions[String(query.groupBy ?? "day")];
  ensure(dimension, "Unsupported sales dimension");
  const facts = Prisma.sql`WITH facts AS (
 SELECT s."createdAt" AS at,s."storeId",s."cashierId",COALESCE(i."salespersonId", s."salespersonId") AS "salespersonId",i.name,i.category,i.brand,i.quantity AS units,i."unitPrice"*i.quantity AS gross,i."discountTotal" AS discount,i."taxTotal" AS tax,i."lineTotal" AS collected,0::numeric AS refunds,i."costPrice"*i.quantity AS cost FROM "POSSaleItem" i JOIN "POSSale" s ON s.id=i."saleId" WHERE ${recognizedSaleSQL}
 UNION ALL SELECT r."createdAt",s."storeId",s."cashierId",COALESCE(i."salespersonId", s."salespersonId") AS "salespersonId",i.name,i.category,i.brand,-ri.quantity,0,0,-(ri."refundAmount"-ri."revenueRefund"),0,ri."refundAmount",CASE WHEN ri.resellable THEN -i."costPrice"*ri.quantity ELSE 0 END FROM "POSReturnItem" ri JOIN "POSReturn" r ON r.id=ri."returnId" JOIN "POSSaleItem" i ON i.id=ri."saleItemId" JOIN "POSSale" s ON s.id=r."saleId" WHERE ${recognizedSaleSQL})`;
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(
    Prisma.sql`${facts} SELECT ${dimension} AS label,SUM(units)::integer AS units,SUM(gross) AS gross,SUM(discount) AS discounts,SUM(tax) AS taxes,SUM(refunds) AS refunds,SUM(collected-refunds) AS "netCollected",SUM(collected-refunds-tax) AS "netRevenue",SUM(cost) AS "costOfGoodsSold",SUM(collected-refunds-tax-cost) AS "grossMargin",COUNT(*) OVER()::integer AS "totalGroups" FROM facts f WHERE (${storeId ?? null}::integer IS NULL OR f."storeId"=${storeId ?? null}::integer) AND f.at >= ${range.gte} AND f.at < ${range.lt} GROUP BY label ORDER BY label LIMIT ${p.take} OFFSET ${p.skip}`,
  );
  return {
    items: rows,
    total: rows[0]?.totalGroups ?? 0,
    page: p.page,
    groupBy: query.groupBy ?? "day",
    from: range.gte,
    toExclusive: range.lt,
    definition:
      "Signed sale/refund events in IST. Refunds are posted on return date; damaged returns retain cost. Week starts Monday.",
  };
}
export async function inventoryReport(
  actor: Actor,
  query: Record<string, any>,
) {
  permission(actor, "reports");
  const storeId = storeFilter(actor, query.storeId),
    p = page(query),
    low = query.lowStock === "true";
  const cte = Prisma.sql`WITH stock AS (SELECT st.id AS "storeId",st.name AS "storeName",v.id AS "variantId",v.sku,pr.name,COALESCE(b.quantity,0) AS quantity,COALESCE(b.damaged,0) AS damaged,COALESCE(b."lowStockThreshold",5) AS threshold,v."costPrice",COALESCE(b.quantity,0)*v."costPrice" AS valuation FROM "Store" st CROSS JOIN "POSProductVariant" v JOIN "POSProduct" pr ON pr.id=v."productId" LEFT JOIN "POSInventoryBalance" b ON b."storeId"=st.id AND b."variantId"=v.id WHERE st."isActive" AND v.active AND pr.active AND (${storeId ?? null}::integer IS NULL OR st.id=${storeId ?? null}::integer))`;
  return prisma.$transaction(
    async (tx) => {
      const items = await tx.$queryRaw(
        Prisma.sql`${cte} SELECT * FROM stock WHERE (NOT ${low} OR quantity<=threshold) ORDER BY "storeId",sku,"variantId" LIMIT ${p.take} OFFSET ${p.skip}`,
      );
      const totals = await tx.$queryRaw<
        { total: number; valuation: Prisma.Decimal | null }[]
      >(
        Prisma.sql`${cte} SELECT COUNT(*)::integer AS total,SUM(valuation) AS valuation FROM stock WHERE (NOT ${low} OR quantity<=threshold)`,
      );
      return {
        items,
        total: totals[0]?.total ?? 0,
        valuation: totals[0]?.valuation ?? "0.00",
        page: p.page,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
export async function registerReport(actor: Actor, query: Record<string, any>) {
  permission(actor, "reports");
  const storeId = storeFilter(actor, query.storeId),
    range = dateRange(query),
    p = page(query);
  const where: Prisma.POSSessionWhereInput = {
    register: { storeId },
    OR: [{ openedAt: range }, { closedAt: range }],
  };
  return {
    items: await prisma.pOSSession.findMany({
      where,
      include: {
        register: { include: { store: { select: { name: true } } } },
        cashMovements: true,
        user: { select: { id: true, email: true } },
      },
      skip: p.skip,
      take: p.take,
      orderBy: [{ openedAt: "desc" }, { id: "asc" }],
    }),
    total: await prisma.pOSSession.count({ where }),
    page: p.page,
  };
}
export async function returnReport(actor: Actor, query: Record<string, any>) {
  permission(actor, "reports");
  const storeId = storeFilter(actor, query.storeId),
    range = dateRange(query),
    p = page(query);
  // Operational refund history retains cancellation payouts for auditing.
  const where = { sale: { storeId }, createdAt: range };
  const items = await prisma.pOSReturn.findMany({
    where,
    include: {
      sale: { select: { invoiceNo: true, storeId: true } },
      items: {
        include: {
          saleItem: {
            select: { name: true, sku: true, size: true, color: true },
          },
        },
      },
    },
    skip: p.skip,
    take: p.take,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  const exchanges = await prisma.pOSAuditLog.findMany({
    where: {
      action: "EXCHANGE_COMPLETED",
      entityId: { in: items.map((i) => i.id) },
    },
  });
  return {
    items: items.map((i) => ({
      ...i,
      exchange: exchanges.find((e) => e.entityId === i.id)?.metadata ?? null,
    })),
    total: await prisma.pOSReturn.count({ where }),
    page: p.page,
  };
}
