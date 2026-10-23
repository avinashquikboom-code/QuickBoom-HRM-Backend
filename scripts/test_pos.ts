import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  lineTotals,
  refundAllocation,
  refundComponents,
} from "../src/pos/finance";
import { money, POSError } from "../src/pos/validation";
import { scope, permission, Actor } from "../src/pos/auth";
import { prisma } from "../src/utils/db";
import * as pos from "../src/pos/service";
import {
  groupedSales,
  inventoryReport,
  registerReport,
  returnReport,
  report,
} from "../src/pos/reports";
import express from "express";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";
import * as operations from "../src/pos/operations";
import {
  reviewCommission,
  commissionPayrollWhere,
  protectLegacyPOSReview,
} from "../src/pos/commissions";
import authRoutes from "../src/routes/authRoutes";
import bcrypt from "bcryptjs";
import { createCommissionTransaction } from "../src/controllers/commissionController";
import { updateSales } from "../src/controllers/salesLegacyController";
import { authenticate } from "../src/pos/auth";
const D = Prisma.Decimal;
let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
async function main() {
  await test("decimal tax and unit discounts", () => {
    const n = lineTotals(new D("99.99"), 3, new D("9.99"), new D("5"));
    assert.equal(n.lineTotal.toFixed(2), "283.50");
    assert.equal(n.discountTotal.toFixed(2), "29.97");
  });
  await test("half-up tax rounding", () =>
    assert.equal(
      lineTotals(new D(".10"), 1, new D(0), new D(5)).taxTotal.toString(),
      ".01".replace(/^\./, "0."),
    ));
  await test("partial refunds allocate all rounding cents", () => {
    let total = new D(0);
    for (let i = 0; i < 3; i++)
      total = total.plus(refundAllocation(new D("100.01"), 3, i, 1));
    assert.equal(total.toString(), "100.01");
    assert.throws(() => refundAllocation(new D(100), 3, 2, 2));
  });
  await test("financial payload rejection", () => {
    for (const v of [-1, "NaN", "0.001", "1e3", null])
      assert.throws(() => money(v));
    assert.throws(() => lineTotals(new D(10), 1, new D(11), new D(0)));
  });
  await test("partial credit allocation never produces negative tax and preserves original components", () => {
    for (const quantity of [2, 3, 7]) {
      let revenue = new D(0),
        tax = new D(0),
        total = new D(0);
      for (let i = 0; i < quantity; i++) {
        const refund = refundComponents(
          new D("1.01"),
          new D("0.01"),
          quantity,
          i,
          1,
        );
        assert(refund.taxRefund.gte(0));
        assert(refund.refundAmount.gte(refund.revenueRefund));
        revenue = revenue.plus(refund.revenueRefund);
        tax = tax.plus(refund.taxRefund);
        total = total.plus(refund.refundAmount);
      }
      assert.equal(revenue.toFixed(2), "1.00");
      assert.equal(tax.toFixed(2), "0.01");
      assert.equal(total.toFixed(2), "1.01");
    }
  });
  const clerk: Actor = {
    userId: 1,
    role: "SALESMAN",
    storeId: 10,
    permissions: { "pos.sell": true },
    admin: false,
  };
  await test("deny cross-store access and missing permissions", () => {
    assert.throws(() => scope(clerk, 11));
    assert.throws(() => permission(clerk, "refund"));
    scope(clerk, 10);
    permission(clerk, "sell");
  });
  if (process.env.POS_TEST_DATABASE_URL) {
    // Strong guard before any fixture writes; never fall back to configured production DB.
    const url = new URL(process.env.POS_TEST_DATABASE_URL);
    assert(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.port === "55439" &&
        url.pathname.includes("pos_test"),
      "Only isolated local POS test database is allowed",
    );
    assert.equal(process.env.DATABASE_URL, process.env.POS_TEST_DATABASE_URL);
    const suffix = randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: {
        email: `pos-${suffix}@test.invalid`,
        password: "not-a-login",
        role: "ADMIN",
      },
    });
    const store = await prisma.store.create({
        data: { name: `POS test ${suffix}` },
      }),
      destination = await prisma.store.create({
        data: { name: `Destination ${suffix}` },
      });
    await prisma.workMode.upsert({
      where: { id: "OFFICE" },
      create: { id: "OFFICE", name: "Office" },
      update: {},
    });
    const employee = await prisma.employee.create({
      data: {
        employeeCode: `POS-${suffix}`,
        firstName: "POS",
        lastName: "Test",
        storeId: store.id,
      },
    });
    const actor: Actor = {
      userId: user.id,
      role: "ADMIN",
      employeeId: employee.id,
      admin: true,
      permissions: {},
    };
    const product = await pos.createProduct(actor, {
      name: "T-shirt",
      code: `P-${suffix}`,
      variants: [
        {
          sku: `S-${suffix}`,
          barcode: `B-${suffix}`,
          size: "M",
          color: "Black",
          costPrice: "50",
          sellingPrice: "100",
          taxRate: "5",
        },
        {
          sku: `S2-${suffix}`,
          size: "L",
          color: "White",
          costPrice: "25",
          sellingPrice: "60",
          taxRate: "0",
        },
      ],
    });
    const v = product.variants[0]!,
      v2 = product.variants[1]!;
    await test("product and variant uniqueness", async () => {
      await assert.rejects(
        pos.createProduct(actor, {
          name: "Duplicate",
          code: `Q-${suffix}`,
          variants: [
            {
              sku: v.sku,
              size: "S",
              color: "Red",
              costPrice: "1",
              sellingPrice: "2",
            },
          ],
        }),
      );
      assert.equal(
        await prisma.pOSProduct.count({ where: { code: `Q-${suffix}` } }),
        0,
      );
    });
    await pos.adjust(actor, {
      storeId: store.id,
      variantId: v.id,
      quantityDelta: 10,
      reason: "Opening stock",
    });
    await pos.adjust(actor, {
      storeId: store.id,
      variantId: v2.id,
      quantityDelta: 2,
      reason: "Opening stock",
    });
    await test("branch stock isolation", async () => {
      assert.equal(
        await prisma.pOSInventoryBalance.count({
          where: { storeId: destination.id, variantId: v.id },
        }),
        0,
      );
    });
    await test("order discounts allocate exact cents and override permission/reason is enforced", async () => {
      const q = await pos.quote(actor, {
        storeId: store.id,
        items: [
          { variantId: v.id, quantity: 3 },
          { variantId: v2.id, quantity: 2 },
        ],
        orderDiscount: "0.01",
      });
      assert.equal(q.discountTotal.toFixed(2), "0.01");
      assert.equal(q.grandTotal.toFixed(2), "434.99");
      const override = await pos.quote(actor, {
        storeId: store.id,
        items: [
          {
            variantId: v.id,
            quantity: 2,
            unitPriceOverride: "80",
            priceOverrideReason: "Manager approval",
          },
        ],
        orderDiscount: "8",
      });
      assert.equal(override.grandTotal.toFixed(2), "159.60");
      assert.equal(override.snapshots[0]!.catalogUnitPrice.toString(), "100");
      await assert.rejects(
        pos.quote(
          {
            ...actor,
            admin: false,
            storeId: store.id,
            permissions: { "pos.sell": true },
          },
          {
            storeId: store.id,
            items: [
              {
                variantId: v.id,
                quantity: 1,
                unitPriceOverride: "1",
                priceOverrideReason: "Unauthorized",
              },
            ],
          },
        ),
        /priceOverride/,
      );
    });
    const register = await prisma.pOSRegister.create({
      data: { storeId: store.id, name: `Register ${suffix}` },
    });
    const session = await pos.openRegister(actor, register.id, {
      openingCash: "500",
    });
    await test("one open session per register", async () => {
      await assert.rejects(
        pos.openRegister(actor, register.id, { openingCash: "0" }),
      );
    });
    const saleBody = {
      storeId: store.id,
      sessionId: session.id,
      salespersonId: employee.id,
      items: [{ variantId: v.id, quantity: 2, discountPerUnit: "10" }],
      payments: [
        { method: "CASH", amount: "100" },
        { method: "UPI", amount: "89" },
      ],
      idempotencyKey: randomUUID(),
    };
    let sale: Awaited<ReturnType<typeof pos.checkout>>;
    await test("atomic checkout with split tender and salesperson attribution", async () => {
      sale = await pos.checkout(actor, saleBody);
      assert.equal(sale.grandTotal.toFixed(2), "189.00");
      assert.equal(sale.salespersonId, employee.id);
      assert.equal(sale.payments.length, 2);
      assert.equal(
        (
          await prisma.pOSInventoryBalance.findUniqueOrThrow({
            where: {
              storeId_variantId: { storeId: store.id, variantId: v.id },
            },
          })
        ).quantity,
        8,
      );
    });
    await test("concurrent identical retries return one invoice", async () => {
      const results = await Promise.all([
        pos.checkout(actor, saleBody),
        pos.checkout(actor, saleBody),
      ]);
      assert.equal(results[0].id, sale!.id);
      assert.equal(results[1].id, sale!.id);
      assert.equal(
        await prisma.pOSSale.count({
          where: { idempotencyKey: saleBody.idempotencyKey },
        }),
        1,
      );
    });
    await test("key reuse with a changed request is rejected", async () => {
      await assert.rejects(
        pos.checkout(actor, { ...saleBody, customerName: "changed" }),
        /Idempotency/,
      );
    });
    await test("client total and invalid tenders are rejected", async () => {
      await assert.rejects(
        pos.checkout(actor, { ...saleBody, grandTotal: "1" }),
      );
      await assert.rejects(
        pos.checkout(actor, {
          ...saleBody,
          idempotencyKey: randomUUID(),
          payments: [{ method: "CARD", amount: "1" }],
        }),
        /server total/,
      );
    });
    await test("concurrent checkout cannot oversell", async () => {
      const body = {
        storeId: store.id,
        sessionId: session.id,
        items: [{ variantId: v2.id, quantity: 2 }],
        payments: [{ method: "CASH", amount: "120" }],
      };
      const results = await Promise.allSettled([
        pos.checkout(actor, { ...body, idempotencyKey: randomUUID() }),
        pos.checkout(actor, { ...body, idempotencyKey: randomUUID() }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        (
          await prisma.pOSInventoryBalance.findUniqueOrThrow({
            where: {
              storeId_variantId: { storeId: store.id, variantId: v2.id },
            },
          })
        ).quantity,
        0,
      );
    });
    await test("transaction failure rolls back invoice and every stock movement", async () => {
      const before = await prisma.pOSInventoryBalance.findUniqueOrThrow({
        where: { storeId_variantId: { storeId: store.id, variantId: v.id } },
      });
      const key = randomUUID();
      await assert.rejects(
        pos.checkout(actor, {
          storeId: store.id,
          sessionId: session.id,
          items: [
            { variantId: v.id, quantity: 1 },
            { variantId: v2.id, quantity: 1 },
          ],
          payments: [{ method: "CASH", amount: "165" }],
          idempotencyKey: key,
        }),
      );
      assert.equal(
        await prisma.pOSSale.count({ where: { idempotencyKey: key } }),
        0,
      );
      assert.equal(
        (
          await prisma.pOSInventoryBalance.findUniqueOrThrow({
            where: { id: before.id },
          })
        ).quantity,
        before.quantity,
      );
    });
    await test("historical invoice values survive price changes", async () => {
      await prisma.pOSProductVariant.update({
        where: { id: v.id },
        data: { sellingPrice: "200" },
      });
      assert.equal(
        (
          await prisma.pOSSaleItem.findUniqueOrThrow({
            where: { id: sale!.items[0]!.id },
          })
        ).unitPrice.toString(),
        "100",
      );
    });
    const returnBody = {
      sessionId: session.id,
      idempotencyKey: randomUUID(),
      reason: "Size issue",
      refundMethod: "CASH",
      items: [
        { saleItemId: sale!.items[0]!.id, quantity: 1, resellable: false },
      ],
    };
    await test("partial refund uses original price and quarantines damage", async () => {
      const ret = await pos.returnSale(actor, sale!.id, returnBody);
      assert.equal(ret.refundAmount.toFixed(2), "94.50");
      const bal = await prisma.pOSInventoryBalance.findUniqueOrThrow({
        where: { storeId_variantId: { storeId: store.id, variantId: v.id } },
      });
      assert.equal(bal.damaged, 1);
      assert.equal(bal.quantity, 8);
    });
    await test("return retry is idempotent; excess return rejected", async () => {
      await pos.returnSale(actor, sale!.id, returnBody);
      assert.equal(
        await prisma.pOSReturn.count({
          where: { idempotencyKey: returnBody.idempotencyKey },
        }),
        1,
      );
      await assert.rejects(
        pos.returnSale(actor, sale!.id, {
          ...returnBody,
          idempotencyKey: randomUUID(),
          items: [{ ...returnBody.items[0], quantity: 2 }],
        }),
        /eligible/,
      );
    });
    await test("transfer dispatch deducts once and receipt adds once", async () => {
      const t = await pos.createTransfer(actor, {
        fromStoreId: store.id,
        toStoreId: destination.id,
        reason: "Replenishment",
        items: [{ variantId: v.id, quantity: 2 }],
      });
      await pos.progressTransfer(actor, t.id, false);
      await pos.progressTransfer(actor, t.id, false);
      await pos.progressTransfer(actor, t.id, true);
      await pos.progressTransfer(actor, t.id, true);
      assert.equal(
        (
          await prisma.pOSInventoryBalance.findUniqueOrThrow({
            where: {
              storeId_variantId: { storeId: destination.id, variantId: v.id },
            },
          })
        ).quantity,
        2,
      );
    });
    await test("report totals reconcile underlying sales and refunds", async () => {
      const r = await report(actor, { storeId: String(store.id) });
      assert.equal(r.invoices, 2);
      assert.equal(r.collectedSales.toFixed(2), "309.00");
      assert.equal(r.refunds.toFixed(2), "94.50");
      assert.equal(r.netCollected.toFixed(2), "214.50");
      assert.equal(r.grossMargin.toFixed(2), "60.00");
    });
    await test("cash movements are idempotent and affect closing expectation", async () => {
      const body = {
        direction: "IN",
        amount: "10",
        reason: "Cash float",
        idempotencyKey: randomUUID(),
      };
      await pos.cashMovement(actor, session.id, body);
      await pos.cashMovement(actor, session.id, body);
      assert.equal(
        await prisma.pOSCashMovement.count({
          where: { idempotencyKey: body.idempotencyKey },
        }),
        1,
      );
    });
    await test("exchange rolls back original refund when replacement fails", async () => {
      const key = randomUUID();
      const before = (
        await prisma.pOSSaleItem.findUniqueOrThrow({
          where: { id: sale!.items[0]!.id },
        })
      ).returnedQuantity;
      await assert.rejects(
        pos.exchange(actor, sale!.id, {
          return: { ...returnBody, idempotencyKey: key },
          replacement: {
            ...saleBody,
            idempotencyKey: randomUUID(),
            items: [{ variantId: v2.id, quantity: 1 }],
            payments: [{ method: "CASH", amount: "60" }],
          },
        }),
      );
      assert.equal(
        await prisma.pOSReturn.count({ where: { idempotencyKey: key } }),
        0,
      );
      assert.equal(
        (
          await prisma.pOSSaleItem.findUniqueOrThrow({
            where: { id: sale!.items[0]!.id },
          })
        ).returnedQuantity,
        before,
      );
    });
    await test("atomic exchange retains original and replacement references", async () => {
      const key = randomUUID();
      const payload = {
        return: {
          ...returnBody,
          idempotencyKey: `${key}-r`,
          items: [{ ...returnBody.items[0], resellable: true }],
        },
        replacement: {
          ...saleBody,
          idempotencyKey: `${key}-s`,
          items: [{ variantId: v.id, quantity: 1 }],
          payments: [{ method: "CASH", amount: "210" }],
        },
      };
      const x = await pos.exchange(actor, sale!.id, payload);
      assert.equal(x.additionalPayment.toFixed(2), "115.50");
      assert.equal(x.netRefund.toString(), "0");
      assert.equal(
        (await pos.exchange(actor, sale!.id, payload)).replacement.id,
        x.replacement.id,
      );
      assert.equal(
        await prisma.pOSAuditLog.count({
          where: { action: "EXCHANGE_COMPLETED", entityId: x.return.id },
        }),
        1,
      );
    });
    await test("HTTP routes reject unsigned dev tokens, unauthorized access and cross-store reads", async () => {
      const app = express();
      app.use(express.json());
      app.use("/api/auth", authRoutes);
      app.use("/api/v1/pos", routes);
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}/api/v1/pos`;
      try {
        assert.equal(
          (
            await fetch(`${url}/context`, {
              headers: { Authorization: "Bearer dev-local-auth-token" },
            })
          ).status,
          401,
        );
        const token = signAccessToken({ id: user.id, role: "ADMIN" });
        assert.equal(
          (
            await fetch(`${url}/inventory?storeId=${store.id}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
          ).status,
          200,
        );
        const restricted = await prisma.user.create({
          data: {
            password: "not-a-login",
            role: "SALESMAN",
            employee: {
              create: {
                employeeCode: `CLERK-${suffix}`,
                firstName: "Clerk",
                lastName: "Test",
                storeId: store.id,
              },
            },
            userPermission: { create: { permissions: { "pos.read": true } } },
          },
        });
        await prisma.user.update({
          where: { id: restricted.id },
          data: {
            email: `clerk-${suffix}@test.invalid`,
            password: await bcrypt.hash("isolated-test-password", 4),
          },
        });
        const login = await fetch(
          `http://127.0.0.1:${addr.port}/api/auth/employee/login`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: `clerk-${suffix}@test.invalid`,
              password: "isolated-test-password",
            }),
          },
        );
        assert.equal(login.status, 200);
        const loginData = (await login.json()) as { token: string };
        assert(loginData.token);
        assert.equal(
          (
            await fetch(`${url}/context`, {
              headers: { Authorization: `Bearer ${loginData.token}` },
            })
          ).status,
          200,
        );
        const clerkToken = signAccessToken({
          id: restricted.id,
          role: "ADMIN",
        });
        assert.equal(
          (
            await fetch(`${url}/inventory?storeId=${destination.id}`, {
              headers: { Authorization: `Bearer ${clerkToken}` },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(`${url}/reports/daily-sales?storeId=${store.id}`, {
              headers: { Authorization: `Bearer ${clerkToken}` },
            })
          ).status,
          403,
        );
        await prisma.user.update({
          where: { id: restricted.id },
          data: { isActive: false },
        });
        assert.equal(
          (
            await fetch(`${url}/context`, {
              headers: { Authorization: `Bearer ${clerkToken}` },
            })
          ).status,
          403,
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
      }
    });
    await test("authorized full cancellation reverses stock and cash exactly once", async () => {
      const original = await pos.checkout(actor, {
        storeId: store.id,
        sessionId: session.id,
        items: [{ variantId: v.id, quantity: 1 }],
        payments: [{ method: "CASH", amount: "210" }],
        idempotencyKey: randomUUID(),
      });
      const body = {
        sessionId: session.id,
        idempotencyKey: randomUUID(),
        reason: "Cashier correction",
        refundMethod: "CASH",
      };
      const r = await pos.cancelSale(actor, original.id, body);
      assert.equal(r.refundAmount.toFixed(2), "210.00");
      assert.equal((await pos.cancelSale(actor, original.id, body))!.id, r.id);
      assert.equal(
        (await prisma.pOSSale.findUniqueOrThrow({ where: { id: original.id } }))
          .status,
        "CANCELLED",
      );
    });
    await test("partial refunds preserve allocated order discount cents and tax-exclusive revenue", async () => {
      const q = await pos.quote(actor, {
        storeId: store.id,
        items: [{ variantId: v.id, quantity: 3 }],
        orderDiscount: "0.01",
      });
      const original = await pos.checkout(actor, {
        storeId: store.id,
        sessionId: session.id,
        items: [{ variantId: v.id, quantity: 3 }],
        orderDiscount: "0.01",
        payments: [{ method: "CASH", amount: q.grandTotal.toFixed(2) }],
        idempotencyKey: randomUUID(),
      });
      let refunded = new D(0),
        revenue = new D(0);
      for (let n = 0; n < 3; n++) {
        const ret = await pos.returnSale(actor, original.id, {
          sessionId: session.id,
          idempotencyKey: randomUUID(),
          reason: "Partial return",
          refundMethod: "CASH",
          items: [
            {
              saleItemId: original.items[0]!.id,
              quantity: 1,
              resellable: true,
            },
          ],
        });
        refunded = refunded.plus(ret.refundAmount);
        revenue = revenue.plus(ret.items[0]!.revenueRefund);
      }
      assert.equal(refunded.toFixed(2), original.grandTotal.toFixed(2));
      assert.equal(revenue.toFixed(2), "599.99");
    });
    await test("register expected cash and variance", async () => {
      const closed = await pos.closeRegister(actor, register.id, {
        sessionId: session.id,
        actualCash: "620",
        reason: "End of shift",
      });
      assert.equal(closed.expectedCash!.toFixed(2), "751.00");
      assert.equal(closed.variance!.toFixed(2), "-131.00");
      await assert.rejects(
        pos.checkout(actor, { ...saleBody, idempotencyKey: randomUUID() }),
        /not open/,
      );
    });
    await test("physical stock reconciliation is ledger-backed", async () => {
      await pos.reconcileStock(actor, {
        storeId: destination.id,
        variantId: v.id,
        countedQuantity: 1,
        countedDamaged: 1,
        reason: "Physical count",
      });
      const b = await prisma.pOSInventoryBalance.findUniqueOrThrow({
        where: {
          storeId_variantId: { storeId: destination.id, variantId: v.id },
        },
      });
      assert.equal(b.quantity, 1);
      assert.equal(b.damaged, 1);
    });
    await test("stock balances match auditable ledger", async () => {
      for (const b of await prisma.pOSInventoryBalance.findMany({
        where: { variantId: { in: [v.id, v2.id] } },
      })) {
        const sum = await prisma.pOSStockMovement.aggregate({
          where: { variantId: b.variantId, storeId: b.storeId },
          _sum: { quantityDelta: true, damagedDelta: true },
        });
        assert.equal(b.quantity, sum._sum.quantityDelta);
        assert.equal(b.damaged, sum._sum.damagedDelta);
      }
    });

    await test("partial variant updates preserve barcode and bulk changes roll back together", async () => {
      const changed = await operations.updateVariant(actor, v2.id, {
        sellingPrice: "61",
      });
      assert.equal(changed.barcode, v2.barcode);
      await assert.rejects(
        operations.bulkCatalog(actor, {
          variants: [
            { id: v.id, changes: { sellingPrice: "999" } },
            { id: v2.id, changes: { taxRate: "101" } },
          ],
        }),
      );
      assert.equal(
        (
          await prisma.pOSProductVariant.findUniqueOrThrow({
            where: { id: v.id },
          })
        ).sellingPrice.toString(),
        "200",
      );
    });
    await test("stock receipt retries and typed damage movements remain ledger-backed", async () => {
      const body = {
        storeId: store.id,
        variantId: v.id,
        quantityDelta: 3,
        type: "RECEIPT",
        reason: "Supplier receipt",
        referenceDocument: `GRN-${suffix}`,
        idempotencyKey: randomUUID(),
      };
      const first = await pos.adjust(actor, body);
      assert.equal((await pos.adjust(actor, body)).reference, first.reference);
      await assert.rejects(
        pos.adjust(actor, { ...body, quantityDelta: 4 }),
        /conflict/,
      );
      await pos.adjust(actor, {
        storeId: store.id,
        variantId: v.id,
        quantityDelta: -1,
        damagedDelta: 1,
        type: "DAMAGE",
        reason: "Inspection failure",
      });
      assert.equal(
        await prisma.pOSStockMovement.count({
          where: { storeId: store.id, reference: `GRN-${suffix}` },
        }),
        1,
      );
    });
    let customer: Awaited<ReturnType<typeof operations.saveCustomer>>;
    await test("customers are scoped and retain invoice snapshots", async () => {
      customer = await operations.saveCustomer(actor, {
        storeId: store.id,
        name: "Original Customer",
        phone: "9" + String(user.id).padStart(9, "0"),
      });
      await assert.rejects(
        operations.saveCustomer(
          actor,
          { storeId: destination.id, name: "Cross-store update" },
          customer.id,
        ),
        /not found/,
      );
    });
    await test("commission settings require explicit policy choices", async () => {
      await assert.rejects(
        operations.configure(actor, {
          storeId: store.id,
          commissionEnabled: true,
        }),
        /basis/,
      );
      await operations.configure(actor, {
        storeId: store.id,
        commissionEnabled: true,
        commissionBasis: "NET_EX_TAX",
        fixedCommissionBasis: "LINE",
        refundCommissionPolicy: "REVIEW_ADJUSTMENT",
      });
    });
    await prisma.commissionPolicy.create({
      data: {
        name: `POS employee policy ${suffix}`,
        commissionType: "PERCENTAGE",
        commissionValue: 10,
        employeeId: employee.id,
        storeId: store.id,
      },
    });
    await operations.savePaymentMethod(actor, "GIFT_VOUCHER", {
      storeId: store.id,
      name: "Gift voucher",
      enabled: true,
    });
    const shift = await prisma.shift.create({
      data: {
        name: `POS shift ${suffix}`,
        startTime: "09:00",
        endTime: "18:00",
        workingDays: ["Friday"],
      },
    });
    const assignment = await prisma.shiftAssignment.create({
      data: {
        employeeId: employee.id,
        shiftId: shift.id,
        effectiveFrom: new Date(Date.now() - 86400000),
      },
    });
    const attendanceBefore = await prisma.attendance.count({
      where: { employeeId: employee.id },
    });
    const session2 = await pos.openRegister(actor, register.id, {
      openingCash: "1000",
    });
    await test("register sessions link the actual HRM shift without creating attendance", async () => {
      assert.equal(session2.shiftAssignmentId, assignment.id);
      assert.equal(
        await prisma.attendance.count({ where: { employeeId: employee.id } }),
        attendanceBefore,
      );
    });
    let commissioned: Awaited<ReturnType<typeof pos.checkout>>;
    await test("custom tenders and commission proposals are atomic and retry-safe", async () => {
      const body = {
        storeId: store.id,
        sessionId: session2.id,
        salespersonId: employee.id,
        customerId: customer!.id,
        items: [{ variantId: v.id, quantity: 2 }],
        payments: [{ method: "GIFT_VOUCHER", amount: "420" }],
        idempotencyKey: randomUUID(),
      };
      commissioned = await pos.checkout(actor, body);
      await pos.checkout(actor, body);
      const tx = await prisma.commissionTransaction.findUniqueOrThrow({
        where: {
          billId_employeeId: {
            billId: `POSSALE-${commissioned.id}`,
            employeeId: employee.id,
          },
        },
        include: { posLines: true },
      });
      assert.equal(tx.commissionAmount, 40);
      assert.equal(tx.posLines.length, 1);
      assert.equal(tx.status, "PENDING");
      await operations.saveCustomer(
        actor,
        { storeId: store.id, name: "Changed Customer" },
        customer!.id,
      );
      assert.equal(
        (
          await prisma.pOSSale.findUniqueOrThrow({
            where: { id: commissioned.id },
          })
        ).customerName,
        "Original Customer",
      );
    });
    const now = new Date(),
      start = new Date(now.getTime() - 86400000),
      end = new Date(now.getTime() + 86400000);
    await test("only approved POS commissions enter existing payroll; legacy pending remains eligible", async () => {
      await prisma.commissionTransaction.create({
        data: {
          employeeId: employee.id,
          storeId: store.id,
          billId: `LEGACY-${suffix}`,
          saleAmount: 30,
          commissionType: "PERCENTAGE",
          commissionAmount: 3,
          eventType: "INVOICE_CREATED",
          status: "PENDING",
        },
      });
      let earnings = await prisma.commissionTransaction.aggregate({
        where: commissionPayrollWhere(employee.id, start, end),
        _sum: { commissionAmount: true },
      });
      assert.equal(earnings._sum.commissionAmount, 3);
      const original = await prisma.commissionTransaction.findUniqueOrThrow({
        where: {
          billId_employeeId: {
            billId: `POSSALE-${commissioned!.id}`,
            employeeId: employee.id,
          },
        },
      });
      await assert.rejects(
        reviewCommission(
          { ...actor, admin: false, storeId: store.id, permissions: {} },
          original.id,
          { decision: "APPROVED", reason: "Unauthorized" },
        ),
        /commissionApprove/,
      );
      await reviewCommission(actor, original.id, {
        decision: "APPROVED",
        reason: "Manager verified sale",
      });
      earnings = await prisma.commissionTransaction.aggregate({
        where: commissionPayrollWhere(employee.id, start, end),
        _sum: { commissionAmount: true },
      });
      assert.equal(earnings._sum.commissionAmount, 43);
    });
    await test("approved commission refunds create reviewable debits without rewriting original earnings", async () => {
      const returned = await pos.returnSale(actor, commissioned!.id, {
        sessionId: session2.id,
        idempotencyKey: randomUUID(),
        reason: "Size return",
        refundMethod: "GIFT_VOUCHER",
        items: [
          {
            saleItemId: commissioned!.items[0]!.id,
            quantity: 1,
            resellable: true,
          },
        ],
      });
      // Refund debits are keyed per original transaction: billId is `POSRETURN-<returnId>-<txId>`.
      const debit = await prisma.commissionTransaction.findFirstOrThrow({
        where: {
          billId: { startsWith: `POSRETURN-${returned.id}-` },
          employeeId: employee.id,
        },
      });
      assert.equal(debit.commissionAmount, -20);
      assert.equal(debit.status, "PENDING");
      await reviewCommission(actor, debit.id, {
        decision: "APPROVED",
        reason: "Refund adjustment approved",
      });
      const earnings = await prisma.commissionTransaction.aggregate({
        where: commissionPayrollWhere(employee.id, start, end),
        _sum: { commissionAmount: true },
      });
      assert.equal(earnings._sum.commissionAmount, 23);
      const original = await prisma.commissionTransaction.findUniqueOrThrow({
        where: {
          billId_employeeId: {
            billId: `POSSALE-${commissioned!.id}`,
            employeeId: employee.id,
          },
        },
      });
      assert.equal(original.commissionAmount, 40);
    });
    await test("legacy commission approval endpoints cannot bypass POS permissions or signed authentication", async () => {
      const proposal = await prisma.commissionTransaction.create({
        data: {
          employeeId: employee.id,
          storeId: store.id,
          billId: `POS-REVIEW-${suffix}`,
          saleAmount: 1,
          commissionAmount: -1,
          commissionType: "PERCENTAGE",
          eventType: "POS_RETURN",
          status: "PENDING",
        },
      });
      const app = express();
      app.use(express.json());
      app.put(
        "/legacy/:id",
        protectLegacyPOSReview("APPROVED"),
        (_req, res) => {
          res.status(500).json({ message: "Bypass reached" });
        },
      );
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((r) => server.once("listening", r));
      const { port } = server.address() as { port: number };
      try {
        const url = `http://127.0.0.1:${port}/legacy/${proposal.id}`;
        assert.equal(
          (
            await fetch(url, {
              method: "PUT",
              headers: {
                Authorization: "Bearer dev-local-auth-token",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ notes: "Attempt" }),
            })
          ).status,
          401,
        );
        const reader = await prisma.user.create({
          data: {
            password: "unused",
            role: "EMPLOYEE",
            employee: {
              create: {
                employeeCode: `REVIEW-${suffix}`,
                firstName: "Reader",
                lastName: "Test",
                storeId: store.id,
              },
            },
            userPermission: { create: { permissions: { "pos.read": true } } },
          },
        });
        assert.equal(
          (
            await fetch(url, {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${signAccessToken({ id: reader.id, role: "ADMIN" })}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ notes: "Attempt" }),
            })
          ).status,
          403,
        );
      } finally {
        await new Promise<void>((r, j) =>
          server.close((e) => (e ? j(e) : r())),
        );
      }
    });
    await test("generic legacy editors cannot forge or rewrite POS commission records", async () => {
      const original = await prisma.commissionTransaction.findUniqueOrThrow({
        where: {
          billId_employeeId: {
            billId: `POSSALE-${commissioned!.id}`,
            employeeId: employee.id,
          },
        },
      });
      const app = express();
      app.use(express.json());
      app.use(authenticate);
      app.post("/commission", createCommissionTransaction);
      app.post("/sale", updateSales);
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((r) => server.once("listening", r));
      const { port } = server.address() as { port: number };
      const headers = {
        Authorization: `Bearer ${signAccessToken({ id: user.id, role: "ADMIN" })}`,
        "Content-Type": "application/json",
      };
      try {
        assert.equal(
          (
            await fetch(`http://127.0.0.1:${port}/commission`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                billId: original.billId,
                employeeId: employee.id,
                eventType: "POS_SALE",
                commissionAmount: 999,
                status: "APPROVED",
              }),
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await fetch(`http://127.0.0.1:${port}/sale`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                billId: original.billId,
                saleAmount: "999",
              }),
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await prisma.commissionTransaction.findUniqueOrThrow({
              where: { id: original.id },
            })
          ).commissionAmount,
          original.commissionAmount,
        );
      } finally {
        await new Promise<void>((r, j) =>
          server.close((e) => (e ? j(e) : r())),
        );
      }
    });
    await test("payment and refund reconciliation are scoped, auditable and idempotent", async () => {
      const payment = commissioned!.payments[0]!;
      await operations.reconcilePayment(actor, payment.id, {
        status: "RECONCILED",
        reason: "Voucher register matched",
      });
      await operations.reconcilePayment(actor, payment.id, {
        status: "RECONCILED",
        reason: "Voucher register matched",
      });
      assert.equal(
        await prisma.pOSAuditLog.count({
          where: { action: "PAYMENT_RECONCILED", entityId: payment.id },
        }),
        1,
      );
      await assert.rejects(
        operations.reconcilePayment(
          {
            ...actor,
            admin: false,
            storeId: destination.id,
            permissions: { "pos.reconcile": true },
          },
          payment.id,
          { status: "DISPUTED", reason: "Wrong store" },
        ),
        /Store access/,
      );
    });
    await test("barcode uniqueness is enforced independently of SKU and failed creation rolls back", async () => {
      const barcode = (
        await prisma.pOSProductVariant.findUniqueOrThrow({
          where: { id: v.id },
        })
      ).barcode;
      await assert.rejects(
        pos.createProduct(actor, {
          name: "Barcode duplicate",
          code: `BARCODE-DUP-${suffix}`,
          variants: [
            {
              sku: `BARCODE-DUP-${suffix}`,
              barcode,
              size: "S",
              color: "Red",
              costPrice: "1",
              sellingPrice: "2",
            },
          ],
        }),
      );
      assert.equal(
        await prisma.pOSProduct.count({
          where: { code: `BARCODE-DUP-${suffix}` },
        }),
        0,
      );
    });
    await test("commission basis including tax is snapshotted and pending refunds reduce the correct revenue", async () => {
      await operations.configure(actor, {
        storeId: store.id,
        commissionEnabled: true,
        commissionBasis: "NET_INCL_TAX",
        fixedCommissionBasis: "LINE",
        refundCommissionPolicy: "REVIEW_ADJUSTMENT",
      });
      const original = await pos.checkout(actor, {
        storeId: store.id,
        sessionId: session2.id,
        salespersonId: employee.id,
        items: [{ variantId: v.id, quantity: 2 }],
        payments: [{ method: "CASH", amount: "420" }],
        idempotencyKey: randomUUID(),
      });
      const key = { billId: `POSSALE-${original.id}`, employeeId: employee.id };
      assert.equal(
        (
          await prisma.commissionTransaction.findUniqueOrThrow({
            where: { billId_employeeId: key },
          })
        ).commissionAmount,
        42,
      );
      await pos.returnSale(actor, original.id, {
        sessionId: session2.id,
        idempotencyKey: randomUUID(),
        reason: "Partial tax-inclusive return",
        refundMethod: "CASH",
        items: [
          { saleItemId: original.items[0]!.id, quantity: 1, resellable: true },
        ],
      });
      const proposal = await prisma.commissionTransaction.findUniqueOrThrow({
        where: { billId_employeeId: key },
      });
      assert.equal(proposal.commissionAmount, 21);
      assert.equal(proposal.saleAmount, 210);
    });
    await test("disabled payment methods fail before committing a sale", async () => {
      await operations.savePaymentMethod(actor, "GIFT_VOUCHER", {
        storeId: store.id,
        name: "Gift voucher",
        enabled: false,
      });
      await assert.rejects(
        pos.checkout(actor, {
          storeId: store.id,
          sessionId: session2.id,
          items: [{ variantId: v.id, quantity: 1 }],
          payments: [{ method: "GIFT_VOUCHER", amount: "210" }],
          idempotencyKey: randomUUID(),
        }),
        /disabled/,
      );
    });
    await test("daily/weekly/monthly and dimensional reports reconcile signed events", async () => {
      const original = await report(actor, { storeId: String(store.id) });
      for (const groupBy of [
        "day",
        "week",
        "month",
        "category",
        "brand",
        "size",
        "color",
      ]) {
        const grouped = await groupedSales(actor, {
          storeId: String(store.id),
          groupBy,
        });
        const sum = (grouped.items as Record<string, any>[]).reduce(
          (n, r) => n.plus(String(r.netCollected)),
          new D(0),
        );
        assert.equal(sum.toFixed(2), original.netCollected.toFixed(2));
      }
    });
    await test("inventory reporting includes variants without a balance; return/register reports are scoped", async () => {
      const other = await pos.createProduct(actor, {
        name: "Never stocked",
        code: `ZERO-${suffix}`,
        variants: [
          {
            sku: `ZERO-${suffix}`,
            size: "S",
            color: "Blue",
            costPrice: "1",
            sellingPrice: "2",
          },
        ],
      });
      const inventory = await inventoryReport(actor, {
        storeId: String(store.id),
        lowStock: "true",
        pageSize: "100",
      });
      assert(
        (inventory.items as Record<string, unknown>[]).some(
          (i) => i.variantId === other.variants[0]!.id && i.quantity === 0,
        ),
      );
      assert(
        (await registerReport(actor, { storeId: String(store.id) })).items
          .length >= 2,
      );
      assert(
        (await returnReport(actor, { storeId: String(store.id) })).items
          .length > 0,
      );
    });
    await test("paid commission refunds do not rewrite frozen payroll or bypass adjustment approval", async () => {
      const current = new Date(Date.now() + 19800000);
      const slip = await prisma.payslip.create({
        data: {
          employeeId: employee.id,
          month: current.getUTCMonth() + 1,
          year: current.getUTCFullYear(),
          baseSalary: 1000,
          allowance: 0,
          deductions: 0,
          netSalary: 1000,
          status: "PAID",
          employeeCode: employee.employeeCode,
          employeeName: "POS Test",
          designation: "Sales",
          department: "Retail",
          officeName: "Test",
          netInWords: "One thousand",
        },
      });
      const original = await prisma.commissionTransaction.update({
        where: {
          billId_employeeId: {
            billId: `POSSALE-${commissioned!.id}`,
            employeeId: employee.id,
          },
        },
        data: { status: "PAID", payrollId: slip.id, paidAt: new Date() },
      });
      const returned = await pos.returnSale(actor, commissioned!.id, {
        sessionId: session2.id,
        idempotencyKey: randomUUID(),
        reason: "Refund after payroll paid",
        refundMethod: "CASH",
        items: [
          {
            saleItemId: commissioned!.items[0]!.id,
            quantity: 1,
            resellable: true,
          },
        ],
      });
      // Refund debits are keyed per original transaction: billId is `POSRETURN-<returnId>-<txId>`.
      const debit = await prisma.commissionTransaction.findFirstOrThrow({
        where: {
          billId: { startsWith: `POSRETURN-${returned.id}-` },
          employeeId: employee.id,
        },
      });
      assert.equal(debit.commissionAmount, -20);
      await assert.rejects(
        reviewCommission(actor, debit.id, {
          decision: "APPROVED",
          reason: "Try frozen period",
        }),
        /frozen/,
      );
      assert.equal(
        (await prisma.payslip.findUniqueOrThrow({ where: { id: slip.id } }))
          .netSalary,
        1000,
      );
      const stillPaid = await prisma.commissionTransaction.findUniqueOrThrow({
        where: { id: original.id },
      });
      assert.equal(stillPaid.status, "PAID");
      assert.equal(stillPaid.commissionAmount, 40);
    });
  }
  console.log(
    `POS: ${passed} checks passed${process.env.POS_TEST_DATABASE_URL ? " (isolated PostgreSQL integration)" : " (unit only; set isolated POS_TEST_DATABASE_URL for integration)"}`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
