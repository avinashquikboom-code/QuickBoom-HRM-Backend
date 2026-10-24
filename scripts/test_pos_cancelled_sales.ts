import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/utils/db";
import * as pos from "../src/pos/service";
import { report, groupedSales } from "../src/pos/reports";
import { Actor } from "../src/pos/auth";

const url = new URL(process.env.POS_TEST_DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "55439" &&
  url.pathname.includes("pos_test") && process.env.DATABASE_URL === process.env.POS_TEST_DATABASE_URL,
  "Isolated POS test database required");
let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn(); console.log(`PASS ${name}`); passed++;
}
async function main() {
  const key = randomUUID();
  const user = await prisma.user.create({ data: { email: `${key}@test.invalid`, password: "test", role: "ADMIN" } });
  const actor: Actor = { userId: user.id, role: "ADMIN", admin: true, permissions: {} };
  const store = await prisma.store.create({ data: { name: `Cancellation ${key}` } });
  const second = await prisma.store.create({ data: { name: `Other ${key}` } });
  await prisma.workMode.upsert({ where: { id: "OFFICE" }, create: { id: "OFFICE", name: "Office" }, update: {} });
  const baseline = await report(actor, {});
  const employee = await prisma.employee.create({ data: {
    employeeCode: key, firstName: "Cancellation", lastName: "Test", source: "HOPKID", status: "active", storeId: store.id,
  } });
  await prisma.pOSConfiguration.create({ data: { storeId: store.id, commissionEnabled: true,
    commissionBasis: "NET_EX_TAX", fixedCommissionBasis: "LINE", refundCommissionPolicy: "REVIEW_ADJUSTMENT" } });
  await prisma.commissionPolicy.create({ data: { name: key, employeeId: employee.id, storeId: store.id,
    commissionType: "PERCENTAGE", commissionValue: 10 } });
  const register = await prisma.pOSRegister.create({ data: { storeId: store.id, name: "Register" } });
  const session = await pos.openRegister(actor, register.id, { openingCash: "1000" });
  const reg2 = await prisma.pOSRegister.create({ data: { storeId: second.id, name: "Register" } });
  const session2 = await pos.openRegister(actor, reg2.id, { openingCash: "0" });
  const make = (amount: string, method = "CASH", sid = store.id, sess = session.id) => pos.checkout(actor, {
    storeId: sid, sessionId: sess, idempotencyKey: randomUUID(), orderDiscount: "0",
    items: [{ manual: true, key: randomUUID(), name: "Test", quantity: 1, unitPrice: amount,
      taxRate: "0", discountPerUnit: "0", ...(sid === store.id ? { salespersonId: employee.id } : {}) }],
    payments: [{ method, amount }],
  });
  const a = await make("1000"); const b = await make("500", "CARD"); const c = await make("300", "UPI");
  await make("75", "CASH", second.id, session2.id);
  const before = await report(actor, { storeId: store.id });
  assert.equal(Number(before.collectedSales), 1800);
  await test("A=1000 + B=500, cancelled C=300 => 1500, two invoices", async () => {
    await pos.deleteSale(actor, c.id, { reason: "Test void" });
    const r = await report(actor, { storeId: store.id });
    assert.equal(Number(r.collectedSales), 1500); assert.equal(Number(r.netCollected), 1500); assert.equal(r.invoices, 2);
    assert.equal(Number(r.byStore[0]._sum.grandTotal), 1500);
    assert.equal(Number(r.byCashier[0]._sum.grandTotal), 1500);
    assert.equal(Number(r.bySalesperson[0]._sum.grandTotal), 1500);
    assert.equal(r.bySalesperson[0]._count, 2);
    assert.equal(r.payments.some((p) => p.method === "UPI"), false);
    assert.equal(Number((r.dailyTrend as any[])[0].total), 1500);
    assert.equal(Number(r.netRevenue), 1500);
  });
  await test("all-store sales and salesperson queries include both stores", async () => {
    const r = await report(actor, {}); assert.equal(Number(r.collectedSales) - Number(baseline.collectedSales), 1575);
    assert.equal(r.invoices - baseline.invoices, 3); assert(r.bySalesperson.some((s) => s.salespersonId === employee.id));
  });
  await test("pending/draft/failed invoices excluded from sums and counts", async () => {
    for (const status of ["PENDING", "DRAFT", "FAILED"]) {
      const sale = await make("25");
      await prisma.pOSSale.update({ where: { id: sale.id }, data: { status } });
    }
    const r = await report(actor, { storeId: store.id }); assert.equal(Number(r.collectedSales), 1500); assert.equal(r.invoices, 2);
  });
  await test("day/week/month/year-range, store and employee analytics exclude cancelled rows", async () => {
    for (const groupBy of ["day", "week", "month", "store", "salesperson", "product", "category", "brand"]) {
      const r = await groupedSales(actor, { storeId: store.id, groupBy });
      assert.equal(r.items.reduce((n, row) => n + Number(row.netCollected), 0), 1500);
    }
    const year = new Date().getFullYear();
    const r = await report(actor, { storeId: store.id, from: `${year}-01-01`, to: `${year}-12-31` });
    assert.equal(Number(r.collectedSales), 1500);
    assert.equal(Number((await report(actor, { storeId: second.id })).collectedSales), 75);
  });
  await test("cancelled history and audit survive repeated and concurrent voids", async () => {
    await Promise.all([pos.deleteSale(actor, c.id), pos.deleteSale(actor, c.id)]);
    const history = await pos.getSessionSales(actor, session.id, { status: "CANCELLED" });
    assert.equal(history.items[0].invoiceNo, c.invoiceNo); assert.equal(Number(history.items[0].grandTotal), 300);
    assert.equal(await prisma.pOSAuditLog.count({ where: { entityId: c.id, action: "SALE_CANCELLED" } }), 1);
    const commission = await prisma.commissionTransaction.findFirstOrThrow({ where: { billId: `POSSALE-${c.id}` } });
    assert.equal(commission.status, "REJECTED"); assert.equal(commission.commissionAmount, 0);
    assert.equal(Number((await report(actor, { storeId: store.id })).collectedSales), 1500);
  });
  await test("refunded cancellation excludes both sales and cancellation credit from revenue", async () => {
    const sale = await make("200");
    const payload = { sessionId: session.id, idempotencyKey: randomUUID(), reason: "Refund cancellation", refundMethod: "CASH" };
    const ret = await pos.cancelSale(actor, sale.id, payload);
    assert.equal((await pos.cancelSale(actor, sale.id, payload)).id, ret.id);
    await assert.rejects(pos.cancelSale(actor, sale.id, { ...payload, idempotencyKey: randomUUID() }), /conflict/);
    const r = await report(actor, { storeId: store.id }); assert.equal(Number(r.netCollected), 1500); assert.equal(Number(r.refunds), 0);
    const s = await pos.computeSessionSummary(session.id);
    assert.equal(s.summary.totalSales, 1500); assert.equal(s.summary.totalBills, 2);
    assert.equal(s.summary.expectedCash, 2000);
  });
  await test("ordinary full refund keeps original receipt and posts credit once", async () => {
    await pos.returnSale(actor, b.id, { sessionId: session.id, idempotencyKey: randomUUID(), reason: "Full return",
      refundMethod: "CARD", items: b.items.map((i) => ({ saleItemId: i.id, quantity: i.quantity, resellable: true })) });
    const r = await report(actor, { storeId: store.id }); assert.equal(Number(r.netCollected), 1000); assert.equal(Number(r.refunds), 500);
    const g = await groupedSales(actor, { storeId: store.id }); assert.equal(Number(g.items[0].netCollected), 1000);
    const s = await pos.computeSessionSummary(session.id); assert.equal(s.summary.expectedCash, 2000);
  });
  await test("GST and inventory restore exactly once for concurrent bulk cancellations", async () => {
    const product = await pos.createProduct(actor, { name: "Tax item", code: randomUUID(), variants: [{
      sku: randomUUID(), barcode: randomUUID(), sellingPrice: "100", costPrice: "50", taxRate: "5",
    }] });
    const variantId = product.variants[0].id;
    await pos.adjust(actor, { storeId: store.id, variantId, quantityDelta: 5, reason: "Test stock" });
    const sale = await pos.checkout(actor, { storeId: store.id, sessionId: session.id,
      idempotencyKey: randomUUID(), orderDiscount: "0", items: [{ variantId, quantity: 2, discountPerUnit: "0", salespersonId: employee.id }],
      payments: [{ method: "UPI", amount: "210" }] });
    assert.equal(Number((await report(actor, { storeId: store.id })).taxes), 10);
    const body = { saleIds: [sale.id], reason: "Test bulk void" };
    const results = await Promise.all([pos.bulkCancelSales(actor, body), pos.bulkCancelSales(actor, body)]);
    assert(results.every((r) => r.failedCount === 0), JSON.stringify(results));
    const stock = await prisma.pOSInventoryBalance.findUniqueOrThrow({ where: { storeId_variantId: { storeId: store.id, variantId } } });
    assert.equal(stock.quantity, 5);
    assert.equal(await prisma.pOSStockMovement.count({ where: { reference: sale.id, type: "CANCELLATION" } }), 1);
    assert.equal(Number((await report(actor, { storeId: store.id })).taxes), 0);
  });
  await test("approved commissions create one reviewable debit on repeated voids", async () => {
    const sale = await make("100", "CARD");
    const original = await prisma.commissionTransaction.findFirstOrThrow({ where: { billId: `POSSALE-${sale.id}` } });
    await prisma.commissionTransaction.update({ where: { id: original.id }, data: { status: "APPROVED", approvedAt: new Date() } });
    await pos.deleteSale(actor, sale.id); await pos.deleteSale(actor, sale.id);
    const debits = await prisma.commissionTransaction.findMany({ where: { billId: `POSVOID-${sale.id}-${original.id}` } });
    assert.equal(debits.length, 1); assert.equal(debits[0].status, "PENDING");
    assert.equal(debits[0].commissionAmount, -original.commissionAmount);
    assert.equal((await prisma.commissionTransaction.findUniqueOrThrow({ where: { id: original.id } })).status, "APPROVED");
  });
  await test("partial refunds retain remaining revenue and cannot be voided twice", async () => {
    const sale = await pos.checkout(actor, { storeId: store.id, sessionId: session.id, idempotencyKey: randomUUID(), orderDiscount: "0",
      items: [{ manual: true, key: randomUUID(), name: "Partial", quantity: 2, unitPrice: "50", taxRate: "0", discountPerUnit: "0" }],
      payments: [{ method: "CARD", amount: "100" }] });
    const payload = { sessionId: session.id, idempotencyKey: randomUUID(), reason: "Partial return", refundMethod: "CARD",
      items: [{ saleItemId: sale.items[0].id, quantity: 1, resellable: true }] };
    await pos.returnSale(actor, sale.id, payload); await pos.returnSale(actor, sale.id, payload);
    assert.equal(Number((await report(actor, { storeId: store.id })).netCollected), 1050);
    await assert.rejects(pos.deleteSale(actor, sale.id), /without returns/);
    await pos.returnSale(actor, sale.id, { ...payload, idempotencyKey: randomUUID() });
    assert.equal(Number((await report(actor, { storeId: store.id })).netCollected), 1000);
  });
  await test("cash full refund reconciles original cash in and cash out", async () => {
    const sale = await make("100");
    await pos.returnSale(actor, sale.id, { sessionId: session.id, idempotencyKey: randomUUID(), reason: "Cash return",
      refundMethod: "CASH", items: sale.items.map((i) => ({ saleItemId: i.id, quantity: i.quantity, resellable: true })) });
    assert.equal((await pos.computeSessionSummary(session.id)).summary.expectedCash, 2000);
    const history = await pos.getSessionHistory(actor, { storeId: store.id });
    assert.equal(history.items[0].expectedCash, 2000);
    const closed = await pos.closeSession(actor, session.id, { actualCash: "2000" });
    assert.equal(Number(closed.expectedCash), 2000); assert.equal(Number(closed.variance), 0);
  });
  await test("cancellation refunded in a later session preserves both cash ledgers", async () => {
    const later = await pos.openRegister(actor, register.id, { openingCash: "1000" });
    await pos.cancelSale(actor, a.id, { sessionId: later.id, idempotencyKey: randomUUID(),
      reason: "Later session cancellation", refundMethod: "CASH" });
    assert.equal((await pos.computeSessionSummary(session.id)).summary.expectedCash, 2000);
    assert.equal((await pos.computeSessionSummary(later.id)).summary.expectedCash, 0);
    assert.equal(Number((await report(actor, { storeId: store.id })).netCollected), 0);
    const closed = await pos.closeSession(actor, later.id, { actualCash: "0" });
    assert.equal(Number(closed.variance), 0);
  });
  await test("cancelled invoices cannot be refunded again", async () => {
    await assert.rejects(pos.returnSale(actor, c.id, { sessionId: session.id, idempotencyKey: randomUUID(), reason: "Invalid",
      refundMethod: "UPI", items: c.items.map((i) => ({ saleItemId: i.id, quantity: i.quantity, resellable: true })) }), /not returnable/);
    assert.equal((await prisma.pOSSale.findUniqueOrThrow({ where: { id: a.id } })).status, "CANCELLED");
  });
  console.log(`${passed} cancellation regression checks passed`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
