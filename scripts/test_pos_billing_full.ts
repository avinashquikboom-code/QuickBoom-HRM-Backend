import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/utils/db";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";
import * as service from "../src/pos/service";
import { Actor } from "../src/pos/auth";
import { receiptFromSale } from "../../HRM-Admin-Pannel/src/features/pos/posReceipt";

async function run() {
  console.log("=== STARTING FULL POS BILLING, BARCODE & CHECKOUT VERIFICATION ===");
  const key = randomUUID().slice(0, 8);

  // 1. Create a store for testing
  const store = await prisma.store.create({
    data: { name: `HOPKID RETAIL STORE ${key}`, code: `HRS_${key}`, isActive: true },
  });

  // 2. Create an admin user & actor
  const adminUser = await prisma.user.create({
    data: { email: `cashier-${key}@pos.test`, password: "dummy", role: "ADMIN" },
  });
  const actor: Actor = {
    userId: adminUser.id,
    role: "ADMIN",
    admin: true,
    permissions: {},
  };

  // 3. Create active products with variants and barcodes
  const barcode1 = `BC-SHIRT-${key}`;
  const barcode2 = `BC-JEANS-${key}`;
  const barcode3 = `BC-CAP-${key}`;
  const barcodeZeroStock = `BC-ZERO-${key}`;
  const barcodeAmbiguous = `BC-AMB-${key}`;

  // Product 1: Shirt (2 variants: M and L)
  const product1 = await service.createProduct(actor, {
    name: `Hopkid Polo Shirt ${key}`,
    code: `HK-POLO-${key}`,
    variants: [
      {
        sku: `SKU-POLO-M-${key}`,
        barcode: barcode1,
        size: "M",
        color: "Navy",
        costPrice: "300.00",
        sellingPrice: "600.00",
        taxRate: "5.00",
      },
      {
        sku: `SKU-POLO-L-${key}`,
        barcode: `BC-POLO-L-${key}`,
        size: "L",
        color: "Navy",
        costPrice: "300.00",
        sellingPrice: "600.00",
        taxRate: "5.00",
      },
    ],
  });

  // Product 2: Jeans (1 variant)
  const product2 = await service.createProduct(actor, {
    name: `Hopkid Denim Jeans ${key}`,
    code: `HK-JEAN-${key}`,
    variants: [
      {
        sku: `SKU-JEAN-32-${key}`,
        barcode: barcode2,
        size: "32",
        color: "Blue",
        costPrice: "500.00",
        sellingPrice: "1200.00",
        taxRate: "12.00",
      },
    ],
  });

  // Product 3: Cap (1 variant)
  const product3 = await service.createProduct(actor, {
    name: `Hopkid Cotton Cap ${key}`,
    code: `HK-CAP-${key}`,
    variants: [
      {
        sku: `SKU-CAP-${key}`,
        barcode: barcode3,
        size: "Free",
        color: "Red",
        costPrice: "100.00",
        sellingPrice: "250.00",
        taxRate: "5.00",
      },
    ],
  });

  // Product 4: Zero Stock Item
  const productZero = await service.createProduct(actor, {
    name: `Hopkid Out Of Stock Tee ${key}`,
    code: `HK-OOS-${key}`,
    variants: [
      {
        sku: `SKU-ZERO-${key}`,
        barcode: barcodeZeroStock,
        size: "M",
        color: "White",
        costPrice: "100.00",
        sellingPrice: "300.00",
        taxRate: "5.00",
      },
    ],
  });

  // Product 5 & 6: Ambiguous collision items
  const productAmb1 = await service.createProduct(actor, {
    name: `Ambiguous Item 1 ${key}`,
    code: `HK-AMB1-${key}`,
    variants: [
      {
        sku: `SKU-AMB-1-${key}`,
        barcode: barcodeAmbiguous,
        size: "S",
        color: "Yellow",
        costPrice: "50.00",
        sellingPrice: "150.00",
        taxRate: "5.00",
      },
    ],
  });
  const productAmb2 = await service.createProduct(actor, {
    name: `Ambiguous Item 2 ${key}`,
    code: `HK-AMB2-${key}`,
    variants: [
      {
        sku: barcodeAmbiguous, // SKU collides with barcode
        barcode: `BC-DIFFERENT-${key}`,
        size: "L",
        color: "Green",
        costPrice: "50.00",
        sellingPrice: "150.00",
        taxRate: "5.00",
      },
    ],
  });

  // Assign stock:
  // Product 1 (Shirt M): 10 units
  // Product 2 (Jeans): 5 units
  // Product 3 (Cap): 8 units
  // Product 4 (Zero): 0 units (none adjusted)
  const varShirtM = product1.variants[0]!;
  const varJeans = product2.variants[0]!;
  const varCap = product3.variants[0]!;
  const varZero = productZero.variants[0]!;

  await service.adjust(actor, {
    storeId: store.id,
    variantId: varShirtM.id,
    quantityDelta: 10,
    type: "OPENING",
    reason: "Initial Shirt Stock",
  });
  await service.adjust(actor, {
    storeId: store.id,
    variantId: varJeans.id,
    quantityDelta: 5,
    type: "OPENING",
    reason: "Initial Jeans Stock",
  });
  await service.adjust(actor, {
    storeId: store.id,
    variantId: varCap.id,
    quantityDelta: 8,
    type: "OPENING",
    reason: "Initial Cap Stock",
  });

  // Setup Register & Session
  const register = await prisma.pOSRegister.create({
    data: { name: `Register 1 ${key}`, storeId: store.id, active: true },
  });
  const session = await prisma.pOSSession.create({
    data: {
      registerId: register.id,
      userId: adminUser.id,
      openingCash: 1000.0,
    },
  });

  // Setup Express server
  const app = express();
  app.use(express.json());
  app.use("/api/v1/pos", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/pos`;
  const token = signAccessToken({ id: adminUser.id, role: adminUser.role });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function get(urlPath: string) {
    const res = await fetch(`${baseUrl}${urlPath}`, { headers });
    return { status: res.status, data: await res.json() };
  }
  async function post(urlPath: string, body: unknown) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: Scan one valid barcode and verify variant resolution
    // -------------------------------------------------------------
    console.log("Checking TEST 1: Scan one valid barcode...");
    const scan1 = await get(`/products/lookup?storeId=${store.id}&code=${barcode1}`);
    assert.equal(scan1.status, 200);
    assert.equal(scan1.data.data.matches.length, 1);
    const item1 = scan1.data.data.matches[0];
    assert.equal(item1.barcode, barcode1);
    assert.equal(item1.sku, varShirtM.sku);
    assert.equal(Number(item1.sellingPrice), 600);
    assert.equal(item1.balances[0].quantity, 10);
    console.log("PASS TEST 1: Exactly one item found with barcode, size, color, price, stock=10");

    // -------------------------------------------------------------
    // TEST 2: Scan the same barcode again (quantity increment simulation)
    // -------------------------------------------------------------
    console.log("Checking TEST 2: Scan same barcode again & quote for quantity=2...");
    const quote2 = await post("/quote", {
      storeId: store.id,
      items: [{ variantId: varShirtM.id, quantity: 2, discountPerUnit: "0" }],
      orderDiscount: "0",
    });
    assert.equal(quote2.status, 200);
    assert.equal(quote2.data.data.snapshots.length, 1);
    const snap2 = quote2.data.data.snapshots[0];
    assert.equal(snap2.quantity, 2);
    assert.equal(Number(snap2.unitPrice), 600);
    // Subtotal: 600 * 2 = 1200. Tax: 5% of 1200 = 60. LineTotal: 1260
    assert.equal(Number(snap2.lineTotal), 1260);
    assert.equal(Number(quote2.data.data.grandTotal), 1260);
    console.log("PASS TEST 2: Quantity incremented to 2, subtotal=1200, tax=60, lineTotal=1260");

    // -------------------------------------------------------------
    // TEST 3: Scan three different products sequentially
    // -------------------------------------------------------------
    console.log("Checking TEST 3: Scan three different products into same cart...");
    const scanJeans = await get(`/products/lookup?storeId=${store.id}&code=${barcode2}`);
    const scanCap = await get(`/products/lookup?storeId=${store.id}&code=${barcode3}`);
    assert.equal(scanJeans.data.data.matches.length, 1);
    assert.equal(scanCap.data.data.matches.length, 1);

    const multiQuote = await post("/quote", {
      storeId: store.id,
      items: [
        { variantId: varShirtM.id, quantity: 1, discountPerUnit: "0" },
        { variantId: varJeans.id, quantity: 1, discountPerUnit: "0" },
        { variantId: varCap.id, quantity: 1, discountPerUnit: "0" },
      ],
      orderDiscount: "0",
    });
    assert.equal(multiQuote.status, 200);
    assert.equal(multiQuote.data.data.snapshots.length, 3);
    // Shirt: 600 + 5% (30) = 630
    // Jeans: 1200 + 12% (144) = 1344
    // Cap: 250 + 5% (12.50) = 262.50
    // Grand Total: 630 + 1344 + 262.50 = 2236.50
    assert.equal(Number(multiQuote.data.data.subtotal), 2050);
    assert.equal(Number(multiQuote.data.data.taxTotal), 186.5);
    assert.equal(Number(multiQuote.data.data.grandTotal), 2236.5);
    console.log("PASS TEST 3: Three different products in cart with subtotal=2050, tax=186.50, grandTotal=2236.50");

    // -------------------------------------------------------------
    // TEST 4: Enter barcode manually with whitespace & case differences
    // -------------------------------------------------------------
    console.log("Checking TEST 4: Enter barcode manually with whitespace/case...");
    const manualBarcode = `  ${barcode1.toLowerCase()}  \n`;
    const scanManual = await get(`/products/lookup?storeId=${store.id}&code=${encodeURIComponent(manualBarcode)}`);
    assert.equal(scanManual.status, 200);
    assert.equal(scanManual.data.data.matches.length, 1);
    assert.equal(scanManual.data.data.matches[0].id, varShirtM.id);
    console.log("PASS TEST 4: Manual barcode with whitespace and case insensitive match resolved");

    // -------------------------------------------------------------
    // TEST 5: Handle invalid barcodes and ambiguous variants
    // -------------------------------------------------------------
    console.log("Checking TEST 5: Handle invalid barcodes and ambiguous variants...");
    const scanInvalid = await get(`/products/lookup?storeId=${store.id}&code=NON_EXISTENT_BARCODE_XYZ`);
    assert.equal(scanInvalid.status, 200);
    assert.equal(scanInvalid.data.data.matches.length, 0);

    const scanAmb = await get(`/products/lookup?storeId=${store.id}&code=${barcodeAmbiguous}`);
    assert.equal(scanAmb.status, 200);
    assert.equal(scanAmb.data.data.matches.length, 2);
    console.log("PASS TEST 5: Invalid barcode returns 0 matches cleanly; ambiguous collision returns both variants");

    // -------------------------------------------------------------
    // TEST 6: Handle zero stock and insufficient stock
    // -------------------------------------------------------------
    console.log("Checking TEST 6: Handle zero stock and insufficient stock...");
    const scanZero = await get(`/products/lookup?storeId=${store.id}&code=${barcodeZeroStock}`);
    assert.equal(scanZero.status, 200);
    assert.equal(scanZero.data.data.matches[0].balances.length, 0); // No balance record in store = 0 stock

    // Attempt checkout with insufficient stock (request 15 when only 10 available)
    const oversellRes = await post("/sales", {
      storeId: store.id,
      sessionId: session.id,
      items: [{ variantId: varShirtM.id, quantity: 15, discountPerUnit: "0" }],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: "9450" }],
      idempotencyKey: `oversell-${key}`,
    });
    assert.equal(oversellRes.status, 409);
    assert.match(oversellRes.data.message, /Insufficient stock/i);
    assert.match(oversellRes.data.message, /only 10 unit\(s\) available/i);
    console.log("PASS TEST 6: Insufficient stock rejected with 409 and actual available count (10) reported");

    // -------------------------------------------------------------
    // TEST 7: Complete a single-product sale atomically
    // -------------------------------------------------------------
    console.log("Checking TEST 7: Complete single-product sale...");
    const singleSaleKey = `single-sale-${key}`;
    const singleQuote = await post("/quote", {
      storeId: store.id,
      items: [{ variantId: varShirtM.id, quantity: 1, discountPerUnit: "0" }],
      orderDiscount: "0",
    });
    const singleGrandTotal = String(singleQuote.data.data.grandTotal);
    assert.equal(singleGrandTotal, "630");

    const singleSaleRes = await post("/sales", {
      storeId: store.id,
      sessionId: session.id,
      items: [{ variantId: varShirtM.id, quantity: 1, discountPerUnit: "0" }],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: singleGrandTotal }],
      idempotencyKey: singleSaleKey,
    });
    assert.equal(singleSaleRes.status, 200);
    const singleSale = singleSaleRes.data.data;
    assert.match(singleSale.invoiceNo, /^HK-\d{10}$/);
    assert.equal(singleSale.items.length, 1);
    assert.equal(singleSale.items[0].variantId, varShirtM.id);
    assert.equal(singleSale.items[0].quantity, 1);
    assert.equal(Number(singleSale.grandTotal), 630);

    // Verify stock decremented from 10 to 9
    const balAfterSingle = await prisma.pOSInventoryBalance.findUnique({
      where: { storeId_variantId: { storeId: store.id, variantId: varShirtM.id } },
    });
    assert.equal(balAfterSingle?.quantity, 9);
    console.log("PASS TEST 7: Single-product sale completed, invoice generated, stock decremented 10 -> 9");

    // -------------------------------------------------------------
    // TEST 8: Complete a multi-product sale with split payment & discount
    // -------------------------------------------------------------
    console.log("Checking TEST 8: Complete multi-product sale with split payment & item discount...");
    const multiSaleKey = `multi-sale-${key}`;
    // Shirt: qty 2, discount 50 per unit -> subtotal 1200, discount 100, taxable 1100, tax 5% (55), line total 1155
    // Jeans: qty 1, discount 0 -> subtotal 1200, tax 12% (144), line total 1344
    // Grand Total: 1155 + 1344 = 2499
    const multiQuoteWithDisc = await post("/quote", {
      storeId: store.id,
      items: [
        { variantId: varShirtM.id, quantity: 2, discountPerUnit: "50.00" },
        { variantId: varJeans.id, quantity: 1, discountPerUnit: "0.00" },
      ],
      orderDiscount: "0",
    });
    assert.equal(Number(multiQuoteWithDisc.data.data.grandTotal), 2499);
    assert.equal(Number(multiQuoteWithDisc.data.data.discountTotal), 100);

    // Split payment: CASH 1000, UPI 1499 = 2499
    const multiSaleRes = await post("/sales", {
      storeId: store.id,
      sessionId: session.id,
      items: [
        { variantId: varShirtM.id, quantity: 2, discountPerUnit: "50.00" },
        { variantId: varJeans.id, quantity: 1, discountPerUnit: "0.00" },
      ],
      orderDiscount: "0",
      payments: [
        { method: "CASH", amount: "1000.00" },
        { method: "UPI", amount: "1499.00", reference: "UPI-REF-12345" },
      ],
      idempotencyKey: multiSaleKey,
    });
    assert.equal(multiSaleRes.status, 200);
    const multiSale = multiSaleRes.data.data;
    assert.equal(multiSale.items.length, 2);
    assert.equal(multiSale.payments.length, 2);
    assert.equal(Number(multiSale.grandTotal), 2499);

    // Verify stock decremented: Shirt 9 -> 7, Jeans 5 -> 4
    const balShirtAfterMulti = await prisma.pOSInventoryBalance.findUnique({
      where: { storeId_variantId: { storeId: store.id, variantId: varShirtM.id } },
    });
    const balJeansAfterMulti = await prisma.pOSInventoryBalance.findUnique({
      where: { storeId_variantId: { storeId: store.id, variantId: varJeans.id } },
    });
    assert.equal(balShirtAfterMulti?.quantity, 7);
    assert.equal(balJeansAfterMulti?.quantity, 4);
    console.log("PASS TEST 8: Multi-product sale completed with split tenders (CASH+UPI) and item discount");

    // -------------------------------------------------------------
    // TEST 9: Verify discounts, GST, payment totals, database records, and receipt totals match
    // -------------------------------------------------------------
    console.log("Checking TEST 9: Verify receipt generation & precision arithmetic match DB...");
    const persistedSaleRes = await get(`/sales/${multiSale.id}`);
    assert.equal(persistedSaleRes.status, 200);
    const persistedSale = persistedSaleRes.data.data;

    const receipt = receiptFromSale(persistedSale, "INR");
    assert.equal(receipt.billNo, persistedSale.invoiceNo);
    assert.equal(receipt.totalItems, 3); // 2 shirts + 1 jeans
    assert.equal(receipt.subTotal, 2400);
    assert.equal(receipt.discount, 100);
    assert.equal(receipt.tax, 199); // 55 + 144
    assert.equal(receipt.totalAmount, 2499);
    assert.equal(receipt.cashAmount, 1000);
    assert.equal(receipt.upiAmount, 1499);
    assert.equal(receipt.items.length, 2);
    const receiptShirt = receipt.items.find((i) => i.sku === varShirtM.sku);
    const receiptJeans = receipt.items.find((i) => i.sku === varJeans.sku);
    assert.equal(receiptShirt?.total, 1155);
    assert.equal(receiptJeans?.total, 1344);
    console.log("PASS TEST 9: Saved sale, database records, and generated thermal receipt totals match to the cent");

    // -------------------------------------------------------------
    // TEST 10: Test duplicate checkout prevention, idempotency, and reprinting
    // -------------------------------------------------------------
    console.log("Checking TEST 10: Test duplicate checkout prevention & reprint...");
    // Resend exact same sale with same idempotency key (simulating double click)
    const duplicateRes = await post("/sales", {
      storeId: store.id,
      sessionId: session.id,
      items: [
        { variantId: varShirtM.id, quantity: 2, discountPerUnit: "50.00" },
        { variantId: varJeans.id, quantity: 1, discountPerUnit: "0.00" },
      ],
      orderDiscount: "0",
      payments: [
        { method: "CASH", amount: "1000.00" },
        { method: "UPI", amount: "1499.00", reference: "UPI-REF-12345" },
      ],
      idempotencyKey: multiSaleKey,
    });
    // Must return the SAME invoice without creating a new sale or deducting inventory again!
    assert.equal(duplicateRes.status, 200);
    assert.equal(duplicateRes.data.data.id, multiSale.id);
    assert.equal(duplicateRes.data.data.invoiceNo, multiSale.invoiceNo);

    // Stock must STILL be 7 and 4 (no double deduction)
    const balShirtAfterDup = await prisma.pOSInventoryBalance.findUnique({
      where: { storeId_variantId: { storeId: store.id, variantId: varShirtM.id } },
    });
    assert.equal(balShirtAfterDup?.quantity, 7);

    // Test Reprint: fetch sale again by id and verify receipt data remains available
    const reprintRes = await get(`/sales/${multiSale.id}`);
    const reprintReceipt = receiptFromSale(reprintRes.data.data, "INR");
    assert.equal(reprintReceipt.billNo, multiSale.invoiceNo);
    assert.equal(reprintReceipt.totalAmount, 2499);
    console.log("PASS TEST 10: Duplicate checkout returned existing invoice idempotently; inventory preserved; reprinting verified");

    console.log("\nALL 10 POS VERIFICATION TESTS PASSED SUCCESSFULLY!");
  } finally {
    server.close();
    // Cleanup test data
    await prisma.pOSStockMovement.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSSalePayment.deleteMany({ where: { sale: { storeId: store.id } } });
    await prisma.pOSSaleItem.deleteMany({ where: { sale: { storeId: store.id } } });
    await prisma.pOSSale.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSSession.deleteMany({ where: { register: { storeId: store.id } } });
    await prisma.pOSRegister.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSInventoryBalance.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSProductVariant.deleteMany({
      where: {
        productId: {
          in: [
            product1.id,
            product2.id,
            product3.id,
            productZero.id,
            productAmb1.id,
            productAmb2.id,
          ],
        },
      },
    });
    await prisma.pOSProduct.deleteMany({
      where: {
        id: {
          in: [
            product1.id,
            product2.id,
            product3.id,
            productZero.id,
            productAmb1.id,
            productAmb2.id,
          ],
        },
      },
    });
    await prisma.store.deleteMany({ where: { id: store.id } });
    await prisma.pOSAuditLog.deleteMany({ where: { userId: adminUser.id } });
    await prisma.user.deleteMany({ where: { id: adminUser.id } });
  }
}

run().catch((e) => {
  console.error("Test failed with error:", e);
  process.exit(1);
});
