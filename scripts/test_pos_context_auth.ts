import assert from "node:assert/strict";
import express from "express";
import { prisma } from "../src/utils/db";
import { signAccessToken } from "../src/utils/jwt";
import routes from "../src/pos/routes";
import { Role } from "@prisma/client";

async function run() {
  console.log("Starting POS /context authorization verification...");

  // Setup Express server with POS routes
  const app = express();
  app.use(express.json());
  app.use("/api/v1/pos", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as { port: number };
  const url = `http://127.0.0.1:${addr.port}/api/v1/pos/context`;

  try {
    // 1. Unauthenticated requests
    console.log("Test 1: Unauthenticated request (no token)");
    const resNoToken = await fetch(url);
    assert.equal(resNoToken.status, 401, "Expected 401 when no token is provided");
    const jsonNoToken = await resNoToken.json();
    assert.equal(jsonNoToken.message, "Sign in required");
    console.log("  PASS -> 401 'Sign in required'");

    console.log("Test 1b: Unauthenticated request (invalid signature)");
    const resInvalidToken = await fetch(url, {
      headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.invalid.mock" },
    });
    assert.equal(resInvalidToken.status, 401, "Expected 401 when token is invalid");
    const jsonInvalidToken = await resInvalidToken.json();
    assert.equal(jsonInvalidToken.message, "Invalid or expired signed session");
    console.log("  PASS -> 401 'Invalid or expired signed session'");

    // Ensure we have at least 2 active test stores for store isolation tests
    const storeA = await prisma.store.upsert({
      where: { id: 1 },
      create: { id: 1, name: "Store Alpha", isActive: true },
      update: { isActive: true },
    });
    const storeB = await prisma.store.upsert({
      where: { id: 2 },
      create: { id: 2, name: "Store Beta", isActive: true },
      update: { isActive: true },
    });

    // 2. Authorized Administrator
    console.log("Test 2: Authorized administrator (ADMIN role)");
    let adminUser = await prisma.user.findFirst({
      where: { role: Role.ADMIN, isActive: true },
    });
    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: {
          email: "admin-auth-test@hopkid.test",
          password: "test-password-hash",
          role: Role.ADMIN,
          isActive: true,
        },
      });
    }
    const adminToken = signAccessToken({ id: adminUser.id, role: adminUser.role });
    const resAdmin = await fetch(url, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200, "Expected 200 for authorized administrator");
    const jsonAdmin = await resAdmin.json();
    assert.equal(jsonAdmin.success, true);
    assert.equal(jsonAdmin.data.actor.admin, true);
    assert(Array.isArray(jsonAdmin.data.stores), "Expected stores array in context");
    assert(jsonAdmin.data.stores.length >= 1, "Expected active stores list");
    assert(jsonAdmin.data.currency, "Expected currency in context");
    assert(Array.isArray(jsonAdmin.data.paymentMethods), "Expected paymentMethods");
    console.log("  PASS -> 200 OK with full admin context & active stores");

    // 3. Authenticated user without POS permission
    console.log("Test 3: Authenticated user without POS permission (generic EMPLOYEE)");
    let genericEmployee = await prisma.user.findFirst({
      where: { role: Role.EMPLOYEE, userPermission: null, isActive: true },
    });
    if (!genericEmployee) {
      genericEmployee = await prisma.user.create({
        data: {
          email: "employee-no-pos@hopkid.test",
          password: "test-password-hash",
          role: Role.EMPLOYEE,
          isActive: true,
        },
      });
    }
    const employeeToken = signAccessToken({
      id: genericEmployee.id,
      role: genericEmployee.role,
    });
    const resNoPerm = await fetch(url, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    assert.equal(resNoPerm.status, 403, "Expected 403 for user without POS permission");
    const jsonNoPerm = await resNoPerm.json();
    assert.equal(jsonNoPerm.message, "POS access required");
    console.log("  PASS -> 403 'POS access required'");

    // 4. Authorized POS cashier with assigned store
    console.log("Test 4: Authorized POS cashier with assigned store (SALESMAN with storeId)");
    let cashierUser = await prisma.user.findFirst({
      where: {
        role: Role.SALESMAN,
        isActive: true,
        employee: { storeId: storeA.id, status: "active" },
      },
      include: { employee: true },
    });
    if (!cashierUser) {
      cashierUser = await prisma.user.create({
        data: {
          email: "cashier-assigned@hopkid.test",
          password: "test-password-hash",
          role: Role.SALESMAN,
          isActive: true,
          employee: {
            create: {
              firstName: "Priya",
              lastName: "Patel",
              employeeCode: "CASHIER-A1",
              status: "active",
              storeId: storeA.id,
            },
          },
        },
        include: { employee: true },
      });
    }
    const cashierToken = signAccessToken({
      id: cashierUser.id,
      role: cashierUser.role,
    });
    const resCashier = await fetch(url, {
      headers: { Authorization: `Bearer ${cashierToken}` },
    });
    assert.equal(resCashier.status, 200, "Expected 200 for authorized cashier with assigned store");
    const jsonCashier = await resCashier.json();
    assert.equal(jsonCashier.success, true);
    assert.equal(jsonCashier.data.actor.admin, false);
    assert.equal(jsonCashier.data.actor.permissions["pos.sell"], true);
    assert.equal(jsonCashier.data.actor.permissions["pos.read"], true);
    assert.equal(jsonCashier.data.actor.storeId, storeA.id);
    assert.equal(jsonCashier.data.stores.length, 1);
    assert.equal(jsonCashier.data.stores[0].id, storeA.id);
    assert.equal(jsonCashier.data.salesperson.name, "Priya Patel");
    assert(jsonCashier.data.paymentMethods.length >= 1);
    console.log("  PASS -> 200 OK for authorized cashier with store context & salesperson profile");

    // 5. User without an assigned store (Authorized cashier but no store assigned)
    console.log("Test 5: User without an assigned store (SALESMAN with storeId = null)");
    let unassignedCashier = await prisma.user.findFirst({
      where: {
        role: Role.SALESMAN,
        isActive: true,
        employee: { storeId: null, status: "active" },
      },
      include: { employee: true },
    });
    if (!unassignedCashier) {
      unassignedCashier = await prisma.user.create({
        data: {
          email: "cashier-nostore@hopkid.test",
          password: "test-password-hash",
          role: Role.SALESMAN,
          isActive: true,
          employee: {
            create: {
              firstName: "Amit",
              lastName: "Verma",
              employeeCode: "CASHIER-UNASSIGNED",
              status: "active",
              storeId: null,
            },
          },
        },
        include: { employee: true },
      });
    }
    const unassignedToken = signAccessToken({
      id: unassignedCashier.id,
      role: unassignedCashier.role,
    });
    const resUnassigned = await fetch(url, {
      headers: { Authorization: `Bearer ${unassignedToken}` },
    });
    assert.equal(
      resUnassigned.status,
      422,
      `Expected 422 Unprocessable Entity instead of generic 403, got ${resUnassigned.status}`,
    );
    const jsonUnassigned = await resUnassigned.json();
    assert.match(
      jsonUnassigned.message,
      /No store location is assigned to your employee account/i,
    );
    console.log("  PASS -> 422 'No store location is assigned to your employee account...' (actionable, not 403)");

    // 6. User assigned to another branch or company (Store isolation check)
    console.log("Test 6: User assigned to Store A attempting to access Store B (?storeId=2)");
    const resCrossStore = await fetch(`${url}?storeId=${storeB.id}`, {
      headers: { Authorization: `Bearer ${cashierToken}` },
    });
    assert.equal(
      resCrossStore.status,
      403,
      "Expected 403 Store access denied for cross-store attempt",
    );
    const jsonCrossStore = await resCrossStore.json();
    assert.equal(jsonCrossStore.message, "Store access denied");
    console.log("  PASS -> 403 'Store access denied' (branch isolation enforced)");

    console.log("\n=========================================");
    console.log("ALL 6 POS /context AUTHORIZATION TESTS PASSED!");
    console.log("=========================================\n");
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
