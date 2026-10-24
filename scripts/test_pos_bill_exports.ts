import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import express from "express";
import ExcelJS from "exceljs";
import { prisma } from "../src/utils/db";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";
import { exportFilter, csvCell } from "../src/pos/billExports";
import { Actor } from "../src/pos/auth";
const url = new URL(process.env.POS_TEST_DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "55439" && url.pathname.includes("pos_test") && process.env.DATABASE_URL === process.env.POS_TEST_DATABASE_URL, "Isolated POS test database required");
let passed = 0;
async function test(name: string, fn: () => Promise<void>) { await fn(); console.log(`PASS ${name}`); passed++; }
async function main() {
  const suffix = randomUUID();
  const admin = await prisma.user.create({ data: { email: `export-${suffix}@test.invalid`, password: "test", role: "ADMIN" } });
  const clerk = await prisma.user.create({ data: { email: `clerk-${suffix}@test.invalid`, password: "test", role: "EMPLOYEE" } });
  const store = await prisma.store.create({ data: { name: `HopKid Export ${suffix}`, address: "Sarabhai Road, Vadodara, Gujarat" } });
  const other = await prisma.store.create({ data: { name: `Other ${suffix}` } });
  await prisma.workMode.upsert({ where: { id: "OFFICE" }, create: { id: "OFFICE", name: "Office" }, update: {} });
  const employee = await prisma.employee.create({ data: { userId: clerk.id, employeeCode: suffix, firstName: "Test", lastName: "Salesperson", source: "HOPKID", status: "active", storeId: store.id } });
  const register = await prisma.pOSRegister.create({ data: { storeId: store.id, name: "Export" } });
  const session = await prisma.pOSSession.create({ data: { registerId: register.id, userId: admin.id, openingCash: 0 } });
  const reg2 = await prisma.pOSRegister.create({ data: { storeId: other.id, name: "Other" } });
  const sess2 = await prisma.pOSSession.create({ data: { registerId: reg2.id, userId: admin.id, openingCash: 0 } });
  const make = (status: string, amount: number, storeId = store.id, createdAt = new Date("2026-10-20T18:29:59Z"), itemCount = 1) => prisma.pOSSale.create({ data: {
    invoiceNo: `POS-EXPORT-${randomUUID().slice(0, 8)}`, idempotencyKey: randomUUID(), requestHash: "export-test", storeId,
    sessionId: storeId === store.id ? session.id : sess2.id, cashierId: admin.id, salespersonId: employee.id,
    customerName: "=SUM(1,2)", customerPhone: "9000000000", status, createdAt,
    subtotal: amount, discountTotal: 0, taxTotal: amount * .05, grandTotal: amount * 1.05,
    items: { create: Array.from({ length: itemCount }, (_, i) => ({
      name: `Kids Cotton T-Shirt ${i + 1} - comfortable everyday wear`, barcode: `8901234567${i.toString().padStart(3, "0")}`, sku: `EXPORT-${i}`,
      brand: "HopKid", quantity: 1, unitPrice: amount / itemCount, costPrice: 0, discountPerUnit: 0, discountTotal: 0,
      taxRate: 5, taxTotal: amount * .05 / itemCount, lineTotal: amount * 1.05 / itemCount, salespersonId: employee.id,
    })) }, payments: { create: [{ method: "CASH", amount: amount * .5 }, { method: "UPI", amount: amount * .55 }] },
  } });
  const a = await make("COMPLETED", 1000), b = await make("CANCELLED", 300), c = await make("COMPLETED", 500, store.id, new Date("2026-10-20T18:30:00Z"));
  const foreign = await make("COMPLETED", 999, other.id);
  const long = await make("COMPLETED", 600, store.id, new Date("2026-09-01T00:00:00Z"), 60);
  const app = express(); app.use(express.json()); app.use("/api/v1/pos", routes);
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const request = (path: string, body: unknown, user = admin) => fetch(`http://127.0.0.1:${port}/api/v1/pos/bill-exports/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${signAccessToken({ id: user.id, role: user.role })}` }, body: JSON.stringify(body),
  });
  const base = { storeId: store.id, format: "csv" };
  const save = (name: string, buffer: Buffer) => { const dir = process.env.POS_EXPORT_QA_DIR; if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/${name}`, buffer); } };
  try {
    await test("export APIs require authentication", async () => {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/pos/bill-exports/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(base) });
      assert.equal(r.status, 401);
    });
    await test("individual completed invoice PDF with meaningful filename", async () => {
      const r = await request("download", { ...base, format: "pdf", paper: "80", saleIds: [a.id] });
      assert.equal(r.status, 200); assert(r.headers.get("content-disposition")!.includes(a.invoiceNo.replace(/^POS-/, "HK-") + ".pdf"));
      const data = Buffer.from(await r.arrayBuffer()); assert.equal(data.subarray(0, 4).toString(), "%PDF"); save("completed-80.pdf", data);
    });
    await test("cancelled invoice PDF remains exportable with its original amount", async () => {
      const r = await request("download", { ...base, format: "pdf", paper: "58", saleIds: [b.id] });
      assert.equal(r.status, 200); save("cancelled-58.pdf", Buffer.from(await r.arrayBuffer()));
      assert.equal((await prisma.pOSSale.findUniqueOrThrow({ where: { id: b.id } })).status, "CANCELLED");
    });
    await test("selected invoices combine into one PDF; long invoice pagination", async () => {
      const r = await request("download", { ...base, format: "pdf", paper: "A4", saleIds: [a.id, b.id, long.id] });
      assert.equal(r.status, 200); assert.equal(r.headers.get("x-export-count"), "3"); save("selected-A4.pdf", Buffer.from(await r.arrayBuffer()));
    });
    await test("store preview and export contain all matching invoices, no payment join duplication", async () => {
      const preview = await request("preview", base); assert.equal((await preview.json() as any).data.count, 4);
      const r = await request("download", base); const csv = await r.text(); assert.equal(r.status, 200);
      assert.equal(csv.trim().split("\r\n").length, 5); assert(csv.includes(a.invoiceNo)); assert(csv.includes(b.invoiceNo)); assert(!csv.includes(foreign.invoiceNo));
      assert(csv.includes('"1050.00"')); assert(csv.includes('"CASH: 500.00; UPI: 550.00"')); assert(csv.includes("'=SUM(1,2)"));
      save("invoices.csv", Buffer.from(csv));
    });
    await test("status, payment and custom IST date filters match preview and downloads", async () => {
      const input = { ...base, from: "2026-10-20", to: "2026-10-20", paymentMode: "UPI", status: "COMPLETED" };
      const preview = await request("preview", input); assert.equal((await preview.json() as any).data.count, 1);
      const r = await request("download", input); const csv = await r.text(); assert(csv.includes(a.invoiceNo)); assert(!csv.includes(b.invoiceNo)); assert(!csv.includes(c.invoiceNo));
      const multiYear = await request("preview", { ...base, from: "2024-01-01", to: "2026-12-31" }); assert.equal(multiYear.status, 200);
    });
    await test("CSV detailed rows contain actual product, barcode, tax and staff values", async () => {
      const r = await request("download", { ...base, detailed: true, saleIds: [a.id] }); const csv = await r.text();
      assert(csv.includes("Product")); assert(csv.includes("8901234567000")); assert(csv.includes('"50.00"')); assert(csv.includes("Test Salesperson"));
    });
    await test("Excel export has the required invoice columns and database values", async () => {
      const r = await request("download", { ...base, format: "xlsx", saleIds: [a.id, b.id] }); assert.equal(r.status, 200);
      const buffer = Buffer.from(await r.arrayBuffer()); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
      const sheet = workbook.worksheets[0]; assert.equal(sheet.rowCount, 3); assert.equal(sheet.columnCount, 14);
      const data = [sheet.getRow(2).values, sheet.getRow(3).values] as any[];
      assert(data.some(row => row.includes("CANCELLED") && row.includes("315.00")));
      assert(data.some(row => row.includes("COMPLETED") && row.includes("1050.00"))); save("invoices.xlsx", buffer);
    });
    await test("backend blocks unauthorized stores and mixed-store selections", async () => {
      assert.equal((await request("download", { ...base, storeId: other.id }, clerk)).status, 403);
      assert.equal((await request("download", { ...base, saleIds: [foreign.id] }, clerk)).status, 400);
      assert.equal((await request("preview", { ...base, saleIds: [a.id, foreign.id] })).status, 400);
      const actor: Actor = { userId: clerk.id, role: "STORE_POS", admin: false, storeId: store.id, isPosStoreSession: true, permissions: { "pos.read": true } };
      assert.throws(() => exportFilter(actor, { ...base, storeId: other.id }), /Unauthorized store/);
    });
    await test("empty exports and malformed filters return clear errors", async () => {
      const empty = { ...base, from: "2020-01-01", to: "2020-01-01" };
      assert.equal((await (await request("preview", empty)).json() as any).data.count, 0);
      assert.equal((await request("download", empty)).status, 404);
      for (const bad of [{ ...base, from: "2026-10-22", to: "2026-10-20" }, { ...base, from: "2026-02-30", to: "2026-03-01" },
        { ...base, saleIds: ["invalid"] }, { ...base, saleIds: [randomUUID()] }, { ...base, status: "UNKNOWN" }, { ...base, format: "exe" }, { format: "csv" }, { ...base, saleIds: [] }])
        assert.equal((await request("download", bad)).status, 400);
      assert.equal(csvCell("@SUM(1)"), '"\'@SUM(1)"');
    });
    await test("large CSV/Excel exports span batches without duplicates; PDF cap is explicit", async () => {
      await prisma.pOSSale.createMany({ data: Array.from({ length: 601 }, (_, i) => ({
        invoiceNo: `BULK-${suffix}-${i}`, idempotencyKey: randomUUID(), requestHash: "bulk", storeId: store.id,
        sessionId: session.id, cashierId: admin.id, subtotal: 1, discountTotal: 0, taxTotal: 0, grandTotal: 1,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })) });
      const filter = { ...base, from: "2026-01-01", to: "2026-01-01" };
      const r = await request("download", filter); const csv = await r.text(); assert.equal(r.status, 200);
      const lines = csv.trim().split("\r\n"); assert.equal(lines.length, 602); assert.equal(new Set(lines.slice(1)).size, 601);
      const excel = await request("download", { ...filter, format: "xlsx" }); assert.equal(excel.status, 200);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await excel.arrayBuffer()) as any); assert.equal(book.worksheets[0].rowCount, 602);
      const pdf = await request("download", { ...filter, format: "pdf" }); assert.equal(pdf.status, 413);
    });
    await test("exports do not mutate invoices, amounts, payments or audit history", async () => {
      const data = await prisma.pOSSale.findUniqueOrThrow({ where: { id: a.id }, include: { payments: true } });
      assert.equal(data.status, "COMPLETED"); assert.equal(Number(data.grandTotal), 1050); assert.equal(data.payments.length, 2);
      assert.equal(await prisma.pOSAuditLog.count({ where: { entityId: a.id } }), 0);
    });
    console.log(`${passed} bill export checks passed`);
    if (process.env.POS_EXPORT_QA_DIR) writeFileSync(`${process.env.POS_EXPORT_QA_DIR}/fixture.json`, JSON.stringify({ a, b, long }));
  } finally { server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
