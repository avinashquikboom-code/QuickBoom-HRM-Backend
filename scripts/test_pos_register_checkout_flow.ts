import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/utils/db";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";

async function run() {
  console.log("=== STARTING POS REGISTER CHECKOUT FLOW TEST SUITE ===");
  const key = randomUUID().slice(0, 8);

  // 1. Setup Express server
  const app = express();
  app.use(express.json());
  app.use("/api/v1/pos", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/pos`;

  // Helper to create a user and token
  async function createCashier(name: string, role: "ADMIN" | "SUPER_ADMIN" | "EMPLOYEE" = "ADMIN") {
    const user = await prisma.user.create({
      data: { email: `${name.toLowerCase()}-${key}@pos.test`, password: "dummy", role },
    });
    const token = signAccessToken({ id: user.id, role: user.role });
    return { user, token, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  }

  const cashierA = await createCashier("CashierA");
  const cashierB = await createCashier("CashierB");

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 1: Valid open register session (explicit sessionId and registerId)
    // -------------------------------------------------------------------------
    console.log("\n--- SCENARIO 1: Valid Open Register Session ---");
    const store1 = await prisma.store.create({
      data: { name: `Store 1 - Open Register Test ${key}`, code: `S1_${key}`, isActive: true },
    });
    const reg1 = await prisma.pOSRegister.create({
      data: { storeId: store1.id, name: "Main Counter", active: true },
    });
    // Open a session explicitly for Cashier A
    const openRes1 = await fetch(`${baseUrl}/registers/${reg1.id}/open`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({ openingCash: "1000.00" }),
    });
    const openJson1 = await openRes1.json();
    assert.equal(openRes1.status, 200, `Failed to open register: ${JSON.stringify(openJson1)}`);
    const session1Id = openJson1.data.id;
    console.log(`Opened session ${session1Id} on register ${reg1.id} for Cashier A`);

    // Perform checkout passing sessionId and registerId
    const saleRes1 = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store1.id,
        sessionId: session1Id,
        registerId: reg1.id,
        items: [
          { manual: true, name: "Baby Dress", quantity: 1, unitPrice: "500.00", taxRate: "5.00" },
        ],
        orderDiscount: "0",
        payments: [{ method: "CASH", amount: "525.00" }],
        idempotencyKey: randomUUID(),
      }),
    });
    const saleJson1 = await saleRes1.json();
    assert.equal(saleRes1.status, 200, `Sale 1 failed: ${JSON.stringify(saleJson1)}`);
    assert.equal(saleJson1.data.sessionId, session1Id);
    console.log(`✓ Scenario 1 Passed: Sale created using open register session. Invoice: ${saleJson1.data.invoiceNo}`);

    // -------------------------------------------------------------------------
    // SCENARIO 2: Cashier whose session is already open (auto-reused without sessionId)
    // -------------------------------------------------------------------------
    console.log("\n--- SCENARIO 2: Cashier with Existing Open Session Auto-Reused ---");
    // Cashier A makes another sale in store1, but frontend doesn't pass sessionId (e.g. fresh page load)
    const saleRes2 = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store1.id,
        // sessionId omitted!
        items: [
          { manual: true, name: "Kids Cap", quantity: 1, unitPrice: "200.00", taxRate: "0" },
        ],
        orderDiscount: "0",
        payments: [{ method: "CASH", amount: "200.00" }],
        idempotencyKey: randomUUID(),
      }),
    });
    const saleJson2 = await saleRes2.json();
    assert.equal(saleRes2.status, 200, `Sale 2 failed: ${JSON.stringify(saleJson2)}`);
    assert.equal(saleJson2.data.sessionId, session1Id, "Must reuse cashier's open session in this store");
    console.log(`✓ Scenario 2 Passed: Open session automatically reused without creating duplicate session. Invoice: ${saleJson2.data.invoiceNo}`);

    // -------------------------------------------------------------------------
    // SCENARIO 3: Genuinely occupied register (409 Conflict)
    // -------------------------------------------------------------------------
    console.log("\n--- SCENARIO 3: Genuinely Occupied Register ---");
    // In store1, reg1 is the ONLY active register, and it is occupied by Cashier A.
    // Cashier B attempts to checkout in store1 without an open session.
    const saleRes3 = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierB.headers,
      body: JSON.stringify({
        storeId: store1.id,
        items: [
          { manual: true, name: "Kids Socks", quantity: 1, unitPrice: "100.00", taxRate: "0" },
        ],
        orderDiscount: "0",
        payments: [{ method: "CASH", amount: "100.00" }],
        idempotencyKey: randomUUID(),
      }),
    });
    const saleJson3 = await saleRes3.json();
    assert.equal(saleRes3.status, 409, `Expected 409 conflict, got: ${saleRes3.status} ${JSON.stringify(saleJson3)}`);
    assert.ok(
      saleJson3.message.includes("No available register") || saleJson3.message.includes("occupied"),
      `Expected occupied register message, got: ${saleJson3.message}`
    );
    console.log(`✓ Scenario 3 Passed: Genuinely occupied register properly returns 409 with actionable message: "${saleJson3.message}"`);

    // -------------------------------------------------------------------------
    // SCENARIO 4: Closed / missing register session auto-opens / creates register
    // -------------------------------------------------------------------------
    console.log("\n--- SCENARIO 4: Closed / Missing Register Session ---");
    // Create a new store with no registers
    const store2 = await prisma.store.create({
      data: { name: `Store 2 - Fresh Store ${key}`, code: `S2_${key}`, isActive: true },
    });
    // Cashier A checks out directly in store2. Backend should auto-create "Main Register" and open session
    const saleRes4 = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store2.id,
        items: [
          { manual: true, name: "Baby Romper", quantity: 1, unitPrice: "350.00", taxRate: "0" },
        ],
        orderDiscount: "0",
        payments: [{ method: "CASH", amount: "350.00" }],
        idempotencyKey: randomUUID(),
      }),
    });
    const saleJson4 = await saleRes4.json();
    assert.equal(saleRes4.status, 200, `Sale 4 failed: ${JSON.stringify(saleJson4)}`);
    assert.ok(saleJson4.data.sessionId, "Must have an assigned session");
    const autoCreatedRegister = await prisma.pOSRegister.findFirst({
      where: { storeId: store2.id },
    });
    assert.ok(autoCreatedRegister, "Main Register should have been auto-created");
    assert.equal(autoCreatedRegister.name, "Main Register");
    console.log(`✓ Scenario 4 Passed: Missing register auto-created and session opened cleanly. Invoice: ${saleJson4.data.invoiceNo}`);

    // -------------------------------------------------------------------------
    // SCENARIO 5: Second sale after first completes
    // -------------------------------------------------------------------------
    console.log("\n--- SCENARIO 5: Second Sale After First Completes ---");
    // Immediate subsequent sale by Cashier A in store2
    const saleRes5 = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        storeId: store2.id,
        sessionId: saleJson4.data.sessionId,
        items: [
          { manual: true, name: "Baby Blanket", quantity: 1, unitPrice: "800.00", taxRate: "5.00" },
        ],
        orderDiscount: "0",
        payments: [{ method: "CASH", amount: "840.00" }],
        idempotencyKey: randomUUID(),
      }),
    });
    const saleJson5 = await saleRes5.json();
    assert.equal(saleRes5.status, 200, `Sale 5 failed: ${JSON.stringify(saleJson5)}`);
    assert.notEqual(saleJson5.data.id, saleJson4.data.id, "Second sale must have a different ID");
    assert.notEqual(saleJson5.data.invoiceNo, saleJson4.data.invoiceNo, "Second sale must have a unique invoice number");
    assert.equal(saleJson5.data.sessionId, saleJson4.data.sessionId, "Both sales must belong to the same cashier session");
    console.log(`✓ Scenario 5 Passed: Subsequent sale generated new bill on the same open session: ${saleJson5.data.invoiceNo}`);

    // -------------------------------------------------------------------------
    // BONUS SCENARIO: Closing register frees it for other cashiers
    // -------------------------------------------------------------------------
    console.log("\n--- BONUS SCENARIO: Closing Register Frees It ---");
    // Cashier A closes their session in store1
    const closeRes = await fetch(`${baseUrl}/registers/${reg1.id}/close`, {
      method: "POST",
      headers: cashierA.headers,
      body: JSON.stringify({
        sessionId: session1Id,
        actualCash: "1725.00",
        reason: "Shift completed",
      }),
    });
    const closeJson = await closeRes.json();
    assert.equal(closeRes.status, 200, `Close failed: ${JSON.stringify(closeJson)}`);
    console.log("Cashier A closed their session on reg1");

    // Now Cashier B should be able to checkout in store1 without 409
    const saleResB = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: cashierB.headers,
      body: JSON.stringify({
        storeId: store1.id,
        items: [
          { manual: true, name: "Kids Socks", quantity: 1, unitPrice: "100.00", taxRate: "0" },
        ],
        orderDiscount: "0",
        payments: [{ method: "CASH", amount: "100.00" }],
        idempotencyKey: randomUUID(),
      }),
    });
    const saleJsonB = await saleResB.json();
    assert.equal(saleResB.status, 200, `Cashier B sale failed after register was freed: ${JSON.stringify(saleJsonB)}`);
    console.log(`✓ Bonus Scenario Passed: Once register closed, next cashier can checkout cleanly. Invoice: ${saleJsonB.data.invoiceNo}`);

    console.log("\n========================================================");
    console.log("🎉 ALL 5 POS REGISTER CHECKOUT FLOW SCENARIOS PASSED! 🎉");
    console.log("========================================================\n");
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

run().catch((e) => {
  console.error("Test execution failed:", e);
  process.exit(1);
});
