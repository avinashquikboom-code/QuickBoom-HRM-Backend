import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/utils/db";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";
import * as service from "../src/pos/service";
import { Actor } from "../src/pos/auth";

async function run() {
  console.log("=== RUNNING POS BARCODE SEARCH VERIFICATION ===");
  const key = randomUUID().slice(0, 8);

  // 1. Create a store for testing (simulating "HO LITTLE LAUGH" or test store)
  const storeA = await prisma.store.create({
    data: { name: `HO LITTLE LAUGH ${key}`, code: `HLL_${key}`, isActive: true },
  });
  const storeB = await prisma.store.create({
    data: { name: `OTHER STORE ${key}`, code: `OTH_${key}`, isActive: true },
  });

  const adminUser = await prisma.user.create({
    data: { email: `admin-${key}@pos.test`, password: "dummy", role: "ADMIN" },
  });
  const actor: Actor = {
    userId: adminUser.id,
    role: "ADMIN",
    admin: true,
    permissions: {},
  };

  // 2. Create products:
  // Product 1: Hopkid Cotton T-Shirt with barcode "ABC-abc-1234"
  const targetBarcode = `ABC-abc-1234`;
  const productActive = await service.createProduct(actor, {
    name: `Hopkid Classic Tee ${key}`,
    code: `HK-TEE-${key}`,
    variants: [
      {
        sku: `SKU-TEE-${key}-M`,
        barcode: targetBarcode,
        size: "M",
        color: "Navy Blue",
        costPrice: "250.00",
        sellingPrice: "599.00",
        taxRate: "5.00",
      },
      {
        sku: `SKU-TEE-${key}-L`,
        barcode: `ABC-abc-5678-${key}`,
        size: "L",
        color: "Navy Blue",
        costPrice: "250.00",
        sellingPrice: "599.00",
        taxRate: "5.00",
      },
    ],
  });

  // Assign stock: Store A has 10 units of M, 0 of L. Store B has 5 of L.
  const variantM = productActive.variants.find((v) => v.size === "M")!;
  const variantL = productActive.variants.find((v) => v.size === "L")!;

  await service.adjust(actor, {
    storeId: storeA.id,
    variantId: variantM.id,
    quantityDelta: 10,
    type: "OPENING",
    reason: "Initial stock Store A",
  });
  await service.adjust(actor, {
    storeId: storeB.id,
    variantId: variantL.id,
    quantityDelta: 5,
    type: "OPENING",
    reason: "Initial stock Store B",
  });

  // Product 2: Inactive product
  const productInactive = await service.createProduct(actor, {
    name: `Hopkid Vintage Jacket ${key}`,
    code: `HK-JKT-${key}`,
    active: false,
    variants: [
      {
        sku: `SKU-JKT-${key}`,
        barcode: `INACT-${key}`,
        size: "Free",
        color: "Denim",
        costPrice: "800.00",
        sellingPrice: "1499.00",
        taxRate: "12.00",
      },
    ],
  });

  // Setup Express test server
  const app = express();
  app.use(express.json());
  app.use("/api/v1/pos", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/pos`;
  const token = signAccessToken({ id: adminUser.id, role: adminUser.role });
  const headers = { Authorization: `Bearer ${token}` };

  async function get(urlPath: string) {
    const res = await fetch(`${baseUrl}${urlPath}`, { headers });
    return { status: res.status, data: await res.json() };
  }

  try {
    // TEST 1: Exact barcode scan lookup (/products/lookup?code=ABC-abc-1234)
    console.log("Checking TEST 1: Exact barcode lookup...");
    const lookupExact = await get(`/products/lookup?storeId=${storeA.id}&code=${targetBarcode}`);
    assert.equal(lookupExact.status, 200);
    assert.equal(lookupExact.data.data.matches.length, 1);
    const m1 = lookupExact.data.data.matches[0];
    assert.equal(m1.barcode, targetBarcode);
    assert.equal(Number(m1.sellingPrice), 599);
    assert.equal(m1.size, "M");
    assert.equal(m1.color, "Navy Blue");
    assert.equal(m1.balances.length, 1);
    assert.equal(m1.balances[0].storeId, storeA.id);
    assert.equal(m1.balances[0].quantity, 10);
    console.log("PASS: Exact barcode lookup resolved variant M with stock=10 in Store A");

    // TEST 2: Barcode with whitespace (/products/lookup?code=  ABC-abc-1234  )
    console.log("Checking TEST 2: Whitespace trimming on barcode lookup...");
    const lookupWhitespace = await get(
      `/products/lookup?storeId=${storeA.id}&code=${encodeURIComponent("  " + targetBarcode + "  \n")}`
    );
    assert.equal(lookupWhitespace.status, 200);
    assert.equal(lookupWhitespace.data.data.matches.length, 1);
    assert.equal(lookupWhitespace.data.data.matches[0].barcode, targetBarcode);
    console.log("PASS: Barcode with whitespace successfully trimmed and resolved");

    // TEST 3: Case-insensitive fallback on barcode lookup
    console.log("Checking TEST 3: Case-insensitive fallback on barcode lookup...");
    const lookupCase = await get(
      `/products/lookup?storeId=${storeA.id}&code=${encodeURIComponent(targetBarcode.toLowerCase())}`
    );
    assert.equal(lookupCase.status, 200);
    assert.equal(lookupCase.data.data.matches.length, 1);
    assert.equal(lookupCase.data.data.matches[0].barcode, targetBarcode);
    console.log("PASS: Case-insensitive fallback matched target barcode");

    // TEST 4: SKU search (/products/lookup?code=SKU-TEE-...-M)
    console.log("Checking TEST 4: SKU lookup...");
    const lookupSku = await get(`/products/lookup?storeId=${storeA.id}&code=${variantM.sku}`);
    assert.equal(lookupSku.status, 200);
    assert.equal(lookupSku.data.data.matches.length, 1);
    assert.equal(lookupSku.data.data.matches[0].sku, variantM.sku);
    console.log("PASS: SKU lookup matched variant M");

    // TEST 5: Paginated /products search by barcode
    console.log("Checking TEST 5: /products catalog search by barcode...");
    const prodSearchBarcode = await get(`/products?storeId=${storeA.id}&search=${targetBarcode}`);
    assert.equal(prodSearchBarcode.status, 200);
    assert.equal(prodSearchBarcode.data.data.total, 1);
    assert.equal(prodSearchBarcode.data.data.items[0].id, productActive.id);
    console.log("PASS: /products catalog search returned product by exact variant barcode");

    // TEST 6: Paginated /products search by name
    console.log("Checking TEST 6: /products catalog search by product name...");
    const prodSearchName = await get(`/products?storeId=${storeA.id}&search=Classic%20Tee`);
    assert.equal(prodSearchName.status, 200);
    assert.equal(prodSearchName.data.data.total, 1);
    console.log("PASS: /products search by product name returned product");

    // TEST 7: Store inventory isolation (Store A vs Store B)
    console.log("Checking TEST 7: Store inventory isolation...");
    const lookupStoreB = await get(`/products/lookup?storeId=${storeB.id}&code=${targetBarcode}`);
    assert.equal(lookupStoreB.status, 200);
    assert.equal(lookupStoreB.data.data.matches.length, 1);
    // Variant M has NO balance record in store B
    assert.equal(lookupStoreB.data.data.matches[0].balances.length, 0);
    console.log("PASS: Store inventory isolation respected (0 stock in Store B)");

    // TEST 8: Inactive product detection
    console.log("Checking TEST 8: Inactive product search...");
    const searchInactive = await get(`/products?storeId=${storeA.id}&search=Vintage%20Jacket`);
    assert.equal(searchInactive.status, 200);
    assert.equal(searchInactive.data.data.total, 1);
    assert.equal(searchInactive.data.data.items[0].active, false);
    console.log("PASS: Inactive product returned with active=false so POS can display clear reason");

    // TEST 9: Non-existent barcode
    console.log("Checking TEST 9: Non-existent barcode lookup...");
    const lookupMissing = await get(`/products/lookup?storeId=${storeA.id}&code=NON_EXISTENT_9999`);
    assert.equal(lookupMissing.status, 200);
    assert.equal(lookupMissing.data.data.matches.length, 0);

    const searchMissing = await get(`/products?storeId=${storeA.id}&search=NON_EXISTENT_9999`);
    assert.equal(searchMissing.status, 200);
    assert.equal(searchMissing.data.data.total, 0);
    console.log("PASS: Genuinely missing barcode returns 0 matches cleanly");

    console.log("\nALL POS BARCODE SEARCH CHECKS PASSED SUCCESSFULLY!");
  } finally {
    // Cleanup fixtures
    await prisma.pOSInventoryBalance.deleteMany({
      where: { storeId: { in: [storeA.id, storeB.id] } },
    });
    await prisma.pOSStockMovement.deleteMany({
      where: { storeId: { in: [storeA.id, storeB.id] } },
    });
    await prisma.pOSProductVariant.deleteMany({
      where: { productId: { in: [productActive.id, productInactive.id] } },
    });
    await prisma.pOSProduct.deleteMany({
      where: { id: { in: [productActive.id, productInactive.id] } },
    });
    await prisma.store.deleteMany({
      where: { id: { in: [storeA.id, storeB.id] } },
    });
    await prisma.pOSAuditLog.deleteMany({
      where: { userId: adminUser.id },
    });
    await prisma.user.deleteMany({ where: { id: adminUser.id } });

    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
