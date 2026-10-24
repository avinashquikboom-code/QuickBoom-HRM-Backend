import { Prisma } from "@prisma/client";
import { prisma } from "../utils/db";
import { Actor, permission, scope } from "./auth";
import { audit, activeStore } from "./service";
import { ensure, object, keys, uuid, integer } from "./validation";

type Tx = Prisma.TransactionClient;
// Each mutation holds the per-account advisory lock. ReadCommitted lets a
// waiting caller see the prior caller's committed revision/idempotency result.
const transaction = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn, {isolationLevel: "ReadCommitted", timeout: 20000});
const active = { status: { in: ["WORKING", "ON_BREAK"] } };
function identity(actor: Actor) {
  permission(actor, "sell");
  ensure(!actor.isPosStoreSession, "Sign in with your personal employee account to save billing drafts and take breaks.", 403);
}
export async function lockPOSWork(tx: Tx, userId: number) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pos-work:${userId}`}, 0))::text`;
}

// Explicit allowlist: drafts contain billing inputs, never card/PIN/CVV credentials.
export function billingSnapshot(raw: unknown): Prisma.InputJsonObject {
  const s = object(raw);
  const strings = ["customerName", "customerPhone", "customerId", "paymentMode", "cashTenderAmount", "paymentReference", "orderDiscount", "bottomSearchQuery", "unknownBarcode", "screen"];
  keys(s, ["version", "cart", "splits", "defaultSalesmanId", ...strings]);
  ensure(s.version === 1 && s.screen === "billing", "Unsupported billing draft version");
  ensure(Array.isArray(s.cart) && s.cart.length <= 500, "Draft supports up to 500 cart lines");
  ensure(Buffer.byteLength(JSON.stringify(s), "utf8") <= 512000, "Billing draft is too large");
  for (const field of strings) ensure(s[field] == null || (typeof s[field] === "string" && s[field].length <= 1000), `Invalid draft ${field}`);
  ensure(s.defaultSalesmanId == null || Number.isSafeInteger(s.defaultSalesmanId), "Invalid default salesperson");
  const rowStrings = ["cartId", "variantId", "productId", "name", "sku", "barcode", "size", "color", "salesmanName", "image", "unitPriceOverride", "priceOverrideReason", "discountType"];
  const rowNumbers = ["quantity", "unitPrice", "discountPercent", "discountPerUnit", "salesmanId", "taxRate", "stockAvailable"];
  const ids = new Set<string>();
  for (const input of s.cart) {
    const row = object(input);
    keys(row, [...rowStrings, ...rowNumbers, "isManual", "discountEligible"]);
    uuid(row.cartId);
    ensure(!ids.has(row.cartId), "Duplicate draft cart line"); ids.add(row.cartId);
    for (const field of rowStrings) ensure(row[field] == null || (typeof row[field] === "string" && row[field].length <= 2000), `Invalid draft item ${field}`);
    for (const field of rowNumbers) ensure(row[field] == null || (typeof row[field] === "number" && Number.isFinite(row[field]) && Math.abs(row[field]) <= 1e12), `Invalid draft item ${field}`);
    for (const field of ["isManual", "discountEligible"]) ensure(row[field] == null || typeof row[field] === "boolean", `Invalid draft item ${field}`);
  }
  ensure(Array.isArray(s.splits) && s.splits.length <= 10, "Invalid draft payment split");
  for (const input of s.splits) {
    const split = object(input); keys(split, ["method", "amount", "reference"]);
    ensure(typeof split.method === "string" && split.method.length <= 80, "Invalid draft payment method");
    ensure((typeof split.amount === "string" && split.amount.length <= 40) || (typeof split.amount === "number" && Number.isFinite(split.amount)), "Invalid draft payment amount");
    ensure(split.reference == null || (typeof split.reference === "string" && split.reference.length <= 200), "Invalid draft payment reference");
  }
  return s as Prisma.InputJsonObject;
}
async function session(tx: Tx, actor: Actor, storeId: number, id: string | null) {
  if (!id) return null;
  const found = await tx.pOSSession.findUnique({where: {id}, include: {register: true}});
  ensure(found && !found.closedAt && found.register.storeId === storeId && found.userId === actor.userId, "The register session is closed or belongs to another employee. Open your register session, then resume this bill.", 409);
  return found;
}
async function current(tx: Tx, actor: Actor) {
  const draft = await tx.pOSBillingDraft.findFirst({where: {userId: actor.userId, ...active}, include: {session: true, breaks: {where: {endedAt: null}, take: 1}}});
  if (draft) scope(actor, draft.storeId);
  return draft;
}
function response(draft: Awaited<ReturnType<typeof current>>) {
  return {draft, activeBreak: draft?.breaks.find(b => !b.endedAt) ?? null, requiresRegisterSession: !!draft?.sessionId && !!draft.session?.closedAt, serverTime: new Date().toISOString()};
}
export async function getPOSWork(actor: Actor) {
  identity(actor);
  return transaction(async tx => {
    const draft = await current(tx, actor);
    if (draft) {scope(actor, draft.storeId); await activeStore(tx, draft.storeId);}
    return response(draft);
  });
}
export async function savePOSWork(actor: Actor, raw: unknown, startBreak = false) {
  identity(actor);
  const b = object(raw);keys(b, ["storeId", "sessionId", "draftId", "revision", "snapshot", "requestKey"]);
  const storeId = integer(b.storeId, "storeId");scope(actor, storeId);
  const requestKey = uuid(b.requestKey), revision = integer(b.revision, "revision", 0);
  const sessionId = b.sessionId ? uuid(b.sessionId) : null;
  const snapshot = billingSnapshot(b.snapshot);
  return transaction(async tx => {
    await lockPOSWork(tx, actor.userId);
    await activeStore(tx, storeId);
    if (startBreak) {
      const previous = await tx.pOSWorkBreak.findUnique({where: {requestKey}, include: {draft: true}});
      if (previous) {
        ensure(previous.draft.userId === actor.userId && previous.storeId === storeId, "Break request belongs to another account", 403);
        return response(await current(tx, actor));
      }
    }
    let draft = await current(tx, actor);
    if (draft?.lastWriteKey === requestKey) return response(draft);
    ensure(!draft || draft.status !== "ON_BREAK", "You are on break. Resume work before changing the bill.", 409);
    if (draft) {
      ensure(b.draftId === draft.id && revision === draft.revision, "This bill changed in another tab. Reload to restore the latest saved draft.", 409);
      if (draft.storeId !== storeId) {
        ensure((draft.snapshot as {cart?: unknown[]}).cart?.length === 0, "Clear the saved bill before switching stores.", 409);
        await tx.pOSBillingDraft.update({where: {id: draft.id}, data: {status: "ARCHIVED"}});
        draft = null;
      }
    } else ensure(!b.draftId && revision === 0, "This draft is no longer active. Reload before billing again.", 409);
    const resolvedSessionId = sessionId ?? draft?.sessionId ?? null;
    await session(tx, actor, storeId, resolvedSessionId);
    const data = {snapshot, sessionId: resolvedSessionId, lastWriteKey: requestKey, status: startBreak ? "ON_BREAK" : "WORKING"};
    const saved = draft
      ? await tx.pOSBillingDraft.update({where: {id: draft.id}, data: {...data, revision: {increment: 1}}})
      : await tx.pOSBillingDraft.create({data: {...data, storeId, userId: actor.userId, employeeId: actor.employeeId}});
    if (startBreak) {
      const pause = await tx.pOSWorkBreak.create({data: {draftId: saved.id, storeId, sessionId: resolvedSessionId, requestKey}});
      await audit(tx, actor, "POS_BREAK_STARTED", saved.id, {breakId: pause.id, storeId, sessionId});
    }
    return response(await current(tx, actor));
  });
}
export async function resumePOSWork(actor: Actor, raw: unknown) {
  identity(actor);
  const b = object(raw);keys(b, ["breakId", "sessionId"]);
  const breakId = uuid(b.breakId);
  return transaction(async tx => {
    await lockPOSWork(tx, actor.userId);
    const pause = await tx.pOSWorkBreak.findUnique({where: {id: breakId}, include: {draft: true}});
    ensure(pause && pause.draft.userId === actor.userId, "Break not found for this employee", 404);
    scope(actor, pause.storeId); await activeStore(tx, pause.storeId);
    if (pause.endedAt) return response(await current(tx, actor));
    const sessionId = b.sessionId ? uuid(b.sessionId) : pause.draft.sessionId;
    await session(tx, actor, pause.storeId, sessionId);
    ensure(!pause.draft.sessionId || sessionId, "Open a register session before resuming", 409);
    const endedAt = new Date();
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - pause.startedAt.getTime()) / 1000));
    await tx.pOSWorkBreak.update({where: {id: pause.id}, data: {endedAt, durationSeconds}});
    await tx.pOSBillingDraft.update({where: {id: pause.draftId}, data: {status: "WORKING", sessionId, revision: {increment: 1}}});
    await audit(tx, actor, "POS_BREAK_ENDED", pause.draftId, {breakId, durationSeconds, sessionId});
    return response(await current(tx, actor));
  });
}
// Called inside the sale transaction, under the same per-user lock as break/save.
export async function checkoutPOSWork(tx: Tx, actor: Actor, storeId: number, draftId?: string, revision?: number) {
  await lockPOSWork(tx, actor.userId);
  const draft = await current(tx, actor);
  ensure(draft?.status !== "ON_BREAK", "You are on break. Resume work before completing a sale.", 409);
  if (!draft) {ensure(!draftId, "Draft no longer active. Reload this bill.", 409);return null;}
  ensure(draft.id === draftId && draft.storeId === storeId && draft.revision === revision, "Reload the latest saved draft before completing this bill.", 409);
  return draft;
}
