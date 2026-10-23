import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import http from "node:http";
import { AddressInfo } from "node:net";
import { prisma } from "../src/utils/db";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";
import * as service from "../src/pos/service";
import * as operations from "../src/pos/operations";
import * as reports from "../src/pos/reports";
import { Actor } from "../src/pos/auth";
import { receiptFromSale } from "../../HRM-Admin-Pannel/src/features/pos/posReceipt";

async function run() {
  console.log("=== STARTING POS SALESPERSON INTEGRATION VERIFICATION ===");
  const key = randomUUID().slice(0, 8);

  // 1. Create a store for testing
  const store = await prisma.store.create({
    data: { name: `HOPKID FASHION STORE ${key}`, code: `HFS_${key}`, isActive: true },
  });

  // 2. Create Cashier user
  const cashierUser = await prisma.user.create({
    data: { email: `cashier-${key}@hopkid.test`, password: "dummy", role: "ADMIN" },
  });
  const actor: Actor = {
    userId: cashierUser.id,
    role: "ADMIN",
    admin: true,
    storeId: store.id,
    permissions: {},
  };

  // Enable commission in POS configuration for this store
  await operations.configure(actor, {
    storeId: store.id,
    commissionEnabled: true,
    commissionBasis: "NET_EX_TAX",
    fixedCommissionBasis: "LINE",
    refundCommissionPolicy: "REVIEW_ADJUSTMENT",
    returnWindowDays: 30,
  });

  // 3. Create two active employees (Salesperson A and Salesperson B)
  const empA = await prisma.employee.create({
    data: {
      firstName: "Sarah",
      lastName: `Connor_${key}`,
      employeeCode: `EMP_A_${key}`,
      status: "ACTIVE",
      designation: "Salesperson",
      storeId: store.id,
      commissionPercentage: 5.0,
    },
  });

  const empB = await prisma.employee.create({
    data: {
      firstName: "John",
      lastName: `Rambo_${key}`,
      employeeCode: `EMP_B_${key}`,
      status: "ACTIVE",
      designation: "Salesperson",
      storeId: store.id,
      commissionPercentage: 8.0,
    },
  });

  console.log(`Created employees: ${empA.firstName} (ID ${empA.id}), ${empB.firstName} (ID ${empB.id})`);

  // 4. Setup Express server to test REST endpoints
  const app = express();
  app.use(express.json());
  app.use("/api/v1/pos", routes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/pos`;

  const token = signAccessToken({ id: cashierUser.id, role: "CASHIER", storeId: store.id });
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    // TEST 1: GET /salespeople endpoint returns active salespeople
    console.log("\n--- TEST 1: Verify /salespeople & /context Endpoints ---");
    const spRes = await fetch(`${baseUrl}/salespeople?storeId=${store.id}`, { headers: authHeaders });
    assert.equal(spRes.status, 200, "Should return 200 OK");
    const spData = await spRes.json();
    const salespeople = Array.isArray(spData.data) ? spData.data : spData.data?.salespeople;
    assert.ok(Array.isArray(salespeople), "salespeople must be an array");
    const foundA = salespeople.find((e: any) => e.id === empA.id);
    const foundB = salespeople.find((e: any) => e.id === empB.id);
    assert.ok(foundA, "Salesperson A must be returned");
    assert.ok(foundB, "Salesperson B must be returned");
    assert.equal(foundA.firstName, "Sarah");
    assert.equal(foundB.firstName, "John");
    console.log("✓ /salespeople correctly returned active salespeople with actual names and codes.");

    // Context bootstrap
    const ctxRes = await fetch(`${baseUrl}/context?storeId=${store.id}`, { headers: authHeaders });
    assert.equal(ctxRes.status, 200);
    const ctxData = await ctxRes.json();
    assert.ok(Array.isArray(ctxData.data?.salespeople), "context.salespeople must be an array");
    assert.ok(ctxData.data.salespeople.some((e: any) => e.id === empA.id));
    console.log("✓ /context includes salespeople in bootstrap response.");

    // 5. Create Register and open session
    const register = await prisma.pOSRegister.create({
      data: { storeId: store.id, name: `Main Register ${key}` },
    });
    const session = await service.openRegister(actor, register.id, {
      openingCash: "500.00",
    });

    // 6. Create product with 2 variants
    const product = await service.createProduct(
      { ...actor, admin: true, role: "ADMIN" },
      {
        name: `Hopkid Designer Denim ${key}`,
        code: `HK-DENIM-${key}`,
        variants: [
          {
            sku: `SKU-DENIM-S-${key}`,
            barcode: `BC-DENIM-S-${key}`,
            size: "S",
            color: "Blue",
            costPrice: "500.00",
            sellingPrice: "1000.00",
            taxRate: "0.00",
          },
          {
            sku: `SKU-DENIM-M-${key}`,
            barcode: `BC-DENIM-M-${key}`,
            size: "M",
            color: "Blue",
            costPrice: "600.00",
            sellingPrice: "1200.00",
            taxRate: "0.00",
          },
        ],
      },
    );

    const varS = product.variants[0]!;
    const varM = product.variants[1]!;

    // Add inventory
    await service.adjust(actor, {
      storeId: store.id,
      variantId: varS.id,
      quantityDelta: 10,
      type: "OPENING",
      reason: "Initial seed",
    });
    await service.adjust(actor, {
      storeId: store.id,
      variantId: varM.id,
      quantityDelta: 10,
      type: "OPENING",
      reason: "Initial seed",
    });

    // TEST 2: Single-Product Sale with Assigned Salesperson
    console.log("\n--- TEST 2: Single-Product Sale with Assigned Salesperson ---");
    const singleCheckout = await service.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      idempotencyKey: randomUUID(),
      salespersonId: empA.id,
      items: [
        {
          variantId: varS.id,
          quantity: 1,
          salespersonId: empA.id,
        },
      ],
      payments: [{ method: "CASH", amount: "1000.00" }],
    });

    assert.equal(singleCheckout.items.length, 1);
    assert.equal(singleCheckout.items[0].salespersonId, empA.id, "Line item must store salespersonId");
    assert.equal(singleCheckout.items[0].salesperson?.firstName, "Sarah");
    console.log(`✓ Single item saved with salespersonId: ${singleCheckout.items[0].salespersonId} (${singleCheckout.items[0].salesperson?.firstName})`);

    // Verify Commission Accrual for Single Sale
    const singleComm = await prisma.commissionTransaction.findMany({
      where: { billId: `POSSALE-${singleCheckout.id}` },
    });
    assert.equal(singleComm.length, 1, "Exactly one commission transaction should exist");
    assert.equal(singleComm[0].employeeId, empA.id, "Attributed to empA");
    assert.equal(Number(singleComm[0].saleAmount), 1000, "Eligible sale amount = 1000");
    // 5% of 1000 = 50
    assert.equal(Number(singleComm[0].commissionAmount), 50, "5% commission = 50");
    console.log(`✓ Commission accurately accrued for Sarah: Rs ${singleComm[0].commissionAmount}`);

    // TEST 3: Multi-Product Sale with DIFFERENT Salespeople per row
    console.log("\n--- TEST 3: Multi-Product Sale with DIFFERENT Salespeople per row ---");
    const multiCheckout = await service.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      idempotencyKey: randomUUID(),
      salespersonId: empA.id, // Order-level fallback
      items: [
        {
          variantId: varS.id,
          quantity: 2,
          salespersonId: empA.id, // Line 1: Sarah Connor (5% of 2000 = 100)
        },
        {
          variantId: varM.id,
          quantity: 1,
          salespersonId: empB.id, // Line 2: John Rambo (8% of 1200 = 96)
        },
      ],
      payments: [{ method: "CASH", amount: "3200.00" }],
    });

    assert.equal(multiCheckout.items.length, 2);
    const item1 = multiCheckout.items.find((i: any) => i.variantId === varS.id)!;
    const item2 = multiCheckout.items.find((i: any) => i.variantId === varM.id)!;

    assert.equal(item1.salespersonId, empA.id, "Item 1 must have empA");
    assert.equal(item2.salespersonId, empB.id, "Item 2 must have empB");
    assert.equal(item1.salesperson?.firstName, "Sarah");
    assert.equal(item2.salesperson?.firstName, "John");
    console.log(`✓ Multi-line sale saved with distinct salespeople: Item 1 -> ${item1.salesperson?.firstName}, Item 2 -> ${item2.salesperson?.firstName}`);

    // Verify Commission Accruals for Multi-Product Sale
    const multiComm = await prisma.commissionTransaction.findMany({
      where: { billId: `POSSALE-${multiCheckout.id}` },
    });
    assert.equal(multiComm.length, 2, "Should create two distinct commission transactions on the same bill");

    const commA = multiComm.find((c: any) => c.employeeId === empA.id)!;
    const commB = multiComm.find((c: any) => c.employeeId === empB.id)!;
    assert.ok(commA, "Sarah's commission transaction must exist");
    assert.ok(commB, "John's commission transaction must exist");

    assert.equal(Number(commA.saleAmount), 2000, "Sarah's eligible sale amount is 2000");
    assert.equal(Number(commA.commissionAmount), 100, "Sarah gets 5% of 2000 = 100");

    assert.equal(Number(commB.saleAmount), 1200, "John's eligible sale amount is 1200");
    assert.equal(Number(commB.commissionAmount), 96, "John gets 8% of 1200 = 96");
    console.log(`✓ Multi-salesperson commission correctly divided: Sarah = Rs ${commA.commissionAmount}, John = Rs ${commB.commissionAmount}`);

    // TEST 4: Backend Validation: Inactive / Invalid Salesperson ID Rejection
    console.log("\n--- TEST 4: Validation of Invalid Salesperson ---");
    let errorCaught = false;
    try {
      await service.checkout(actor, {
        storeId: store.id,
        sessionId: session.id,
        idempotencyKey: randomUUID(),
        items: [
          {
            variantId: varS.id,
            quantity: 1,
            salespersonId: 999999, // Non-existent employee
          },
        ],
        payments: [{ method: "CASH", amount: "1000.00" }],
      });
    } catch (err: any) {
      errorCaught = true;
      assert.ok(err.message.toLowerCase().includes("salesperson") || err.message.toLowerCase().includes("employee"), `Expected salesperson/employee in error: ${err.message}`);
      console.log(`✓ Rejection of invalid salesperson succeeded: "${err.message}"`);
    }
    assert.ok(errorCaught, "Should have thrown on invalid salesperson ID");

    // TEST 5: Sales History, Invoicing & Thermal Receipt Formatter
    console.log("\n--- TEST 5: Sales History & Thermal Receipt Details ---");
    const saleRes = await fetch(`${baseUrl}/sales/${multiCheckout.id}`, { headers: authHeaders });
    assert.equal(saleRes.status, 200, "Should return 200 OK");
    const { data: retrievedSale } = await saleRes.json();
    assert.ok(retrievedSale, "Sale must be retrievable");
    assert.equal(retrievedSale.items.length, 2);
    const itemSarah = retrievedSale.items.find((i: any) => i.salespersonId === empA.id);
    const itemJohn = retrievedSale.items.find((i: any) => i.salespersonId === empB.id);
    assert.ok(itemSarah, "Item for Sarah must exist");
    assert.ok(itemJohn, "Item for John must exist");
    assert.equal(itemSarah.salesperson?.firstName, "Sarah");
    assert.equal(itemJohn.salesperson?.firstName, "John");

    const receipt = receiptFromSale(retrievedSale as any);
    assert.ok(receipt, "Receipt data generated");
    assert.equal(receipt.items.length, 2);
    const rcptSarah = receipt.items.find((i: any) => i.salesmanName?.includes("Sarah"));
    const rcptJohn = receipt.items.find((i: any) => i.salesmanName?.includes("John"));
    assert.ok(rcptSarah, "Receipt reflects Sarah for her item");
    assert.ok(rcptJohn, "Receipt reflects John for his item");
    console.log(`✓ Receipt formatter resolved line-level salesperson names: Sarah item = ${rcptSarah?.salesmanName}, John item = ${rcptJohn?.salesmanName}`);

    // TEST 6: Salesperson Aggregation Reports
    console.log("\n--- TEST 6: Sales Report Aggregation by Salesperson ---");
    const reportData = await reports.report(actor, { storeId: store.id });
    assert.ok(Array.isArray(reportData.bySalesperson), "bySalesperson must be an array");
    const rptSarah = reportData.bySalesperson.find((r: any) => r.salespersonId === empA.id);
    const rptJohn = reportData.bySalesperson.find((r: any) => r.salespersonId === empB.id);
    assert.ok(rptSarah, "Sarah Connor must appear in report");
    assert.ok(rptJohn, "John Rambo must appear in report");
    assert.ok(rptSarah.salespersonName.includes("Sarah"), "Name resolved from database");
    assert.ok(rptJohn.salespersonName.includes("John"), "Name resolved from database");
    // Sarah: 1000 (sale 1) + 2000 (sale 2) = 3000
    assert.equal(Number(rptSarah._sum.grandTotal), 3000, "Sarah's total attributed revenue = 3000");
    // John: 1200 (sale 2) = 1200
    assert.equal(Number(rptJohn._sum.grandTotal), 1200, "John's total attributed revenue = 1200");
    console.log(`✓ Report bySalesperson attributed items accurately: Sarah = Rs ${rptSarah._sum.grandTotal}, John = Rs ${rptJohn._sum.grandTotal}`);

    console.log("\n=== ALL POS SALESPERSON INTEGRATION TESTS PASSED SUCCESSFULLY! ===");
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
