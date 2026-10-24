import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/utils/db";
import * as pos from "../src/pos/service";
import { Actor } from "../src/pos/auth";

async function runTests() {
  console.log("=== Testing POS Bill Permanent Delete vs Cancel Bill ===");

  const key = randomUUID().slice(0, 8);
  const adminUser = await prisma.user.create({
    data: { email: `admin-${key}@hopkid.test`, password: "test", role: "ADMIN" },
  });
  const staffUser = await prisma.user.create({
    data: { email: `staff-${key}@hopkid.test`, password: "test", role: "EMPLOYEE" },
  });

  const adminActor: Actor = {
    userId: adminUser.id,
    role: "ADMIN",
    admin: true,
    permissions: {},
  };

  const staffActor: Actor = {
    userId: staffUser.id,
    role: "EMPLOYEE",
    admin: false,
    permissions: { "pos.refund": true },
  };

  const store1 = await prisma.store.create({ data: { name: `Store A ${key}` } });
  const store2 = await prisma.store.create({ data: { name: `Store B ${key}` } });

  // Registers & Sessions
  const reg1 = await prisma.pOSRegister.create({ data: { storeId: store1.id, name: "Reg1" } });
  const sess1 = await pos.openRegister(adminActor, reg1.id, { openingCash: "1000" });

  const reg2 = await prisma.pOSRegister.create({ data: { storeId: store2.id, name: "Reg2" } });
  const sess2 = await pos.openRegister(adminActor, reg2.id, { openingCash: "1000" });

  // Store-scoped admin actor for store 1 only
  const store1AdminActor: Actor = {
    userId: adminUser.id,
    role: "ADMIN",
    admin: true,
    storeId: store1.id,
    permissions: {},
  };

  // Helper to create a test sale via pos.checkout
  async function makeSale(storeId: number, sessionId: string, amount: string, method = "CASH") {
    return pos.checkout(adminActor, {
      storeId,
      sessionId,
      idempotencyKey: randomUUID(),
      orderDiscount: "0",
      items: [
        {
          manual: true,
          key: randomUUID(),
          name: "Test Item",
          quantity: 1,
          unitPrice: amount,
          taxRate: "0",
          discountPerUnit: "0",
        },
      ],
      payments: [{ method, amount }],
    });
  }

  // TEST 1: Deleting one eligible bill permanently removes it from DB
  console.log("\n1. Testing permanent bill deletion...");
  const sale1 = await makeSale(store1.id, sess1.id, "500");
  const deleteRes = await pos.deleteSale(adminActor, sale1.id, { reason: "Testing permanent deletion" });
  assert.equal(deleteRes.deleted, true);
  assert.equal(deleteRes.status, "DELETED");
  const checkDbSale1 = await prisma.pOSSale.findUnique({ where: { id: sale1.id } });
  assert.equal(checkDbSale1, null, "Sale 1 must be permanently removed from database");
  const checkDbItems1 = await prisma.pOSSaleItem.findMany({ where: { saleId: sale1.id } });
  assert.equal(checkDbItems1.length, 0, "Sale items must be deleted");
  console.log("✓ Bill permanently removed from database along with items and payments.");

  // TEST 2: Cancelling a bill separately preserves it with status CANCELLED
  console.log("\n2. Testing cancel bill workflow...");
  const sale2 = await makeSale(store1.id, sess1.id, "750");
  const cancelRes = await pos.cancelSale(adminActor, sale2.id, { reason: "Customer return cancellation" });
  assert.equal(cancelRes.status, "CANCELLED");
  const checkDbSale2 = await prisma.pOSSale.findUnique({ where: { id: sale2.id } });
  assert.notEqual(checkDbSale2, null, "Sale 2 must still exist in database");
  assert.equal(checkDbSale2?.status, "CANCELLED", "Sale 2 status must be CANCELLED");
  console.log("✓ Bill cancelled, preserved in database with status CANCELLED.");

  // TEST 3: Attempting deletion without administrator permissions is rejected
  console.log("\n3. Testing non-admin delete restriction...");
  const sale3 = await makeSale(store1.id, sess1.id, "300");
  await assert.rejects(
    async () => {
      await pos.deleteSale(staffActor, sale3.id, { reason: "Unauthorized delete" });
    },
    (err: any) => {
      assert.match(err.message, /Administrator required/);
      return true;
    },
    "Non-admin should not be able to permanently delete bills"
  );
  console.log("✓ Non-admin delete attempt successfully rejected with 403.");

  // TEST 4: Attempting deletion of bill belonging to unauthorized store is rejected
  console.log("\n4. Testing store scope isolation...");
  const saleInStore2 = await makeSale(store2.id, sess2.id, "450");
  await assert.rejects(
    async () => {
      await pos.deleteSale(store1AdminActor, saleInStore2.id, { reason: "Cross store delete" });
    },
    (err: any) => {
      assert.match(err.message, /unauthorized|Store scope mismatch|Store/i);
      return true;
    },
    "Admin restricted to Store 1 must not delete Store 2 bills"
  );
  console.log("✓ Store permission boundary enforced.");

  // TEST 5: Financial safety - Reconciled payments prevent permanent deletion
  console.log("\n5. Testing financial safety lock for reconciled payments...");
  const saleReconciled = await makeSale(store1.id, sess1.id, "1200");
  await prisma.pOSSalePayment.updateMany({
    where: { saleId: saleReconciled.id },
    data: { reconciliationStatus: "RECONCILED" },
  });
  await assert.rejects(
    async () => {
      await pos.deleteSale(adminActor, saleReconciled.id, { reason: "Delete reconciled" });
    },
    (err: any) => {
      assert.match(err.message, /already been reconciled/i);
      return true;
    },
    "Reconciled payment must block permanent deletion"
  );
  console.log("✓ Financial compliance lock successfully prevented deleting reconciled bill.");

  // TEST 6: Bulk delete permanently removes selected bills
  console.log("\n6. Testing bulk permanent delete...");
  const bulkSaleA = await makeSale(store1.id, sess1.id, "100");
  const bulkSaleB = await makeSale(store1.id, sess1.id, "200");
  const bulkRes = await pos.bulkCancelSales(adminActor, {
    saleIds: [bulkSaleA.id, bulkSaleB.id],
    permanent: true,
    reason: "Bulk purge test",
  });
  assert.equal(bulkRes.processedCount, 2);
  const checkBulkA = await prisma.pOSSale.findUnique({ where: { id: bulkSaleA.id } });
  const checkBulkB = await prisma.pOSSale.findUnique({ where: { id: bulkSaleB.id } });
  assert.equal(checkBulkA, null, "Bulked bill A must be deleted");
  assert.equal(checkBulkB, null, "Bulked bill B must be deleted");
  console.log("✓ Bulk permanent deletion successfully removed all selected bills.");

  // Cleanup test fixtures
  await prisma.pOSSalePayment.updateMany({
    where: { sale: { storeId: { in: [store1.id, store2.id] } } },
    data: { reconciliationStatus: "UNRECONCILED" },
  });
  const remainingSales = await prisma.pOSSale.findMany({ where: { storeId: { in: [store1.id, store2.id] } } });
  for (const s of remainingSales) {
    await pos.deleteSale(adminActor, s.id, { reason: "Test fixture cleanup" });
  }
  await prisma.pOSSession.deleteMany({ where: { id: { in: [sess1.id, sess2.id] } } });
  await prisma.pOSRegister.deleteMany({ where: { id: { in: [reg1.id, reg2.id] } } });
  await prisma.store.deleteMany({ where: { id: { in: [store1.id, store2.id] } } });
  await prisma.pOSAuditLog.deleteMany({ where: { userId: { in: [adminUser.id, staffUser.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUser.id, staffUser.id] } } });

  console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
