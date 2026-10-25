import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/utils/db";
import * as pos from "../src/pos/service";
import { configure } from "../src/pos/operations";
import { accrueRetailCommission, configureSubcategoryCommission, retailCommissionReport, reviewRetailAdjustment } from "../src/pos/retailCommissions";
import { Actor } from "../src/pos/auth";
let passed = 0;
async function test(name: string, fn: () => Promise<void>) { await fn(); console.log(`PASS ${name}`); passed++; }
async function main() {
 const url = new URL(process.env.POS_TEST_DATABASE_URL ?? "");
 assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "55439" && url.pathname.includes("pos_test") && process.env.DATABASE_URL === process.env.POS_TEST_DATABASE_URL, "Isolated POS database required");
 const key = randomUUID();
 const user = await prisma.user.create({ data: { email: `retail-${key}@test.invalid`, password: "test", role: "ADMIN" } });
 const actor: Actor = { userId: user.id, role: "ADMIN", admin: true, permissions: {} };
 const store = await prisma.store.create({ data: { name: `Retail commission ${key}` } });
 const other = await prisma.store.create({ data: { name: `Other retail ${key}` } });
 const parent = await prisma.pOSCategory.create({ data: { name: `Clothing ${key}` } });
 const a = await prisma.pOSCategory.create({ data: { name: `T-Shirts ${key}`, parentId: parent.id } });
 const b = await prisma.pOSCategory.create({ data: { name: `Trousers ${key}`, parentId: parent.id } });
 const missing = await prisma.pOSCategory.create({ data: { name: `Unconfigured ${key}`, parentId: parent.id } });
 await configure(actor, { storeId: store.id, commissionEnabled: true, commissionBasis: "NET_EX_TAX", fixedCommissionBasis: "UNIT", refundCommissionPolicy: "REVIEW_ADJUSTMENT" });
 await configureSubcategoryCommission(actor, a.id, { commissionType: "PERCENTAGE", commissionRate: 5 });
 await configureSubcategoryCommission(actor, b.id, { commissionType: "PERCENTAGE", commissionRate: 3 });
 const makeVariant = async (categoryId?: string) => {
   const id = randomUUID();
   const product = await prisma.pOSProduct.create({ data: { name: id, code: id, categoryId, images: [], variants: { create: { sku: id, barcode: id, costPrice: 100, sellingPrice: 1000, taxRate: 18 } } }, include: { variants: true } });
   const variant = product.variants[0];
   await pos.adjust(actor, { storeId: store.id, variantId: variant.id, quantityDelta: 50, type: "OPENING", reason: "Commission tests" });
   return variant;
 };
 const va = await makeVariant(a.id), vb = await makeVariant(b.id), vm = await makeVariant(missing.id), vn = await makeVariant(), vp = await makeVariant(parent.id);
 const register = await prisma.pOSRegister.create({ data: { storeId: store.id, name: key } });
 const session = await pos.openRegister(actor, register.id, { openingCash: "10000" });
 const makeRequest = async (items: any[], extra: Record<string, any> = {}) => {
   const input = { storeId: store.id, sessionId: session.id, idempotencyKey: randomUUID(), orderDiscount: "0", items, ...extra };
   const { sessionId: _session, idempotencyKey: _key, salespersonId: _salesperson, ...quoteInput } = input;
   const q = await pos.quote(actor, quoteInput);
   return { ...input, payments: [{ method: "CASH", amount: q.grandTotal.toString() }] };
 };
 const report = () => retailCommissionReport(actor, { storeId: store.id });
 const lines = (saleId: string) => prisma.pOSRetailCommission.findMany({ where: { saleId }, orderBy: { subcategoryName: "asc" } });
 let mixed: any;
 await test("mixed subcategories: 1000 at 5% plus 2000 at 3% = 110; no employee required", async () => {
   mixed = await pos.checkout(actor, await makeRequest([{ variantId: va.id, quantity: 1 }, { variantId: vb.id, quantity: 2 }]));
   const earned = await lines(mixed.id); assert.equal(earned.length, 2); assert.equal(earned.reduce((n, l) => n + Number(l.amount), 0), 110);
   assert.equal(await prisma.commissionTransaction.count({ where: { billId: `POSSALE-${mixed.id}` } }), 0);
 });
 await test("item and order percentage discounts with GST leave invoice totals unchanged", async () => {
   const req = await makeRequest([{ variantId: va.id, quantity: 2, discountType: "percent", discountValue: "10" }], { orderDiscountType: "percent", orderDiscount: "10" });
   const sale = await pos.checkout(actor, req); assert.equal(Number(sale.grandTotal), 1911.6);
   const [line] = await lines(sale.id); assert.equal(Number(line.eligibleRevenue), 1620); assert.equal(Number(line.amount), 81);
 });
 await test("missing subcategory/rate and parent-only assignments explicitly earn zero", async () => {
   const sale = await pos.checkout(actor, await makeRequest([vn, vm, vp].map(v => ({ variantId: v.id, quantity: 1 }))));
   const earned = await lines(sale.id); assert(earned.every(l => Number(l.amount) === 0 && Number(l.eligibleRevenue) === 0));
   assert.deepEqual(earned.map(l => l.exclusionReason).sort(), ["NO_CONFIGURED_RATE", "NO_SUBCATEGORY", "NO_SUBCATEGORY"].sort());
 });
 await test("retry checkout and accrual cannot duplicate or rewrite historical snapshots", async () => {
   const req = await makeRequest([{ variantId: va.id, quantity: 1 }]); const sale = await pos.checkout(actor, req);
   await configureSubcategoryCommission(actor, a.id, { commissionType: "PERCENTAGE", commissionRate: 99 });
   assert.equal((await pos.checkout(actor, req)).id, sale.id);
   await prisma.$transaction(tx => accrueRetailCommission(tx, actor, sale.id));
   const earned = await lines(sale.id); assert.equal(earned.length, 1); assert.equal(Number(earned[0].rate), 5); assert.equal(Number(earned[0].amount), 50);
   await configureSubcategoryCommission(actor, a.id, { commissionType: "PERCENTAGE", commissionRate: 5 });
 });
 await test("partial returns use original rate, retry is harmless, final return exactly reverses commission", async () => {
   const item = mixed.items.find((i: any) => i.variantId === vb.id);
   const req = { sessionId: session.id, items: [{ saleItemId: item.id, quantity: 1, resellable: true }], refundMethod: "CASH", reason: "Test refund", idempotencyKey: randomUUID() };
   await pos.returnSale(actor, mixed.id, req); await pos.returnSale(actor, mixed.id, req);
   let line = (await lines(mixed.id)).find(l => l.saleItemId === item.id)!; assert.equal(Number(line.reversedAmount), 30); assert.equal(Number(line.reversedRevenue), 1000);
   await pos.returnSale(actor, mixed.id, { ...req, idempotencyKey: randomUUID() });
   line = (await lines(mixed.id)).find(l => l.saleItemId === item.id)!; assert.equal(Number(line.reversedAmount), 60);
 });
 await test("fixed per-unit and per-line rates; cumulative rounding on partial refunds", async () => {
   await configureSubcategoryCommission(actor, b.id, { commissionType: "FIXED", commissionRate: 10.01 });
   let sale = await pos.checkout(actor, await makeRequest([{ variantId: vb.id, quantity: 3 }])); assert.equal(Number((await lines(sale.id))[0].amount), 30.03);
   await prisma.pOSConfiguration.update({ where: { storeId: store.id }, data: { fixedCommissionBasis: "LINE" } });
   sale = await pos.checkout(actor, await makeRequest([{ variantId: vb.id, quantity: 3 }])); assert.equal(Number((await lines(sale.id))[0].amount), 10.01);
   for (let n = 1; n <= 3; n++) {
     await pos.returnSale(actor, sale.id, { sessionId: session.id, items: [{ saleItemId: sale.items[0].id, quantity: 1, resellable: true }], refundMethod: "CASH", reason: "Fixed partial refund", idempotencyKey: randomUUID() });
     assert.equal(Number((await lines(sale.id))[0].reversedAmount), [3.34, 6.67, 10.01][n - 1]);
   }
 });
 await test("configured tax-inclusive commission uses discounted GST-inclusive total", async () => {
   await prisma.pOSConfiguration.update({ where: { storeId: store.id }, data: { commissionBasis: "NET_INCL_TAX" } });
   const sale = await pos.checkout(actor, await makeRequest([{ variantId: va.id, quantity: 1, discountType: "percent", discountValue: "10" }]));
   const [line] = await lines(sale.id); assert.equal(Number(line.eligibleRevenue), 1062); assert.equal(Number(line.amount), 53.1);
 });
 await test("cancelled and deleted bills excluded while retail audit snapshots survive deletion", async () => {
   const sale = await pos.checkout(actor, await makeRequest([{ variantId: va.id, quantity: 1 }])); const before = Number((await report()).totals.commissionAmount);
   await pos.cancelSale(actor, sale.id, { reason: "Commission cancellation" });
   assert.equal((await lines(sale.id))[0].status, "CANCELLED"); assert.equal(Number((await report()).totals.commissionAmount), before - Number((await lines(sale.id))[0].amount));
   await pos.deleteSale(actor, sale.id, { reason: "Commission deletion" }); assert.equal((await lines(sale.id))[0].status, "DELETED");
   const active = await pos.checkout(actor, await makeRequest([{ variantId: va.id, quantity: 1 }]));
   const beforeDelete = Number((await report()).totals.commissionAmount);
   await pos.deleteSale(actor, active.id, { reason: "Direct active-sale deletion" });
   const [deleted] = await lines(active.id); assert.equal(deleted.status, "DELETED");
   assert.equal(Number((await report()).totals.commissionAmount), beforeDelete - Number(deleted.amount));
 });
 await test("refunded cancellation also closes ledger", async () => {
   const sale = await pos.checkout(actor, await makeRequest([{ variantId: va.id, quantity: 1 }]));
   await pos.cancelSale(actor, sale.id, { sessionId: session.id, refundMethod: "CASH", reason: "Cancel with refund", idempotencyKey: randomUUID() });
   assert.equal((await lines(sale.id))[0].status, "CANCELLED");
 });
 await test("invalid rates, parent categories, unauthorized administration and clearing rates", async () => {
   for (const commissionRate of [-1, 100.1, NaN, Infinity, 0.00001]) await assert.rejects(configureSubcategoryCommission(actor, a.id, { commissionType: "PERCENTAGE", commissionRate }));
   await assert.rejects(configureSubcategoryCommission(actor, parent.id, { commissionType: "PERCENTAGE", commissionRate: 5 }));
   await assert.rejects(configureSubcategoryCommission({ ...actor, admin: false }, a.id, { commissionType: "FIXED", commissionRate: 5 }));
   await configureSubcategoryCommission(actor, a.id, { commissionType: null, commissionRate: null });
   assert.equal((await prisma.pOSCategory.findUniqueOrThrow({ where: { id: a.id } })).commissionRate, null);
 });
 await test("refund debits are unique and require authorized one-time review outside payroll", async () => {
   const adjustments = await prisma.pOSRetailCommissionAdjustment.findMany({ where: { saleId: mixed.id } });
   assert.equal(adjustments.length, 2); assert.equal(adjustments.reduce((n, r) => n + Number(r.amount), 0), -60);
   await reviewRetailAdjustment(actor, adjustments[0].id, { decision: "APPROVED", reason: "Original rate checked" });
   await assert.rejects(reviewRetailAdjustment(actor, adjustments[0].id, { decision: "APPROVED", reason: "Duplicate review" }));
   assert.equal(await prisma.commissionTransaction.count({ where: { storeId: store.id } }), 0);
 });
 await test("employee commission percentage has no effect on retail accrual", async () => {
   await prisma.workMode.upsert({ where: { id: "OFFICE" }, create: { id: "OFFICE", name: "Office" }, update: {} });
   const employee = await prisma.employee.create({ data: { employeeCode: key, firstName: "Test", lastName: "Seller", storeId: store.id, status: "active", commissionPercentage: 99 } });
   await configureSubcategoryCommission(actor, a.id, { commissionType: "PERCENTAGE", commissionRate: 5 });
   const sale = await pos.checkout(actor, await makeRequest([{ variantId: va.id, quantity: 1, salespersonId: employee.id }], { salespersonId: employee.id }));
   assert.equal(Number((await lines(sale.id))[0].amount), 59);
 });
 await test("store and date range reports use immutable applied rates, not current configuration", async () => {
   const r = await report(); assert(r.items.some(i => Number(i.rate) === 5)); assert(r.items.every(i => i.storeId === store.id));
   assert.equal((await retailCommissionReport(actor, { storeId: other.id })).items.length, 0);
   assert.equal((await retailCommissionReport(actor, { storeId: store.id, from: "2000-01-01", to: "2000-01-02" })).items.length, 0);
   await assert.rejects(retailCommissionReport({ ...actor, admin: false, storeId: other.id }, { storeId: store.id }));
 });
 console.log(`Retail commission: ${passed} integration checks passed`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
