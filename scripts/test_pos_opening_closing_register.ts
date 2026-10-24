import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/utils/db";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";

async function runTests() {
  console.log("=== STARTING POS OPENING & CLOSING REGISTER TEST SUITE ===");
  const key = randomUUID().slice(0, 8);

  const app = express();
  app.use(express.json());
  app.use("/api/v1/pos", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/pos`;

  async function createCashier(name: string, role: "ADMIN" | "EMPLOYEE" = "ADMIN") {
    const user = await prisma.user.create({
      data: { email: `${name.toLowerCase()}-${key}@pos.test`, password: "dummy", role },
    });
    const token = signAccessToken({ id: user.id, role: user.role });
    return { user, token, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  }

  const cashierA = await createCashier("CashierA");
  const cashierB = await createCashier("CashierB", "EMPLOYEE");

  try {
    const store = await prisma.store.create({
      data: { name: `HopKid Test Store ${key}`, code: `HK_${key}`, isActive: true },
    });
    const register = await prisma.pOSRegister.create({
      data: { storeId: store.id, name: "Counter 1", active: true },
    });

    // 1. Check current session before opening
    console.log("\n1. Testing GET /sessions/current when no session exists...");
    const curRes1 = await fetch(`${baseUrl}/sessions/current?storeId=${store.id}`, {
      headers: cashierA.headers,
    });
    assert.equal(curRes1.status, 200);
    const curJson1 = await curRes1.json();
    assert.equal(curJson1.data.session, null, "Should have no active session initially");
    console.log("✓ Correctly returned null session for fresh login");

    // 2. Reject negative opening cash
    console.log("\n2. Testing validation: reject negative opening cash...");
    const badOpenRes = await fetch(`${baseUrl}/sessions/open`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store.id,
        registerId: register.id,
        openingCash: "-100",
      }),
    });
    assert.equal(badOpenRes.status, 400);
    console.log("✓ Correctly rejected negative opening cash");

    // 3. Open Register Session
    console.log("\n3. Testing POST /sessions/open with ₹500 opening cash...");
    const openRes = await fetch(`${baseUrl}/sessions/open`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store.id,
        registerId: register.id,
        openingCash: "500.00",
        openingNotes: "Morning cash drawer float",
      }),
    });
    assert.equal(openRes.status, 200);
    const openJson = await openRes.json();
    const session = openJson.data;
    assert.ok(session.id, "Session ID should be created");
    assert.equal(Number(session.openingCash), 500);
    assert.equal(session.openingNotes, "Morning cash drawer float");
    console.log(`✓ Session opened successfully with ID: ${session.id}`);

    // 4. Repeated open call should idempotently resume without duplicate sessions
    console.log("\n4. Testing idempotent open call...");
    const retryOpenRes = await fetch(`${baseUrl}/sessions/open`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store.id,
        registerId: register.id,
        openingCash: "500.00",
      }),
    });
    assert.equal(retryOpenRes.status, 200);
    const retryOpenJson = await retryOpenRes.json();
    assert.equal(retryOpenJson.data.id, session.id, "Must resume existing open session");
    console.log("✓ Resumed open session idempotently without creating duplicate");

    // 5. Check GET /sessions/current returns the open session
    console.log("\n5. Testing GET /sessions/current returns active session...");
    const curRes2 = await fetch(`${baseUrl}/sessions/current?storeId=${store.id}`, {
      headers: cashierA.headers,
    });
    assert.equal(curRes2.status, 200);
    const curJson2 = await curRes2.json();
    assert.equal(curJson2.data.session.id, session.id);
    assert.equal(Number(curJson2.data.session.openingCash), 500);
    console.log("✓ Current session query returns the open session");

    // 6. Perform sales: Cash-only, Card-only, UPI-only, and Split payments
    console.log("\n6. Processing sales with Cash, Card, UPI, and Split payments...");

    // Sale 1: Cash sale ₹1000
    const sale1Res = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store.id,
        sessionId: session.id,
        items: [{ manual: true, name: "Kids T-Shirt", quantity: 2, unitPrice: "500.00", taxRate: "0" }],
        payments: [{ method: "CASH", amount: "1000.00" }],
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(sale1Res.status, 200);
    const sale1Json = await sale1Res.json();
    console.log(`✓ Sale 1 (Cash ₹1000) completed. Invoice: ${sale1Json.data.invoiceNo}`);

    // Sale 2: Card sale ₹1500
    const sale2Res = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store.id,
        sessionId: session.id,
        items: [{ manual: true, name: "Baby Shoes", quantity: 1, unitPrice: "1500.00", taxRate: "0" }],
        payments: [{ method: "CARD", amount: "1500.00" }],
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(sale2Res.status, 200);
    const sale2Json = await sale2Res.json();
    console.log(`✓ Sale 2 (Card ₹1500) completed. Invoice: ${sale2Json.data.invoiceNo}`);

    // Sale 3: UPI sale ₹800
    const sale3Res = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store.id,
        sessionId: session.id,
        items: [{ manual: true, name: "Baby Dress", quantity: 1, unitPrice: "800.00", taxRate: "0" }],
        payments: [{ method: "UPI", amount: "800.00" }],
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(sale3Res.status, 200);
    const sale3Json = await sale3Res.json();
    console.log(`✓ Sale 3 (UPI ₹800) completed. Invoice: ${sale3Json.data.invoiceNo}`);

    // Sale 4: Split payment (₹400 Cash + ₹600 UPI = ₹1000)
    const sale4Res = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store.id,
        sessionId: session.id,
        items: [{ manual: true, name: "Kids Winter Jacket", quantity: 1, unitPrice: "1000.00", taxRate: "0" }],
        payments: [
          { method: "CASH", amount: "400.00" },
          { method: "UPI", amount: "600.00" },
        ],
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(sale4Res.status, 200);
    const sale4Json = await sale4Res.json();
    console.log(`✓ Sale 4 (Split: ₹400 Cash + ₹600 UPI) completed. Invoice: ${sale4Json.data.invoiceNo}`);

    // 7. Cash Drawer movement: Cash In ₹200, Cash Out ₹100
    console.log("\n7. Testing Cash Drawer movements (Cash In ₹200, Cash Out ₹100)...");
    const cashInRes = await fetch(`${baseUrl}/sessions/${session.id}/cash-movements`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        direction: "IN",
        amount: "200.00",
        reason: "Adding change float",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(cashInRes.status, 200);

    const cashOutRes = await fetch(`${baseUrl}/sessions/${session.id}/cash-movements`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        direction: "OUT",
        amount: "100.00",
        reason: "Tea & snacks expense",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(cashOutRes.status, 200);
    console.log("✓ Recorded cash movements: Cash In ₹200, Cash Out ₹100");

    // 8. Test Session Closing Summary
    console.log("\n8. Verifying Session Closing Summary calculations...");
    // Expected Cash = Opening Cash (500) + Cash Sales (1000 + 400 = 1400) - Cash Refunds (0) + Cash In (200) - Cash Out (100)
    // Expected Cash = 500 + 1400 - 0 + 200 - 100 = 2000.00
    // Total Sales = 1000 + 1500 + 800 + 1000 = 4300.00
    // Cash Sales = 1400.00
    // Card Sales = 1500.00
    // UPI Sales = 800 + 600 = 1400.00
    const summaryRes = await fetch(`${baseUrl}/sessions/${session.id}/summary`, {
      headers: cashierA.headers,
    });
    assert.equal(summaryRes.status, 200);
    const summaryJson = await summaryRes.json();
    const s = summaryJson.data.summary;

    console.log("Summary details:", s);
    assert.equal(s.totalBills, 4, "Total bills must be 4");
    assert.equal(s.totalSales, 4300, "Total sales must be 4300");
    assert.equal(s.cashSales, 1400, "Cash sales must be 1400");
    assert.equal(s.cardSales, 1500, "Card sales must be 1500");
    assert.equal(s.upiSales, 1400, "UPI sales must be 1400");
    assert.equal(s.cashIn, 200, "Cash In must be 200");
    assert.equal(s.cashOut, 100, "Cash Out must be 100");
    assert.equal(s.openingCash, 500, "Opening Cash must be 500");
    assert.equal(s.expectedCash, 2000, "Expected cash drawer must be 2000.00");
    console.log("✓ Expected cash exactly matches formula: 500 + 1400 + 200 - 100 = 2000.00!");

    // 9. Unauthorized cashier cannot close another cashier's session
    console.log("\n9. Testing unauthorized cashier B cannot close cashier A's session...");
    const unauthClose = await fetch(`${baseUrl}/sessions/${session.id}/close`, {
      method: "POST",
      headers: cashierB.headers,
      body: JSON.stringify({ actualCash: "2000.00" }),
    });
    assert.equal(unauthClose.status, 403, "Cashier B must be forbidden from closing Cashier A's session");
    console.log("✓ Another cashier was prevented from closing active session (403 Forbidden)");

    // 10. Discrepancy detection requires confirmation/note
    console.log("\n10. Testing discrepancy check when actual cash != expected cash...");
    const mismatchRes = await fetch(`${baseUrl}/sessions/${session.id}/close`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        actualCash: "1950.00", // ₹50 shortage
      }),
    });
    assert.equal(mismatchRes.status, 400);
    const mismatchJson = await mismatchRes.json();
    assert.ok(mismatchJson.message.includes("Closing cash mismatch detected"));
    console.log(`✓ Properly detected discrepancy and required reason: "${mismatchJson.message}"`);

    // 11. Reconcile and Close Session with verified amount
    console.log("\n11. Testing closing session successfully...");
    const closeRes = await fetch(`${baseUrl}/sessions/${session.id}/close`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        actualCash: "2000.00",
        closeReason: "Evening closing reconciled with no variance",
      }),
    });
    assert.equal(closeRes.status, 200);
    const closeJson = await closeRes.json();
    assert.ok(closeJson.data.closedAt, "closedAt timestamp must be set");
    assert.equal(Number(closeJson.data.actualCash), 2000);
    assert.equal(Number(closeJson.data.expectedCash), 2000);
    assert.equal(Number(closeJson.data.variance), 0);
    console.log("✓ Session closed and marked in database!");

    // 12. Prevent checkout on closed session
    console.log("\n12. Testing sales cannot be attached to closed session...");
    const blockedSale = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store.id,
        sessionId: session.id, // passing the closed session!
        items: [{ manual: true, name: "Hair Band", quantity: 1, unitPrice: "50.00", taxRate: "0" }],
        payments: [{ method: "CASH", amount: "50.00" }],
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(blockedSale.status, 409, "Must return 409 when attempting to bill on closed session");
    const blockedJson = await blockedSale.json();
    assert.ok(blockedJson.message.includes("closed register session"));
    console.log(`✓ Sale rejected on closed session: "${blockedJson.message}"`);

    // 13. Session History API (GET /sessions)
    console.log("\n13. Testing GET /sessions (Register Session History)...");
    const sessHistRes = await fetch(`${baseUrl}/sessions?storeId=${store.id}`, {
      headers: cashierA.headers,
    });
    assert.equal(sessHistRes.status, 200);
    const sessHistJson = await sessHistRes.json();
    assert.ok(sessHistJson.data.items.length >= 1);
    const histSession = sessHistJson.data.items.find((item: any) => item.id === session.id);
    assert.ok(histSession, "Session must exist in history");
    assert.equal(histSession.status, "Closed");
    assert.equal(histSession.totalBills, 4);
    assert.equal(histSession.totalSales, 4300);
    assert.equal(histSession.cashSales, 1400);
    assert.equal(histSession.cardSales, 1500);
    assert.equal(histSession.upiSales, 1400);
    assert.equal(histSession.expectedCash, 2000);
    assert.equal(histSession.actualCash, 2000);
    assert.equal(histSession.variance, 0);
    console.log("✓ Session history returned accurate persisted totals and reconciliation fields");

    // 14. Session Sales API (GET /sessions/:id/sales)
    console.log("\n14. Testing GET /sessions/:id/sales...");
    const sessSalesRes = await fetch(`${baseUrl}/sessions/${session.id}/sales`, {
      headers: cashierA.headers,
    });
    assert.equal(sessSalesRes.status, 200);
    const sessSalesJson = await sessSalesRes.json();
    assert.equal(sessSalesJson.data.items.length, 4);
    console.log("✓ Retrieved all 4 sales for the session");

    // 15. Bill History API with paymentMode and filters (GET /sales)
    console.log("\n15. Testing GET /sales with paymentMode filter...");
    const cardSalesRes = await fetch(`${baseUrl}/sales?storeId=${store.id}&paymentMode=CARD`, {
      headers: cashierA.headers,
    });
    assert.equal(cardSalesRes.status, 200);
    const cardSalesJson = await cardSalesRes.json();
    assert.ok(cardSalesJson.data.items.some((i: any) => i.id === sale2Json.data.id));
    console.log("✓ Filtered bills by payment mode successfully");

    console.log("\n=======================================================");
    console.log("🎉 ALL 15 REGISTER OPEN/CLOSE & RECONCILIATION TESTS PASSED! 🎉");
    console.log("=======================================================");
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
