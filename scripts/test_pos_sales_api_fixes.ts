import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/utils/db";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";

async function run() {
  console.log("=== STARTING POS SALES API FIXES VERIFICATION ===");
  const key = randomUUID().slice(0, 8);

  // 1. Create a store for testing
  const store = await prisma.store.create({
    data: { name: `HOPKID POS TEST STORE ${key}`, code: `HPS_${key}`, isActive: true },
  });

  // 2. Create cashier user & employee record linked to store
  const cashier = await prisma.user.create({
    data: { email: `cashier-${key}@pos.test`, password: "dummy", role: "ADMIN" },
  });
  await prisma.employee.create({
    data: {
      userId: cashier.id,
      storeId: store.id,
      firstName: "Cashier",
      lastName: key,
      employeeCode: `CASH_${key}`,
      status: "ACTIVE",
    },
  });
  const token = signAccessToken({ id: cashier.id, role: cashier.role });

  // 3. Setup Express server
  const app = express();
  app.use(express.json());
  app.use("/api/v1/pos", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/pos`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Single manually entered item (Name, Barcode, Quantity, Price, Discount, GST)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 1: Single Manual Item Sale ---");
    const quoteRes1 = await fetch(`${baseUrl}/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        storeId: store.id,
        items: [
          {
            manual: true,
            name: "Custom Kids T-Shirt",
            barcode: `MANUAL-BC-${key}-1`,
            quantity: 2,
            unitPrice: "450.00",
            discountPerUnit: "50.00",
            taxRate: "5.00",
          },
        ],
        orderDiscount: "0",
      }),
    });
    const quoteJson1 = await quoteRes1.json();
    assert.equal(quoteRes1.status, 200, `Quote failed: ${JSON.stringify(quoteJson1)}`);
    console.log("Quote 1 result:", quoteJson1.data);
    const total1 = quoteJson1.data.grandTotal;

    const saleRes1 = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        storeId: store.id,
        items: [
          {
            manual: true,
            name: "Custom Kids T-Shirt",
            barcode: `MANUAL-BC-${key}-1`,
            quantity: 2,
            unitPrice: "450.00",
            discountPerUnit: "50.00",
            taxRate: "5.00",
          },
        ],
        orderDiscount: "0",
        payments: [{ method: "CASH", amount: total1 }],
        idempotencyKey: randomUUID(),
      }),
    });
    const saleJson1 = await saleRes1.json();
    assert.equal(saleRes1.status, 200, `Sale 1 failed: ${JSON.stringify(saleJson1)}`);
    assert.ok(saleJson1.data.invoiceNo, "Invoice number must be present");
    assert.equal(saleJson1.data.items.length, 1);
    assert.equal(saleJson1.data.items[0].name, "Custom Kids T-Shirt");
    assert.equal(saleJson1.data.items[0].barcode, `MANUAL-BC-${key}-1`);
    assert.equal(saleJson1.data.items[0].variantId, null, "Manual item must not have variantId");
    console.log(`✓ Test 1 Passed: Single manual item billed successfully. Invoice: ${saleJson1.data.invoiceNo}`);

    // -------------------------------------------------------------------------
    // TEST 2: Multiple manual items with different quantities, prices, discounts
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 2: Multiple Manual Items Sale ---");
    const manualItems2 = [
      {
        manual: true,
        key: "line-1",
        name: "Manual Shoes",
        barcode: `SHOES-${key}`,
        quantity: 1,
        unitPrice: "1200.00",
        discountPerUnit: "100.00",
        taxRate: "12.00",
      },
      {
        manual: true,
        key: "line-2",
        name: "Manual Socks",
        barcode: `SOCKS-${key}`,
        quantity: 3,
        unitPrice: "150.00",
        discountPerUnit: "10.00",
        taxRate: "5.00",
      },
    ];

    const quoteRes2 = await fetch(`${baseUrl}/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        storeId: store.id,
        items: manualItems2,
        orderDiscount: "50.00",
      }),
    });
    const quoteJson2 = await quoteRes2.json();
    assert.equal(quoteRes2.status, 200, `Quote 2 failed: ${JSON.stringify(quoteJson2)}`);
    const total2 = quoteJson2.data.grandTotal;

    const saleRes2 = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        storeId: store.id,
        items: manualItems2,
        orderDiscount: "50.00",
        payments: [{ method: "CARD", amount: total2, reference: "AUTH-12345" }],
        idempotencyKey: randomUUID(),
      }),
    });
    const saleJson2 = await saleRes2.json();
    assert.equal(saleRes2.status, 200, `Sale 2 failed: ${JSON.stringify(saleJson2)}`);
    assert.equal(saleJson2.data.items.length, 2);
    assert.equal(saleJson2.data.payments[0].method, "CARD");
    console.log(`✓ Test 2 Passed: Multiple manual items billed with CARD. Invoice: ${saleJson2.data.invoiceNo}`);

    // -------------------------------------------------------------------------
    // TEST 3: UPI Payment & Split Payment
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 3: UPI Payment ---");
    const quoteRes3 = await fetch(`${baseUrl}/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        storeId: store.id,
        items: [
          {
            manual: true,
            name: "School Bag",
            barcode: `BAG-${key}`,
            quantity: 1,
            unitPrice: "800.00",
            taxRate: "18.00",
          },
        ],
        orderDiscount: "0",
      }),
    });
    const quoteJson3 = await quoteRes3.json();
    assert.equal(quoteRes3.status, 200);
    const total3 = quoteJson3.data.grandTotal;

    const saleRes3 = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        storeId: store.id,
        items: [
          {
            manual: true,
            name: "School Bag",
            barcode: `BAG-${key}`,
            quantity: 1,
            unitPrice: "800.00",
            taxRate: "18.00",
          },
        ],
        orderDiscount: "0",
        payments: [{ method: "UPI", amount: total3, reference: "upi@okbank" }],
        idempotencyKey: randomUUID(),
      }),
    });
    const saleJson3 = await saleRes3.json();
    assert.equal(saleRes3.status, 200, `Sale 3 failed: ${JSON.stringify(saleJson3)}`);
    assert.equal(saleJson3.data.payments[0].method, "UPI");
    console.log(`✓ Test 3 Passed: UPI payment billed successfully. Invoice: ${saleJson3.data.invoiceNo}`);

    // -------------------------------------------------------------------------
    // TEST 4: Cash Overpayment (Cash Tender >= Grand Total)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 4: Cash Overpayment (Change Due) ---");
    // Bill total is 944.00, cashier tenders 1000.00 cash
    const saleRes4 = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        storeId: store.id,
        items: [
          {
            manual: true,
            name: "Toy Robot",
            quantity: 1,
            unitPrice: "800.00",
            taxRate: "18.00",
          },
        ],
        orderDiscount: "0",
        payments: [{ method: "CASH", amount: "1000.00" }], // 1000 tendered on 944 bill
        idempotencyKey: randomUUID(),
      }),
    });
    const saleJson4 = await saleRes4.json();
    assert.equal(saleRes4.status, 200, `Sale 4 failed: ${JSON.stringify(saleJson4)}`);
    assert.equal(saleJson4.data.payments[0].amount, saleJson4.data.grandTotal, "Payment should be normalized to grandTotal");
    console.log(`✓ Test 4 Passed: Cash overpayment handled cleanly without 400. Invoice: ${saleJson4.data.invoiceNo}`);

    // -------------------------------------------------------------------------
    // TEST 5: Concurrent Double-Click (Race Condition) - Same IdempotencyKey
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 5: Concurrent Double-Click (Anti-409) ---");
    const concurrentKey = randomUUID();
    const concurrentPayload = {
      storeId: store.id,
      items: [
        {
          manual: true,
          name: "Concurrent Test Product",
          quantity: 1,
          unitPrice: "250.00",
          taxRate: "5.00",
        },
      ],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: "262.50" }],
      idempotencyKey: concurrentKey,
    };

    // Send two requests at the exact same millisecond
    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/sales`, {
        method: "POST",
        headers,
        body: JSON.stringify(concurrentPayload),
      }),
      fetch(`${baseUrl}/sales`, {
        method: "POST",
        headers,
        body: JSON.stringify(concurrentPayload),
      }),
    ]);

    const jsonA = await resA.json();
    const jsonB = await resB.json();

    console.log(`Request A status: ${resA.status}, invoice: ${jsonA.data?.invoiceNo}`);
    console.log(`Request B status: ${resB.status}, invoice: ${jsonB.data?.invoiceNo}`);

    assert.equal(resA.status, 200, `Request A failed: ${JSON.stringify(jsonA)}`);
    assert.equal(resB.status, 200, `Request B failed: ${JSON.stringify(jsonB)}`);
    assert.equal(jsonA.data.id, jsonB.data.id, "Both concurrent requests must return the exact same sale ID");
    assert.equal(jsonA.data.invoiceNo, jsonB.data.invoiceNo, "Both concurrent requests must return the exact same invoice");

    // Verify only 1 sale record exists in DB
    const dbSales = await prisma.pOSSale.count({ where: { idempotencyKey: concurrentKey } });
    assert.equal(dbSales, 1, "Exactly one sale must be stored in the database");
    console.log(`✓ Test 5 Passed: Concurrent double-click handled gracefully without 409 conflict! Single DB sale created.`);

    // -------------------------------------------------------------------------
    // TEST 6: Subsequent Idempotent Retry
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 6: Subsequent Idempotent Retry ---");
    const retryRes = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers,
      body: JSON.stringify(concurrentPayload),
    });
    const retryJson = await retryRes.json();
    assert.equal(retryRes.status, 200);
    assert.equal(retryJson.data.id, jsonA.data.id);
    console.log(`✓ Test 6 Passed: Idempotent retry returns existing sale ${retryJson.data.invoiceNo}`);

    // -------------------------------------------------------------------------
    // TEST 7: Transaction & Database Integrity
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 7: Database Transaction & Integrity ---");
    const saleRecord = await prisma.pOSSale.findUnique({
      where: { id: jsonA.data.id },
      include: { items: true, payments: true, session: true },
    });
    assert.ok(saleRecord, "Sale record must exist in DB");
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saleRecord.id), "Sale ID must be UUID");
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saleRecord.sessionId), "Session ID must be UUID");
    assert.equal(saleRecord.items.length, 1);
    assert.equal(saleRecord.payments.length, 1);
    console.log(`✓ Test 7 Passed: Sale ${saleRecord.invoiceNo} has full transaction integrity with UUIDs.`);

    console.log("\n=== ALL POS SALES API TESTS PASSED SUCCESSFULLY! ===");
  } finally {
    server.close();
  }
}

run().catch((e) => {
  console.error("Test failed with error:", e);
  process.exit(1);
});
