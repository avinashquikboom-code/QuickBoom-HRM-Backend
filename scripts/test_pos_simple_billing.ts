import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/utils/db";
import * as service from "../src/pos/service";
import { Actor } from "../src/pos/auth";
import { receiptFromSale } from "../../HRM-Admin-Pannel/src/features/pos/posReceipt";

async function run() {
  console.log("=== STARTING POS SIMPLE BILLING & AUTO-REGISTER-SESSION VERIFICATION ===");
  const key = randomUUID().slice(0, 8);

  // 1. Create a store for testing
  const store = await prisma.store.create({
    data: { name: `HOPKID SIMPLIFIED POS STORE ${key}`, code: `SPS_${key}`, isActive: true },
  });

  // 2. Create cashier and employees
  const cashierUser = await prisma.user.create({
    data: { email: `cashier-${key}@hopkid.test`, password: "dummy", role: "EMPLOYEE" },
  });
  const employee1 = await prisma.employee.create({
    data: {
      firstName: "Rahul",
      lastName: "Sharma",
      employeeCode: `EMP-R-${key}`,
      storeId: store.id,
      status: "active",
    },
  });
  const employee2 = await prisma.employee.create({
    data: {
      firstName: "Priya",
      lastName: "Verma",
      employeeCode: `EMP-P-${key}`,
      storeId: store.id,
      status: "active",
    },
  });

  const actor: Actor = {
    userId: cashierUser.id,
    employeeId: employee1.id,
    role: "CASHIER",
    admin: false,
    storeId: store.id,
    permissions: {
      "pos.sell": true,
      "pos.discount": true,
      "pos.priceOverride": true,
      "pos.read": true,
    },
  };

  try {
    // Enable CASH, CARD, UPI payment methods for the store
    for (const code of ["CASH", "CARD", "UPI"]) {
      await prisma.pOSPaymentMethod.upsert({
        where: { storeId_code: { storeId: store.id, code } },
        create: { storeId: store.id, code, name: code, enabled: true },
        update: { enabled: true },
      });
    }

    // TEST 1: Single-item Cash Sale WITHOUT open register session (auto-handled)
    console.log("\n--- TEST 1: Single-item Cash Sale with Auto Register Session (no manual session opened) ---");
    const quote1 = await service.quote(actor, {
      storeId: store.id,
      items: [
        {
          manual: true,
          key: "row-1",
          name: "HopKid Cotton T-Shirt",
          barcode: `BC-MANUAL-1-${key}`,
          quantity: 1,
          unitPrice: "499.00",
          taxRate: "5.00",
          discountPerUnit: "0.00",
          salespersonId: employee1.id,
        },
      ],
    });

    assert.ok(quote1.snapshots.length === 1, "Quote returned 1 line");
    assert.equal(quote1.snapshots[0].name, "HopKid Cotton T-Shirt");
    assert.equal(quote1.snapshots[0].size, "");
    assert.equal(quote1.snapshots[0].color, "");
    assert.equal(quote1.grandTotal.toString(), "523.95"); // 499 + 5% GST (24.95)

    // Complete sale with NO sessionId in payload
    const sale1Idempotency = `sale-1-${key}`;
    const sale1 = await service.checkout(actor, {
      storeId: store.id,
      // Note: NO sessionId provided!
      salespersonId: employee1.id,
      items: [
        {
          manual: true,
          key: "row-1",
          name: "HopKid Cotton T-Shirt",
          barcode: `BC-MANUAL-1-${key}`,
          quantity: 1,
          unitPrice: "499.00",
          taxRate: "5.00",
          discountPerUnit: "0.00",
          salespersonId: employee1.id,
        },
      ],
      payments: [
        {
          method: "CASH",
          amount: quote1.grandTotal.toFixed(2),
        },
      ],
      idempotencyKey: sale1Idempotency,
    });

    assert.ok(sale1.id, "Sale 1 created successfully");
    assert.ok(sale1.sessionId, "Sale 1 has auto-assigned valid sessionId");
    assert.equal(sale1.payments[0].method, "CASH");
    assert.equal(sale1.items[0].name, "HopKid Cotton T-Shirt");
    assert.equal(sale1.items[0].size, "");
    assert.equal(sale1.items[0].color, "");

    // Verify session and register were created in the database
    const session1 = await prisma.pOSSession.findUnique({
      where: { id: sale1.sessionId },
      include: { register: true },
    });
    assert.ok(session1, "Session exists in database");
    assert.equal(session1.userId, cashierUser.id, "Session belongs to cashier");
    assert.equal(session1.register.storeId, store.id, "Session belongs to correct store");
    assert.equal(session1.register.name, "Main Register", "Register created automatically as Main Register");
    console.log(`✓ Sale 1 (${sale1.invoiceNo}) completed with auto-session: ${sale1.sessionId} on register "${session1.register.name}"`);

    // TEST 2: Multi-item Card Sale with Discount & GST
    console.log("\n--- TEST 2: Multi-item Card Sale with Discount & GST (Reuse active session) ---");
    const quote2 = await service.quote(actor, {
      storeId: store.id,
      items: [
        {
          manual: true,
          key: "item-a",
          name: "Kids Denim Jeans",
          barcode: `BC-JEANS-${key}`,
          quantity: 2,
          unitPrice: "800.00", // 1600 total
          discountPerUnit: "100.00", // 200 discount -> 1400 taxable
          taxRate: "12.00", // 168 tax -> 1568
          salespersonId: employee1.id,
        },
        {
          manual: true,
          key: "item-b",
          name: "Kids Party Wear Shirt",
          quantity: 1,
          unitPrice: "600.00",
          discountPerUnit: "50.00", // 550 taxable
          taxRate: "5.00", // 27.50 tax -> 577.50
          salespersonId: employee2.id,
        },
      ],
    });

    assert.equal(quote2.snapshots.length, 2);
    const sale2 = await service.checkout(actor, {
      storeId: store.id,
      sessionId: sale1.sessionId, // Passing the established session
      salespersonId: employee1.id,
      customerName: "Anil Kapoor",
      customerPhone: "9876543210",
      items: [
        {
          manual: true,
          key: "item-a",
          name: "Kids Denim Jeans",
          barcode: `BC-JEANS-${key}`,
          quantity: 2,
          unitPrice: "800.00",
          discountPerUnit: "100.00",
          taxRate: "12.00",
          salespersonId: employee1.id,
        },
        {
          manual: true,
          key: "item-b",
          name: "Kids Party Wear Shirt",
          quantity: 1,
          unitPrice: "600.00",
          discountPerUnit: "50.00",
          taxRate: "5.00",
          salespersonId: employee2.id,
        },
      ],
      payments: [
        {
          method: "CARD",
          amount: quote2.grandTotal.toFixed(2),
          reference: "TXN-CARD-9918",
        },
      ],
      idempotencyKey: `sale-2-${key}`,
    });

    assert.equal(sale2.payments[0].method, "CARD");
    assert.equal(sale2.customerName, "Anil Kapoor");
    assert.equal(sale2.items.length, 2);
    assert.equal(sale2.items[0].salespersonId, employee1.id);
    assert.equal(sale2.items[1].salespersonId, employee2.id);
    console.log(`✓ Sale 2 (${sale2.invoiceNo}) completed via CARD: 2 items, total ${quote2.grandTotal.toFixed(2)}`);

    // TEST 3: Multi-item UPI Sale
    console.log("\n--- TEST 3: Multi-item UPI Sale ---");
    const quote3 = await service.quote(actor, {
      storeId: store.id,
      items: [
        {
          manual: true,
          key: "item-c",
          name: "Winter Jacket",
          quantity: 1,
          unitPrice: "1200.00",
          taxRate: "18.00",
          discountPerUnit: "0.00",
          salespersonId: employee2.id,
        },
      ],
    });

    const sale3 = await service.checkout(actor, {
      storeId: store.id,
      salespersonId: employee2.id,
      items: [
        {
          manual: true,
          key: "item-c",
          name: "Winter Jacket",
          quantity: 1,
          unitPrice: "1200.00",
          taxRate: "18.00",
          discountPerUnit: "0.00",
          salespersonId: employee2.id,
        },
      ],
      payments: [
        {
          method: "UPI",
          amount: quote3.grandTotal.toFixed(2),
          reference: "UPI/392019/HOPKID",
        },
      ],
      idempotencyKey: `sale-3-${key}`,
    });

    assert.equal(sale3.payments[0].method, "UPI");
    console.log(`✓ Sale 3 (${sale3.invoiceNo}) completed via UPI: total ${quote3.grandTotal}`);

    // TEST 4: Receipt generation verification
    console.log("\n--- TEST 4: Verify Thermal Receipt Generation from Persisted Sales ---");
    const persistedSale2 = await prisma.pOSSale.findUniqueOrThrow({
      where: { id: sale2.id },
      include: {
        items: {
          include: {
            salesperson: { select: { id: true, employeeID: true, firstName: true, lastName: true, employeeCode: true } },
          },
        },
        payments: true,
        returns: { include: { items: true } },
        store: { select: { name: true, address: true } },
        cashier: { select: { email: true, profile: { select: { fullName: true } } } },
        salesperson: { select: { id: true, employeeID: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });
    const receipt = receiptFromSale(persistedSale2, "INR");
    assert.ok(receipt.billNo === sale2.invoiceNo, "Receipt invoice number matches");
    assert.ok(receipt.items.length === 2, "Receipt contains 2 items");
    assert.equal(receipt.customerName, "Anil Kapoor");
    assert.equal(receipt.customerPhone, "9876543210");
    assert.equal(receipt.paymentMode, "CARD");
    console.log(`✓ Receipt verified: Invoice ${receipt.billNo}, customer "${receipt.customerName}", items: ${receipt.items.map(i => i.name).join(", ")}`);

    console.log("\n=== ALL POS BILLING SIMPLIFICATION & REGISTER SESSION TESTS PASSED! ===");
  } finally {
    // Cleanup created test records
    await prisma.pOSSalePayment.deleteMany({ where: { sale: { storeId: store.id } } });
    await prisma.pOSSaleItem.deleteMany({ where: { sale: { storeId: store.id } } });
    await prisma.pOSSale.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSSession.deleteMany({ where: { register: { storeId: store.id } } });
    await prisma.pOSRegister.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSPaymentMethod.deleteMany({ where: { storeId: store.id } });
    await prisma.employee.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSAuditLog.deleteMany({ where: { userId: cashierUser.id } });
    await prisma.user.deleteMany({ where: { id: cashierUser.id } });
    await prisma.store.deleteMany({ where: { id: store.id } });
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
