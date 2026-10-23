import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/utils/db";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";
import * as service from "../src/pos/service";
import { Actor } from "../src/pos/auth";
async function main() {
  const url = new URL(process.env.POS_TEST_DATABASE_URL ?? "");
  assert(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.port === "55439" &&
      url.pathname.includes("pos_test") &&
      process.env.DATABASE_URL === process.env.POS_TEST_DATABASE_URL,
    "Isolated local POS test database required",
  );
  const key = randomUUID();
  const store = await prisma.store.create({
      data: { name: `Selection ${key}` },
    }),
    other = await prisma.store.create({ data: { name: `Other ${key}` } });
  const user = await prisma.user.create({
    data: {
      email: `${key}@selection.test.invalid`,
      password: "unused",
      role: "ADMIN",
    },
  });
  const actor: Actor = {
    userId: user.id,
    role: "ADMIN",
    admin: true,
    permissions: {},
  };
  const register = await prisma.pOSRegister.create({
    data: { name: "Selection test", storeId: store.id },
  });
  const session = await service.openRegister(actor, register.id, {
    openingCash: "500",
  });
  const variant = (tag: string, size?: string, color?: string) => ({
    sku: `${key}-${tag}`,
    barcode: `BC-${key}-${tag}`,
    size,
    color,
    costPrice: "50",
    sellingPrice: "100",
    taxRate: "5",
  });
  const products = [];
  for (const [name, variants] of [
    ["Both", [variant("MB", "M", "Black"), variant("LR", "L", "Red")]],
    ["Size", [variant("S", "S"), variant("L", "L")]],
    [
      "Color",
      [variant("RED", undefined, "Red"), variant("BLUE", undefined, "Blue")],
    ],
    ["Plain", [variant("PLAIN")]],
  ] as const) {
    const p = await service.createProduct(actor, {
      name: `${name} ${key}`,
      code: `${key}-${name}`,
      variants,
    });
    products.push(p);
    for (const v of p.variants) {
      await service.adjust(actor, {
        storeId: store.id,
        variantId: v.id,
        quantityDelta: 3,
        type: "OPENING",
        reason: "Selection fixture",
      });
      await service.adjust(actor, {
        storeId: other.id,
        variantId: v.id,
        quantityDelta: 99,
        type: "OPENING",
        reason: "Other store fixture",
      });
    }
  }
  const app = express();
  app.use(express.json());
  app.use("/api/v1/pos", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/pos`;
  const headers = {
    Authorization: `Bearer ${signAccessToken({ id: user.id, role: user.role })}`,
    "Content-Type": "application/json",
  };
  let count = 0;
  async function request(path: string, body?: unknown, status = 200) {
    const r = await fetch(origin + path, {
      headers,
      method: body ? "POST" : "GET",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    assert.equal(r.status, status, JSON.stringify(data));
    return data.data;
  }
  async function test(name: string, fn: () => Promise<void>) {
    await fn();
    count++;
    console.log("PASS " + name);
  }
  try {
    for (const p of products)
      await test(`manual search, exact scan and checkout: ${p.name.split(" ")[0]}`, async () => {
        const found = await request(
          `/products?storeId=${store.id}&search=${encodeURIComponent(p.name)}`,
        );
        assert.equal(found.total, 1);
        assert.equal(found.items[0].variants.length, p.variants.length);
        const original = p.variants[p.variants.length - 1]!;
        const result = await request(
          `/products/lookup?storeId=${store.id}&code=${original.barcode}`,
        );
        assert.equal(result.matches.length, 1);
        const v = result.matches[0];
        assert.equal(v.id, original.id);
        assert.equal(v.sku, original.sku);
        assert.equal(v.sellingPrice, "100");
        assert.equal(v.taxRate, "5");
        assert.deepEqual(
          v.balances.map((b: { storeId: number; quantity: number }) => [
            b.storeId,
            b.quantity,
          ]),
          [[store.id, 3]],
        );
        const sku = await request(
          `/products/lookup?storeId=${store.id}&code=${original.sku}`,
        );
        assert.equal(sku.matches[0].id, v.id);
        const sale = await request("/sales", {
          storeId: store.id,
          sessionId: session.id,
          idempotencyKey: randomUUID(),
          items: [{ variantId: v.id, quantity: 2, discountPerUnit: "0" }],
          payments: [{ method: "CASH", amount: "210" }],
        });
        assert.equal(sale.items[0].variantId, v.id);
        assert.equal(sale.items[0].quantity, 2);
        assert.equal(sale.grandTotal, "210");
        const balance = await prisma.pOSInventoryBalance.findUniqueOrThrow({
          where: { storeId_variantId: { storeId: store.id, variantId: v.id } },
        });
        assert.equal(balance.quantity, 1);
        const untouched = await prisma.pOSInventoryBalance.findUniqueOrThrow({
          where: { storeId_variantId: { storeId: other.id, variantId: v.id } },
        });
        assert.equal(untouched.quantity, 99);
      });
    await test("insufficient stock rolls back and inactive variants remain blocked", async () => {
      const v = products[3]!.variants[0]!;
      await request(
        "/sales",
        {
          storeId: store.id,
          sessionId: session.id,
          idempotencyKey: randomUUID(),
          items: [{ variantId: v.id, quantity: 2, discountPerUnit: "0" }],
          payments: [{ method: "CASH", amount: "210" }],
        },
        409,
      );
      await prisma.pOSProductVariant.update({
        where: { id: v.id },
        data: { active: false },
      });
      const exact = await request(
        `/products/lookup?storeId=${store.id}&code=${v.barcode}`,
      );
      assert.equal(exact.matches[0].active, false);
      await request(
        "/quote",
        {
          storeId: store.id,
          items: [{ variantId: v.id, quantity: 1, discountPerUnit: "0" }],
        },
        400,
      );
    });
    await test("cross-namespace SKU/barcode collision is returned as ambiguity", async () => {
      const v = products[0]!.variants[0]!;
      const second = products[1]!.variants[0]!;
      await prisma.pOSProductVariant.update({
        where: { id: second.id },
        data: { barcode: v.sku },
      });
      const exact = await request(
        `/products/lookup?storeId=${store.id}&code=${v.sku}`,
      );
      assert.equal(exact.matches.length, 2);
      assert.deepEqual(
        new Set(exact.matches.map((r: { id: string }) => r.id)),
        new Set([v.id, second.id]),
      );
    });
    await test("missing codes and missing/invalid stores are explicit", async () => {
      assert.equal(
        (
          await request(
            `/products/lookup?storeId=${store.id}&code=missing-${key}`,
          )
        ).matches.length,
        0,
      );
      await request("/products/lookup?code=x", undefined, 400);
      await request(
        "/products/lookup?storeId=undefined&code=x",
        undefined,
        400,
      );
    });
    await test("lookup enforces store permissions", async () => {
      const denied = await prisma.user.create({
        data: {
          email: `${randomUUID()}@selection.test.invalid`,
          password: "unused",
          role: "SALESMAN",
        },
      });
      const r = await fetch(
        `${origin}/products/lookup?storeId=${store.id}&code=x`,
        {
          headers: {
            Authorization: `Bearer ${signAccessToken({ id: denied.id, role: denied.role })}`,
          },
        },
      );
      assert.equal(r.status, 403);
    });
    console.log(`PASS ${count} real database product selection checks`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
