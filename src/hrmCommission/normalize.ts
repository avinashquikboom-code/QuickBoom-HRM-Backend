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
export function date(value: unknown, field: string, timeZone?: string) {
  requireValue(typeof value === 'string' || value instanceof Date, `${field}_MISSING`);
  if (value instanceof Date) {
    requireValue(Number.isFinite(value.getTime()), `${field}_INVALID`);
    return value;
  }
  const raw=value.trim();
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(raw);
  const qualified=/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  // Date-only values retain the existing IST calendar-day contract. Local clocks
  // require a verified source/store zone; UTC receipt times cannot supply it.
  if (!qualified && !dateOnly) requireValue(timeZone, `${field}_TIMEZONE_REQUIRED`);
  const local=/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/.exec(raw);
  if (!qualified) {
    requireValue(local, `${field}_INVALID`);
    const [year,month,day,hour,minute,second]=[local[1],local[2],local[3],local[4]??'0',local[5]??'0',local[6]??'0'].map(Number);
    const ms=Number((local[7]??'').padEnd(3,'0').slice(0,3));
    const wall=new Date(Date.UTC(year,month-1,day,hour,minute,second,ms));
    requireValue(wall.getUTCFullYear()===year&&wall.getUTCMonth()===month-1&&wall.getUTCDate()===day&&hour<24&&minute<60&&second<60,`${field}_INVALID`);
    if (!timeZone && dateOnly) return new Date(wall.getTime()-19800000);
    if (timeZone && /^[+-]\d{2}:?\d{2}$/.test(timeZone)) return date(`${wall.toISOString().slice(0,-1)}${timeZone}`,field);
    let formatter: Intl.DateTimeFormat;
    try { formatter=new Intl.DateTimeFormat('en-GB',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
    catch { throw new CommissionInputError(`${field}_TIMEZONE_INVALID`); }
    const offset=(instant:number)=>{
      const parts=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
      return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second))-Math.floor(instant/1000)*1000;
    };
    const target=wall.getTime();
    const offsets=new Set([offset(target-86400000),offset(target),offset(target+86400000)]);
    const candidates=[...offsets].map(delta=>target-delta).filter(instant=>instant+offset(instant)===target);
    requireValue(candidates.length===1,`${field}_TIMEZONE_AMBIGUOUS_OR_NONEXISTENT`);
    return new Date(candidates[0]);
  }
  requireValue(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw),`${field}_INVALID`);
  const clock=/[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw)!;
  requireValue(Number(clock[1])<24&&Number(clock[2])<60&&Number(clock[3]??0)<60,`${field}_INVALID`);
  const parsed=new Date(raw.replace(' ','T'));
  requireValue(Number.isFinite(parsed.getTime()),`${field}_INVALID`);
  // Reject Date's rollover of e.g. February 30 even when an offset is supplied.
  const calendar=raw.slice(0,10), check=new Date(`${calendar}T00:00:00Z`);
  requireValue(Number.isFinite(check.getTime())&&check.toISOString().slice(0,10)===calendar,`${field}_INVALID`);
  return parsed;
}
export type SourceContract = { netField: string; netBasis: string; discounted: boolean; timeZone?: string };
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
  const storeId = Number(pick(inv, ['storeId', 'StoreID', 'branchId', 'BranchID']) ?? pick(data, ['storeId', 'StoreID', 'branchId', 'BranchID']) ?? pick(raw, ['storeId', 'StoreID', 'branchId', 'BranchID']));
  requireValue(Number.isSafeInteger(storeId) && storeId > 0, 'STORE_ID_MISSING');
  const occurredAt = date(
    pick(inv, refund
      ? ['creditDate', 'date', 'createdAt', 'created_at']
      : ['invoiceDate', 'saleDate', 'generatedDate', 'date', 'createdAt', 'created_at', 'invoice_date', 'sale_date', 'generated_date']
    ) ?? pick(data, refund
      ? ['creditDate', 'date', 'createdAt', 'created_at']
      : ['invoiceDate', 'saleDate', 'generatedDate', 'date', 'createdAt', 'created_at', 'invoice_date', 'sale_date', 'generated_date']
    ),
    'SALE_DATE', contract.timeZone
  );
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
    if (!exTax && !inclTax && item[contract.netField] !== undefined && ['NET_EX_TAX','NET_INCL_TAX'].includes(contract.netBasis)) {
      const value=decimal(item[contract.netField],'CONTRACT_NET_AMOUNT');
      if(contract.netBasis==='NET_EX_TAX') { exTax=value; if(tax!==undefined) inclTax=value.plus(decimal(tax,'TAX')); }
      else { inclTax=value; if(tax!==undefined) {const t=decimal(tax,'TAX');requireValue(value.gte(t),'TAX_EXCEEDS_NET');exTax=value.minus(t);} }
    }
    const subId = extractProductLineMeta(item).subcategoryId;
    return { id, productId, variantId, quantity, exTax, inclTax,
      unverifiedAmount: !exTax && !inclTax && pick(item, ['creditAmount', 'productNetAmount', 'netAmount', 'lineTotal', 'amount', 'refundAmount']) !== undefined,
      subcategoryExternalId: subId == null ? undefined : identifier(subId, 'SUBCATEGORY_ID'),
      subcategoryName: extractProductLineMeta(item).subcategoryName ?? pick(item, ['subcategoryName', 'subCategoryName', 'SubCategoryName', 'subcategory', 'Subcategory', 'subCategory', 'SubCategory']),
      categoryExternalId: pick(item, ['categoryId', 'CategoryID']),
      originalLineId: pick(item, ['originalSaleItemId', 'originalLineId', 'originalSalesProductId']),
      originalInvoiceId: pick(item, ['originalInvoiceId', 'originalBillId']) ?? originalInvoiceId };
  });
  requireValue(lines.length <= 1000, 'TOO_MANY_LINES');
  requireValue(new Set(lines.map(l => l.id)).size === lines.length, 'AMBIGUOUS_DUPLICATE_PRODUCT_LINES');
  return { externalId, invoiceNumber: pick(inv, ['invoiceNo', 'invoiceNumber', 'billNumber']), kind: refund ? 'REFUND' : 'SALE', storeId, occurredAt, updatedAt: revision ? date(revision, 'REVISION_DATE', contract.timeZone) : undefined,
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
