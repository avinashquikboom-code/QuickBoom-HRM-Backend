import { checkoutPOSWork } from "./workSessions";
import { accrueCommission, reverseCommission } from "./commissions";
import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/db";
import { Actor, permission, scope, storeFilter } from "./auth";
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
  page,
  dateRange,
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
      s.userId === actor.userId || (actor.employeeId != null && s.employeeId === actor.employeeId),
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
  preferredRegisterId?: string,
): Promise<string> {
  await activeStore(tx, storeId);
  await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;

  // 1. If preferredSessionId was provided, verify it belongs to storeId and actor, and is active
  if (preferredSessionId) {
    const session = await tx.pOSSession.findUnique({
      where: { id: preferredSessionId },
      include: { register: true },
    });
    if (session) {
      if (session.closedAt != null) {
        throw new POSError(409, "Cannot process sales on a closed register session. Please open a new register session.");
      }
      if (session.register.storeId !== storeId) {
        throw new POSError(403, "Register session belongs to another store.");
      }
      const isOwner =
        session.userId === actor.userId ||
        (actor.employeeId != null && session.employeeId === actor.employeeId) ||
        actor.isPosStoreSession;
      if (!isOwner) {
        throw new POSError(403, "Register session belongs to another cashier.");
      }
      await tx.$queryRaw`SELECT id FROM "POSSession" WHERE id = ${session.id}::uuid FOR UPDATE`;
      return session.id;
    }
    throw new POSError(404, "Register session not found.");
  }

  // 2. Check if the current cashier already has a valid open session in this store
  const cashierConditions: Prisma.POSSessionWhereInput[] = [{ userId: actor.userId }];
  if (actor.employeeId != null) {
    cashierConditions.push({ employeeId: actor.employeeId });
  }

  const existing = await tx.pOSSession.findFirst({
    where: {
      OR: cashierConditions,
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

  // 3. Current cashier doesn't have an open session. Find an available active register in this store
  let register = null;
  if (preferredRegisterId) {
    register = await tx.pOSRegister.findFirst({
      where: {
        id: preferredRegisterId,
        storeId,
        active: true,
        sessions: { none: { closedAt: null } },
      },
    });
  }

  if (!register) {
    register = await tx.pOSRegister.findFirst({
      where: { storeId, active: true, sessions: { none: { closedAt: null } } },
      orderBy: { id: "asc" },
    });
  }

  if (!register) {
    const activeCount = await tx.pOSRegister.count({ where: { storeId, active: true } });
    if (activeCount > 0) {
      // Store-password login has its own audit identity. An HRM cashier's open
      // register cannot be reused by that identity. Allocate one dedicated
      // terminal register rather than blocking billing or taking over the shift.
      const terminalName = `Store POS Terminal (${actor.userId})`;
      const dedicated = actor.isPosStoreSession && actor.storeId === storeId
        ? await tx.pOSRegister.findFirst({ where: { storeId, name: terminalName } })
        : null;
      if (actor.isPosStoreSession && actor.storeId === storeId && !dedicated) {
        register = await tx.pOSRegister.create({ data: { storeId, name: terminalName, active: true } });
        await audit(tx, actor, "REGISTER_CREATED", register.id);
      } else {
        throw new POSError(
          409,
          "No available register. Close the occupied cashier session or select an available active register.",
        );
      }
    } else {
      register = await tx.pOSRegister.create({ data: { storeId, name: "Main Register", active: true } });
      await audit(tx, actor, "REGISTER_CREATED", register.id);
    }
  }

  await tx.$queryRaw`SELECT id FROM "POSRegister" WHERE id = ${register.id}::uuid FOR UPDATE`;

  const occupiedCheck = await tx.pOSSession.findFirst({
    where: { registerId: register.id, closedAt: null },
  });
  if (occupiedCheck) {
    throw new POSError(
      409,
      "No available register. Close the occupied cashier session or select an available active register.",
    );
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
  keys(b, ["openingCash", "openingNotes"]);
  const openingCash = money(b.openingCash, "openingCash");
  ensure(openingCash.gte(0), "Opening cash must be non-negative", 400);
  const openingNotes = b.openingNotes ? text(b.openingNotes, "openingNotes", 500) : null;
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "POSRegister" WHERE id = ${id}::uuid FOR UPDATE`;
    const register = await tx.pOSRegister.findUnique({ where: { id } });
    ensure(register?.active, "Register unavailable", 404);
    scope(actor, register.storeId);
    await activeStore(tx, register.storeId);

    // If this cashier already has an active open session on this register, resume it idempotently
    const cashierConditions: Prisma.POSSessionWhereInput[] = [{ userId: actor.userId }];
    if (actor.employeeId != null) {
      cashierConditions.push({ employeeId: actor.employeeId });
    }
    const myExisting = await tx.pOSSession.findFirst({
      where: {
        OR: cashierConditions,
        registerId: id,
        closedAt: null,
      },
      include: { register: { include: { store: true } } },
    });
    if (myExisting) {
      return myExisting;
    }

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
        openingNotes,
      },
      include: { register: { include: { store: true } } },
    });
    await audit(tx, actor, "REGISTER_OPENED", s.id, {
      openingCash: openingCash.toString(),
      openingNotes,
    });
    return s;
  });
}

export async function openRegisterSession(actor: Actor, raw: unknown) {
  permission(actor, "sell");
  const b = object(raw);
  keys(b, ["storeId", "registerId", "openingCash", "openingNotes"]);
  const storeId = integer(b.storeId, "storeId");
  scope(actor, storeId);
  const openingCash = money(b.openingCash, "openingCash");
  ensure(openingCash.gte(0), "Opening cash must be non-negative", 400);
  const openingNotes = b.openingNotes ? text(b.openingNotes, "openingNotes", 500) : null;
  const preferredRegisterId = optionalUuid(b.registerId, "registerId");

  return transaction(async (tx) => {
    await activeStore(tx, storeId);
    await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;

    // 1. Check if the current cashier already has an active open session in this store
    const cashierConditions: Prisma.POSSessionWhereInput[] = [{ userId: actor.userId }];
    if (actor.employeeId != null) {
      cashierConditions.push({ employeeId: actor.employeeId });
    }

    const existing = await tx.pOSSession.findFirst({
      where: {
        OR: cashierConditions,
        closedAt: null,
        register: { storeId, active: true },
      },
      include: {
        register: { include: { store: true } },
        user: { select: { id: true, email: true, role: true, profile: { select: { fullName: true } } } },
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
      },
      orderBy: { openedAt: "desc" },
    });

    if (existing) {
      return existing; // Resume existing session without asking again or creating duplicates
    }

    // 2. Find or allocate register
    let register = null;
    if (preferredRegisterId) {
      register = await tx.pOSRegister.findFirst({
        where: { id: preferredRegisterId, storeId, active: true },
      });
      ensure(register, "Selected register not found or inactive", 404);
      const occupied = await tx.pOSSession.findFirst({
        where: { registerId: register.id, closedAt: null },
      });
      ensure(!occupied, "Selected register is already occupied by an active session", 409);
    } else {
      register = await tx.pOSRegister.findFirst({
        where: { storeId, active: true, sessions: { none: { closedAt: null } } },
        orderBy: { name: "asc" },
      });
      if (!register) {
        const count = await tx.pOSRegister.count({ where: { storeId, active: true } });
        if (count > 0 && actor.isPosStoreSession) {
          const terminalName = `Store POS Terminal (${actor.userId})`;
          register = await tx.pOSRegister.findFirst({ where: { storeId, name: terminalName } });
          if (!register) {
            register = await tx.pOSRegister.create({ data: { storeId, name: terminalName, active: true } });
          }
        } else if (count === 0) {
          register = await tx.pOSRegister.create({ data: { storeId, name: "Main Register", active: true } });
        } else {
          throw new POSError(409, "All registers in this store are currently occupied by active sessions.");
        }
      }
    }

    await tx.$queryRaw`SELECT id FROM "POSRegister" WHERE id = ${register.id}::uuid FOR UPDATE`;
    const doubleCheck = await tx.pOSSession.findFirst({
      where: { registerId: register.id, closedAt: null },
    });
    ensure(!doubleCheck, "Register is already occupied by an active session", 409);

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
        openingCash,
        openingNotes,
      },
      include: {
        register: { include: { store: true } },
        user: { select: { id: true, email: true, role: true, profile: { select: { fullName: true } } } },
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
      },
    });

    await audit(tx, actor, "REGISTER_OPENED", newSession.id, {
      openingCash: openingCash.toString(),
      openingNotes,
    });

    return newSession;
  });
}

export async function computeSessionSummary(sessionId: string) {
  const session = await prisma.pOSSession.findUnique({
    where: { id: sessionId },
    include: {
      register: { include: { store: true } },
      user: { select: { id: true, email: true, role: true, profile: { select: { fullName: true } } } },
      employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
    },
  });
  ensure(session, "Session not found", 404);

  // 1. Completed sales in this session
  const salesAgg = await prisma.pOSSale.aggregate({
    where: { sessionId, status: "COMPLETED" },
    _sum: {
      grandTotal: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
    },
    _count: true,
  });

  // 2. Payments by method for completed sales in this session
  const paymentsByMethod = await prisma.pOSSalePayment.groupBy({
    by: ["method"],
    where: { sale: { sessionId, status: "COMPLETED" } },
    _sum: { amount: true },
  });

  let cashSales = new D(0);
  let cardSales = new D(0);
  let upiSales = new D(0);
  let otherSales = new D(0);

  for (const p of paymentsByMethod) {
    const amt = p._sum.amount ?? 0;
    const m = (p.method || "").toUpperCase();
    if (m === "CASH") cashSales = cashSales.plus(amt);
    else if (m === "CARD") cardSales = cardSales.plus(amt);
    else if (m === "UPI") upiSales = upiSales.plus(amt);
    else otherSales = otherSales.plus(amt);
  }

  // 3. Refunds for this session
  const refundsAgg = await prisma.pOSReturn.aggregate({
    where: { sessionId },
    _sum: { refundAmount: true },
    _count: true,
  });
  const cashRefundsAgg = await prisma.pOSReturn.aggregate({
    where: { sessionId, refundMethod: "CASH" },
    _sum: { refundAmount: true },
  });

  const totalRefunds = refundsAgg._sum.refundAmount ?? new D(0);
  const cashRefunds = cashRefundsAgg._sum.refundAmount ?? new D(0);

  // 4. Cash movements for this session
  const cashMovements = await prisma.pOSCashMovement.findMany({
    where: { sessionId },
  });
  let cashIn = new D(0);
  let cashOut = new D(0);
  for (const cm of cashMovements) {
    if (cm.direction === "IN") cashIn = cashIn.plus(cm.amount);
    else cashOut = cashOut.plus(cm.amount);
  }

  // Formula: Expected Cash = Opening Cash + Cash Sales - Cash Refunds + Cash In - Cash Out
  const openingCash = session.openingCash ?? new D(0);
  const expectedCash = openingCash
    .plus(cashSales)
    .minus(cashRefunds)
    .plus(cashIn)
    .minus(cashOut);

  const totalBills = salesAgg._count;
  const totalSales = salesAgg._sum.grandTotal ?? new D(0);
  const actualCash = session.actualCash;
  const variance = session.variance ?? (actualCash != null ? actualCash.minus(expectedCash) : null);

  const cashierName =
    session.employee?.firstName
      ? `${session.employee.firstName} ${session.employee.lastName || ""}`.trim()
      : session.user?.profile?.fullName || session.user?.email || `User #${session.userId}`;

  return {
    session: {
      ...session,
      cashierName,
      storeName: session.register.store.name,
      registerName: session.register.name,
    },
    summary: {
      openingCash: Number(openingCash.toString()),
      totalBills,
      totalSales: Number(totalSales.toString()),
      subtotal: Number((salesAgg._sum.subtotal ?? 0).toString()),
      discountTotal: Number((salesAgg._sum.discountTotal ?? 0).toString()),
      taxTotal: Number((salesAgg._sum.taxTotal ?? 0).toString()),
      cashSales: Number(cashSales.toString()),
      cardSales: Number(cardSales.toString()),
      upiSales: Number(upiSales.toString()),
      otherSales: Number(otherSales.toString()),
      totalRefunds: Number(totalRefunds.toString()),
      cashRefunds: Number(cashRefunds.toString()),
      cashIn: Number(cashIn.toString()),
      cashOut: Number(cashOut.toString()),
      expectedCash: Number(expectedCash.toString()),
      actualCash: actualCash != null ? Number(actualCash.toString()) : null,
      variance: variance != null ? Number(variance.toString()) : null,
      closeReason: session.closeReason,
      openingNotes: session.openingNotes,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      isClosed: !!session.closedAt,
      cashierName,
      storeName: session.register.store.name,
      registerName: session.register.name,
    },
  };
}

export async function closeSession(actor: Actor, sessionId: string, raw: unknown) {
  const b = object(raw);
  keys(b, ["sessionId", "actualCash", "reason", "closeReason", "confirmDiscrepancy"]);
  const actualCash = money(b.actualCash, "actualCash");
  ensure(actualCash.gte(0), "Actual closing cash must be a non-negative number", 400);
  const reason = b.closeReason != null ? String(b.closeReason).trim() : b.reason != null ? String(b.reason).trim() : "";

  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "POSSession" WHERE id = ${sessionId}::uuid FOR UPDATE`;
    const previous = await tx.pOSSession.findUnique({
      where: { id: sessionId },
      include: {
        register: { include: { store: true } },
        user: { select: { id: true, email: true } },
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
      },
    });
    ensure(previous, "Register session not found", 404);
    scope(actor, previous.register.storeId);

    // Verify session ownership or reconcile permission:
    const isOwner =
      previous.userId === actor.userId ||
      (actor.employeeId != null && previous.employeeId === actor.employeeId) ||
      actor.isPosStoreSession;
    if (!isOwner) {
      permission(actor, "reconcile");
    }

    if (previous.closedAt) {
      return previous; // Idempotent return
    }

    // Server-side calculation of expected cash:
    // Expected Cash = Opening Cash + Cash Sales - Cash Refunds + Cash In - Cash Out
    const sales = await tx.pOSSalePayment.aggregate({
      where: { method: "CASH", sale: { sessionId, status: "COMPLETED" } },
      _sum: { amount: true },
    });
    const refunds = await tx.pOSReturn.aggregate({
      where: { sessionId, refundMethod: "CASH" },
      _sum: { refundAmount: true },
    });
    const cashNet = await cashMovementNet(tx, sessionId);
    const expectedCash = previous.openingCash
      .plus(sales._sum.amount ?? 0)
      .minus(refunds._sum.refundAmount ?? 0)
      .plus(cashNet);

    const variance = actualCash.minus(expectedCash);

    if (!variance.isZero() && !reason && !b.confirmDiscrepancy) {
      throw new POSError(
        400,
        `Closing cash mismatch detected: Actual ₹${actualCash.toFixed(2)} differs from Expected ₹${expectedCash.toFixed(2)} by ₹${variance.toFixed(2)}. Please provide a discrepancy note to confirm closing.`,
      );
    }

    const result = await tx.pOSSession.update({
      where: { id: sessionId },
      data: {
        actualCash,
        expectedCash,
        variance,
        closeReason: reason || null,
        closedAt: new Date(),
      },
      include: {
        register: { include: { store: true } },
        user: { select: { id: true, email: true } },
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
      },
    });

    await audit(tx, actor, "REGISTER_CLOSED", sessionId, {
      actualCash: actualCash.toString(),
      expectedCash: expectedCash.toString(),
      variance: variance.toString(),
      reason,
    });

    return result;
  });
}

export async function closeRegister(actor: Actor, id: string, raw: unknown) {
  const b = object(raw);
  keys(b, ["sessionId", "actualCash", "reason", "closeReason", "confirmDiscrepancy"]);
  const sessionId = uuid(b.sessionId);
  const session = await prisma.pOSSession.findUnique({ where: { id: sessionId } });
  ensure(session, "Session not found", 404);
  ensure(session.registerId === id, "Register mismatch");
  return closeSession(actor, sessionId, raw);
}

export async function getCurrentCashierSession(actor: Actor, storeIdParam: unknown) {
  permission(actor, "read");
  const storeId = storeFilter(actor, storeIdParam);
  ensure(storeId, "storeId is required", 400);

  const cashierConditions: Prisma.POSSessionWhereInput[] = [{ userId: actor.userId }];
  if (actor.employeeId != null) {
    cashierConditions.push({ employeeId: actor.employeeId });
  }

  const session = await prisma.pOSSession.findFirst({
    where: {
      OR: cashierConditions,
      closedAt: null,
      register: { storeId, active: true },
    },
    include: {
      register: { include: { store: true } },
      user: { select: { id: true, email: true, role: true, profile: { select: { fullName: true } } } },
      employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
    },
    orderBy: { openedAt: "desc" },
  });

  const registers = await prisma.pOSRegister.findMany({
    where: { storeId, active: true },
    include: {
      sessions: {
        where: { closedAt: null },
        include: {
          user: { select: { id: true, email: true } },
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  let summary = null;
  if (session) {
    const s = await computeSessionSummary(session.id);
    summary = s.summary;
  }

  return {
    session,
    summary,
    registers,
  };
}

export async function getSessionHistory(actor: Actor, query: Record<string, any>) {
  permission(actor, "read");
  const storeId = storeFilter(actor, query.storeId);
  const p = page(query);

  const where: Prisma.POSSessionWhereInput = {
    ...(storeId ? { register: { storeId } } : {}),
    ...(query.registerId ? { registerId: optionalUuid(query.registerId, "registerId") } : {}),
    ...(query.cashierId ? { userId: integer(query.cashierId, "cashierId") } : {}),
    ...(query.from || query.to ? { openedAt: dateRange(query) } : {}),
    ...(query.status === "OPEN" ? { closedAt: null } : query.status === "CLOSED" ? { closedAt: { not: null } } : {}),
  };

  const total = await prisma.pOSSession.count({ where });
  const rawSessions = await prisma.pOSSession.findMany({
    where,
    skip: p.skip,
    take: p.take,
    orderBy: { openedAt: "desc" },
    include: {
      register: { include: { store: true } },
      user: { select: { id: true, email: true, role: true, profile: { select: { fullName: true } } } },
      employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
      sales: {
        where: { status: "COMPLETED" },
        select: {
          id: true,
          grandTotal: true,
          payments: { select: { method: true, amount: true } },
        },
      },
      returns: { select: { id: true, refundMethod: true, refundAmount: true } },
      cashMovements: { select: { id: true, direction: true, amount: true } },
    },
  });

  const items = rawSessions.map((sess) => {
    let totalSales = new D(0);
    let cashSales = new D(0);
    let cardSales = new D(0);
    let upiSales = new D(0);
    let otherSales = new D(0);

    for (const sale of sess.sales) {
      totalSales = totalSales.plus(sale.grandTotal);
      for (const p of sale.payments) {
        const m = (p.method || "").toUpperCase();
        if (m === "CASH") cashSales = cashSales.plus(p.amount);
        else if (m === "CARD") cardSales = cardSales.plus(p.amount);
        else if (m === "UPI") upiSales = upiSales.plus(p.amount);
        else otherSales = otherSales.plus(p.amount);
      }
    }

    let cashRefunds = new D(0);
    let totalRefunds = new D(0);
    for (const ret of sess.returns) {
      totalRefunds = totalRefunds.plus(ret.refundAmount);
      if ((ret.refundMethod || "").toUpperCase() === "CASH") {
        cashRefunds = cashRefunds.plus(ret.refundAmount);
      }
    }

    let cashIn = new D(0);
    let cashOut = new D(0);
    for (const cm of sess.cashMovements) {
      if (cm.direction === "IN") cashIn = cashIn.plus(cm.amount);
      else cashOut = cashOut.plus(cm.amount);
    }

    const openingCash = sess.openingCash ?? new D(0);
    const expectedCash = sess.expectedCash ??
      openingCash.plus(cashSales).minus(cashRefunds).plus(cashIn).minus(cashOut);

    const actualCash = sess.actualCash;
    const variance = sess.variance ?? (actualCash != null ? actualCash.minus(expectedCash) : null);

    const cashierName =
      sess.employee?.firstName
        ? `${sess.employee.firstName} ${sess.employee.lastName || ""}`.trim()
        : sess.user?.profile?.fullName || sess.user?.email || `User #${sess.userId}`;

    return {
      id: sess.id,
      registerId: sess.registerId,
      registerName: sess.register.name,
      storeId: sess.register.storeId,
      storeName: sess.register.store.name,
      userId: sess.userId,
      employeeId: sess.employeeId,
      cashierName,
      cashierEmail: sess.user?.email,
      cashierCode: sess.employee?.employeeCode,
      openedAt: sess.openedAt,
      closedAt: sess.closedAt,
      status: sess.closedAt ? "Closed" : "Open",
      openingCash: Number(openingCash.toString()),
      expectedCash: Number(expectedCash.toString()),
      actualCash: actualCash != null ? Number(actualCash.toString()) : null,
      variance: variance != null ? Number(variance.toString()) : null,
      closeReason: sess.closeReason,
      openingNotes: sess.openingNotes,
      totalBills: sess.sales.length,
      totalSales: Number(totalSales.toString()),
      cashSales: Number(cashSales.toString()),
      cardSales: Number(cardSales.toString()),
      upiSales: Number(upiSales.toString()),
      otherSales: Number(otherSales.toString()),
      totalRefunds: Number(totalRefunds.toString()),
      cashRefunds: Number(cashRefunds.toString()),
      cashIn: Number(cashIn.toString()),
      cashOut: Number(cashOut.toString()),
    };
  });

  return {
    items,
    total,
    page: p.page,
    pageSize: p.take,
    totalPages: Math.ceil(total / p.take) || 1,
  };
}

export async function getSessionSales(actor: Actor, sessionId: string, query: Record<string, any>) {
  permission(actor, "read");
  const session = await prisma.pOSSession.findUnique({
    where: { id: sessionId },
    include: { register: true },
  });
  ensure(session, "Session not found", 404);
  scope(actor, session.register.storeId);
  const p = page(query);

  const where: Prisma.POSSaleWhereInput = {
    sessionId,
    ...(query.status ? { status: text(query.status, "status") } : {}),
    ...(query.search ? { invoiceNo: { contains: text(query.search, "search"), mode: "insensitive" } } : {}),
  };

  const total = await prisma.pOSSale.count({ where });
  const items = await prisma.pOSSale.findMany({
    where,
    skip: p.skip,
    take: p.take,
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          salesperson: { select: { id: true, employeeID: true, firstName: true, lastName: true, employeeCode: true } },
        },
      },
      payments: true,
      store: { select: { id: true, name: true, code: true } },
      cashier: { select: { id: true, email: true, profile: { select: { fullName: true } } } },
      salesperson: { select: { id: true, employeeID: true, firstName: true, lastName: true, employeeCode: true } },
    },
  });

  return {
    items,
    total,
    page: p.page,
    pageSize: p.take,
    totalPages: Math.ceil(total / p.take) || 1,
  };
}
export async function checkout(actor: Actor, raw: unknown, existingTx?: Tx) {
  permission(actor, "sell");
  const b = object(raw);
  keys(b, [
    "storeId",
    "sessionId",
    "registerId",
    "salespersonId",
    "customerName",
    "customerPhone",
    "items",
    "payments",
    "idempotencyKey",
    "orderDiscount",
    "customerId",
    "billingDraftId",
    "billingDraftRevision",
  ]);
  const billingDraftId = b.billingDraftId ? uuid(b.billingDraftId) : undefined;
  const billingDraftRevision = b.billingDraftRevision == null ? undefined : integer(b.billingDraftRevision, "billingDraftRevision", 1);
  const storeId = integer(b.storeId, "storeId"),
    providedSessionId = optionalUuid(b.sessionId, "sessionId"),
    providedRegisterId = optionalUuid(b.registerId, "registerId"),
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
      const billingDraft = await checkoutPOSWork(tx, actor, storeId, billingDraftId, billingDraftRevision, !!existingTx);
      const sessionId = await ensureOrOpenSession(tx, actor, storeId, providedSessionId, providedRegisterId);
      ensure(!billingDraft?.sessionId || billingDraft.sessionId === sessionId, "The draft belongs to another register session. Save it with your current open session first.", 409);
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
      if (billingDraft) await tx.pOSBillingDraft.update({where: {id: billingDraft.id}, data: {status: "COMPLETED", saleId: sale.id, revision: {increment: 1}}});
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
          concurrentSale.storeId === storeId &&
          concurrentSale.requestHash === requestHash
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

export async function deleteSale(
  actor: Actor,
  saleId: string,
  options: { reason?: string; permanent?: boolean } = {},
) {
  ensure(
    actor.admin || actor.permissions["pos.refund"] === true,
    "Permission denied: pos.refund or admin required",
    403,
  );
  if (options.permanent) {
    ensure(actor.admin, "Administrator required for permanent deletion", 403);
  }
  return transaction(async (tx) => {
    const sale = await tx.pOSSale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });
    ensure(sale, "Invoice not found", 404);
    scope(actor, sale.storeId);

    if (options.permanent) {
      const saleItemIds = sale.items.map((i) => i.id);
      const returns = await tx.pOSReturn.findMany({
        where: { saleId },
        select: { id: true },
      });
      const returnIds = returns.map((r) => r.id);
      if (returnIds.length > 0 || saleItemIds.length > 0) {
        await tx.pOSReturnItem.deleteMany({
          where: {
            OR: [
              ...(returnIds.length > 0 ? [{ returnId: { in: returnIds } }] : []),
              ...(saleItemIds.length > 0 ? [{ saleItemId: { in: saleItemIds } }] : []),
            ],
          },
        });
      }
      if (returnIds.length > 0) {
        await tx.pOSReturn.deleteMany({ where: { id: { in: returnIds } } });
      }
      if (saleItemIds.length > 0) {
        await tx.pOSCommissionLine.deleteMany({ where: { saleItemId: { in: saleItemIds } } });
      }
      await tx.pOSSalePayment.deleteMany({ where: { saleId } });
      await tx.pOSSaleItem.deleteMany({ where: { saleId } });
      await tx.pOSSale.delete({ where: { id: saleId } });

      if (sale.status === "COMPLETED") {
        for (const item of sale.items) {
          if (item.variantId) {
            await tx.pOSInventoryBalance.updateMany({
              where: { storeId: sale.storeId, variantId: item.variantId },
              data: { quantity: { increment: item.quantity } },
            });
          }
        }
      }

      await audit(tx, actor, "SALE_DELETED", saleId, {
        invoiceNo: sale.invoiceNo,
        storeId: sale.storeId,
        reason: options.reason || "Manual bill deletion",
        grandTotal: sale.grandTotal,
      });

      return { id: saleId, invoiceNo: sale.invoiceNo, status: "DELETED" };
    } else {
      if (sale.status === "CANCELLED") {
        return { id: saleId, invoiceNo: sale.invoiceNo, status: "CANCELLED" };
      }
      for (const item of sale.items) {
        if (item.variantId) {
          await tx.pOSInventoryBalance.updateMany({
            where: { storeId: sale.storeId, variantId: item.variantId },
            data: { quantity: { increment: item.quantity } },
          });
        }
      }
      await tx.pOSSale.update({
        where: { id: saleId },
        data: { status: "CANCELLED" },
      });
      const saleItemIds = sale.items.map((i) => i.id);
      if (saleItemIds.length > 0) {
        const commLines = await tx.pOSCommissionLine.findMany({
          where: { saleItemId: { in: saleItemIds } },
        });
        for (const line of commLines) {
          await tx.pOSCommissionLine.update({
            where: { id: line.id },
            data: { reversedAmount: line.amount },
          });
        }
      }
      await audit(tx, actor, "SALE_CANCELLED", saleId, {
        invoiceNo: sale.invoiceNo,
        storeId: sale.storeId,
        reason: options.reason || "Bill cancelled and deleted from completed",
        grandTotal: sale.grandTotal,
      });
      return { id: saleId, invoiceNo: sale.invoiceNo, status: "CANCELLED" };
    }
  });
}

export async function bulkCancelSales(actor: Actor, raw: unknown) {
  ensure(
    actor.admin || actor.permissions["pos.refund"] === true,
    "Permission denied: pos.refund or admin required",
    403,
  );
  const b = object(raw);
  keys(b, ["saleIds", "reason", "refundMethod", "permanent"]);
  ensure(
    Array.isArray(b.saleIds) && b.saleIds.length > 0,
    "At least one sale ID is required",
    400,
  );
  ensure(b.saleIds.length <= 500, "Maximum 500 bills can be processed at once", 400);
  const reason = text(b.reason || "Bulk cancellation", "reason", 1000);
  const refundMethod = b.refundMethod ? text(b.refundMethod, "refundMethod", 50) : "CASH";
  const permanent = b.permanent === true;
  if (permanent) {
    ensure(actor.admin, "Administrator required for permanent deletion", 403);
  }

  const results: Array<{ id: string; invoiceNo?: string; success: boolean; error?: string }> = [];

  for (const rawId of b.saleIds) {
    const saleId = uuid(rawId);
    try {
      const res = await transaction(async (tx) => {
        const sale = await tx.pOSSale.findUnique({
          where: { id: saleId },
          include: { items: true },
        });
        ensure(sale, "Invoice not found", 404);
        scope(actor, sale.storeId);

        if (permanent) {
          const saleItemIds = sale.items.map((i) => i.id);
          const returns = await tx.pOSReturn.findMany({
            where: { saleId },
            select: { id: true },
          });
          const returnIds = returns.map((r) => r.id);

          if (returnIds.length > 0 || saleItemIds.length > 0) {
            await tx.pOSReturnItem.deleteMany({
              where: {
                OR: [
                  ...(returnIds.length > 0 ? [{ returnId: { in: returnIds } }] : []),
                  ...(saleItemIds.length > 0 ? [{ saleItemId: { in: saleItemIds } }] : []),
                ],
              },
            });
          }
          if (returnIds.length > 0) {
            await tx.pOSReturn.deleteMany({ where: { id: { in: returnIds } } });
          }
          if (saleItemIds.length > 0) {
            await tx.pOSCommissionLine.deleteMany({ where: { saleItemId: { in: saleItemIds } } });
          }
          await tx.pOSSalePayment.deleteMany({ where: { saleId } });
          await tx.pOSSaleItem.deleteMany({ where: { saleId } });
          await tx.pOSSale.delete({ where: { id: saleId } });

          if (sale.status === "COMPLETED") {
            for (const item of sale.items) {
              if (item.variantId) {
                await tx.pOSInventoryBalance.updateMany({
                  where: { storeId: sale.storeId, variantId: item.variantId },
                  data: { quantity: { increment: item.quantity } },
                });
              }
            }
          }

          await audit(tx, actor, "SALE_DELETED", saleId, {
            invoiceNo: sale.invoiceNo,
            storeId: sale.storeId,
            reason,
            grandTotal: sale.grandTotal,
          });

          return { invoiceNo: sale.invoiceNo };
        } else {
          if (sale.status === "CANCELLED") {
            return { invoiceNo: sale.invoiceNo };
          }
          for (const item of sale.items) {
            if (item.variantId) {
              await tx.pOSInventoryBalance.updateMany({
                where: { storeId: sale.storeId, variantId: item.variantId },
                data: { quantity: { increment: item.quantity } },
              });
            }
          }
          await tx.pOSSale.update({
            where: { id: saleId },
            data: { status: "CANCELLED" },
          });
          const saleItemIds = sale.items.map((i) => i.id);
          if (saleItemIds.length > 0) {
            const commLines = await tx.pOSCommissionLine.findMany({
              where: { saleItemId: { in: saleItemIds } },
            });
            for (const line of commLines) {
              await tx.pOSCommissionLine.update({
                where: { id: line.id },
                data: { reversedAmount: line.amount },
              });
            }
          }
          await audit(tx, actor, "SALE_CANCELLED", saleId, {
            invoiceNo: sale.invoiceNo,
            storeId: sale.storeId,
            reason,
            refundMethod,
            grandTotal: sale.grandTotal,
          });
          return { invoiceNo: sale.invoiceNo };
        }
      });
      results.push({ id: saleId, invoiceNo: res.invoiceNo, success: true });
    } catch (err: unknown) {
      results.push({
        id: saleId,
        success: false,
        error: err instanceof Error ? err.message : "Cancellation failed",
      });
    }
  }

  const processedCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  return {
    success: failedCount === 0,
    totalRequested: b.saleIds.length,
    processedCount,
    failedCount,
    results,
  };
}

export async function dataManagementPreview(actor: Actor, query: Record<string, unknown>) {
  permission(actor, "reports");
  const scopeType = text(query.scope || "current", "scope");
  ensure(["current", "selected", "all"].includes(scopeType), "Scope must be current, selected, or all");

  let storeIds: number[] = [];
  if (scopeType === "all") {
    ensure(actor.admin, "Administrator required for all-store preview", 403);
    const allStores = await prisma.store.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    storeIds = allStores.map((s) => s.id);
  } else if (scopeType === "selected") {
    ensure(actor.admin || actor.permissions["pos.allStores"] === true, "Administrator or multi-store access required", 403);
    const rawIds = query.storeIds;
    const parsed = Array.isArray(rawIds)
      ? rawIds.map(Number)
      : typeof rawIds === "string"
      ? rawIds.split(",").map(Number)
      : [];
    ensure(parsed.length > 0, "At least one store must be selected", 400);
    for (const sid of parsed) {
      scope(actor, sid);
    }
    storeIds = parsed;
  } else {
    const sid = integer(Number(query.currentStoreId || actor.storeId), "currentStoreId");
    scope(actor, sid);
    storeIds = [sid];
  }

  const where: Prisma.POSSaleWhereInput = {
    storeId: { in: storeIds },
    ...(query.status && query.status !== "ALL" ? { status: text(query.status, "status") } : {}),
    ...(query.startDate || query.endDate
      ? {
          createdAt: {
            ...(query.startDate ? { gte: new Date(String(query.startDate)) } : {}),
            ...(query.endDate ? { lte: new Date(String(query.endDate) + "T23:59:59.999Z") } : {}),
          },
        }
      : {}),
  };

  const storeBreakdowns = await prisma.pOSSale.groupBy({
    by: ["storeId"],
    where,
    _count: { id: true },
    _sum: { grandTotal: true },
  });

  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, name: true, code: true },
  });

  const storeMap = new Map(stores.map((s) => [s.id, s]));

  const breakdown = storeIds.map((sid) => {
    const stat = storeBreakdowns.find((b) => b.storeId === sid);
    const storeInfo = storeMap.get(sid);
    return {
      storeId: sid,
      storeName: storeInfo?.name || `Store #${sid}`,
      storeCode: storeInfo?.code || "",
      billCount: stat?._count.id ?? 0,
      totalAmount: Number(stat?._sum.grandTotal ?? 0),
    };
  });

  const totalBills = breakdown.reduce((sum, s) => sum + s.billCount, 0);
  const totalAmount = breakdown.reduce((sum, s) => sum + s.totalAmount, 0);
  const affectedStores = breakdown.filter((s) => s.billCount > 0);

  return {
    scope: scopeType,
    totalBills,
    totalAmount,
    affectedStoreCount: affectedStores.length,
    stores: breakdown,
  };
}

export async function dataManagementClear(actor: Actor, raw: unknown) {
  const b = object(raw);
  keys(b, [
    "scope",
    "storeIds",
    "currentStoreId",
    "startDate",
    "endDate",
    "status",
    "actionType",
    "reason",
    "confirmationText",
  ]);

  ensure(
    actor.admin || actor.permissions["pos.refund"] === true,
    "Permission denied: pos.refund or admin required",
    403,
  );
  const scopeType = text(b.scope || "current", "scope");
  ensure(["current", "selected", "all"].includes(scopeType), "Scope must be current, selected, or all");
  const actionType = text(b.actionType || "CANCEL", "actionType");
  ensure(["CANCEL", "DELETE"].includes(actionType), "actionType must be CANCEL or DELETE");
  const reason = b.reason ? text(b.reason, "reason", 1000) : "Data management clear";

  if (scopeType === "all" || actionType === "DELETE") {
    ensure(actor.admin, "Administrator authorization required for this action", 403);
    ensure(
      b.confirmationText === "DELETE",
      "Type DELETE to confirm permanent operation",
      400,
    );
  }

  let storeIds: number[] = [];
  if (scopeType === "all") {
    const allStores = await prisma.store.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    storeIds = allStores.map((s) => s.id);
  } else if (scopeType === "selected") {
    ensure(actor.admin || actor.permissions["pos.allStores"] === true, "Administrator or multi-store access required", 403);
    ensure(Array.isArray(b.storeIds) && b.storeIds.length > 0, "At least one store must be selected", 400);
    const parsed = b.storeIds.map((id: unknown) => integer(Number(id), "storeId"));
    for (const sid of parsed) {
      scope(actor, sid);
    }
    storeIds = parsed;
  } else {
    const sid = integer(Number(b.currentStoreId || actor.storeId), "currentStoreId");
    scope(actor, sid);
    storeIds = [sid];
  }

  const where: Prisma.POSSaleWhereInput = {
    storeId: { in: storeIds },
    ...(b.status && b.status !== "ALL" ? { status: text(b.status, "status") } : {}),
    ...(b.startDate || b.endDate
      ? {
          createdAt: {
            ...(b.startDate ? { gte: new Date(String(b.startDate)) } : {}),
            ...(b.endDate ? { lte: new Date(String(b.endDate) + "T23:59:59.999Z") } : {}),
          },
        }
      : {}),
  };

  return transaction(async (tx) => {
    const sales = await tx.pOSSale.findMany({
      where,
      include: { items: true },
    });

    const affectedBills = sales.length;
    const affectedAmount = sales.reduce((sum, s) => sum + Number(s.grandTotal), 0);
    const saleIds = sales.map((s) => s.id);

    if (affectedBills === 0) {
      return {
        success: true,
        affectedBills: 0,
        affectedAmount: 0,
        affectedStoreCount: 0,
        message: "No matching bills found for the selected criteria.",
      };
    }

    if (actionType === "DELETE") {
      const chunkSize = 100;
      for (let i = 0; i < saleIds.length; i += chunkSize) {
        const chunk = saleIds.slice(i, i + chunkSize);
        const chunkSales = sales.filter((s) => chunk.includes(s.id));
        const saleItemIds = chunkSales.flatMap((s) => s.items.map((it) => it.id));
        const returns = await tx.pOSReturn.findMany({
          where: { saleId: { in: chunk } },
          select: { id: true },
        });
        const returnIds = returns.map((r) => r.id);

        if (returnIds.length > 0 || saleItemIds.length > 0) {
          await tx.pOSReturnItem.deleteMany({
            where: {
              OR: [
                ...(returnIds.length > 0 ? [{ returnId: { in: returnIds } }] : []),
                ...(saleItemIds.length > 0 ? [{ saleItemId: { in: saleItemIds } }] : []),
              ],
            },
          });
        }
        if (returnIds.length > 0) {
          await tx.pOSReturn.deleteMany({ where: { id: { in: returnIds } } });
        }
        if (saleItemIds.length > 0) {
          await tx.pOSCommissionLine.deleteMany({ where: { saleItemId: { in: saleItemIds } } });
        }
        await tx.pOSSalePayment.deleteMany({ where: { saleId: { in: chunk } } });
        await tx.pOSSaleItem.deleteMany({ where: { saleId: { in: chunk } } });
        await tx.pOSSale.deleteMany({ where: { id: { in: chunk } } });
      }

      await audit(tx, actor, "DATA_MANAGEMENT_PURGE", "DATA_MANAGEMENT", {
        scope: scopeType,
        storeIds,
        affectedBills,
        affectedAmount,
        reason,
        startDate: b.startDate,
        endDate: b.endDate,
        statusFilter: b.status,
      });

      return {
        success: true,
        affectedBills,
        affectedAmount,
        affectedStoreCount: storeIds.length,
        message: `Permanently deleted ${affectedBills} bills across ${storeIds.length} store(s).`,
      };
    } else {
      const completedSales = sales.filter((s) => s.status === "COMPLETED");
      const completedIds = completedSales.map((s) => s.id);

      for (const s of completedSales) {
        for (const item of s.items) {
          if (item.variantId) {
            await tx.pOSInventoryBalance.updateMany({
              where: { storeId: s.storeId, variantId: item.variantId },
              data: { quantity: { increment: item.quantity } },
            });
          }
        }
      }

      if (completedIds.length > 0) {
        await tx.pOSSale.updateMany({
          where: { id: { in: completedIds } },
          data: { status: "CANCELLED" },
        });

        const completedItemIds = completedSales.flatMap((s) => s.items.map((it) => it.id));
        if (completedItemIds.length > 0) {
          const commLines = await tx.pOSCommissionLine.findMany({
            where: { saleItemId: { in: completedItemIds } },
          });
          for (const line of commLines) {
            await tx.pOSCommissionLine.update({
              where: { id: line.id },
              data: { reversedAmount: line.amount },
            });
          }
        }
      }

      await audit(tx, actor, "DATA_MANAGEMENT_CANCEL", "DATA_MANAGEMENT", {
        scope: scopeType,
        storeIds,
        affectedBills,
        cancelledCompletedBills: completedIds.length,
        affectedAmount,
        reason,
        startDate: b.startDate,
        endDate: b.endDate,
        statusFilter: b.status,
      });

      return {
        success: true,
        affectedBills,
        affectedAmount,
        affectedStoreCount: storeIds.length,
        message: `Successfully cancelled ${completedIds.length} completed bills (${affectedBills} total affected) across ${storeIds.length} store(s).`,
      };
    }
  });
}

