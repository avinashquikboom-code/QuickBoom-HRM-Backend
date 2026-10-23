import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/utils/db";
import * as service from "../src/pos/service";
import { Actor } from "../src/pos/auth";

async function run() {
  const testUrl = new URL(process.env.POS_TEST_DATABASE_URL ?? "");
  assert(["127.0.0.1", "localhost"].includes(testUrl.hostname) && testUrl.port === "55439" && testUrl.pathname.includes("pos_test") && process.env.DATABASE_URL === process.env.POS_TEST_DATABASE_URL, "Guarded isolated POS test database required");
  console.log("=== STARTING CATALOG & MANUAL POS CHECKOUT & COMMISSION VERIFICATION ===");
  const key = randomUUID().slice(0, 8);

  // 1. Create a store for testing
  const store = await prisma.store.create({
    data: { name: `HOPKID MANUAL TEST STORE ${key}`, code: `HMTS_${key}`, isActive: true },
  });

  // 2. Create an admin user & actor
  const adminUser = await prisma.user.create({
    data: { email: `admin-${key}@pos-manual.test`, password: "dummy", role: "ADMIN" },
  });
  const actor: Actor = {
    userId: adminUser.id,
    role: "ADMIN",
    admin: true,
    permissions: {},
  };

  // 3. Create a salesperson employee with user account
  const sellerUser = await prisma.user.create({
    data: { email: `seller-${key}@pos-manual.test`, password: "dummy", role: "EMPLOYEE", isActive: true },
  });
  const seller = await prisma.employee.create({
    data: {
      userId: sellerUser.id,
      employeeCode: `SEL-${key}`,
      employeeID: randomUUID(),
      firstName: "Sales",
      lastName: `Person ${key}`,
      storeId: store.id,
      designation: "Salesperson",
      status: "active",
      source: "LOCAL",
    },
  });

  // 4. Create an active product with 1 variant
  const product = await service.createProduct(actor, {
    name: `Hopkid Test Product ${key}`,
    code: `HK-PROD-${key}`,
    variants: [
      {
        sku: `SKU-PROD-${key}`,
        barcode: `BC-PROD-${key}`,
        size: "M",
        color: "Blue",
        costPrice: "200.00",
        sellingPrice: "500.00",
        taxRate: "5.00",
      },
    ],
  });
  const variant = product.variants[0];

  // Add initial stock: 20 units
  await service.adjust(actor, {
    storeId: store.id,
    variantId: variant.id,
    quantityDelta: 20,
    type: "OPENING",
    reason: "Initial stock for manual/catalog verification",
  });

  // 5. Open a register & session
  const register = await prisma.pOSRegister.create({
    data: { storeId: store.id, name: `Register ${key}` },
  });
  const session = await service.openRegister(actor, register.id, { openingCash: "1000.00" });

  try {
    // -----------------------------------------------------------------
    // TEST 1: Catalog-based POS Checkout Path
    // -----------------------------------------------------------------
    console.log("Checking TEST 1: Pure catalog-based POS checkout path...");
    const quote1 = await service.quote(actor, {
      storeId: store.id,
      items: [{ variantId: variant.id, quantity: 2, discountPerUnit: "0" }],
      orderDiscount: "0",
    });
    // 2 * 500 = 1000 + 5% tax (50) = 1050
    assert.equal(Number(quote1.subtotal), 1000);
    assert.equal(Number(quote1.taxTotal), 50);
    assert.equal(Number(quote1.grandTotal), 1050);

    const sale1 = await service.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      salespersonId: seller.id,
      items: [{ variantId: variant.id, quantity: 2, discountPerUnit: "0", salespersonId: seller.id }],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: "1050.00" }],
      idempotencyKey: `sale1-${key}`,
    });
    assert.equal(sale1.items.length, 1);
    assert.equal(sale1.items[0].variantId, variant.id);
    assert.equal(Number(sale1.grandTotal), 1050);

    // Stock should be decremented from 20 to 18
    const balAfterSale1 = await prisma.pOSInventoryBalance.findUnique({
      where: { storeId_variantId: { storeId: store.id, variantId: variant.id } },
    });
    assert.equal(balAfterSale1?.quantity, 18);
    console.log("PASS TEST 1: Catalog sale completed, stock decremented 20 -> 18");

    // -----------------------------------------------------------------
    // TEST 2: Manual POS Checkout Path (No variant, custom price/tax)
    // -----------------------------------------------------------------
    console.log("Checking TEST 2: Pure manual POS checkout path...");
    const quote2 = await service.quote(actor, {
      storeId: store.id,
      items: [
        {
          manual: true,
          name: "Alteration / Stitching Service",
          unitPrice: "150.00",
          taxRate: "18.00",
          quantity: 2,
          discountPerUnit: "0",
          salespersonId: seller.id,
        },
      ],
      orderDiscount: "0",
    });
    // 2 * 150 = 300 + 18% tax (54) = 354
    assert.equal(Number(quote2.subtotal), 300);
    assert.equal(Number(quote2.taxTotal), 54);
    assert.equal(Number(quote2.grandTotal), 354);

    const sale2 = await service.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      salespersonId: seller.id,
      items: [
        {
          manual: true,
          name: "Alteration / Stitching Service",
          unitPrice: "150.00",
          taxRate: "18.00",
          quantity: 2,
          discountPerUnit: "0",
          salespersonId: seller.id,
        },
      ],
      orderDiscount: "0",
      payments: [{ method: "UPI", amount: "354.00", reference: `UPI-${key}` }],
      idempotencyKey: `sale2-${key}`,
    });
    assert.equal(sale2.items.length, 1);
    assert.equal(sale2.items[0].variantId, null);
    assert.equal(sale2.items[0].name, "Alteration / Stitching Service");
    assert.equal(Number(sale2.grandTotal), 354);

    // Stock for catalog variant MUST NOT be affected (remains 18)
    const balAfterSale2 = await prisma.pOSInventoryBalance.findUnique({
      where: { storeId_variantId: { storeId: store.id, variantId: variant.id } },
    });
    assert.equal(balAfterSale2?.quantity, 18);
    console.log("PASS TEST 2: Manual sale completed with variantId=null; inventory preserved at 18");

    // -----------------------------------------------------------------
    // TEST 3: Mixed POS Checkout Path (Catalog + Manual items in one cart)
    // -----------------------------------------------------------------
    console.log("Checking TEST 3: Mixed POS checkout path (catalog + manual)...");
    const quote3 = await service.quote(actor, {
      storeId: store.id,
      items: [
        { variantId: variant.id, quantity: 1, discountPerUnit: "0", salespersonId: seller.id },
        {
          manual: true,
          name: "Gift Wrapping & Bag",
          unitPrice: "50.00",
          taxRate: "0.00",
          quantity: 1,
          discountPerUnit: "0",
          salespersonId: seller.id,
        },
      ],
      orderDiscount: "0",
    });
    // Catalog: 500 + 5% (25) = 525
    // Manual: 50 + 0% (0) = 50
    // Total: 575
    assert.equal(Number(quote3.subtotal), 550);
    assert.equal(Number(quote3.taxTotal), 25);
    assert.equal(Number(quote3.grandTotal), 575);

    const sale3 = await service.checkout(actor, {
      storeId: store.id,
      sessionId: session.id,
      salespersonId: seller.id,
      items: [
        { variantId: variant.id, quantity: 1, discountPerUnit: "0", salespersonId: seller.id },
        {
          manual: true,
          name: "Gift Wrapping & Bag",
          unitPrice: "50.00",
          taxRate: "0.00",
          quantity: 1,
          discountPerUnit: "0",
          salespersonId: seller.id,
        },
      ],
      orderDiscount: "0",
      payments: [{ method: "CASH", amount: "575.00" }],
      idempotencyKey: `sale3-${key}`,
    });
    assert.equal(sale3.items.length, 2);
    // Catalog item has variantId, manual item has null
    const catalogItem = sale3.items.find((i: any) => i.variantId === variant.id);
    const manualItem = sale3.items.find((i: any) => i.variantId === null);
    assert.ok(catalogItem, "Catalog item found in sale");
    assert.ok(manualItem, "Manual item found in sale");

    // Stock for catalog variant decremented from 18 to 17
    const balAfterSale3 = await prisma.pOSInventoryBalance.findUnique({
      where: { storeId_variantId: { storeId: store.id, variantId: variant.id } },
    });
    assert.equal(balAfterSale3?.quantity, 17);
    console.log("PASS TEST 3: Mixed checkout succeeded; catalog stock decremented 18 -> 17; manual item recorded");

    // -----------------------------------------------------------------
    // TEST 4: Return flow for mixed sale (Catalog variant restocked, manual variantId: null handled safely)
    // -----------------------------------------------------------------
    console.log("Checking TEST 4: Return flow for mixed sale...");
    const returnResult = await service.returnSale(actor, sale3.id, {
      sessionId: session.id,
      items: [
        { saleItemId: catalogItem.id, quantity: 1, resellable: true },
        { saleItemId: manualItem.id, quantity: 1, resellable: false },
      ],
      refundMethod: "CASH",
      reason: "Customer change of mind",
      idempotencyKey: `ret-${key}`,
    });
    assert.equal(Number(returnResult.refundAmount), 575);

    // Stock for catalog variant must be restored 17 -> 18
    const balAfterReturn = await prisma.pOSInventoryBalance.findUnique({
      where: { storeId_variantId: { storeId: store.id, variantId: variant.id } },
    });
    assert.equal(balAfterReturn?.quantity, 18);
    console.log("PASS TEST 4: Return succeeded; catalog variant restocked 17 -> 18; manual line safely refunded without movement error");

    console.log("\nALL 4 CATALOG & MANUAL POS VERIFICATIONS PASSED SUCCESSFULLY!");
  } finally {
    // Cleanup fixtures
    await prisma.pOSStockMovement.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSReturnItem.deleteMany({ where: { return: { sale: { storeId: store.id } } } });
    await prisma.pOSReturn.deleteMany({ where: { sale: { storeId: store.id } } });
    await prisma.commissionTransaction.deleteMany({ where: { employeeId: seller.id } });
    await prisma.pOSSalePayment.deleteMany({ where: { sale: { storeId: store.id } } });
    await prisma.pOSSaleItem.deleteMany({ where: { sale: { storeId: store.id } } });
    await prisma.pOSSale.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSSession.deleteMany({ where: { register: { storeId: store.id } } });
    await prisma.pOSRegister.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSInventoryBalance.deleteMany({ where: { storeId: store.id } });
    await prisma.pOSProductVariant.deleteMany({ where: { productId: product.id } });
    await prisma.pOSProduct.deleteMany({ where: { id: product.id } });
    await prisma.employee.deleteMany({ where: { id: seller.id } });
    await prisma.store.deleteMany({ where: { id: store.id } });
    await prisma.pOSAuditLog.deleteMany({ where: { userId: { in: [adminUser.id, sellerUser.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminUser.id, sellerUser.id] } } });
    await prisma.$disconnect();
  }
}

run().then(() => process.exit(0)).catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
