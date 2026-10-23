import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/utils/db";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";
import * as service from "../src/pos/service";
import { Actor } from "../src/pos/auth";
import { receiptFromSale } from "../../HRM-Admin-Pannel/src/features/pos/posReceipt";

async function main() {
  const url = new URL(process.env.POS_TEST_DATABASE_URL ?? "");
  assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "55439" && url.pathname.includes("pos_test") && process.env.DATABASE_URL === process.env.POS_TEST_DATABASE_URL, "Guarded isolated POS test database required");
  const suffix = randomUUID();
  const store = await prisma.store.create({ data: { name: `Scan ${suffix}` } });
  const other = await prisma.store.create({ data: { name: `Other scan ${suffix}` } });
  const user = await prisma.user.create({ data: { email: `${suffix}@scan.invalid`, password: "unused", role: "ADMIN" } });
  const cashier = await prisma.user.create({ data: { email: `restricted-${suffix}@scan.invalid`, password: "unused", role: "EMPLOYEE" } });
  await prisma.employee.create({ data: { userId: cashier.id, employeeCode: `C-${suffix}`, firstName: "Restricted", lastName: "Cashier", storeId: store.id, source: "LOCAL" } });
  const actor: Actor = { userId: user.id, role: "ADMIN", admin: true, storeId: store.id, permissions: {} };
  const person = async (tag: string, storeId: number, designation = "Salesperson", status = "active") => prisma.employee.create({ data: { employeeCode: `${tag}-${suffix}`, employeeID: randomUUID(), firstName: tag, lastName: suffix, storeId, designation, status, source: "LOCAL" } });
  const seller = await person("Eligible", store.id);
  const inactive = await person("Inactive", store.id, "Salesperson", "inactive");
  const ineligible = await person("Accounts", store.id, "Accountant");
  const foreign = await person("Other", other.id);
  const disabledUser = await prisma.user.create({ data: { email: `disabled-${suffix}@scan.invalid`, password: "unused", role: "SALESMAN", isActive: false } });
  await prisma.employee.create({ data: { userId: disabledUser.id, employeeCode: `D-${suffix}`, firstName: "Disabled", lastName: "Seller", storeId: store.id, designation: "Salesperson" } });
  const app = express(); app.use(express.json()); app.use("/api/v1/pos", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/pos`;
  const token = signAccessToken({ id: user.id, role: "ADMIN" });
  const limitedToken = signAccessToken({ id: cashier.id, role: "EMPLOYEE" });
  const call = async (path: string, body?: unknown, status = 200, auth = token) => {
    const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await response.json(); assert.equal(response.status, status, JSON.stringify(json)); return json.data;
  };
  let passed = 0;
  const test = async (name: string, fn: () => Promise<void>) => { await fn(); passed++; console.log("PASS " + name); };
  const barcode = `EXACT-${suffix}`;
  const registration = (tag: string, openingStoreId = store.id) => ({ name: `Registered ${tag} ${suffix}`, code: `${tag}-${suffix}`, variants: [{ sku: `SKU-${tag}-${suffix}`, barcode: `${tag}-${barcode}`, size: "M", color: "Navy", costPrice: "20", sellingPrice: "100", taxRate: "5" }], openingStock: { storeId: openingStoreId, quantity: 5, reason: "Verified opening registration" } });
  try {
    let product: any;
    await test("authorized product, exact barcode and opening stock persist atomically", async () => {
      product = await call("/products", registration("NEW"));
      const variant = product.variants[0];
      const balance = await prisma.pOSInventoryBalance.findUniqueOrThrow({ where: { storeId_variantId: { storeId: store.id, variantId: variant.id } } });
      assert.equal(balance.quantity, 5);
      assert.equal(await prisma.pOSStockMovement.count({ where: { storeId: store.id, variantId: variant.id, type: "OPENING", reference: product.id } }), 1);
    });
    const variant = () => product.variants[0];
    await test("unknown/partial barcode never creates or substitutes a product", async () => {
      const before = await prisma.pOSProduct.count();
      const partial = variant().barcode.slice(0, -1);
      assert.equal((await call(`/products/lookup?storeId=${store.id}&code=${partial}`)).matches.length, 0);
      assert.equal((await call(`/products?storeId=${store.id}&search=${partial}&searchMode=name`)).total, 0);
      assert((await call(`/products?storeId=${store.id}&search=${partial}`)).total >= 1);
      assert.equal(await prisma.pOSProduct.count(), before);
    });
    await test("exact barcode/SKU resolve the variant UUID and selected-store balance", async () => {
      for (const code of [variant().barcode, variant().sku]) {
        const exact = await call(`/products/lookup?storeId=${store.id}&code=${code}`);
        assert.equal(exact.matches[0].id, variant().id);
        assert.deepEqual(exact.matches[0].balances.map((balance: any) => balance.storeId), [store.id]);
      }
    });
    await test("name suggestions search real names without barcode substring substitution", async () => {
      const found = await call(`/products?storeId=${store.id}&search=${encodeURIComponent(product.name)}&searchMode=name`);
      assert.equal(found.items[0].id, product.id);
    });
    await test("registration rejects forbidden stores and rolls back inactive-store stock", async () => {
      await call("/products", registration("DENIED"), 403, limitedToken);
      const offline = await prisma.store.create({ data: { name: `Offline ${suffix}`, isActive: false } });
      const input = registration("OFFLINE", offline.id);
      await call("/products", input, 404);
      assert.equal(await prisma.pOSProduct.count({ where: { code: input.code } }), 0);
      const storeManager: Actor = { ...actor, admin: false, permissions: { "pos.catalog": true, "pos.inventory": true } };
      await assert.rejects(service.createProduct(storeManager, registration("CROSS", other.id)), /Store access denied/);
    });
    await test("store salespeople exclude inactive, ineligible and disabled accounts and expose actual GUID/name", async () => {
      const people = await call(`/salespeople?storeId=${store.id}`);
      assert.equal(people.length, 1);
      assert.equal(people[0].id, seller.id); assert.equal(people[0].employeeID, seller.employeeID);
      assert.equal(people[0].name, `${seller.firstName} ${seller.lastName}`);
      await call(`/salespeople?storeId=${other.id}`, undefined, 403, limitedToken);
    });
    const register = await prisma.pOSRegister.create({ data: { storeId: store.id, name: `Scan register ${suffix}` } });
    const session = await service.openRegister(actor, register.id, { openingCash: "0" });
    const input = { storeId: store.id, sessionId: session.id, salespersonId: seller.id, items: [{ variantId: variant().id, quantity: 2, salespersonId: seller.id }], payments: [{ method: "CASH", amount: "210" }], idempotencyKey: randomUUID() };
    let sale: any;
    await test("checkout saves real employee FK/GUID relationship, totals, payments and stock once", async () => {
      sale = await call("/sales", input); const repeated = await call("/sales", input);
      assert.equal(sale.id, repeated.id); assert.equal(sale.items[0].salespersonId, seller.id);
      assert.equal(sale.items[0].salesperson.employeeID, seller.employeeID);
      assert.equal(sale.grandTotal, "210"); assert.equal(sale.taxTotal, "10"); assert.equal(sale.payments[0].amount, "210");
      const balance = await prisma.pOSInventoryBalance.findUniqueOrThrow({ where: { storeId_variantId: { storeId: store.id, variantId: variant().id } } });
      assert.equal(balance.quantity, 3);
    });
    await test("history, invoice and receipt retain the actual selected salesperson name", async () => {
      const detail = await call(`/sales/${sale.id}`);
      const history = await call(`/sales?storeId=${store.id}&search=${sale.invoiceNo}`);
      assert.equal(history.items[0].items[0].salesperson.employeeID, seller.employeeID);
      assert.equal(receiptFromSale(detail).items[0].salesmanName, `${seller.firstName} ${seller.lastName}`);
    });
    await test("unassigned row stays unassigned even with an order-level salesperson", async () => {
      const result = await call("/sales", { ...input, idempotencyKey: randomUUID(), items: [{ variantId: variant().id, quantity: 1, salespersonId: null }], payments: [{ method: "CASH", amount: "105" }] });
      assert.equal(result.items[0].salespersonId, null);
      assert.equal(receiptFromSale(await call(`/sales/${result.id}`)).items[0].salesmanName, "Unassigned");
    });
    await test("inactive, ineligible, cross-store and malformed employee IDs fail without stock or sale changes", async () => {
      const before = await prisma.pOSSale.count();
      for (const person of [inactive, ineligible, foreign]) await call("/sales", { ...input, idempotencyKey: randomUUID(), salespersonId: person.id }, 400);
      await call("/sales", { ...input, idempotencyKey: randomUUID(), salespersonId: seller.employeeID }, 400);
      assert.equal(await prisma.pOSSale.count(), before);
    });
    await test("cross-store lookup/checkout and unauthorized registration remain blocked; assigned-store sale reads work", async () => {
      await call(`/products/lookup?storeId=${other.id}&code=${variant().barcode}`, undefined, 403, limitedToken);
      await call("/sales", { ...input, storeId: other.id, idempotencyKey: randomUUID() }, 403, limitedToken);
      await call(`/sales/${sale.id}`, undefined, 200, limitedToken);
      await call("/products", registration("RESTRICTED"), 403, limitedToken);
    });
    console.log(`PASS ${passed} real PostgreSQL/HTTP scan, registration and salesperson checks`);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await prisma.$disconnect(); }
}
main().then(() => process.exit(0)).catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
