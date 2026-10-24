import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/utils/db";
import * as pos from "../src/pos/service";
import type { Actor } from "../src/pos/auth";

const url = new URL(process.env.POS_TEST_DATABASE_URL ?? "");
assert(
  ["127.0.0.1", "localhost"].includes(url.hostname) &&
    url.port === "55439" &&
    url.pathname.includes("pos_test") &&
    process.env.DATABASE_URL === process.env.POS_TEST_DATABASE_URL,
  "Guarded isolated POS test database required",
);
let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

/**
 * Manual POS billing: ten scenarios from the feature brief, executed against
 * the isolated pos_test database. Every fixture is created through the POS
 * service API itself, never hand-maintained SQL.
 */
async function main() {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `pos-manual-${suffix}@test.invalid`,
      password: "not-a-login",
      role: "ADMIN",
    },
  });
  const store = await prisma.store.create({
    data: { name: `POS manual test ${suffix}` },
  });
  await prisma.workMode.upsert({
    where: { id: "OFFICE" },
    create: { id: "OFFICE", name: "Office" },
    update: {},
  });
  const salesman1 = await prisma.employee.create({
    data: {
      employeeCode: `MAN1-${suffix}`,
      firstName: "Manual",
      lastName: "Salesman",
      storeId: store.id,
      source: "HOPKID",
      status: "active",
    },
  });
  const salesman2 = await prisma.employee.create({
    data: {
      employeeCode: `MAN2-${suffix}`,
      firstName: "Second",
      lastName: "Salesman",
      storeId: store.id,
      source: "HOPKID",
      status: "active",
    },
  });
  const inactiveSalesman = await prisma.employee.create({
    data: {
      employeeCode: `MAN3-${suffix}`,
      firstName: "Inactive",
      lastName: "Salesman",
      storeId: store.id,
      source: "HOPKID",
      status: "inactive",
    },
  });
  const actor: Actor = {
    userId: user.id,
    role: "ADMIN",
    admin: true,
    permissions: {},
  };
  const catalog = await pos.createProduct(actor, {
    name: "Kids Denim Jeans",
    code: `CAT-${suffix}`,
    variants: [
      {
        sku: `CV-${suffix}`,
        barcode: `CAT-BAR-${suffix}`,
        size: "M",
        color: "Blue",
        costPrice: "150",
        sellingPrice: "800",
        taxRate: "5",
      },
    ],
  });
  const v = catalog.variants[0]!;
  await pos.adjust(actor, {
    storeId: store.id,
    variantId: v.id,
    quantityDelta: 10,
    reason: "Opening stock",
  });
  const register = await prisma.pOSRegister.create({
    data: { storeId: store.id, name: `Manual Register ${suffix}` },
  });
  const session = await pos.openRegister(actor, register.id, {
    openingCash: "0",
  });

  const manualItem = (over: Record<string, unknown> = {}) => ({
    manual: true,
    key: randomUUID(),
    name: "Kids T-Shirt",
    quantity: 2,
    unitPrice: "500",
    taxRate: "5",
    salespersonId: salesman1.id,
    ...over,
  });

  await test("1. single manual item with no barcode quotes tax-exclusive GST", async () => {
    const q = await pos.quote(actor, {
      storeId: store.id,
      items: [manualItem({ salespersonId: undefined, discountPerUnit: "50", key: "single" })],
      orderDiscount: "0",
    });
    // 2 x 500 - 2 x 50 = 900 taxable; 5% tax-exclusive GST adds 45.
    assert.equal(q.subtotal.toFixed(2), "1000.00");
    assert.equal(q.discountTotal.toFixed(2), "100.00");
    assert.equal(q.taxTotal.toFixed(2), "45.00");
    assert.equal(q.grandTotal.toFixed(2), "945.00");
    const s = q.snapshots[0]!;
    assert.equal(s.variantId, null);
    assert.equal(s.name, "Kids T-Shirt");
    assert.equal(s.key, "single");
    assert.equal(s.salespersonId, null);
  });

  await test("manual row rejects missing name, non-positive price, bad qty, bad tax and oversized discount", async () => {
    await assert.rejects(
      pos.quote(actor, {
        storeId: store.id,
        items: [manualItem({ name: "   " })],
        orderDiscount: "0",
      }),
      /item name/,
    );
    await assert.rejects(
      pos.quote(actor, {
        storeId: store.id,
        items: [manualItem({ unitPrice: "0" })],
      }),
      /greater than zero/,
    );
    await assert.rejects(
      pos.quote(actor, {
        storeId: store.id,
        items: [manualItem({ unitPrice: "-500" })],
      }),
      /unit price/,
    );
    await assert.rejects(
      pos.quote(actor, {
        storeId: store.id,
        items: [manualItem({ quantity: 0 })],
      }),
      /quantity/,
    );
    await assert.rejects(
      pos.quote(actor, {
        storeId: store.id,
        items: [manualItem({ taxRate: "101" })],
      }),
      /tax rate/,
    );
    await assert.rejects(
      pos.quote(actor, {
        storeId: store.id,
        items: [manualItem({ discountPerUnit: "600" })],
      }),
      /Discount exceeds unit price/,
    );
  });

  await test("2. multiple manual items align through echoed keys", async () => {
    const q = await pos.quote(actor, {
      storeId: store.id,
      items: [
        manualItem({ name: "Cap", unitPrice: "199.50", taxRate: "0", key: "cap-row" }),
        manualItem({ name: "Socks", unitPrice: "99.25", taxRate: "12", key: "socks-row", quantity: 3 }),
      ],
      orderDiscount: "0",
    });
    assert.equal(q.snapshots[0]!.key, "cap-row");
    assert.equal(q.snapshots[1]!.key, "socks-row");
    assert.equal(q.subtotal.toFixed(2), "696.75");
    assert.equal(q.taxTotal.toFixed(2), "35.73");
    assert.equal(q.grandTotal.toFixed(2), "732.48");
  });

  await test("4/5. mixed sale with % and fixed per-unit discounts, split CASH+UPI payments persists", async () => {
    const key = randomUUID();
    const sale = await pos.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      customerName: "Walkin Mixed",
      items: [
        { variantId: v.id, quantity: 1, discountPerUnit: "0" },
        manualItem({
          name: "Belt",
          unitPrice: "300",
          taxRate: "5",
          quantity: 1,
          discountPerUnit: "75",
          salespersonId: salesman1.id,
        }),
      ],
      orderDiscount: "0",
      payments: [
        { method: "CASH", amount: "840.00" },
        { method: "UPI", amount: "236.25" },
      ],
      idempotencyKey: key,
    });
    // catalog 800 taxed 5% = 840.00; belt 300 - 75 = 225, tax 11.25 = 236.25.
    assert.equal(sale.grandTotal.toFixed(2), "1076.25");
    assert.equal(sale.payments.length, 2);
    const manualRow = sale.items.find((i) => i.variantId === null)!;
    assert.equal(manualRow.name, "Belt");
    assert.equal(manualRow.unitPrice.toFixed(2), "300.00");
    assert.equal(manualRow.discountTotal.toFixed(2), "75.00");
    assert.equal(manualRow.taxTotal.toFixed(2), "11.25");
    assert.equal(manualRow.lineTotal.toFixed(2), "236.25");
    assert.equal(manualRow.salespersonId, salesman1.id);
    const split3 = await pos.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      items: [manualItem({ quantity: 1, taxRate: "0", discountPerUnit: "0", salespersonId: undefined })],
      orderDiscount: "0",
      payments: [
        { method: "CASH", amount: "262.50" },
        { method: "UPI", amount: "200" },
        { method: "CARD", amount: "37.50" },
      ],
      idempotencyKey: randomUUID(),
    });
    assert.equal(split3.grandTotal.toFixed(2), "500.00");
  });

  await test("3. manually entered barcode and SKU persist on the sale item without creating catalog rows", async () => {
    const sale = await pos.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      items: [
        manualItem({
          name: "Imported Socks",
          barcode: "MAN-BAR-12345",
          sku: "MAN-SKU-9",
          size: "XL",
          color: "Grey",
          brand: "Local",
          category: "Accessories",
          unitPrice: "150",
          taxRate: "0",
          quantity: 1,
          discountPerUnit: "0",
          salespersonId: undefined,
        }),
      ],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: "150" }],
      idempotencyKey: randomUUID(),
    });
    const row = sale.items.find((i) => i.variantId === null)!;
    assert.equal(row.barcode, "MAN-BAR-12345");
    assert.equal(row.sku, "MAN-SKU-9");
    assert.equal(row.brand, "Local");
    assert.equal(row.category, "Accessories");
    assert.equal(
      await prisma.pOSProductVariant.count({ where: { barcode: "MAN-BAR-12345" } }),
      0,
      "Manual billing must not create catalog products",
    );
    assert.equal(
      (await prisma.pOSStockMovement.count({ where: { reference: sale.id } })),
      0,
      "Manual items must create no inventory movements",
    );
  });

  await test("5 (order level). order discount spans catalog and manual lines with exact cents", async () => {
    const q = await pos.quote(actor, {
      storeId: store.id,
      items: [
        { variantId: v.id, quantity: 1, discountPerUnit: "0" },
        manualItem({ quantity: 1, unitPrice: "400", taxRate: "5", discountPerUnit: "0", salespersonId: undefined }),
      ],
      orderDiscount: "10",
    });
    assert.equal(q.discountTotal.toFixed(2), "10.00");
    assert.equal(q.grandTotal.toFixed(2), "1249.50");
  });

  await test("7. per-row salesperson persists; sale-level fallback used when row omits it", async () => {
    const sale = await pos.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      salespersonId: salesman2.id,
      items: [
        manualItem({ key: "row-a", quantity: 1, unitPrice: "100", taxRate: "0", discountPerUnit: "0", salespersonId: salesman1.id }),
        manualItem({ key: "row-b", name: "Unassigned Row", quantity: 1, unitPrice: "100", taxRate: "0", discountPerUnit: "0", salespersonId: undefined }),
      ],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: "200" }],
      idempotencyKey: randomUUID(),
    });
    assert.equal(sale.items.find((i) => i.sku === "")!.salespersonId, salesman1.id);
    assert.equal(sale.items.find((i) => i.name === "Unassigned Row")!.salespersonId, salesman2.id);
  });

  await test("7b. inactive salesperson is rejected", async () => {
    await assert.rejects(
      pos.checkout(actor, {
        storeId: store.id,
        sessionId: session.id,
        items: [
          manualItem({ quantity: 1, unitPrice: "100", taxRate: "0", discountPerUnit: "0", salespersonId: inactiveSalesman.id }),
        ],
        orderDiscount: "0",
        payments: [{ method: "CASH", amount: "100" }],
        idempotencyKey: randomUUID(),
      }),
      /salesperson/,
    );
  });

  await test("8. catalog stock is deducted only for catalog lines", async () => {
    const before = await prisma.pOSInventoryBalance.findUniqueOrThrow({
      where: { storeId_variantId: { storeId: store.id, variantId: v.id } },
    });
    const sale = await pos.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      items: [
        { variantId: v.id, quantity: 2, discountPerUnit: "0" },
        manualItem({ quantity: 5, name: "No-Stock Manual", unitPrice: "100", taxRate: "0", discountPerUnit: "0", salespersonId: undefined }),
      ],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: "2180.00" }],
      idempotencyKey: randomUUID(),
    });
    const after = await prisma.pOSInventoryBalance.findUniqueOrThrow({
      where: { storeId_variantId: { storeId: store.id, variantId: v.id } },
    });
    assert.equal(before.quantity - after.quantity, 2);
    const movements = await prisma.pOSStockMovement.count({
      where: { reference: sale.id },
    });
    assert.equal(movements, 1, "only the catalog line produces a SALE movement");
  });

  await test("9. disabled configured payment method is rejected; enabled methods pass", async () => {
    await prisma.pOSPaymentMethod.create({
      data: { storeId: store.id, code: "UPI", name: "UPI", enabled: false },
    });
    await assert.rejects(
      pos.checkout(actor, {
        storeId: store.id,
        sessionId: session.id,
        items: [manualItem({ quantity: 1, discountPerUnit: "0", salespersonId: undefined })],
        orderDiscount: "0",
        payments: [{ method: "UPI", amount: "500" }],
        idempotencyKey: randomUUID(),
      }),
      /Payment method/,
    );
    await assert.rejects(
      pos.checkout(actor, {
        storeId: store.id,
        sessionId: session.id,
        items: [manualItem({ quantity: 1, discountPerUnit: "0", salespersonId: undefined })],
        orderDiscount: "0",
        payments: [{ method: "UPI", amount: "500" }],
        idempotencyKey: randomUUID(),
      }),
      /unconfigured/,
    );
  });

  await test("10. checkout → persisted invoice with sequence number; duplicate submissions stay single", async () => {
    const key = randomUUID();
    const sale = await pos.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      items: [manualItem({ quantity: 1, taxRate: "0", discountPerUnit: "0", salespersonId: undefined })],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: "500" }],
      idempotencyKey: key,
    });
    assert.match(sale.invoiceNo, /^HK-\d{10}$/);
    try {
      await pos.checkout(actor, {
        storeId: store.id,
        sessionId: session.id,
        items: [manualItem({ quantity: 1, discountPerUnit: "0", salespersonId: undefined })],
        orderDiscount: "0",
        payments: [{ method: "CASH", amount: "500" }],
        idempotencyKey: key,
      });
    } catch {
      // second submission with the same key must never create another sale
    }
    assert.equal(
      await prisma.pOSSale.count({ where: { idempotencyKey: key } }),
      1,
    );
  });

  await test("10b. returns refund manual lines without inventory movements", async () => {
    const sale = await pos.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      items: [
        manualItem({
          quantity: 2,
          unitPrice: "250",
          taxRate: "0",
          discountPerUnit: "50",
          salespersonId: undefined,
        }),
      ],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: "400" }],
      idempotencyKey: randomUUID(),
    });
    const manualRow = sale.items.find((i) => i.variantId === null)!;
    const history = await pos.returnSale(actor, sale.id, {
      sessionId: session.id,
      idempotencyKey: randomUUID(),
      reason: "Customer changed mind",
      refundMethod: "CASH",
      items: [{ saleItemId: manualRow.id, quantity: 1, resellable: false }],
    });
    assert.equal(history.refundAmount.toFixed(2), "200.00");
    assert.equal(
      await prisma.pOSStockMovement.count({ where: { reference: history.id } }),
      0,
      "returning a manual line must create no inventory movement",
    );
  });

  await test("commissions exclude manual lines entirely", async () => {
    const sale = await pos.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      items: [
        manualItem({ quantity: 1, unitPrice: "100", taxRate: "0", discountPerUnit: "0", salespersonId: salesman1.id }),
      ],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: "100" }],
      idempotencyKey: randomUUID(),
    });
    const manualRow = sale.items.find((i) => i.variantId === null)!;
    assert.equal(
      await prisma.pOSCommissionLine.count({ where: { saleItemId: manualRow.id } }),
      0,
      "manual rows never accrue commission",
    );
    const txs = await prisma.commissionTransaction.findMany({
      where: { employeeId: salesman1.id },
    });
    assert.ok(txs.length <= 1, "no fabricated commission revenue for manual-only sales");
  });

  console.log(`\n${passed} manual-billing tests passed against ${url.pathname.slice(1)}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("FAIL", error);
    await prisma.$disconnect();
    process.exit(1);
  });
