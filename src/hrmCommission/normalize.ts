import { extractProductLineMeta } from '../utils/productLineMeta';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
const D = Prisma.Decimal;
export class CommissionInputError extends Error {}
export function requireValue(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new CommissionInputError(reason);
}
export const pick = (v: any, names: string[]) => names.map(k => v?.[k]).find(x => x !== undefined && x !== null && x !== '');
export function identifier(value: unknown, field: string) {
  requireValue((typeof value === 'string' || typeof value === 'number') && String(value).trim().length > 0 && String(value).length <= 200, `${field}_MISSING`);
  return String(value).trim();
}
export function decimal(value: unknown, field: string) {
  requireValue(typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)), `${field}_INVALID`);
  const n = new D(String(value)); requireValue(n.isFinite() && n.gte(0), `${field}_INVALID`); return n;
}
export function date(value: unknown, field: string) {
  requireValue(typeof value === 'string' || value instanceof Date, `${field}_MISSING`);
  // Date-only upstream values are IST calendar days. Never use the server's local timezone.
  if (typeof value === 'string') requireValue(/^\d{4}-\d{2}-\d{2}$/.test(value) || /(?:Z|[+-]\d{2}:\d{2})$/.test(value), `${field}_TIMEZONE_REQUIRED`);
  const d = new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+05:30` : value as string);
  requireValue(Number.isFinite(d.getTime()), `${field}_INVALID`); if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) requireValue(new Date(d.getTime()+19800000).toISOString().slice(0,10) === value, `${field}_INVALID`);
  return d;
}
export type SourceContract = { netField: string; netBasis: string; discounted: boolean };
export type NormalizedLine = { id: string; productId: string; variantId: string; quantity: Prisma.Decimal;
  subcategoryExternalId?: string; subcategoryName?: string; categoryExternalId?: string;
  exTax?: Prisma.Decimal; inclTax?: Prisma.Decimal; unverifiedAmount?: boolean; originalLineId?: string; originalInvoiceId?: string };
export type NormalizedDocument = { externalId: string; invoiceNumber?: string; kind: 'SALE' | 'REFUND'; storeId: number; occurredAt: Date;
  updatedAt?: Date; cancelled: boolean; lines: NormalizedLine[]; originalInvoiceId?: string };
export function normalizePayload(raw: any, contract: SourceContract): NormalizedDocument {
  const data = raw.data ?? raw;
  const event = String(raw.eventType ?? raw.topic ?? raw.event ?? '').toUpperCase().replace(/[. -]/g, '_');
  requireValue(!event.includes('EXCHANGE'), 'EXCHANGE_REQUIRES_LINKED_SALE_AND_RETURN_DOCUMENTS');
  const refund = event.includes('CREDIT') || event.includes('REFUND') || !!data.creditNote;
  const inv = refund ? data.creditNote ?? data : data.invoice ?? data;
  requireValue(refund || event.includes('INVOICE') || event.includes('SALE') || !!data.invoice || !!pick(data, ['invoiceId','invoiceNo','billId']), 'UNSUPPORTED_EVENT');
  const externalId = identifier(pick(inv, refund ? ['creditNoteNo', 'cnNo', 'CreditNoteNo', 'id'] : ['invoiceId', 'InvoiceID', 'salesID', 'SalesID', 'billId', 'invoiceNo', 'invoiceNumber']) ?? pick(data, ['billId', 'invoiceNo']), 'DOCUMENT_ID');
  const storeId = Number(pick(inv, ['storeId', 'StoreID', 'branchId', 'BranchID']) ?? pick(data, ['storeId', 'StoreID', 'branchId', 'BranchID']));
  requireValue(Number.isSafeInteger(storeId) && storeId > 0, 'STORE_ID_MISSING');
  const occurredAt = date(pick(inv, refund ? ['creditDate', 'date', 'createdAt'] : ['invoiceDate', 'saleDate', 'date', 'createdAt']), 'SALE_DATE');
  const revision = pick(inv, ['updatedAt', 'modifiedAt', 'lastModifiedAt']);
  const status = String(inv.status ?? data.status ?? (event.includes('CANCEL') || event.includes('DELET') ? 'CANCELLED' : 'ACTIVE')).toUpperCase();
  requireValue(['ACTIVE', 'COMPLETED', 'PAID', 'APPROVED', 'CANCELLED', 'CANCELED', 'CANCEL', 'DELETED', 'INACTIVE', 'RETURNED', 'RETURN', 'PARTIALLY_RETURNED'].includes(status), 'UNRECOGNIZED_SALE_STATUS');
  const cancelled = ['CANCELLED', 'CANCELED', 'CANCEL', 'DELETED', 'INACTIVE', 'RETURNED', 'RETURN'].includes(status);
  const items = pick(inv, ['lineItems', 'items', 'products', 'SalesProductList', 'CreditNoteProducts']) ?? pick(data, ['lineItems', 'items', 'products', 'SalesProductList', 'CreditNoteProducts']) ?? pick(raw, ['lineItems', 'SalesProductList', 'CreditNoteProducts']);
  requireValue(cancelled || (Array.isArray(items) && items.length > 0), 'PRODUCT_LINES_MISSING');
  const originalInvoiceId = refund ? pick(inv, ['originalInvoiceId', 'originalBillId', 'salesID', 'SalesID', 'invoiceNo', 'invoiceNumber']) : undefined;
  const lines: NormalizedLine[] = cancelled ? [] : items.map((item: any): NormalizedLine => {
    requireValue(![true, 1, '1', 'true'].includes(pick(item, ['IsOld', 'isOld'])), 'EXCHANGE_LINE_REQUIRES_EXPLICIT_DOCUMENT_LINK');
    const productId = identifier(pick(item, ['productID', 'productId', 'ProductID', 'product_id', 'item_id', 'itemId']), 'PRODUCT_ID');
    // Upstream Guid.Empty is a missing identity, not a catalog product that can be mapped.
    requireValue(productId !== '00000000-0000-0000-0000-000000000000', 'PRODUCT_ID_MISSING');
    const variantId = String(pick(item, ['variantId', 'variantID', 'VariantId', 'VariantID', 'sku', 'SKU']) ?? '');
    const id = identifier(pick(item, ['saleItemId', 'lineItemId', 'lineId', 'SalesProductID', 'creditNoteLineId']) ?? `${productId}:${variantId}`, 'LINE_ID');
    const quantity = decimal(pick(item, ['quantity', 'qty', 'Qty', 'Quantity']), 'QUANTITY'); requireValue(quantity.gt(0), 'QUANTITY_INVALID');
    let exTax: Prisma.Decimal | undefined, inclTax: Prisma.Decimal | undefined;
    if (pick(item, ['netAmountExTax', 'taxableAmount']) !== undefined) exTax = decimal(pick(item, ['netAmountExTax', 'taxableAmount']), 'NET_EX_TAX');
    if (item.netAmountInclTax !== undefined) inclTax = decimal(item.netAmountInclTax, 'NET_INCL_TAX');
    const tax = pick(item, ['taxTotal', 'taxAmount', 'gstAmount']);
    if (tax !== undefined) {
      const t = decimal(tax, 'TAX');
      if (exTax && !inclTax) inclTax = exTax.plus(t);
      if (inclTax && !exTax) { requireValue(inclTax.gte(t), 'TAX_EXCEEDS_NET'); exTax = inclTax.minus(t); }
      if (exTax && inclTax) requireValue(inclTax.minus(exTax).equals(t), 'TAX_TOTAL_MISMATCH');
    }
    if (!exTax && !inclTax && item[contract.netField] !== undefined && contract.discounted && ['NET_EX_TAX','NET_INCL_TAX'].includes(contract.netBasis)) {
      const value=decimal(item[contract.netField],'CONTRACT_NET_AMOUNT');
      if(contract.netBasis==='NET_EX_TAX') { exTax=value; if(tax!==undefined) inclTax=value.plus(decimal(tax,'TAX')); }
      else { inclTax=value; if(tax!==undefined) {const t=decimal(tax,'TAX');requireValue(value.gte(t),'TAX_EXCEEDS_NET');exTax=value.minus(t);} }
    }
    const subId = extractProductLineMeta(item).subcategoryId;
    return { id, productId, variantId, quantity, exTax, inclTax,
      unverifiedAmount: !exTax && !inclTax && pick(item, ['creditAmount', 'productNetAmount', 'netAmount', 'lineTotal', 'amount', 'refundAmount']) !== undefined,
      subcategoryExternalId: subId == null ? undefined : identifier(subId, 'SUBCATEGORY_ID'),
      subcategoryName: pick(item, ['subcategoryName', 'subCategoryName', 'SubCategoryName']),
      categoryExternalId: pick(item, ['categoryId', 'CategoryID']),
      originalLineId: pick(item, ['originalSaleItemId', 'originalLineId', 'originalSalesProductId']),
      originalInvoiceId: pick(item, ['originalInvoiceId', 'originalBillId']) ?? originalInvoiceId };
  });
  requireValue(lines.length <= 1000, 'TOO_MANY_LINES');
  requireValue(new Set(lines.map(l => l.id)).size === lines.length, 'AMBIGUOUS_DUPLICATE_PRODUCT_LINES');
  return { externalId, invoiceNumber: pick(inv, ['invoiceNo', 'invoiceNumber', 'billNumber']), kind: refund ? 'REFUND' : 'SALE', storeId, occurredAt, updatedAt: revision ? date(revision, 'REVISION_DATE') : undefined,
    cancelled, lines, originalInvoiceId: originalInvoiceId == null ? undefined : String(originalInvoiceId) };
}
export function economicHash(doc: NormalizedDocument) {
  return createHash('sha256').update(JSON.stringify({ ...doc, lines: [...doc.lines].sort((a,b) => a.id.localeCompare(b.id)) })).digest('hex');
}
export const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, D.ROUND_HALF_UP);
export function earning(revenue: Prisma.Decimal, quantity: Prisma.Decimal, policy: { type: string; rate: Prisma.Decimal; fixedBasis: string }) {
  return money(policy.type === 'PERCENTAGE' ? revenue.mul(policy.rate).div(100) : policy.rate.mul(policy.fixedBasis === 'UNIT' ? quantity : 1));
}

export function normalizeDocuments(raw: any, contract: SourceContract): NormalizedDocument[] {
  const event = String(raw.eventType ?? raw.topic ?? raw.event ?? '').toUpperCase();
  if (!event.includes('EXCHANGE')) return [normalizePayload(raw, contract)];
  const data = raw.data ?? raw, exchange = data.salesExchange ?? raw.salesExchange;
  requireValue(exchange, 'EXCHANGE_DETAILS_MISSING');
  const id = identifier(pick(exchange, ['exchangeNo', 'salesExchangeId', 'id']), 'EXCHANGE_ID');
  const items = pick(exchange, ['lineItems', 'items']) ?? data.SalesExchangeProductList ?? raw.SalesExchangeProductList;
  requireValue(Array.isArray(items) && items.length > 0, 'EXCHANGE_PRODUCT_LINES_MISSING');
  const old: any[] = [], sold: any[] = [];
  for (const item of items) {
    const flag = pick(item, ['IsOld', 'isOld']);
    requireValue([true, false, 1, 0, '1', '0', 'true', 'false'].includes(flag), 'EXCHANGE_LINE_DIRECTION_MISSING');
    const { IsOld: _old, isOld: _lower, ...line } = item;
    ([true, 1, '1', 'true'].includes(flag) ? old : sold).push(line);
  }
  const common = { storeId: pick(exchange, ['storeId', 'branchId']) ?? data.storeId, updatedAt: exchange.updatedAt, status: exchange.status,
    date: pick(exchange, ['exchangeDate', 'date', 'createdAt']) };
  const originalInvoiceId = pick(exchange, ['originalInvoiceId', 'originalInvoiceNo', 'originalBillId', 'salesID', 'SalesID']);
  const docs: NormalizedDocument[] = [];
  if (old.length) docs.push(normalizePayload({ eventType: 'CREDIT_NOTE_CREATED', data: { creditNote: {
    ...common, creditNoteNo: `EXCHANGE:${id}:RETURN`, originalInvoiceId, lineItems: old,
  } } }, contract));
  if (sold.length) docs.push(normalizePayload({ eventType: 'INVOICE_CREATED', data: { invoice: {
    ...common, invoiceId: `EXCHANGE:${id}:SALE`, invoiceNo: exchange.newInvoiceNo ?? exchange.exchangeNo, lineItems: sold,
  } } }, contract));
  return docs;
}
