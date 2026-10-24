import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { Response } from "express";
import { prisma } from "../utils/db";
import { Actor, permission, scope, storeFilter } from "./auth";
import { dateRange, ensure, integer, page } from "./validation";
import { csvCell } from "./billExports";
import { getSessionHistory } from "./service";
const D = Prisma.Decimal;
const kinds = ["sales", "invoices", "payments", "products", "discounts", "tax", "employees", "stores", "sessions", "cancelled", "returns"];
function filters(actor: Actor, q: Record<string, any>) {
  permission(actor, "reports");
  const all = !actor.isPosStoreSession && (actor.admin || actor.permissions["pos.allStores"] === true || actor.permissions["pos.manageStores"] === true);
  const storeId = all && (!q.storeId || q.storeId === "*") ? undefined : storeFilter(actor, q.storeId);
  if (q.storeId && q.storeId !== "*") scope(actor, integer(Number(q.storeId), "storeId"));
  ensure(q.storeId !== "*" || all, "All-store report access denied", 403);
  const range = dateRange(q), p = page(q);
  const employee = q.employeeId ? integer(Number(q.employeeId), "employeeId") : undefined;
  const payment = q.paymentMode ?? "ALL", status = q.status ?? "ALL";
  ensure(["ALL", "CASH", "CARD", "UPI"].includes(payment), "Invalid payment filter");
  ensure(["ALL", "COMPLETED", "CANCELLED", "PARTIALLY_RETURNED", "RETURNED"].includes(status), "Invalid status filter");
  ensure(q.search === undefined || typeof q.search === "string", "Invalid report search");
  const search = String(q.search ?? "").trim(); ensure(search.length <= 200, "Search is too long");
  const base = Prisma.sql`(${storeId ?? null}::int IS NULL OR s."storeId"=${storeId ?? null}::int)
    AND (${employee ?? null}::int IS NULL OR s."salespersonId"=${employee ?? null}::int OR EXISTS (SELECT 1 FROM "POSSaleItem" ei WHERE ei."saleId"=s.id AND ei."salespersonId"=${employee ?? null}::int))
    AND (${payment}='ALL' OR EXISTS(SELECT 1 FROM "POSSalePayment" ep WHERE ep."saleId"=s.id AND ep.method=${payment}))
    AND (${status}='ALL' OR s.status=${status})
    AND (${search}='' OR s."invoiceNo" ILIKE ${'%' + search + '%'} OR COALESCE(s."customerName",'') ILIKE ${'%' + search + '%'} OR COALESCE(s."customerPhone",'') ILIKE ${'%' + search + '%'} OR EXISTS(SELECT 1 FROM "POSSaleItem" si WHERE si."saleId"=s.id AND (si.name ILIKE ${'%'+search+'%'} OR si.sku ILIKE ${'%'+search+'%'} OR si.barcode ILIKE ${'%'+search+'%'})))`;
  const period = Prisma.sql`s."createdAt">=${range.gte} AND s."createdAt"<${range.lt}`;
  const recognized = Prisma.sql`s.status IN ('COMPLETED','PARTIALLY_RETURNED','RETURNED')`;
  return { base, period, recognized, range, storeId, employee, payment, status, p };
}
const saleTotals = Prisma.sql`COUNT(*)::int AS bills,COALESCE(SUM(s.subtotal),0) AS gross,COALESCE(SUM(s."discountTotal"),0) AS discounts,COALESCE(SUM(s."taxTotal"),0) AS tax,COALESCE(SUM(s."grandTotal"),0) AS collected`;
export async function reportingOverview(actor: Actor, q: Record<string, any>) {
  const f = filters(actor, q);
  return prisma.$transaction(async tx => {
    const sales = await tx.$queryRaw<any[]>(Prisma.sql`SELECT ${saleTotals} FROM "POSSale" s WHERE ${f.base} AND ${f.period} AND ${f.recognized}`);
    const cancelled = await tx.$queryRaw<any[]>(Prisma.sql`SELECT COUNT(*)::int AS count FROM "POSSale" s WHERE ${f.base} AND ${f.period} AND s.status='CANCELLED'`);
    const units = await tx.$queryRaw<any[]>(Prisma.sql`SELECT COALESCE(SUM(i.quantity),0)::int AS quantity FROM "POSSaleItem" i JOIN "POSSale" s ON s.id=i."saleId" WHERE ${f.base} AND ${f.period} AND ${f.recognized}`);
    const payments = await tx.$queryRaw<any[]>(Prisma.sql`SELECT p.method, SUM(p.amount) AS amount FROM "POSSalePayment" p JOIN "POSSale" s ON s.id=p."saleId" WHERE ${f.base} AND ${f.period} AND ${f.recognized} GROUP BY p.method ORDER BY p.method`);
    const refunds = await tx.$queryRaw<any[]>(Prisma.sql`SELECT COALESCE(SUM(r."refundAmount"),0) AS amount,COUNT(*)::int AS count FROM "POSReturn" r JOIN "POSSale" s ON s.id=r."saleId" WHERE ${f.base} AND ${f.recognized} AND r."createdAt">=${f.range.gte} AND r."createdAt"<${f.range.lt}`);
    const duration = f.range.lt.getTime() - f.range.gte.getTime();
    const previous = await tx.$queryRaw<any[]>(Prisma.sql`SELECT ${saleTotals} FROM "POSSale" s WHERE ${f.base} AND ${f.recognized} AND s."createdAt">=${new Date(f.range.gte.getTime()-duration)} AND s."createdAt"<${f.range.gte}`);
    const trend = await tx.$queryRaw<any[]>(Prisma.sql`SELECT to_char(s."createdAt"+interval '5 hours 30 minutes','YYYY-MM-DD') AS date,${saleTotals} FROM "POSSale" s WHERE ${f.base} AND ${f.period} AND ${f.recognized} GROUP BY date ORDER BY date`);
    const stores = await tx.$queryRaw<any[]>(Prisma.sql`SELECT st.name AS store,${saleTotals} FROM "POSSale" s JOIN "Store" st ON st.id=s."storeId" WHERE ${f.base} AND ${f.period} AND ${f.recognized} GROUP BY st.id,st.name ORDER BY collected DESC`);
    const topProducts = await tx.$queryRaw<any[]>(Prisma.sql`SELECT i.name,SUM(i.quantity)::int AS quantity,SUM(i."lineTotal") AS collected FROM "POSSaleItem" i JOIN "POSSale" s ON s.id=i."saleId" WHERE ${f.base} AND ${f.period} AND ${f.recognized} GROUP BY i.name ORDER BY quantity DESC LIMIT 10`);
    const total = sales[0], net = new D(total.collected).minus(refunds[0].amount);
    return { ...total, cancelledBills: cancelled[0].count, itemsSold: units[0].quantity, payments, refunds: refunds[0].amount,
      refundCount: refunds[0].count, netCollected: net, averageBill: total.bills ? new D(total.collected).div(total.bills).toFixed(2) : "0.00",
      previous: previous[0], trend, stores, topProducts, timezone: "Asia/Kolkata",
      accounting: "Sales, discounts and GST use original recognized invoices. Net collected subtracts ordinary refunds posted in the period. Cancelled invoices and their credits are excluded together." };
  }, { isolationLevel: "RepeatableRead" });
}
export async function reportingDetails(actor: Actor, q: Record<string, any>, db: Prisma.TransactionClient = prisma): Promise<any> {
  const f = filters(actor, q), kind = String(q.report ?? "sales"); ensure(kinds.includes(kind), "Unknown report");
  const direction = q.direction ?? "desc"; ensure(["asc","desc"].includes(direction), "Invalid sort direction");
  const sort = Prisma.raw(direction.toUpperCase());
  const limit = Prisma.sql`LIMIT ${f.p.take} OFFSET ${f.p.skip}`;
  const completed = Prisma.sql`${f.base} AND ${f.period} AND ${f.recognized}`;
  let query: Prisma.Sql;
  if (kind === "sessions") {
    // The existing service owns the physical cash ledger, including refunded cancellations.
    ensure(["ALL","OPEN","CLOSED"].includes(q.sessionStatus ?? "ALL"), "Invalid session status");
    const result = await getSessionHistory(actor, { storeId: f.storeId ?? "*", reportOverlap: true, from: q.from, to: q.to, employeeId: f.employee, status: q.sessionStatus ?? "ALL", direction: q.direction, page: f.p.page, pageSize: f.p.take }, db);
    return { ...result, definition: "Physical cash = opening + cash receipts - cash refunds + cash in - cash out. Closed sessions retain their recorded reconciliation snapshot." };
  }
  if (kind === "sales") {
    const grouping = q.groupBy ?? "day";
    const groups: Record<string, Prisma.Sql> = { day: Prisma.sql`to_char(s."createdAt"+interval '5 hours 30 minutes','YYYY-MM-DD')`, week: Prisma.sql`to_char(date_trunc('week',s."createdAt"+interval '5 hours 30 minutes'),'YYYY-MM-DD')`, month: Prisma.sql`to_char(s."createdAt"+interval '5 hours 30 minutes','YYYY-MM')`, hour: Prisma.sql`to_char(s."createdAt"+interval '5 hours 30 minutes','YYYY-MM-DD HH24:00')` };
    ensure(Object.prototype.hasOwnProperty.call(groups, grouping), "Invalid sales grouping");
    query = Prisma.sql`SELECT ${groups[grouping]} AS period,${saleTotals},COUNT(*) OVER()::int AS "totalGroups" FROM "POSSale" s WHERE ${completed} GROUP BY period ORDER BY period ${sort} ${limit}`;
  } else if (kind === "discounts" && q.groupBy && q.groupBy !== "invoice") {
    const dimensions: Record<string, Prisma.Sql> = {
      day: Prisma.sql`to_char(s."createdAt"+interval '5 hours 30 minutes','YYYY-MM-DD')`,
      store: Prisma.sql`st.name`, employee: Prisma.sql`u.email`,
    };
    ensure(Object.prototype.hasOwnProperty.call(dimensions, q.groupBy), "Invalid discount grouping");
    query = Prisma.sql`WITH facts AS (SELECT ${dimensions[q.groupBy]} AS label,s."discountTotal" AS total,
      COALESCE((a.metadata->>'orderDiscountTotal')::numeric,(a.metadata->>'orderDiscount')::numeric) AS bill,
      COALESCE((SELECT SUM((j->>'amount')::numeric) FROM jsonb_array_elements(a.metadata->'itemDiscounts') j WHERE j->>'type'='percent'),0)
        + CASE WHEN a.metadata->>'orderDiscountType'='percent' THEN COALESCE((a.metadata->>'orderDiscountTotal')::numeric,0) ELSE 0 END AS percentage,
      COALESCE((SELECT SUM((j->>'amount')::numeric) FROM jsonb_array_elements(a.metadata->'itemDiscounts') j WHERE j->>'type'='amount'),0)
        + CASE WHEN COALESCE(a.metadata->>'orderDiscountType','amount')='amount' THEN COALESCE((a.metadata->>'orderDiscountTotal')::numeric,(a.metadata->>'orderDiscount')::numeric,0) ELSE 0 END AS fixed
      FROM "POSSale" s JOIN "Store" st ON st.id=s."storeId" JOIN "User" u ON u.id=s."cashierId"
      LEFT JOIN LATERAL(SELECT metadata FROM "POSAuditLog" WHERE "entityId"=s.id::text AND action='SALE_COMPLETED' LIMIT 1) a ON true
      WHERE ${completed} AND s."discountTotal">0)
      SELECT label,COUNT(*)::int AS bills,SUM(total) AS "discountTotal",SUM(bill) AS "billDiscount",SUM(total-bill) AS "itemDiscount",SUM(percentage) AS "percentageDiscount",SUM(fixed) AS "fixedDiscount",SUM(total-percentage-fixed) AS "unclassifiedDiscount",COUNT(*) OVER()::int AS "totalGroups" FROM facts GROUP BY label ORDER BY label ${sort} ${limit}`;
  } else if (kind === "invoices" || kind === "cancelled" || kind === "discounts") {
    query = Prisma.sql`SELECT s.id,s."storeId",s."invoiceNo",s."createdAt",st.name AS store,s."customerName",s."customerPhone",u.email AS cashier,
      CONCAT(e."firstName",' ',e."lastName") AS salesperson,(SELECT COALESCE(SUM(i.quantity),0)::int FROM "POSSaleItem" i WHERE i."saleId"=s.id) AS quantity,
      s.subtotal,s."discountTotal",s."taxTotal",s."grandTotal",s.status,
      (SELECT string_agg(p.method || ': ' || p.amount::text,'; ') FROM "POSSalePayment" p WHERE p."saleId"=s.id) AS payments,
      a.metadata->>'reason' AS "cancellationReason",a."createdAt" AS "cancelledAt",cu.email AS "cancelledBy",
      CASE WHEN a.id IS NULL OR NOT EXISTS(SELECT 1 FROM "POSSaleItem" ci WHERE ci."saleId"=s.id AND ci."variantId" IS NOT NULL) THEN NULL ELSE EXISTS(SELECT 1 FROM "POSStockMovement" m WHERE m.reference=s.id::text OR m.reference=a.metadata->>'returnId') END AS "stockRestorationRecorded",
      c.metadata->>'orderDiscountTotal' AS "billDiscount", c.metadata->>'orderDiscount' AS "legacyBillDiscount",
      c.metadata->>'orderDiscountType' AS "billDiscountType", c.metadata->'itemDiscounts' AS "itemDiscountTypes",
      COUNT(*) OVER()::int AS "totalGroups"
      FROM "POSSale" s JOIN "Store" st ON st.id=s."storeId" JOIN "User" u ON u.id=s."cashierId" LEFT JOIN "Employee" e ON e.id=s."salespersonId"
      LEFT JOIN LATERAL(SELECT id,metadata,"userId","createdAt" FROM "POSAuditLog" WHERE "entityId"=s.id::text AND action='SALE_CANCELLED' ORDER BY "createdAt" DESC LIMIT 1) a ON true
      LEFT JOIN "User" cu ON cu.id=a."userId"
      LEFT JOIN LATERAL(SELECT metadata FROM "POSAuditLog" WHERE "entityId"=s.id::text AND action='SALE_COMPLETED' ORDER BY "createdAt" DESC LIMIT 1) c ON true
      WHERE ${f.base} AND ${f.period} ${kind === "cancelled" ? Prisma.sql`AND s.status='CANCELLED'` : kind === "discounts" ? Prisma.sql`AND ${f.recognized} AND s."discountTotal">0` : Prisma.empty}
      ORDER BY s."createdAt" ${sort},s.id ${limit}`;
  } else if (kind === "payments" && q.groupBy && q.groupBy !== "invoice") {
    const dimensions: Record<string, Prisma.Sql> = { day: Prisma.sql`to_char(s."createdAt"+interval '5 hours 30 minutes','YYYY-MM-DD')`, store: Prisma.sql`st.name` };
    ensure(Object.prototype.hasOwnProperty.call(dimensions, q.groupBy), "Invalid payment grouping");
    query = Prisma.sql`SELECT ${dimensions[q.groupBy]} AS label,p.method,COUNT(DISTINCT s.id)::int AS bills,SUM(p.amount) AS amount,COUNT(*) OVER()::int AS "totalGroups" FROM "POSSalePayment" p JOIN "POSSale" s ON s.id=p."saleId" JOIN "Store" st ON st.id=s."storeId" WHERE ${completed} AND (${f.payment}='ALL' OR p.method=${f.payment}) GROUP BY label,p.method ORDER BY label ${sort},p.method ${limit}`;
  } else if (kind === "payments") {
    query = Prisma.sql`SELECT s.id,s."invoiceNo",s."createdAt",st.name AS store,p.method,p.amount,p.reference,
      (SELECT COUNT(*)>1 FROM "POSSalePayment" sp WHERE sp."saleId"=s.id) AS split,
      c.metadata->>'tenderedTotal' AS "amountTendered",c.metadata->>'changeReturned' AS "changeReturned",
      COUNT(*) OVER()::int AS "totalGroups" FROM "POSSalePayment" p JOIN "POSSale" s ON s.id=p."saleId" JOIN "Store" st ON st.id=s."storeId"
      LEFT JOIN LATERAL(SELECT metadata FROM "POSAuditLog" WHERE "entityId"=s.id::text AND action='SALE_COMPLETED' LIMIT 1) c ON true
      WHERE ${completed} AND (${f.payment}='ALL' OR p.method=${f.payment}) ORDER BY s."createdAt" ${sort},p.id ${limit}`;
  } else if (kind === "products") {
    query = Prisma.sql`WITH sold AS(SELECT i."variantId",i.name,i.sku,i.barcode,SUM(i.quantity)::int AS quantity,SUM(i."unitPrice"*i.quantity) AS gross,SUM(i."discountTotal") AS discounts,SUM(i."taxTotal") AS tax,SUM(i."lineTotal"-i."taxTotal") AS net,SUM(i."lineTotal") AS collected FROM "POSSaleItem" i JOIN "POSSale" s ON s.id=i."saleId" WHERE ${completed} GROUP BY i."variantId",i.name,i.sku,i.barcode), allrows AS (
      SELECT name,sku,barcode,quantity,gross,discounts,tax,net,collected,CASE WHEN quantity>0 THEN net/quantity ELSE 0 END AS "averagePrice" FROM sold
      UNION ALL SELECT p.name,v.sku,v.barcode,0,0,0,0,0,0,0 FROM "POSProductVariant" v JOIN "POSProduct" p ON p.id=v."productId" WHERE p.active AND v.active AND NOT EXISTS(SELECT 1 FROM sold WHERE "variantId"=v.id))
      SELECT *,COUNT(*) OVER()::int AS "totalGroups" FROM allrows WHERE (${String(q.search??"").trim()}='' OR name ILIKE ${'%'+String(q.search??"").trim()+'%'} OR sku ILIKE ${'%'+String(q.search??"").trim()+'%'} OR barcode ILIKE ${'%'+String(q.search??"").trim()+'%'}) ORDER BY quantity ${sort},sku ${limit}`;
  } else if (kind === "tax") {
    query = Prisma.sql`SELECT s."invoiceNo",st.name AS store,to_char(s."createdAt"+interval '5 hours 30 minutes','YYYY-MM-DD') AS date,i."taxRate",SUM(i."unitPrice"*i.quantity-i."discountTotal") AS taxable,SUM(i."taxTotal") AS tax,
      NULL::text AS cgst,NULL::text AS sgst,NULL::text AS igst,COUNT(*) OVER()::int AS "totalGroups" FROM "POSSaleItem" i JOIN "POSSale" s ON s.id=i."saleId" JOIN "Store" st ON st.id=s."storeId" WHERE ${completed} GROUP BY s.id,st.name,date,i."taxRate" ORDER BY date ${sort},s."invoiceNo",i."taxRate" ${limit}`;
  } else if (kind === "employees") {
    query = Prisma.sql`SELECT CASE WHEN e.id IS NULL THEN 'Unassigned' ELSE CONCAT(e."firstName",' ',e."lastName") END AS employee,COUNT(DISTINCT s.id)::int AS bills,SUM(i.quantity)::int AS quantity,SUM(i."discountTotal") AS discounts,SUM(i."lineTotal") AS collected,SUM(i."lineTotal")/COUNT(DISTINCT s.id) AS "averageBill",STRING_AGG(DISTINCT s."invoiceNo" || ': ' || COALESCE((SELECT string_agg(p.method || ' ' || p.amount::text,', ') FROM "POSSalePayment" p WHERE p."saleId"=s.id),'No payment due'),'; ') AS payments,COUNT(*) OVER()::int AS "totalGroups" FROM "POSSaleItem" i JOIN "POSSale" s ON s.id=i."saleId" LEFT JOIN "Employee" e ON e.id=COALESCE(i."salespersonId",s."salespersonId") WHERE ${completed} AND (${f.employee ?? null}::int IS NULL OR COALESCE(i."salespersonId",s."salespersonId")=${f.employee ?? null}::int) GROUP BY e.id,e."firstName",e."lastName" ORDER BY collected ${sort} ${limit}`;
  } else if (kind === "stores") {
    query = Prisma.sql`SELECT st.name AS store,COUNT(*) FILTER(WHERE ${f.recognized})::int AS bills,COUNT(*) FILTER(WHERE s.status='CANCELLED')::int AS cancelled,
      COALESCE(SUM(s."discountTotal") FILTER(WHERE ${f.recognized}),0) AS discounts,COALESCE(SUM(s."taxTotal") FILTER(WHERE ${f.recognized}),0) AS tax,COALESCE(SUM(s."grandTotal") FILTER(WHERE ${f.recognized}),0) AS collected,
      SUM(COALESCE((SELECT SUM(p.amount) FROM "POSSalePayment" p WHERE p."saleId"=s.id AND p.method='CASH' AND ${f.recognized}),0)) AS cash,
      SUM(COALESCE((SELECT SUM(p.amount) FROM "POSSalePayment" p WHERE p."saleId"=s.id AND p.method='CARD' AND ${f.recognized}),0)) AS card,
      SUM(COALESCE((SELECT SUM(p.amount) FROM "POSSalePayment" p WHERE p."saleId"=s.id AND p.method='UPI' AND ${f.recognized}),0)) AS upi,
      COUNT(*) OVER()::int AS "totalGroups" FROM "POSSale" s JOIN "Store" st ON st.id=s."storeId" WHERE ${f.base} AND ${f.period} GROUP BY st.id,st.name ORDER BY collected ${sort} ${limit}`;
  } else {
    query = Prisma.sql`SELECT r.id,s."invoiceNo",st.name AS store,r."createdAt",r."refundMethod",r."refundAmount",r.reason,s.status,COUNT(*) OVER()::int AS "totalGroups" FROM "POSReturn" r JOIN "POSSale" s ON s.id=r."saleId" JOIN "Store" st ON st.id=s."storeId" WHERE ${f.base} AND r."createdAt">=${f.range.gte} AND r."createdAt"<${f.range.lt} ORDER BY r."createdAt" ${sort},r.id ${limit}`;
  }
  const items = await db.$queryRaw<any[]>(query);
  if (kind === "discounts") for (const row of items) {
    const bill = row.billDiscount ?? row.legacyBillDiscount;
    row.itemDiscount = bill == null ? null : new D(row.discountTotal).minus(bill).toFixed(2);
    row.billDiscount = bill;
  }
  const total = items[0]?.totalGroups ?? (f.p.skip > 0 ? (await reportingDetails(actor, { ...q, page: 1, pageSize: 1 }, db)).total : 0);
  return { items, total, page: f.p.page, pageSize: f.p.take,
    definition: kind === "tax" ? "Stored GST only. CGST/SGST/IGST were not stored separately; no split is inferred." : kind === "discounts" ? "Item/bill discount types are available on newly recorded invoices. Missing historical metadata is shown as unavailable." : kind === "payments" ? "Amounts are saved payment receipts. Tendered amount/change are unavailable where not recorded; split-invoice tender totals repeat for context and must not be summed per payment row." : "Original recognized invoice values. Ordinary refunds are shown separately on their posting dates." };
}
export async function exportReport(actor: Actor, q: Record<string, any>, res: Response) {
  filters(actor,q); ensure(["csv","xlsx"].includes(q.format), "Unsupported report export format");
  return prisma.$transaction(async tx => {
  const first = await reportingDetails(actor, { ...q, page: 1, pageSize: 100 }, tx);
  ensure(first.items.length, "No report rows match the filters",404);
  ensure(first.total <= 1000000, "Report exceeds one million rows; narrow the date range",413);
  const columns = Object.keys(first.items[0]).filter(k=> !["id","storeId","totalGroups","sessionId","registerId","userId","employeeId","itemDiscountTypes"].includes(k));
  res.setHeader("Content-Type", q.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",`attachment; filename="HopKid-${q.report}-report.${q.format}"`);res.setHeader("Cache-Control","private, no-store");res.setHeader("Access-Control-Expose-Headers","Content-Disposition");
  const book = q.format === "xlsx" ? new ExcelJS.stream.xlsx.WorkbookWriter({stream:res}) : undefined;
  const sheet = book?.addWorksheet("Report");
  if(sheet) sheet.addRow(columns).commit(); else res.write("\uFEFF"+columns.map(csvCell).join(",")+"\r\n");
  for(let n=1;;n++) {
    const data = n===1 ? first : await reportingDetails(actor,{...q,page:n,pageSize:100},tx);
    for(const item of data.items) {
      const row=columns.map(c=> item[c] == null ? "" : typeof item[c]==="object" && !(item[c] instanceof D) && !(item[c] instanceof Date) ? JSON.stringify(item[c]) : String(item[c]));
      if(sheet) sheet.addRow(row).commit(); else if(!res.write(row.map(csvCell).join(",")+"\r\n")) await new Promise<void>((resolve,reject)=>{const clean=()=>{res.off("drain",done);res.off("close",closed);};const done=()=>{clean();resolve();};const closed=()=>{clean();reject(new Error("Download disconnected"));};res.once("drain",done);res.once("close",closed);});
    }
    if(data.items.length<100 || n*100>=data.total) break;
    ensure(n<10000,"Report too large; narrow the date range",413);
  }
  if(book){sheet!.commit();await book.commit();}else res.end();
  }, { isolationLevel: "RepeatableRead", timeout: 120000 });
}
