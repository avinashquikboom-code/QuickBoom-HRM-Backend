import { Prisma, HrmCommissionLine } from '@prisma/client';
import { prisma } from '../utils/db';
import { CommissionInputError, normalizeDocuments, economicHash, requireValue, earning, money, NormalizedDocument, NormalizedLine } from './normalize';
const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

async function applyDocument(tx: Tx, sourceLogId: string, receivedAt: Date, doc: NormalizedDocument) {
  const key = `${doc.storeId}:${doc.kind}:${doc.externalId}`, hash = economicHash(doc);
  // Serializes independent worker instances for the same external document.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`HRM-COMMISSION-${doc.storeId}`}))`;
  const priorEvent = await tx.hrmCommissionEvent.findUnique({ where: { fingerprint: hash } });
  if (priorEvent) return;
  requireValue(await tx.store.findUnique({ where: { id: doc.storeId }, select: { id: true } }), 'STORE_MAPPING_REQUIRED');
  let document = await tx.hrmCommissionDocument.findUnique({ where: { key } });
  if (document) {
    if (doc.updatedAt && document.sourceUpdatedAt && doc.updatedAt < document.sourceUpdatedAt) return;
    if (!doc.cancelled) {
      requireValue(document.status !== 'CANCELLED', 'CANCELLED_DOCUMENT_CANNOT_REOPEN_AUTOMATICALLY');
      requireValue(doc.updatedAt && (!document.sourceUpdatedAt || doc.updatedAt > document.sourceUpdatedAt), 'UNVERSIONED_OR_CONFLICTING_DOCUMENT_UPDATE');
    }
    requireValue(document.occurredAt.getTime() === doc.occurredAt.getTime(), 'ORIGINAL_DOCUMENT_DATE_CHANGED');
  } else {
    document = await tx.hrmCommissionDocument.create({ data: { key, externalId: doc.externalId, invoiceNumber: doc.invoiceNumber == null ? null : String(doc.invoiceNumber),
      kind: doc.kind, storeId: doc.storeId, occurredAt: doc.occurredAt, sourceUpdatedAt: doc.updatedAt, lastHash: hash, status: doc.cancelled ? 'CANCELLED' : 'ACTIVE' } });
  }
  const event = await tx.hrmCommissionEvent.create({ data: { fingerprint: hash, sourceLogId, documentId: document.id, occurredAt: doc.updatedAt ?? doc.occurredAt, receivedAt } });
  const existing = await tx.hrmCommissionLine.findMany({ where: { documentId: document.id } });
  const changed = new Set<string>();

  async function record(line: HrmCommissionLine, quantity: Prisma.Decimal, revenue: Prisma.Decimal, commission: Prisma.Decimal, saleDate = doc.occurredAt, sign = doc.kind === 'REFUND' ? -1 : 1) {
    const dq = quantity.minus(line.quantity), dr = revenue.minus(line.eligibleRevenue), dc = commission.minus(line.commissionAmount);
    if (dq.isZero() && dr.isZero() && dc.isZero()) return;
    await tx.hrmCommissionLedger.create({ data: {
      eventId: event.id, lineId: line.id, documentId: line.documentId, storeId: doc.storeId,
      subcategoryId: line.subcategoryId, subcategoryName: line.subcategoryName, type: line.type, rate: line.rate, basis: line.basis, fixedBasis: line.fixedBasis,
      quantity: dq.mul(sign), eligibleRevenue: dr.mul(sign), commissionAmount: dc.mul(sign), saleDate, postedAt: receivedAt,
      snapshot: { sourceLogId, invoice: doc.externalId, externalLineId: line.externalLineId, productId: line.productId, variantId: line.variantId,
        originalSaleLineId: line.originalSaleLineId, rateId: line.rateId, originalQuantity: line.quantity.toString(), newQuantity: quantity.toString(),
        previousRevenue: line.eligibleRevenue.toString(), newRevenue: revenue.toString(), previousCommission: line.commissionAmount.toString(), newCommission: commission.toString() },
    } });
    await tx.hrmCommissionLine.update({ where: { id: line.id }, data: { quantity, eligibleRevenue: revenue, commissionAmount: commission } });
  }

  for (const source of doc.lines) {
    let line = existing.find(l => l.externalLineId === source.id);
    let policy: { id: string; subcategoryId: string; type: string; rate: Prisma.Decimal; basis: string; fixedBasis: string };
    let subcategoryName: string;
    let original: HrmCommissionLine | undefined;
    let saleDate = doc.occurredAt;
    if (doc.kind === 'REFUND') {
      const invoiceId = source.originalInvoiceId ?? doc.originalInvoiceId;
      requireValue(invoiceId, 'ORIGINAL_INVOICE_REFERENCE_MISSING');
      const originalDocs = await tx.hrmCommissionDocument.findMany({ where: { storeId: doc.storeId, kind: 'SALE', OR: [{ externalId: String(invoiceId) }, { invoiceNumber: String(invoiceId) }] } });
      requireValue(originalDocs.length === 1 && originalDocs[0].status === 'ACTIVE', 'ORIGINAL_SALE_NOT_FOUND_OR_CANCELLED');
      const candidates = await tx.hrmCommissionLine.findMany({ where: { documentId: originalDocs[0].id,
        ...(source.originalLineId ? { externalLineId: String(source.originalLineId) } : { productId: source.productId, variantId: source.variantId }) } });
      requireValue(candidates.length === 1, 'ORIGINAL_SALE_LINE_AMBIGUOUS_OR_MISSING');
      original = candidates[0];
      requireValue(original.quantity.gt(0) && original.productId === source.productId && original.variantId === source.variantId, 'ORIGINAL_PRODUCT_MISMATCH_OR_REMOVED');
      saleDate = originalDocs[0].occurredAt;
      requireValue(!line || line.originalSaleLineId === original.id, 'REFUND_REFERENCE_CHANGED');
      policy = { ...original, id: original.rateId }; subcategoryName = original.subcategoryName;
    } else if (line) {
      requireValue(line.productId === source.productId && line.variantId === source.variantId, 'SALE_LINE_ID_REUSED_FOR_DIFFERENT_PRODUCT');
      policy = { ...line, id: line.rateId }; subcategoryName = line.subcategoryName;
    } else {
      let subcategory;
      if (source.subcategoryExternalId) {
        subcategory = await tx.hrmCommissionSubcategory.findUnique({ where: { externalId: source.subcategoryExternalId } });
        if (!subcategory && source.subcategoryName) subcategory = await tx.hrmCommissionSubcategory.create({ data: {
          externalId: source.subcategoryExternalId, name: String(source.subcategoryName), categoryExternalId: source.categoryExternalId == null ? null : String(source.categoryExternalId),
        } });
      } else {
        const mapping = await tx.hrmCommissionMapping.findFirst({ where: { productId: source.productId, variantId: source.variantId, effectiveFrom: { lte: doc.occurredAt } }, orderBy: { effectiveFrom: 'desc' } });
        if (mapping) subcategory = await tx.hrmCommissionSubcategory.findUnique({ where: { id: mapping.subcategoryId } });
      }
      requireValue(subcategory, 'SUBCATEGORY_MAPPING_REQUIRED');
      const rates = await tx.hrmCommissionRate.findMany({ where: { subcategoryId: subcategory.id, storeKey: { in: [0, doc.storeId] }, effectiveFrom: { lte: doc.occurredAt } }, orderBy: [{ storeKey: 'desc' }, { effectiveFrom: 'desc' }] });
      requireValue(rates.length, 'HISTORICAL_OR_CURRENT_RATE_MISSING');
      policy = rates[0]; subcategoryName = subcategory.name;
    }
    let revenue = policy.basis === 'NET_EX_TAX' ? source.exTax : source.inclTax;
    if (original && revenue === undefined) {
      requireValue(!source.unverifiedAmount, 'REFUND_AMOUNT_BASIS_UNVERIFIED');
      revenue = money(original.eligibleRevenue.mul(source.quantity).div(original.quantity));
    }
    requireValue(revenue !== undefined, 'DISCOUNTED_NET_AMOUNT_BASIS_UNVERIFIED');
    let commission = revenue.isZero() ? new D(0) : earning(revenue, source.quantity, policy);
    if (original) {
      const otherReturns = await tx.hrmCommissionLine.findMany({ where: { originalSaleLineId: original.id, ...(line ? { id: { not: line.id } } : {}) } });
      const total = otherReturns.reduce((sum, l) => ({ quantity: sum.quantity.plus(l.quantity), revenue: sum.revenue.plus(l.eligibleRevenue), commission: sum.commission.plus(l.commissionAmount) }), { quantity: new D(0), revenue: new D(0), commission: new D(0) });
      requireValue(total.quantity.plus(source.quantity).lte(original.quantity) && total.revenue.plus(revenue).lte(original.eligibleRevenue), 'REFUND_EXCEEDS_ORIGINAL_SALE');
      const cumulative = policy.type === 'FIXED'
        ? money(original.commissionAmount.mul(total.quantity.plus(source.quantity)).div(original.quantity))
        : original.eligibleRevenue.isZero() ? new D(0) : money(original.commissionAmount.mul(total.revenue.plus(revenue)).div(original.eligibleRevenue));
      commission = cumulative.minus(total.commission);
      requireValue(commission.gte(0) && total.commission.plus(commission).lte(original.commissionAmount), 'REFUND_COMMISSION_EXCEEDS_ORIGINAL');
    } else if (line && (!line.quantity.equals(source.quantity) || !line.eligibleRevenue.equals(revenue))) {
      requireValue(!(await tx.hrmCommissionLine.count({ where: { originalSaleLineId: line.id, quantity: { gt: 0 } } })), 'SALE_REVISION_AFTER_REFUND_REQUIRES_RECONCILIATION');
    }
    if (!line) line = await tx.hrmCommissionLine.create({ data: { documentId: document.id, externalLineId: source.id,
      productId: source.productId, variantId: source.variantId, subcategoryId: policy.subcategoryId, subcategoryName,
      rateId: policy.id, type: policy.type, rate: policy.rate, basis: policy.basis, fixedBasis: policy.fixedBasis,
      quantity: 0, eligibleRevenue: 0, commissionAmount: 0, originalSaleLineId: original?.id } });
    await record(line, source.quantity, revenue, commission, saleDate); changed.add(line.id);
  }
  for (const line of existing.filter(l => !changed.has(l.id))) {
    const children = doc.kind === 'SALE' ? await tx.hrmCommissionLine.findMany({ where: { originalSaleLineId: line.id, quantity: { gt: 0 } } }) : [];
    requireValue(doc.cancelled || !children.length, 'REMOVED_SALE_LINE_HAS_REFUNDS');
    for (const refund of children) await record(refund, new D(0), new D(0), new D(0), document.occurredAt, -1);
    await record(line, new D(0), new D(0), new D(0), doc.kind === 'REFUND' && line.originalSaleLineId
      ? (await tx.hrmCommissionDocument.findUniqueOrThrow({ where: { id: (await tx.hrmCommissionLine.findUniqueOrThrow({ where: { id: line.originalSaleLineId } })).documentId } })).occurredAt : document.occurredAt);
  }
  await tx.hrmCommissionDocument.update({ where: { id: document.id }, data: { lastHash: hash, status: doc.cancelled ? 'CANCELLED' : 'ACTIVE', sourceUpdatedAt: doc.updatedAt ?? document.sourceUpdatedAt } });
}

export async function processStoredLog(sourceLogId: string) {
  const source = await prisma.hopkidWebhookLog.findUniqueOrThrow({ where: { id: sourceLogId } });
  const settings = await prisma.hrmCommissionSettings.findUnique({ where: { id: 1 } });
  requireValue(settings?.enabled, 'HRM_COMMISSION_IMPORT_DISABLED');
  const inbox = await prisma.hrmCommissionInbox.upsert({ where: { sourceLogId }, create: { sourceLogId }, update: {} });
  if (inbox.status === 'PROCESSED' || inbox.status === 'IGNORED') return inbox;
  try {
    const raw = JSON.parse(source.rawPayload);
    const documents = normalizeDocuments(raw, settings);
    await prisma.$transaction(async tx => {
      for (const doc of documents) await applyDocument(tx, sourceLogId, source.createdAt, doc);
      await tx.hrmCommissionInbox.update({ where: { id: inbox.id }, data: { status: 'PROCESSED', error: null, processedAt: new Date() } });
    }, { timeout: 30000 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.hrmCommissionInbox.update({ where: { id: inbox.id }, data: { status: message === 'UNSUPPORTED_EVENT' ? 'IGNORED' : 'EXCEPTION', error: message } });
    if (!(e instanceof CommissionInputError) && !(e instanceof SyntaxError)) console.error('[HRM commission projection]', message);
  }
  return prisma.hrmCommissionInbox.findUniqueOrThrow({ where: { id: inbox.id } });
}

let running = false;
export async function projectStoredHopkidLogs() {
  if (running) return { processed: 0 };
  running = true;
  try {
    const settings = await prisma.hrmCommissionSettings.findUnique({ where: { id: 1 } });
    if (!settings?.enabled) return { processed: 0 };
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT l.id FROM "HopkidWebhookLog" l WHERE l."createdAt">=${settings.ingestSince}
      AND NOT EXISTS (SELECT 1 FROM "HrmCommissionInbox" i WHERE i."sourceLogId"=l.id)
      ORDER BY l."createdAt",l.id LIMIT 100`);
    for (const row of rows) await processStoredLog(row.id);
    return { processed: rows.length };
  } finally { running = false; }
}
