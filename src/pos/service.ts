import { accrueCommission, reverseCommission } from "./commissions";
import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/db";
import { Actor, permission, scope } from "./auth";
import {
  methods,
  ensure,
  POSError,
  object,
  keys,
  text,
  optionalText,
  uuid,
  optionalUuid,
  integer,
  money,
  list,
  unique,
  method,
  boolean,
} from "./validation";
import { lineTotals, refundComponents, round } from "./finance";
const D = Prisma.Decimal;
type D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;
export const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: "Serializable",
        timeout: 20000,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2034" &&
        attempt < 3
      )
        continue;
      throw e;
    }
  }
}
function run<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : transaction(fn);
}
export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await tx.pOSAuditLog.create({
    data: { userId: actor.userId, action, entityId, metadata },
  });
}
export async function activeStore(tx: Tx, id: number) {
  ensure(
    await tx.store.findFirst({ where: { id, isActive: true } }),
    "Store unavailable",
    404,
  );
}
export async function movement(
  tx: Tx,
  actor: Actor,
  storeId: number,
  variantId: string,
  delta: number,
  damagedDelta: number,
  type: string,
  reference: string,
  reason: string,
) {
  // Every stock mutation occurs inside the caller transaction and creates a ledger entry.
  await tx.pOSInventoryBalance.upsert({
    where: { storeId_variantId: { storeId, variantId } },
    create: { storeId, variantId },
    update: {},
  });
  const updated = await tx.pOSInventoryBalance.updateMany({
    where: {
      storeId,
      variantId,
      quantity: { gte: Math.max(0, -delta) },
      damaged: { gte: Math.max(0, -damagedDelta) },
    },
    data: {
      quantity: { increment: delta },
      damaged: { increment: damagedDelta },
    },
  });
  if (updated.count !== 1) {
    const current = await tx.pOSInventoryBalance.findUnique({
      where: { storeId_variantId: { storeId, variantId } },
    });
    const v = await tx.pOSProductVariant.findUnique({
      where: { id: variantId },
    });
    const avail = current?.quantity ?? 0;
    const skuLabel = v?.sku ? ` for ${v.sku}` : "";
    throw new POSError(
      409,
      `Insufficient stock${skuLabel}: only ${avail} unit(s) available in this store.`,
    );
  }
  await tx.pOSStockMovement.create({
    data: {
      storeId,
      variantId,
      quantityDelta: delta,
      damagedDelta,
      type,
      reference,
      reason,
      userId: actor.userId,
    },
  });
}
export function variantData(raw: unknown) {
  const b = object(raw);
  keys(b, [
    "sku",
    "barcode",
    "size",
    "color",
    "costPrice",
    "sellingPrice",
    "taxRate",
    "active",
    "attributes",
  ]);
  const taxRate = money(b.taxRate ?? "0", "taxRate", "100");
  if (b.barcode)
    ensure(
      /^[\x20-\x7e]+$/.test(text(b.barcode, "barcode", 80)),
      "Barcode must use printable ASCII characters",
    );
  return {
    sku: text(b.sku, "SKU", 80),
    barcode: b.barcode ? text(b.barcode, "barcode", 80) : `POS-${randomUUID()}`,
    costPrice: money(b.costPrice, "costPrice"),
    sellingPrice: money(b.sellingPrice, "sellingPrice"),
    taxRate,
    active: b.active === undefined ? true : boolean(b.active),
    attributes: b.attributes === undefined ? undefined : object(b.attributes),
  };
}
export async function createProduct(
  actor: Actor,
  raw: unknown,
  existingTx?: Tx,
) {
  permission(actor, "catalog");
  const b = object(raw);
  keys(b, [
    "name",
    "description",
    "code",
    "brand",
    "categoryId",
    "season",
    "material",
    "gender",
    "images",
    "sizeChart",
    "discountEligible",
    "active",
    "variants",
    "externalCommissionProductId",
    "openingStock",
  ]);
  const variants = list(b.variants).map(variantData);
  unique(variants.map((v) => v.sku));
  unique(variants.map((v) => v.barcode));
  let opening: { storeId: number; quantity: number; reason: string } | undefined;
  if (b.openingStock !== undefined) {
    permission(actor, "inventory");
    ensure(variants.length === 1, "Opening stock registration requires exactly one variant");
    const stock = object(b.openingStock);
    keys(stock, ["storeId", "quantity", "reason"]);
    opening = { storeId: integer(stock.storeId, "storeId"), quantity: integer(stock.quantity, "opening quantity"), reason: text(stock.reason, "opening stock reason", 1000) };
    scope(actor, opening.storeId);
  }
  const data = productData(b);
  return run(existingTx, async (tx) => {
    const p = await tx.pOSProduct.create({
      data: {
        ...data,
        name: text(b.name, "name"),
        code: text(b.code, "code", 80),
        variants: { create: variants },
      },
      include: { variants: true },
    });
    if (opening) {
      await activeStore(tx, opening.storeId);
      await movement(tx, actor, opening.storeId, p.variants[0]!.id, opening.quantity, 0, "OPENING", p.id, opening.reason);
    }
    await audit(tx, actor, "PRODUCT_CREATED", p.id);
    return p;
  });
}
export function productData(b: Record<string, any>) {
  const data: Record<string, any> = {};
  for (const f of [
    "name",
    "code",
    "description",
    "brand",
    "season",
    "material",
    "gender",
  ])
    if (b[f] !== undefined)
      data[f] =
        f === "name" || f === "code"
          ? text(b[f], f)
          : b[f] === ""
            ? ""
            : text(b[f], f, 2000);
  for (const f of ["active", "discountEligible"])
    if (b[f] !== undefined) data[f] = boolean(b[f]);
  if (b.categoryId !== undefined)
    data.categoryId = b.categoryId === null ? null : uuid(b.categoryId);
  if (b.images !== undefined) {
    ensure(Array.isArray(b.images) && b.images.length <= 20, "Invalid images");
    data.images = b.images.map((v: unknown) => {
      const url = text(v, "image URL", 2000);
      ensure(
        /^https:\/\//.test(url) || /^\/uploads\//.test(url),
        "Images require HTTPS or uploaded URL",
      );
      return url;
    });
  }
  if (b.externalCommissionProductId !== undefined)
    data.externalCommissionProductId =
      b.externalCommissionProductId == null
        ? null
        : integer(b.externalCommissionProductId, "externalCommissionProductId");
  if (b.sizeChart !== undefined) data.sizeChart = object(b.sizeChart);
  return data;
}
export async function adjust(actor: Actor, raw: unknown) {
  permission(actor, "inventory");
  const b = object(raw);
  keys(b, [
    "storeId",
    "variantId",
    "quantityDelta",
    "damagedDelta",
    "reason",
    "type",
    "referenceDocument",
    "idempotencyKey",
  ]);
  const storeId = integer(b.storeId, "storeId"),
    variantId = uuid(b.variantId),
    delta = integer(b.quantityDelta, "quantityDelta", -1000000),
    damaged = integer(b.damagedDelta ?? 0, "damagedDelta", -1000000),
    reason = text(b.reason, "reason", 1000);
  scope(actor, storeId);
  ensure(delta !== 0 || damaged !== 0, "Empty adjustment");
  const type = b.type ?? "ADJUSTMENT";
  ensure(
    ["ADJUSTMENT", "OPENING", "RECEIPT", "DAMAGE"].includes(type),
    "Invalid movement type",
  );
  if (["OPENING", "RECEIPT"].includes(type))
    ensure(
      delta > 0 && damaged === 0,
      "Stock-in requires positive resellable quantity",
    );
  if (type === "DAMAGE")
    ensure(
      damaged > 0 && delta === -damaged,
      "Damage moves resellable units into damaged stock",
    );
  const requestHash = hash({
    storeId,
    variantId,
    delta,
    damaged,
    reason,
    type,
    referenceDocument: b.referenceDocument ?? null,
  });
  const reference = b.idempotencyKey
    ? text(b.idempotencyKey, "idempotencyKey", 100)
    : randomUUID();
  const document = b.referenceDocument
    ? text(b.referenceDocument, "referenceDocument", 200)
    : reference;
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stock:${reference}`},0))::text`;
    const previous = await tx.pOSAuditLog.findFirst({
      where: { action: "STOCK_ADJUSTED", entityId: reference },
    });
    if (previous) {
      const metadata = previous.metadata as Record<string, unknown>;
      ensure(
        previous.userId === actor.userId &&
          metadata.requestHash === requestHash,
        "Idempotency key conflict",
        409,
      );
      return { reference };
    }
    await activeStore(tx, storeId);
    if (type === "OPENING")
      ensure(
        !(await tx.pOSStockMovement.findFirst({
          where: { storeId, variantId },
        })),
        "Opening stock already exists; use a receipt or adjustment",
        409,
      );
    await movement(
      tx,
      actor,
      storeId,
      variantId,
      delta,
      damaged,
      type,
      document,
      reason,
    );
    await audit(tx, actor, "STOCK_ADJUSTED", reference, {
      storeId,
      variantId,
      delta,
      damaged,
      reason,
      type,
      document,
      requestHash,
    });
    return { reference };
  });
}
async function openSession(
  tx: Tx,
  actor: Actor,
  sessionId: string,
  storeId?: number,
  owner = true,
) {
  await tx.$queryRaw`SELECT id FROM "POSSession" WHERE id = ${sessionId}::uuid FOR UPDATE`;
  const s = await tx.pOSSession.findUnique({
    where: { id: sessionId },
    include: { register: true },
  });
  ensure(
    s && !s.closedAt && s.register.active,
    "Register session is not open",
    409,
  );
  scope(actor, s.register.storeId);
  await activeStore(tx, s.register.storeId);
  if (storeId !== undefined)
    ensure(s.register.storeId === storeId, "Session belongs to another store");
  if (owner)
    ensure(
      s.userId === actor.userId,
      "Session belongs to another cashier",
      403,
    );
  return s;
}
async function ensureOrOpenSession(
  tx: Tx,
  actor: Actor,
  storeId: number,
  preferredSessionId?: string,
): Promise<string> {
  await activeStore(tx, storeId);
  await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
  if (preferredSessionId) {
    const session = await openSession(tx, actor, preferredSessionId, storeId, true);
    return session.id;
  }

  const existing = await tx.pOSSession.findFirst({
    where: {
      userId: actor.userId,
      closedAt: null,
      register: { storeId, active: true },
    },
    include: { register: true },
    orderBy: { openedAt: "desc" },
  });

  if (existing) {
    await tx.$queryRaw`SELECT id FROM "POSSession" WHERE id = ${existing.id}::uuid FOR UPDATE`;
    return existing.id;
  }

  let register = await tx.pOSRegister.findFirst({
    where: { storeId, active: true, sessions: { none: { closedAt: null } } },
    orderBy: { id: "asc" },
  });

  if (!register) {
    const configured = await tx.pOSRegister.count({ where: { storeId } });
    ensure(configured === 0, "No available register. Close the occupied cashier session or select an available active register.", 409);
    register = await tx.pOSRegister.create({data: {storeId, name: "Main Register", active: true}});
    await audit(tx, actor, "REGISTER_CREATED", register.id);
  }

  const shiftAssignment = actor.employeeId
    ? await tx.shiftAssignment.findFirst({
        where: {
          employeeId: actor.employeeId,
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      })
    : null;

  const newSession = await tx.pOSSession.create({
    data: {
      registerId: register.id,
      userId: actor.userId,
      employeeId: actor.employeeId,
      shiftAssignmentId: shiftAssignment?.id,
      openingCash: new D(0),
    },
  });

  await audit(tx, actor, "REGISTER_OPENED", newSession.id);
  return newSession.id;
}
export async function openRegister(actor: Actor, id: string, raw: unknown) {
  permission(actor, "sell");
  const b = object(raw);
  keys(b, ["openingCash"]);
  const openingCash = money(b.openingCash);
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "POSRegister" WHERE id = ${id}::uuid FOR UPDATE`;
    const register = await tx.pOSRegister.findUnique({ where: { id } });
    ensure(register?.active, "Register unavailable", 404);
    scope(actor, register.storeId);
    await activeStore(tx, register.storeId);
    ensure(
      !(await tx.pOSSession.findFirst({
        where: { registerId: id, closedAt: null },
      })),
      "Register already open",
      409,
    );
    const shiftAssignment = actor.employeeId
      ? await tx.shiftAssignment.findFirst({
          where: {
            employeeId: actor.employeeId,
            effectiveFrom: { lte: new Date() },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
          },
          orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
        })
      : null;
    const s = await tx.pOSSession.create({
      data: {
        registerId: id,
        userId: actor.userId,
        employeeId: actor.employeeId,
        shiftAssignmentId: shiftAssignment?.id,
        openingCash,
      },
    });
    await audit(tx, actor, "REGISTER_OPENED", s.id);
    return s;
  });
}
export async function closeRegister(actor: Actor, id: string, raw: unknown) {
  permission(actor, "reconcile");
  const b = object(raw);
  keys(b, ["sessionId", "actualCash", "reason"]);
  const sessionId = uuid(b.sessionId),
    actualCash = money(b.actualCash),
    reason = text(b.reason, "close reason", 1000);
  return transaction(async (tx) => {
    const previous = await tx.pOSSession.findUnique({
      where: { id: sessionId },
      include: { register: true },
    });
    ensure(previous, "Session not found", 404);
    scope(actor, previous.register.storeId);
    ensure(previous.registerId === id, "Register mismatch");
    if (previous.closedAt) {
      ensure(
        previous.actualCash?.equals(actualCash) &&
          previous.closeReason === reason,
        "Session already closed with different values",
        409,
      );
      return previous;
    }
    const s = await openSession(tx, actor, sessionId, undefined, false);
    ensure(s.registerId === id, "Register mismatch");
    const sales = await tx.pOSSalePayment.aggregate({
      where: { method: "CASH", sale: { sessionId } },
      _sum: { amount: true },
    });
    const refunds = await tx.pOSReturn.aggregate({
      where: { sessionId, refundMethod: "CASH" },
      _sum: { refundAmount: true },
    });
    const expectedCash = s.openingCash
        .plus(sales._sum.amount ?? 0)
        .minus(refunds._sum.refundAmount ?? 0)
        .plus(await cashMovementNet(tx, sessionId)),
      variance = actualCash.minus(expectedCash);
    const result = await tx.pOSSession.update({
      where: { id: sessionId },
      data: {
        actualCash,
        expectedCash,
        variance,
        closeReason: reason,
        closedAt: new Date(),
      },
    });
    await audit(tx, actor, "REGISTER_CLOSED", sessionId, {
      actualCash: actualCash.toString(),
      expectedCash: expectedCash.toString(),
      reason,
    });
    return result;
  });
}
export async function checkout(actor: Actor, raw: unknown, existingTx?: Tx) {
  permission(actor, "sell");
  const b = object(raw);
  keys(b, [
    "storeId",
    "sessionId",
    "salespersonId",
    "customerName",
    "customerPhone",
    "items",
    "payments",
    "idempotencyKey",
    "orderDiscount",
    "customerId",
  ]);
  const storeId = integer(b.storeId, "storeId"),
    providedSessionId = optionalUuid(b.sessionId, "sessionId"),
    idempotencyKey = text(b.idempotencyKey, "idempotencyKey", 100);
  scope(actor, storeId);
  const items = pricingInput(actor, b.items),
    orderDiscount = money(b.orderDiscount ?? "0", "orderDiscount");
  if (orderDiscount.gt(0)) permission(actor, "discount");
  const payments = list(b.payments, 10).map((raw) => {
    const p = object(raw);
    keys(p, ["method", "amount", "reference", "gatewayTransactionId"]);
    const m = method(p.method),
      amount = money(p.amount);
    ensure(amount.gt(0), "Payment must be positive");
    return {
      method: m,
      amount,
      gatewayTransactionId: optionalText(p.gatewayTransactionId, "gatewayTransactionId", 200),
      reference: optionalText(p.reference, "reference", 200),
    };
  });
  const salespersonId =
    b.salespersonId == null || b.salespersonId === "" || b.salespersonId === 0 || b.salespersonId === "0"
      ? undefined
      : integer(b.salespersonId, "salespersonId", 1);
  const customerId = optionalUuid(b.customerId, "customerId");
  const customerName = optionalText(b.customerName, "customerName", 200);
  const customerPhone = optionalText(b.customerPhone, "customerPhone", 30);
  const requestHash = hash({
    storeId,
    items,
    payments,
    salespersonId,
    customerName,
    customerPhone,
    customerId,
    orderDiscount,
  });

  const saleInclude = {
    items: {
      include: {
        salesperson: { select: { id: true, employeeID: true, firstName: true, lastName: true, employeeCode: true } },
      },
    },
    payments: true,
    salesperson: { select: { id: true, employeeID: true, firstName: true, lastName: true, employeeCode: true } },
  };

  // Immediate idempotency fast path before opening a transaction
  const preExisting = existingTx ? null : await prisma.pOSSale.findUnique({
    where: { idempotencyKey },
    include: saleInclude,
  });
  if (preExisting) {
    if (preExisting.cashierId === actor.userId && preExisting.storeId === storeId && preExisting.requestHash === requestHash) {
      return preExisting;
    }
    throw new POSError(409, "Idempotency key used for another request");
  }

  try {
    return await run(existingTx, async (tx) => {
      // Advisory lock serializes concurrent retries even before a sale row exists.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sale:${idempotencyKey}`}, 0))::text`;
      const existing = await tx.pOSSale.findUnique({
        where: { idempotencyKey },
        include: saleInclude,
      });
      if (existing) {
        if (existing.cashierId === actor.userId && existing.storeId === storeId && existing.requestHash === requestHash) {
          return existing;
        }
        throw new POSError(409, "Idempotency key used for another request");
      }
      const sessionId = await ensureOrOpenSession(tx, actor, storeId, providedSessionId);
      const itemSalespeople = items
        .map((i) => i.salespersonId)
        .filter((id): id is number => id !== undefined && id !== null);
      const allSalespeople = [
        ...(salespersonId ? [salespersonId] : []),
        ...itemSalespeople,
      ];
      for (const spId of new Set(allSalespeople)) {
        const activeEmp = await tx.employee.findFirst({
          where: {
            id: spId,
            status: { equals: "active", mode: "insensitive" },
          },
          include: { department: true, user: { select: { role: true, isActive: true } } },
        });
        ensure(activeEmp, "Select an active employee.");
        ensure(activeEmp.user?.isActive !== false, "Select an active employee.");
      }
      for (const payment of payments) {
        const configured = await tx.pOSPaymentMethod.findUnique({
          where: { storeId_code: { storeId, code: payment.method } },
        });
        ensure(
          configured ? configured.enabled : methods.includes(payment.method),
          "Payment method is disabled or unconfigured",
        );
      }
      const customer = customerId
        ? await tx.pOSCustomer.findFirst({
            where: { id: customerId, storeId, active: true },
          })
        : null;
      ensure(!customerId || customer, "Customer not found in this store");
      const { subtotal, discountTotal, taxTotal, grandTotal, snapshots } =
        await priceItems(tx, items, orderDiscount);
      ensure(
        grandTotal.gt(0) && grandTotal.lte("9999999999999.99"),
        "Invalid invoice total",
      );

      // Payment alignment & cash change handling
      if (payments.length === 1) {
        if (payments[0].method === "CASH" && payments[0].amount.gte(grandTotal)) {
          payments[0].amount = grandTotal;
        } else if (payments[0].amount.minus(grandTotal).abs().lte("0.05")) {
          payments[0].amount = grandTotal;
        }
      } else {
        const paymentTotal = payments.reduce((n, p) => n.plus(p.amount), new D(0));
        if (paymentTotal.minus(grandTotal).abs().lte("0.05")) {
          const diff = grandTotal.minus(paymentTotal);
          payments[payments.length - 1].amount = payments[payments.length - 1].amount.plus(diff);
        }
      }

      ensure(
        payments.reduce((n, p) => n.plus(p.amount), new D(0)).equals(grandTotal),
        `Payments must equal server total ${grandTotal.toFixed(2)}`,
      );

      let invoiceNo = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        const sequence = await tx.$queryRaw<
          { n: bigint }[]
        >`SELECT nextval('"POSInvoiceSequence"') AS n`;
        const candidate = `POS-${String(sequence[0]!.n).padStart(10, "0")}`;
        const conflict = await tx.pOSSale.findUnique({
          where: { invoiceNo: candidate },
          select: { id: true },
        });
        if (!conflict) {
          invoiceNo = candidate;
          break;
        }
      }
      ensure(invoiceNo.length > 0, "Failed to generate unique invoice number", 500);

      const itemsToCreate = snapshots.map((s, idx) => {
        // `key` exists only in the request/quote snapshot for line alignment;
        // POSSaleItem has no such column.
        const { key, ...row } = s;
        return {
          ...row,
          salespersonId: items[idx]?.salespersonId !== undefined ? items[idx]!.salespersonId : salespersonId ?? null,
        };
      });
      const resolvedSalespersonId =
        salespersonId ??
        itemsToCreate.find((i) => i.salespersonId != null)?.salespersonId ??
        null;
      const sale = await tx.pOSSale.create({
        data: {
          invoiceNo,
          idempotencyKey,
          requestHash,
          storeId,
          sessionId,
          cashierId: actor.userId,
          salespersonId: resolvedSalespersonId,
          customerId,
          customerName: customer?.name ?? customerName,
          customerPhone: customer?.phone ?? customerPhone,
          subtotal,
          discountTotal,
          taxTotal,
          grandTotal,
          items: { create: itemsToCreate },
          payments: { create: payments },
        },
        include: saleInclude,
      });
      for (const item of items)
        if (item.kind === "catalog")
          await movement(
            tx,
            actor,
            storeId,
            item.variantId,
            -item.quantity,
            0,
            "SALE",
            sale.id,
            invoiceNo,
          );
      await accrueCommission(tx, actor, sale.id);
      await audit(tx, actor, "SALE_COMPLETED", sale.id, {
        invoiceNo,
        salespersonId: resolvedSalespersonId,
        orderDiscount: orderDiscount.toString(),
        overrides: snapshots
          .filter((i) => i.overrideReason)
          .map((i) => ({
            variantId: i.variantId,
            catalogPrice: i.catalogUnitPrice.toString(),
            unitPrice: i.unitPrice.toString(),
            reason: i.overrideReason!,
          })),
      });
      return sale;
    });
  } catch (err) {
    if (
      !existingTx && err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2002" || err.code === "P2034")
    ) {
      const concurrentSale = await prisma.pOSSale.findUnique({
        where: { idempotencyKey },
        include: saleInclude,
      });
      if (concurrentSale) {
        if (
          concurrentSale.cashierId === actor.userId &&
          concurrentSale.storeId === storeId
        ) {
          return concurrentSale;
        }
        throw new POSError(409, "Idempotency key used for another request");
      }
    }
    throw err;
  }
}
export async function returnSale(
  actor: Actor,
  saleId: string,
  raw: unknown,
  existingTx?: Tx,
) {
  permission(actor, "refund");
  const b = object(raw);
  keys(b, [
    "sessionId",
    "idempotencyKey",
    "reason",
    "refundMethod",
    "refundReference",
    "items",
  ]);
  const sessionId = uuid(b.sessionId),
    idempotencyKey = text(b.idempotencyKey, "idempotencyKey", 100),
    reason = text(b.reason, "reason", 1000),
    refundMethod = method(b.refundMethod),
    refundReference = b.refundReference
      ? text(b.refundReference, "refundReference")
      : undefined;
  const items = list(b.items)
    .map((raw) => {
      const v = object(raw);
      keys(v, ["saleItemId", "quantity", "resellable"]);
      return {
        saleItemId: uuid(v.saleItemId),
        quantity: integer(v.quantity),
        resellable: boolean(v.resellable),
      };
    })
    .sort((a, b) => a.saleItemId.localeCompare(b.saleItemId));
  unique(items.map((i) => i.saleItemId));
  const requestHash = hash({
    saleId,
    sessionId,
    reason,
    refundMethod,
    refundReference,
    items,
  });
  return run(existingTx, async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`return:${idempotencyKey}`}, 0))::text`;
    const existing = await tx.pOSReturn.findUnique({
      where: { idempotencyKey },
      include: { items: true, sale: true },
    });
    if (existing) {
      scope(actor, existing.sale.storeId);
      ensure(
        existing.userId === actor.userId &&
          existing.requestHash === requestHash,
        "Idempotency conflict",
        409,
      );
      return existing;
    }
    await tx.$queryRaw`SELECT id FROM "POSSale" WHERE id = ${saleId}::uuid FOR UPDATE`;
    const sale = await tx.pOSSale.findUnique({
      where: { id: saleId },
      include: { items: true, payments: true },
    });
    ensure(sale, "Invoice not found", 404);
    scope(actor, sale.storeId);
    const config = await tx.pOSConfiguration.findUnique({
      where: { storeId: sale.storeId },
    });
    if (config?.returnWindowDays != null)
      ensure(
        Date.now() - sale.createdAt.getTime() <=
          config.returnWindowDays * 86400000,
        "Configured return window has expired",
        409,
      );
    const refundConfig = await tx.pOSPaymentMethod.findUnique({
      where: { storeId_code: { storeId: sale.storeId, code: refundMethod } },
    });
    ensure(
      refundConfig ? refundConfig.enabled : methods.includes(refundMethod),
      "Refund method is disabled or unconfigured",
    );
    const session = await openSession(tx, actor, sessionId, sale.storeId);
    let refundAmount = new D(0);
    const snapshots = [];
    for (const line of items) {
      const item = sale.items.find((i) => i.id === line.saleItemId);
      ensure(item, "Item does not belong to invoice");
      const { refundAmount: amount, revenueRefund } = refundComponents(
        item.lineTotal,
        item.taxTotal,
        item.quantity,
        item.returnedQuantity,
        line.quantity,
      );
      refundAmount = refundAmount.plus(amount);
      snapshots.push({ ...line, refundAmount: amount, revenueRefund });
      await tx.pOSSaleItem.update({
        where: { id: item.id },
        data: { returnedQuantity: { increment: line.quantity } },
      });
    }
    if (refundMethod === "CASH") {
      const cashIn = await tx.pOSSalePayment.aggregate({
        where: { method: "CASH", sale: { sessionId } },
        _sum: { amount: true },
      });
      const cashOut = await tx.pOSReturn.aggregate({
        where: { sessionId, refundMethod: "CASH" },
        _sum: { refundAmount: true },
      });
      ensure(
        session.openingCash
          .plus(cashIn._sum.amount ?? 0)
          .minus(cashOut._sum.refundAmount ?? 0)
          .plus(await cashMovementNet(tx, sessionId))
          .gte(refundAmount),
        "Insufficient register cash for refund",
        409,
      );
    }
    const result = await tx.pOSReturn.create({
      data: {
        saleId,
        sessionId,
        userId: actor.userId,
        idempotencyKey,
        requestHash,
        reason,
        refundMethod,
        refundReference,
        refundAmount,
        items: { create: snapshots },
      },
      include: { items: true },
    });
    for (const line of items) {
      const item = sale.items.find((i) => i.id === line.saleItemId);
      ensure(item, "Sale item not found", 404);
      const variantId = item.variantId;
      // Manual sale items have no catalog variant and no stock to return.
      if (variantId)
        await movement(
          tx,
          actor,
          sale.storeId,
          variantId,
          line.resellable ? line.quantity : 0,
          line.resellable ? 0 : line.quantity,
          "RETURN",
          result.id,
          reason,
        );
    }
    const updatedItems = await tx.pOSSaleItem.findMany({ where: { saleId } });
    await tx.pOSSale.update({
      where: { id: saleId },
      data: {
        status: updatedItems.every((i) => i.returnedQuantity === i.quantity)
          ? "RETURNED"
          : "PARTIALLY_RETURNED",
      },
    });
    await reverseCommission(tx, actor, result.id);
    await audit(tx, actor, "RETURN_RECORDED", result.id, {
      saleId,
      refundAmount: refundAmount.toString(),
      reason,
    });
    return result;
  });
}
export async function createTransfer(actor: Actor, raw: unknown) {
  permission(actor, "inventory");
  const b = object(raw);
  keys(b, ["fromStoreId", "toStoreId", "reason", "items"]);
  const fromStoreId = integer(b.fromStoreId, "fromStoreId"),
    toStoreId = integer(b.toStoreId, "toStoreId");
  scope(actor, fromStoreId);
  ensure(fromStoreId !== toStoreId, "Choose different stores");
  const reason = text(b.reason, "reason", 1000),
    items = list(b.items).map((raw) => {
      const i = object(raw);
      keys(i, ["variantId", "quantity"]);
      return { variantId: uuid(i.variantId), quantity: integer(i.quantity) };
    });
  unique(items.map((i) => i.variantId));
  return transaction(async (tx) => {
    await activeStore(tx, fromStoreId);
    await activeStore(tx, toStoreId);
    const t = await tx.pOSStockTransfer.create({
      data: { fromStoreId, toStoreId, reason, items: { create: items } },
      include: { items: true },
    });
    await audit(tx, actor, "TRANSFER_CREATED", t.id);
    return t;
  });
}
export async function progressTransfer(
  actor: Actor,
  id: string,
  receive: boolean,
) {
  permission(actor, "inventory");
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "POSStockTransfer" WHERE id = ${id}::uuid FOR UPDATE`;
    const t = await tx.pOSStockTransfer.findUnique({
      where: { id },
      include: { items: true },
    });
    ensure(t, "Transfer not found", 404);
    scope(actor, receive ? t.toStoreId : t.fromStoreId);
    await activeStore(tx, receive ? t.toStoreId : t.fromStoreId);
    if (t.status === (receive ? "RECEIVED" : "DISPATCHED")) return t;
    ensure(
      t.status === (receive ? "DISPATCHED" : "DRAFT"),
      "Invalid transfer state",
      409,
    );
    for (const item of [...t.items].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    ))
      await movement(
        tx,
        actor,
        receive ? t.toStoreId : t.fromStoreId,
        item.variantId,
        receive ? item.quantity : -item.quantity,
        0,
        receive ? "TRANSFER_IN" : "TRANSFER_OUT",
        id,
        t.reason,
      );
    const result = await tx.pOSStockTransfer.update({
      where: { id },
      data: receive
        ? { status: "RECEIVED", receivedAt: new Date() }
        : { status: "DISPATCHED", dispatchedAt: new Date() },
    });
    await audit(
      tx,
      actor,
      receive ? "TRANSFER_RECEIVED" : "TRANSFER_DISPATCHED",
      id,
    );
    return result;
  });
}

type SalespersonRef = number | null | undefined;
type CatalogInput = {
  kind: "catalog";
  key?: string;
  variantId: string;
  quantity: number;
  discount: Prisma.Decimal;
  override?: Prisma.Decimal;
  reason?: string;
  salespersonId: SalespersonRef;
};
type ManualInput = {
  kind: "manual";
  /** Echoed back in the price snapshot so the buyer UI can align lines. */
  key?: string;
  name: string;
  sku?: string;
  barcode?: string;
  brand?: string;
  category?: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  salespersonId: SalespersonRef;
};
type PricedInput = CatalogInput | ManualInput;
type PricedSnapshot = {
  key?: string;
  variantId: string | null;
  name: string;
  sku: string;
  barcode: string | null;
  brand: string;
  category: string | null;
  quantity: number;
  unitPrice: Prisma.Decimal;
  catalogUnitPrice: Prisma.Decimal;
  overrideReason?: string;
  costPrice: Prisma.Decimal;
  discountPerUnit: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  salespersonId: number | null;
};
function manualItem(
  v: Record<string, any>,
  discount: Prisma.Decimal,
): ManualInput {
  if (v.manual !== undefined && v.manual !== true)
    throw new POSError(400, "Invalid manual flag");
  // Cashier-supplied price and tax rate are the source of truth for a manual line.
  // The server recomputes every total from them client-agnostically.
  const unitPrice = money(v.unitPrice, "unit price");
  const taxRate = money(v.taxRate ?? "0", "tax rate", "100");
  ensure(unitPrice.gt(0), "Unit price must be greater than zero");
  const salespersonId =
    v.salespersonId === null || v.salespersonId === 0 || v.salespersonId === "0"
      ? null
      : v.salespersonId === undefined || v.salespersonId === ""
        ? undefined
        : integer(v.salespersonId, "salespersonId", 1);
  // Barcode acceptance mirrors catalog variants (variantData): printable ASCII, max 80.
  const barcode = optionalText(v.barcode, "barcode", 80);
  if (barcode)
    ensure(
      /^[\x20-\x7e]+$/.test(barcode),
      "Barcode must use printable ASCII characters",
    );
  return {
    kind: "manual",
    key: optionalText(v.key, "item key", 100),
    name: text(v.name, "item name", 200),
    sku: optionalText(v.sku, "SKU", 80),
    barcode,
    brand: optionalText(v.brand, "brand", 80),
    category: optionalText(v.category, "category", 80),
    quantity: integer(v.quantity, "quantity", 1, 10000),
    unitPrice,
    discount,
    taxRate,
    salespersonId,
  };
}
function pricingInput(actor: Actor, raw: unknown): PricedInput[] {
  const items = list(raw)
    .map((raw) => {
      const v = object(raw);
      keys(v, [
        "variantId",
        "quantity",
        "discountPerUnit",
        "unitPriceOverride",
        "priceOverrideReason",
        "salespersonId",
        "manual",
        "key",
        "name",
        "sku",
        "barcode",
        "size",
        "color",
        "brand",
        "category",
        "unitPrice",
        "taxRate",
      ]);
      const discount = money(v.discountPerUnit ?? "0");
      if (discount.gt(0)) permission(actor, "discount");
      const isManual =
        v.manual === true ||
        !v.variantId ||
        (typeof v.variantId === "string" && v.variantId.trim() === "");
      if (isManual) return manualItem(v, discount);
      const override =
        v.unitPriceOverride === undefined
          ? undefined
          : money(v.unitPriceOverride, "unitPriceOverride");
      if (override !== undefined) permission(actor, "priceOverride");
      const reason =
        override === undefined
          ? undefined
          : text(v.priceOverrideReason, "priceOverrideReason", 500);
      const salespersonId =
        v.salespersonId === null || v.salespersonId === 0 || v.salespersonId === "0"
          ? null
          : v.salespersonId === undefined || v.salespersonId === ""
            ? undefined
            : integer(v.salespersonId, "salespersonId", 1);
      const catalog: CatalogInput = {
        kind: "catalog",
        key: optionalText(v.key, "item key", 100),
        variantId: uuid(v.variantId),
        quantity: integer(v.quantity, "quantity", 1, 10000),
        discount,
        override,
        reason,
        salespersonId,
      };
      return catalog;
    });
  // Only catalog lines are keyed by a variant; manual lines may legitimately repeat.
  unique(
    items
      .filter((i): i is CatalogInput => i.kind === "catalog")
      .map((i) => i.variantId),
  );
  return items;
}
async function priceItems(
  tx: Tx,
  items: PricedInput[],
  orderDiscount = new D(0),
) {
  /** Input-aligned rows: each pricing decision keeps the position of its item. */
  const priced: {
    item: PricedInput;
    price: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    totals: ReturnType<typeof lineTotals>;
    catalog?: {
      variantId: string;
      name: string;
      sku: string;
      barcode: string | null;
      brand: string;
      category: string | null;
      catalogUnitPrice: Prisma.Decimal;
      costPrice: Prisma.Decimal;
      discountEligible: boolean;
    };
  }[] = [];
  for (const item of items) {
    if (item.kind === "catalog") {
      await tx.$queryRaw`SELECT id FROM "POSProductVariant" WHERE id = ${item.variantId}::uuid FOR SHARE`;
      const v = await tx.pOSProductVariant.findUnique({
        where: { id: item.variantId },
        include: { product: { include: { category: true } } },
      });
      ensure(v?.active && v.product.active, "Variant unavailable");
      ensure(
        item.discount.isZero() || v.product.discountEligible,
        "Product does not allow discounts",
      );
      const price = item.override ?? v.sellingPrice;
      priced.push({
        item,
        price,
        taxRate: v.taxRate,
        totals: lineTotals(price, item.quantity, item.discount, v.taxRate),
        catalog: {
          variantId: v.id,
          name: v.product.name,
          sku: v.sku,
          barcode: v.barcode,
          brand: v.product.brand,
          category: v.product.category?.name ?? null,
          catalogUnitPrice: v.sellingPrice,
          costPrice: v.costPrice,
          discountEligible: v.product.discountEligible,
        },
      });
    } else {
      // Manual item: the cashier supplies price and GST rate; the Decimal
      // pipeline recomputes every total with the same rounding rules.
      ensure(
        item.discount.isZero() || item.discount.lte(item.unitPrice),
        "Discount exceeds unit price",
      );
      priced.push({
        item,
        price: item.unitPrice,
        taxRate: item.taxRate,
        totals: lineTotals(
          item.unitPrice,
          item.quantity,
          item.discount,
          item.taxRate,
        ),
      });
    }
  }
  // Manual lines are always discount-eligible; catalog lines follow the product flag.
  const eligible = priced.reduce(
    (n, row) =>
      (row.catalog?.discountEligible ?? true)
        ? n.plus(row.totals.subtotal.minus(row.totals.discountTotal))
        : n,
    new D(0),
  );
  ensure(
    orderDiscount.lte(eligible),
    "Order discount exceeds eligible taxable amount",
  );
  let remainingDiscount = orderDiscount,
    remainingBase = eligible;
  let subtotal = new D(0),
    discountTotal = new D(0),
    taxTotal = new D(0),
    grandTotal = new D(0);
  const snapshots: PricedSnapshot[] = priced.map(
    ({ item, price, taxRate, totals, catalog }) => {
      const base = totals.subtotal.minus(totals.discountTotal);
      let allocation = new D(0);
      if ((catalog?.discountEligible ?? true) && remainingBase.gt(0)) {
        allocation = base.equals(remainingBase)
          ? remainingDiscount
          : D.min(base, round(remainingDiscount.mul(base).div(remainingBase)));
        remainingDiscount = remainingDiscount.minus(allocation);
        remainingBase = remainingBase.minus(base);
      }
      const lineDiscount = totals.discountTotal.plus(allocation),
        taxable = totals.subtotal.minus(lineDiscount),
        lineTax = round(taxable.mul(taxRate).div(100)),
        total = taxable.plus(lineTax);
      subtotal = subtotal.plus(totals.subtotal);
      discountTotal = discountTotal.plus(lineDiscount);
      taxTotal = taxTotal.plus(lineTax);
      grandTotal = grandTotal.plus(total);
      if (catalog) {
        return {
          key: item.key,
          variantId: catalog.variantId,
          name: catalog.name,
          sku: catalog.sku,
          barcode: catalog.barcode,
          brand: catalog.brand,
          category: catalog.category,
          quantity: item.quantity,
          unitPrice: price,
          catalogUnitPrice: catalog.catalogUnitPrice,
          overrideReason:
            item.kind === "catalog" ? item.reason : undefined,
          costPrice: catalog.costPrice,
          discountPerUnit: item.discount,
          discountTotal: lineDiscount,
          taxRate,
          taxTotal: lineTax,
          lineTotal: total,
          salespersonId: item.salespersonId ?? null,
        };
      }
      // Manual line: no fabricated catalog, cost or stock records.
      const manual = item as ManualInput;
      return {
        key: manual.key,
        variantId: null,
        name: manual.name,
        sku: manual.sku ?? "",
        barcode: manual.barcode ?? null,
        brand: manual.brand ?? "",
        category: manual.category ?? null,
        quantity: manual.quantity,
        unitPrice: manual.unitPrice,
        catalogUnitPrice: manual.unitPrice,
        overrideReason: undefined,
        costPrice: new D(0),
        discountPerUnit: manual.discount,
        discountTotal: lineDiscount,
        taxRate: manual.taxRate,
        taxTotal: lineTax,
        lineTotal: total,
        salespersonId: manual.salespersonId ?? null,
      };
    },
  );
  ensure(remainingDiscount.isZero(), "Could not allocate order discount");
  return { subtotal, discountTotal, taxTotal, grandTotal, snapshots };
}
export async function quote(actor: Actor, raw: unknown) {
  permission(actor, "sell");
  const b = object(raw);
  keys(b, ["storeId", "items", "orderDiscount"]);
  scope(actor, integer(b.storeId, "storeId"));
  const items = pricingInput(actor, b.items),
    orderDiscount = money(b.orderDiscount ?? "0", "orderDiscount");
  if (orderDiscount.gt(0)) permission(actor, "discount");
  return transaction((tx) => priceItems(tx, items, orderDiscount));
}

// One database transaction composes both documented workflows. No intermediate stock/refund commits.
export async function exchange(actor: Actor, saleId: string, raw: unknown) {
  permission(actor, "refund");
  permission(actor, "sell");
  const b = object(raw);
  keys(b, ["return", "replacement"]);
  return transaction(async (tx) => {
    const returned = await returnSale(actor, saleId, b.return, tx);
    const replacementBody = object(b.replacement);
    const original = await tx.pOSSale.findUniqueOrThrow({
      where: { id: saleId },
    });
    ensure(
      replacementBody.storeId === original.storeId,
      "Exchange must be in the original store",
    );
    const replacement = await checkout(actor, replacementBody, tx);
    ensure(replacement.id !== saleId, "Replacement cannot be original invoice");
    const difference = replacement.grandTotal.minus(returned.refundAmount);
    const existing = await tx.pOSAuditLog.findFirst({
      where: { action: "EXCHANGE_COMPLETED", entityId: returned.id },
    });
    if (existing) {
      const metadata = existing.metadata as Record<string, string>;
      ensure(
        metadata.replacementSaleId === replacement.id,
        "Return already linked to another exchange",
        409,
      );
    } else
      await audit(tx, actor, "EXCHANGE_COMPLETED", returned.id, {
        originalSaleId: saleId,
        replacementSaleId: replacement.id,
        refundAmount: returned.refundAmount.toString(),
        replacementTotal: replacement.grandTotal.toString(),
        difference: difference.toString(),
      });
    return {
      return: returned,
      replacement,
      additionalPayment: difference.gt(0) ? difference : new D(0),
      netRefund: difference.lt(0) ? difference.abs() : new D(0),
    };
  });
}
export async function cancelSale(actor: Actor, saleId: string, raw: unknown) {
  permission(actor, "refund");
  const b = object(raw);
  keys(b, [
    "sessionId",
    "idempotencyKey",
    "reason",
    "refundMethod",
    "refundReference",
  ]);
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "POSSale" WHERE id = ${saleId}::uuid FOR UPDATE`;
    const sale = await tx.pOSSale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });
    ensure(sale, "Invoice not found", 404);
    scope(actor, sale.storeId);
    if (sale.status === "CANCELLED") {
      const previous = await tx.pOSReturn.findUnique({
        where: {
          idempotencyKey: text(b.idempotencyKey, "idempotencyKey", 100),
        },
      });
      ensure(
        previous?.saleId === saleId &&
          previous.userId === actor.userId &&
          previous.sessionId === b.sessionId &&
          previous.reason === b.reason &&
          previous.refundMethod === b.refundMethod &&
          previous.refundReference === (b.refundReference ?? null),
        "Cancellation key conflict",
        409,
      );
      return previous;
    }
    ensure(
      sale.items.every((i) => i.returnedQuantity === 0),
      "Use item returns for partially returned invoices",
    );
    const result = await returnSale(
      actor,
      saleId,
      {
        ...b,
        items: sale.items.map((i) => ({
          saleItemId: i.id,
          quantity: i.quantity,
          resellable: true,
        })),
      },
      tx,
    );
    await tx.pOSSale.update({
      where: { id: saleId },
      data: { status: "CANCELLED" },
    });
    await audit(tx, actor, "SALE_CANCELLED", saleId, {
      returnId: result.id,
      reason: b.reason,
    });
    return result;
  });
}

async function cashMovementNet(tx: Tx, sessionId: string) {
  const groups = await tx.pOSCashMovement.groupBy({
    by: ["direction"],
    where: { sessionId },
    _sum: { amount: true },
  });
  return groups.reduce(
    (n, g) =>
      g.direction === "IN"
        ? n.plus(g._sum.amount ?? 0)
        : n.minus(g._sum.amount ?? 0),
    new D(0),
  );
}
export async function cashMovement(
  actor: Actor,
  sessionId: string,
  raw: unknown,
) {
  permission(actor, "reconcile");
  const b = object(raw);
  keys(b, ["direction", "amount", "reason", "idempotencyKey"]);
  ensure(["IN", "OUT"].includes(b.direction), "Direction must be IN or OUT");
  const amount = money(b.amount);
  ensure(amount.gt(0), "Amount must be positive");
  const reason = text(b.reason, "reason", 1000),
    idempotencyKey = text(b.idempotencyKey, "idempotencyKey", 100);
  return transaction(async (tx) => {
    const existing = await tx.pOSCashMovement.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      ensure(
        existing.userId === actor.userId &&
          existing.sessionId === sessionId &&
          existing.amount.equals(amount) &&
          existing.direction === b.direction &&
          existing.reason === reason,
        "Idempotency conflict",
        409,
      );
      const session = await tx.pOSSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { register: true },
      });
      scope(actor, session.register.storeId);
      return existing;
    }
    const s = await openSession(tx, actor, sessionId, undefined, false);
    if (b.direction === "OUT") {
      const incoming = await tx.pOSSalePayment.aggregate({
          where: { method: "CASH", sale: { sessionId } },
          _sum: { amount: true },
        }),
        outgoing = await tx.pOSReturn.aggregate({
          where: { sessionId, refundMethod: "CASH" },
          _sum: { refundAmount: true },
        });
      ensure(
        s.openingCash
          .plus(incoming._sum.amount ?? 0)
          .minus(outgoing._sum.refundAmount ?? 0)
          .plus(await cashMovementNet(tx, sessionId))
          .gte(amount),
        "Insufficient register cash",
        409,
      );
    }
    const result = await tx.pOSCashMovement.create({
      data: {
        sessionId,
        userId: actor.userId,
        direction: b.direction,
        amount,
        reason,
        idempotencyKey,
      },
    });
    await audit(tx, actor, "CASH_MOVEMENT", result.id, {
      sessionId,
      reason,
      direction: b.direction,
      amount: amount.toString(),
    });
    return result;
  });
}
export async function reconcileStock(actor: Actor, raw: unknown) {
  permission(actor, "inventory");
  const b = object(raw);
  keys(b, [
    "storeId",
    "variantId",
    "countedQuantity",
    "countedDamaged",
    "reason",
  ]);
  const storeId = integer(b.storeId, "storeId"),
    variantId = uuid(b.variantId),
    countedQuantity = integer(b.countedQuantity, "countedQuantity", 0),
    countedDamaged = integer(b.countedDamaged ?? 0, "countedDamaged", 0),
    reason = text(b.reason, "reason", 1000);
  scope(actor, storeId);
  return transaction(async (tx) => {
    await activeStore(tx, storeId);
    await tx.pOSInventoryBalance.upsert({
      where: { storeId_variantId: { storeId, variantId } },
      create: { storeId, variantId },
      update: {},
    });
    await tx.$queryRaw`SELECT id FROM "POSInventoryBalance" WHERE "storeId" = ${storeId} AND "variantId" = ${variantId}::uuid FOR UPDATE`;
    const before = await tx.pOSInventoryBalance.findUniqueOrThrow({
        where: { storeId_variantId: { storeId, variantId } },
      }),
      reference = randomUUID();
    await movement(
      tx,
      actor,
      storeId,
      variantId,
      countedQuantity - before.quantity,
      countedDamaged - before.damaged,
      "RECONCILIATION",
      reference,
      reason,
    );
    await audit(tx, actor, "STOCK_RECONCILED", reference, {
      storeId,
      variantId,
      previousQuantity: before.quantity,
      countedQuantity,
      previousDamaged: before.damaged,
      countedDamaged,
      reason,
    });
    return { reference };
  });
}

/** Net tender exchange: internal credit offsets the replacement; only the difference moves external money. */
