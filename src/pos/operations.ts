import { Prisma } from "@prisma/client";
import { prisma } from "../utils/db";
import { Actor, permission, scope, storeFilter } from "./auth";
import {
  ensure,
  object,
  keys,
  text,
  integer,
  boolean,
  uuid,
  page,
  methods,
} from "./validation";
import {
  transaction,
  audit,
  activeStore,
  productData,
  variantData,
} from "./service";
export async function paymentMethods(actor: Actor, storeId: number) {
  scope(actor, storeId);
  const configured = await prisma.pOSPaymentMethod.findMany({
    where: { storeId },
  });
  return [
    ...methods.map((code) => ({
      code,
      name: code.replaceAll("_", " "),
      enabled: true,
    })),
    ...configured.filter((m) => !methods.includes(m.code)),
  ].map((m) => ({ ...m, ...configured.find((c) => c.code === m.code) }));
}
export async function validatePaymentMethod(
  tx: Prisma.TransactionClient,
  storeId: number,
  code: string,
) {
  const configured = await tx.pOSPaymentMethod.findUnique({
    where: { storeId_code: { storeId, code } },
  });
  ensure(
    configured ? configured.enabled : methods.includes(code),
    "Payment method is disabled or unconfigured",
  );
}
export async function configure(actor: Actor, raw: unknown) {
  permission(actor, "configure");
  const b = object(raw);
  keys(b, [
    "storeId",
    "commissionEnabled",
    "commissionBasis",
    "fixedCommissionBasis",
    "refundCommissionPolicy",
    "returnWindowDays",
  ]);
  const storeId = integer(b.storeId, "storeId");
  scope(actor, storeId);
  const commissionEnabled = boolean(b.commissionEnabled);
  if (commissionEnabled) {
    ensure(
      ["NET_EX_TAX", "NET_INCL_TAX"].includes(b.commissionBasis),
      "Choose commission revenue basis",
    );
    ensure(
      ["LINE", "UNIT"].includes(b.fixedCommissionBasis),
      "Choose fixed commission basis",
    );
    ensure(
      b.refundCommissionPolicy === "REVIEW_ADJUSTMENT",
      "Explicit refund adjustment policy is required",
    );
  }
  const data = {
    commissionEnabled,
    commissionBasis: commissionEnabled ? b.commissionBasis : null,
    fixedCommissionBasis: commissionEnabled ? b.fixedCommissionBasis : null,
    refundCommissionPolicy: commissionEnabled ? b.refundCommissionPolicy : null,
    returnWindowDays:
      b.returnWindowDays == null
        ? null
        : integer(b.returnWindowDays, "returnWindowDays", 0, 3650),
  };
  return transaction(async (tx) => {
    await activeStore(tx, storeId);
    const result = await tx.pOSConfiguration.upsert({
      where: { storeId },
      create: { storeId, ...data },
      update: data,
    });
    await audit(tx, actor, "CONFIGURATION_UPDATED", String(storeId), data);
    return result;
  });
}
export async function savePaymentMethod(
  actor: Actor,
  code: string,
  raw: unknown,
) {
  permission(actor, "configure");
  ensure(/^[A-Z][A-Z0-9_]{0,39}$/.test(code), "Invalid payment method code");
  const b = object(raw);
  keys(b, ["storeId", "name", "enabled"]);
  const storeId = integer(b.storeId, "storeId");
  scope(actor, storeId);
  const data = { name: text(b.name, "name", 80), enabled: boolean(b.enabled) };
  return transaction(async (tx) => {
    await activeStore(tx, storeId);
    const result = await tx.pOSPaymentMethod.upsert({
      where: { storeId_code: { storeId, code } },
      create: { storeId, code, ...data },
      update: data,
    });
    await audit(tx, actor, "PAYMENT_METHOD_CONFIGURED", result.id, {
      code,
      ...data,
    });
    return result;
  });
}
export async function reconcilePayment(
  actor: Actor,
  id: string,
  raw: unknown,
  refund = false,
) {
  permission(actor, "reconcile");
  const b = object(raw);
  keys(b, ["status", "reason"]);
  ensure(
    ["RECONCILED", "DISPUTED"].includes(b.status),
    "Invalid reconciliation status",
  );
  const reason = text(b.reason, "reconciliation reason", 1000);
  return transaction(async (tx) => {
    if (refund) {
      await tx.$queryRaw`SELECT id FROM "POSReturn" WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.pOSReturn.findUnique({
        where: { id },
        include: { sale: true },
      });
      ensure(row, "Refund not found", 404);
      scope(actor, row.sale.storeId);
      if (
        row.reconciliationStatus === b.status &&
        row.reconciliationNote === reason
      )
        return row;
      const result = await tx.pOSReturn.update({
        where: { id },
        data: {
          reconciliationStatus: b.status,
          reconciledAt: new Date(),
          reconciliationNote: reason,
        },
      });
      await audit(tx, actor, "REFUND_RECONCILED", id, {
        status: b.status,
        reason,
      });
      return result;
    }
    await tx.$queryRaw`SELECT id FROM "POSSalePayment" WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.pOSSalePayment.findUnique({
      where: { id },
      include: { sale: true },
    });
    ensure(row, "Payment not found", 404);
    scope(actor, row.sale.storeId);
    if (
      row.reconciliationStatus === b.status &&
      row.reconciliationNote === reason
    )
      return row;
    const result = await tx.pOSSalePayment.update({
      where: { id },
      data: {
        reconciliationStatus: b.status,
        reconciledAt: new Date(),
        reconciliationNote: reason,
      },
    });
    await audit(tx, actor, "PAYMENT_RECONCILED", id, {
      status: b.status,
      reason,
    });
    return result;
  });
}
export async function customers(actor: Actor, query: Record<string, unknown>) {
  permission(actor, "read");
  const storeId = storeFilter(actor, query.storeId),
    p = page(query),
    search = query.search ? text(query.search, "search") : "";
  const where: Prisma.POSCustomerWhereInput = {
    storeId,
    active: true,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  };
  return {
    items: await prisma.pOSCustomer.findMany({
      where,
      skip: p.skip,
      take: p.take,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    total: await prisma.pOSCustomer.count({ where }),
    page: p.page,
  };
}
export async function saveCustomer(actor: Actor, raw: unknown, id?: string) {
  permission(actor, "sell");
  const b = object(raw);
  keys(b, ["storeId", "name", "phone", "email", "active"]);
  const storeId = integer(b.storeId, "storeId");
  scope(actor, storeId);
  const phone = b.phone
    ? text(b.phone, "phone", 30).replace(/[\s()-]/g, "")
    : null;
  ensure(phone == null || /^\+?\d{7,20}$/.test(phone), "Invalid phone number");
  const email = b.email ? text(b.email, "email", 254) : null;
  ensure(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Invalid email");
  const data = {
    name: text(b.name, "customer name"),
    phone,
    email,
    active: b.active === undefined ? true : boolean(b.active),
  };
  return transaction(async (tx) => {
    await activeStore(tx, storeId);
    if (id) {
      const previous = await tx.pOSCustomer.findUnique({
        where: { id: uuid(id) },
      });
      ensure(
        previous?.storeId === storeId,
        "Customer not found in this store",
        404,
      );
    }
    const result = id
      ? await tx.pOSCustomer.update({ where: { id }, data })
      : await tx.pOSCustomer.create({ data: { storeId, ...data } });
    await audit(
      tx,
      actor,
      id ? "CUSTOMER_UPDATED" : "CUSTOMER_CREATED",
      result.id,
    );
    return result;
  });
}
export async function updateVariant(
  actor: Actor,
  id: string,
  raw: unknown,
  tx?: Prisma.TransactionClient,
) {
  permission(actor, "catalog");
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
  const run = async (db: Prisma.TransactionClient) => {
    const previous = await db.pOSProductVariant.findUnique({ where: { id } });
    ensure(previous, "Variant not found", 404);
    const merged = {
      sku: previous.sku,
      barcode: previous.barcode,
      size: previous.size,
      color: previous.color,
      costPrice: previous.costPrice.toFixed(2),
      sellingPrice: previous.sellingPrice.toFixed(2),
      taxRate: previous.taxRate.toString(),
      active: previous.active,
      ...b,
    };
    const result = await db.pOSProductVariant.update({
      where: { id },
      data: variantData(merged),
    });
    await audit(db, actor, "VARIANT_UPDATED", id, { fields: Object.keys(b) });
    return result;
  };
  return tx ? run(tx) : transaction(run);
}
export async function bulkCatalog(actor: Actor, raw: unknown) {
  permission(actor, "catalog");
  const b = object(raw);
  keys(b, ["variants"]);
  ensure(
    Array.isArray(b.variants) &&
      b.variants.length > 0 &&
      b.variants.length <= 100,
    "Choose 1–100 variants",
  );
  const ids = b.variants.map((v: unknown) => uuid(object(v).id));
  ensure(new Set(ids).size === ids.length, "Duplicate variant");
  return transaction(async (tx) => {
    const result = [];
    for (const v of b.variants) {
      const row = object(v);
      keys(row, ["id", "changes"]);
      result.push(await updateVariant(actor, uuid(row.id), row.changes, tx));
    }
    return result;
  });
}
