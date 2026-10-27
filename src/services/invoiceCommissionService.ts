import { resolveInvoiceSaleTime } from './invoiceSaleTime';
import { recoverSavedInvoiceItems, recoverInvoiceItemIdentities } from './invoiceItemRecovery';
import { CommissionTransaction, Prisma } from '@prisma/client';
import { prisma } from '../utils/db';
import { extractWebhookMeta, fetchHopkidInvoiceDetails, getNumericInvoiceNumber, parseIsOld } from '../utils/commissionHelper';
import { extractProductLineMeta } from '../utils/productLineMeta';
import { normalizePayload, money, earning, NormalizedLine } from '../hrmCommission/normalize';
import { resolveSubcategory, resolveSubcategoryRate } from '../hrmCommission/resolution';
const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;
const frozen = (sale: CommissionTransaction | null) => !!sale && ['APPROVED','PAID'].includes(sale.status);
export const isExternalInvoice = (sale: CommissionTransaction) => (!sale.eventType || ['INVOICE_CREATED','INVOICE_UPDATED'].includes(sale.eventType)) && !/^(POS|RKD)[-A-Z]*-/i.test(sale.billId ?? '');
const list = (value: unknown): any[] => Array.isArray(value) ? value.filter(x => x && typeof x === 'object') : [];
const finite = (n: unknown) => (typeof n === 'number' || typeof n === 'string') && n !== '' && Number.isFinite(Number(n));
function amount(n: unknown): number | null { return finite(n) ? Number(n) : null; }
const messages: Record<string,string> = {
  PRODUCT_VARIANT_AMBIGUOUS: 'The invoice variant matches conflicting catalog identifiers. Verify the product variant mapping.',
  SUBCATEGORY_MAPPING_REQUIRED: 'No verified subcategory mapping is effective for this product and invoice date. Ask an administrator to verify the product ID and create an effective-dated HRM product mapping.',
  SUBCATEGORY_RATE_INACTIVE: 'The applicable subcategory commission rule is inactive. Ask an administrator to create an active rule effective for this invoice date.',
  HISTORICAL_OR_CURRENT_RATE_MISSING: 'No subcategory commission configuration is effective on the invoice date.',
  DISCOUNTED_NET_AMOUNT_BASIS_UNVERIFIED: 'Discounted eligible sales and GST basis need verification.',
  HISTORICAL_SNAPSHOT_MISSING: 'Saved approved item commissions are unavailable. The approved amount has not been recalculated.',
  HISTORICAL_TOTAL_MISMATCH: 'Saved item commissions do not reconcile to the approved amount. Accounting review is required.',
};
export function summarizeInvoiceLines(lines: any[], state = 'COMPLETE') {
  lines = lines.map(line => ({...line,
    productId:line.productID ?? line.productId ?? null,
    unitPrice:line.unitPrice ?? invoiceUnitPrice(line),
    totalAmount:line.totalAmount ?? line.saleAmount ?? null,
    commissionEarned:line.commissionAmount,
    rateDisplay:line.commissionRate == null ? null : (line.commissionType === 'FIXED' || (line.commissionRate === 0 && (line.commissionAmount ?? 0) > 0))
      ? `₹${(line.commissionRate !== null && line.commissionRate > 0) ? line.commissionRate : line.commissionAmount} / ${line.fixedBasis === 'LINE' ? 'line' : 'unit'}` : `${line.commissionRate}%`,
  }));
  const complete = lines.length > 0 && lines.every(l => l.commissionAmount !== null && l.commissionState === 'CONFIGURED');
  const total = complete ? money(lines.reduce((sum,l) => sum.plus(String(l.commissionAmount)),new D(0))).toNumber() : null;
  const rates = new Set(lines.filter(l => l.commissionRate !== null).map(l => `${l.commissionType}:${l.commissionRate}:${l.fixedBasis}`));
  const uniform = lines.length > 0 && lines.every(l=>l.commissionRate!==null) && rates.size === 1;
  const rate = uniform ? lines[0].commissionRate : null;
  const missingConfiguration = lines.some(l=>['SUBCATEGORY_MAPPING_REQUIRED','HISTORICAL_OR_CURRENT_RATE_MISSING','SUBCATEGORY_RATE_INACTIVE'].includes(l.missingReason));
  const missingData = !complete && !missingConfiguration;
  const isUniformFixed = uniform && (lines[0].commissionType === 'FIXED' || (rate === 0 && total !== null && total > 0));
  const uniformFixedRate = (rate !== null && rate > 0) ? rate : total;
  return { commissionSource:complete?'SUBCATEGORY':'UNRESOLVED', commissionState:complete?state:missingData?'INVOICE_DATA_MISSING':'MISSING_CONFIGURATION',
    commissionAmount:total,commissionEarned:total,totalCommission:total,newCommission:total,calculatedCommissionAmount:total,
    commissionRate:rate,commissionPercent:rate,commissionPercentage:rate,
    rateDisplay:uniform?(isUniformFixed?`₹${uniformFixedRate} / ${lines[0].fixedBasis==='LINE'?'line':'unit'}`:`${rate}%`):complete?'Multiple subcategory rates':missingData?(lines.some(l=>String(l.missingReason??'').startsWith('SALE_DATE'))?'Invoice sale timestamp unavailable':lines.some(l=>l.missingReason==='STORE_ID_MISSING')?'Invoice store mapping unavailable':'Invoice item data unavailable'):'Configuration required',
    eligibleSaleAmount:complete&&lines.every(l=>l.eligibleSaleAmount!==null)?money(lines.reduce((n,l)=>n.plus(String(l.eligibleSaleAmount)),new D(0))).toNumber():null,
    hasUnresolvedInvoiceItems:!complete,hasMissingConfiguration:missingConfiguration,hasMissingInvoiceData:missingData,productCommissionBreakdown:lines,productWiseCommission:lines };
}
// Canonical null/zero must not be replaced by a legacy alias or a current rate.
function savedNumber(row: any, keys: string[]): number | null {
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(row,key)) return amount(row[key]);
  return null;
}
function normalizeRecordedItem(row: any) {
  return {...row,
    commissionRate:savedNumber(row,['commissionRate','commissionPercent','commissionPercentage','productCommissionRate','directCommissionRate','CommissionRate','commission_rate']),
    commissionAmount:savedNumber(row,['commissionAmount','productCommission','commissionEarned','earnedCommission','directCommissionAmount','CommissionAmount','commission_amount']),
  };
}

function matchingInvoiceItem(items: any[], reference: any): any | null {
  const product=extractProductLineMeta(reference).productId;
  const lineId=reference.saleItemId ?? reference.lineItemId ?? reference.lineId;
  const variant=reference.variantId ?? reference.variantID ?? reference.VariantID ?? extractProductLineMeta(reference).sku;
  const sameProduct=(item:any)=>product==null || String(extractProductLineMeta(item).productId)===String(product);
  if(lineId!=null) {
    const exact=items.filter(item=>String(item.saleItemId??item.lineItemId??item.lineId??'')===String(lineId) && sameProduct(item));
    if(exact.length===1) return exact[0];
  }
  if(product==null) return null;
  const matches=items.filter(item=>sameProduct(item) && (variant==null || String(item.variantId??item.variantID??item.VariantID??extractProductLineMeta(item).sku??'')===String(variant)));
  return matches.length===1?matches[0]:null;
}

function invoiceDataMessage(reason: string) {
  if(reason.startsWith('SALE_DATE')) return `Invoice sale timestamp could not be verified (${reason}). Supply its explicit offset or the verified HopKid store/source timezone; receipt time is not a substitute.`;
  if(reason==='STORE_ID_MISSING') return 'Invoice store mapping is unavailable. Verify the HopKid store or branch mapping; product data and configured rates have not been changed.';
  if(reason==='PRODUCT_LINES_MISSING') return 'Invoice item data is unavailable. The saved invoice needs its original product details.';
  if(reason==='PRODUCT_ID_MISSING') return 'The saved product is missing its catalog ID. Its subcategory cannot be verified yet.';
  if(reason==='QUANTITY_INVALID') return 'The saved product quantity is unavailable or invalid.';
  return 'Invoice item data could not be verified. The configured commission rate has not been changed.';
}
function displayLine(raw: any, index: number) {
  const meta = extractProductLineMeta(raw);
  const lineAmt = amount(raw.saleAmount ?? raw.eligibleSaleAmount ?? raw.productNetAmount ?? raw.netAmountInclTax ?? raw.netAmountExTax ?? raw.taxableAmount ?? raw.netAmount ?? raw.lineTotal ?? raw.amount ?? (raw.unitPrice != null ? Number(raw.unitPrice) * Number(raw.quantity ?? raw.qty ?? 1) : null));
  return { saleItemId: String(raw.saleItemId ?? raw.lineItemId ?? raw.lineId ?? `${meta.productId ?? index}:${raw.variantId ?? meta.sku ?? ''}`),
    productID: meta.productId, variantId: String(raw.variantId ?? raw.variantID ?? raw.VariantId ?? raw.VariantID ?? meta.sku ?? ''), productName: meta.productName ?? raw.name ?? 'Product', sku: meta.sku, variant: meta.variant,
    quantity: amount(raw.quantity ?? raw.qty ?? raw.Qty ?? raw.Quantity) ?? 1,
    unitPrice:invoiceUnitPrice(raw),totalAmount:lineAmt,categoryId:meta.rawCategoryId,category:meta.category, subcategoryId: null as string|null, subcategory: null as string|null,
    subcategoryName: raw.subcategoryName ?? raw.subCategoryName ?? raw.SubCategoryName ?? null,
    eligibleSaleAmount: lineAmt, saleAmount: lineAmt, commissionRate: null as number|null,
    commissionAmount: null as number|null, commissionType: null as string|null, fixedBasis: null as string|null,
    rateId: null as string|null, commissionState: 'MISSING_CONFIGURATION', missingReason: 'SUBCATEGORY_MAPPING_REQUIRED',
    configurationMessage: messages.SUBCATEGORY_MAPPING_REQUIRED };
}

/** Derive a unit rate only from verified line data, never the invoice total. */
export function invoiceUnitPrice(line: any): number | null {
  const explicit = amount(line.unitPrice ?? line.productPrice ?? line.price ?? line.rate);
  const quantity = amount(line.quantity ?? line.qty ?? line.Qty ?? line.Quantity);
  const total = amount(line.netAmountInclTax ?? line.netAmountExTax ?? line.taxableAmount ?? line.productNetAmount ?? line.netAmount ?? line.lineTotal ?? line.saleAmount ?? line.eligibleSaleAmount);
  if (explicit !== null && explicit >= 0 && (explicit > 0 || total === null || total === 0)) return explicit;
  return quantity !== null && quantity > 0 && total !== null && total >= 0
    ? money(new D(String(total)).div(String(quantity))).toNumber() : null;
}

async function projectedInvoiceLine(tx: Tx, snapshot: any, base: any) {
  const returns=await tx.hrmCommissionLine.findMany({where:{originalSaleLineId:snapshot.id}});
  const revenue=snapshot.eligibleRevenue.minus(returns.reduce((n,r)=>n.plus(r.eligibleRevenue),new D(0)));
  const commission=snapshot.commissionAmount.minus(returns.reduce((n,r)=>n.plus(r.commissionAmount),new D(0)));
  return {...base,subcategoryId:snapshot.subcategoryId,subcategoryName:snapshot.subcategoryName,subcategory:snapshot.subcategoryName,
    eligibleSaleAmount:revenue.toNumber(),saleAmount:revenue.toNumber(),commissionRate:snapshot.rate.toNumber(),commissionAmount:commission.toNumber(),
    commissionType:snapshot.type,fixedBasis:snapshot.fixedBasis,rateId:snapshot.rateId,basis:snapshot.basis,
    commissionState:'CONFIGURED',missingReason:null,configurationMessage:null};
}

/** Read-only invoice calculation. Approved/paid records are never recalculated using current policy. */
export async function calculateInvoiceCommission(tx: Tx, sale: CommissionTransaction | null, raw: any, context: { storeId: number; at: Date; reference: string; employeeIdentifiers?: string[]; sourceRecordedAt?: Date }) {
  const meta = raw ? extractWebhookMeta(raw) : null;
  // Every calculation entry point must resolve store metadata before normalization.
  // Never let a legacy zero context overwrite a verified invoice store/branch.
  if (!frozen(sale) && (!Number.isSafeInteger(context.storeId) || context.storeId <= 0)) {
    const storeId = await resolveInvoiceStore(tx, {sale, meta,
      aliases:[context.reference,sale?.billId??'',sale?.invoiceNumber??'',String(meta?.invoiceNumber??'')], persist:false});
    if (storeId) context = {...context,storeId};
  }
  const raws = list(meta?.lineItems);
  const saved = list(sale?.productBreakdown).map(normalizeRecordedItem);
  const display = (raws.length ? raws : saved).map(displayLine);
  const recordedTotal = amount(sale?.commissionAmount);
  let recoveredLedger = false;
  const approvalCutoff = sale?.approvedAt ?? sale?.paidAt;
  const ownerKeys = new Set((context.employeeIdentifiers ?? []).map(key=>key.trim().toLowerCase()));
  const rawOwnersMatch = raws.every(line=>{
    const owners=[line.employeeCode,line.employeeId,line.employeeID,line.employeePhoneNo].filter(value=>value!=null && String(value).trim());
    return !owners.length || owners.some(value=>ownerKeys.has(String(value).trim().toLowerCase()));
  });
  const savedReconciles = saved.length>0 && recordedTotal!==null && saved.every(line=>line.commissionAmount!==null) &&
    saved.reduce((total,line)=>total.plus(String(line.commissionAmount)),new D(0)).equals(new D(String(recordedTotal)));
  if (frozen(sale) && rawOwnersMatch && approvalCutoff && recordedTotal !== null &&
      (!savedReconciles || saved.some(line => line.commissionRate === null))) {
    const references=[context.reference,sale!.billId,sale!.invoiceNumber].filter((value):value is string=>Boolean(value));
    const documents=await tx.hrmCommissionDocument.findMany({where:{storeId:context.storeId,kind:'SALE',
      OR:[{externalId:{in:references}},{invoiceNumber:{in:references}}]}});
    if(documents.length===1) {
      const siblings=await tx.commissionTransaction.count({where:{storeId:context.storeId,employeeId:{not:sale!.employeeId},
        OR:[{billId:{in:references}},{invoiceNumber:{in:references}}],eventType:{in:['INVOICE_CREATED','INVOICE_UPDATED']}}});
      if(siblings===0) {
        const entries=await tx.hrmCommissionLedger.findMany({where:{documentId:documents[0].id,storeId:context.storeId,postedAt:{lte:approvalCutoff}},orderBy:[{postedAt:'asc'},{id:'asc'}]});
        const latest=new Map<string,any>();
        let ambiguousLedger=false;
        for(const entry of entries) {
          const previous=latest.get(entry.lineId);
          if(previous && previous.postedAt.getTime()===entry.postedAt.getTime() &&
              (JSON.stringify(previous.snapshot)!==JSON.stringify(entry.snapshot) || String(previous.rate)!==String(entry.rate))) ambiguousLedger=true;
          latest.set(entry.lineId,entry);
        }
        const snapshots=Array.from(latest.values()).map(entry=>{
          const snapshot=entry.snapshot as any;
          if(!snapshot || amount(snapshot.newCommission)===null || amount(snapshot.newRevenue)===null || amount(snapshot.newQuantity)===null) return null;
          const sources=raws.length?raws:saved;
          const sourceMatches=sources.filter(line=>String(line.lineItemId??line.saleItemId??'')===String(snapshot.externalLineId) && String(extractProductLineMeta(line).productId)===String(snapshot.productId));
          const productMatches=sources.filter(line=>String(extractProductLineMeta(line).productId)===String(snapshot.productId) &&
            String(line.variantId??line.variantID??line.VariantID??extractProductLineMeta(line).sku??'')===String(snapshot.variantId??''));
          const source=sourceMatches.length===1?sourceMatches[0]:productMatches.length===1?productMatches[0]:{};
          return {...source,saleItemId:snapshot.externalLineId,productID:snapshot.productId,variantId:snapshot.variantId,
            quantity:amount(snapshot.newQuantity),eligibleSaleAmount:amount(snapshot.newRevenue),saleAmount:amount(snapshot.newRevenue),
            commissionAmount:amount(snapshot.newCommission),commissionRate:amount(String(entry.rate)),commissionType:entry.type,
            fixedBasis:entry.fixedBasis,basis:entry.basis,rateId:snapshot.rateId,subcategoryId:entry.subcategoryId,subcategoryName:entry.subcategoryName,
            commissionSource:'APPROVED_LEDGER',commissionState:'CONFIGURED',missingReason:null};
        });
        if(!ambiguousLedger && snapshots.length && snapshots.every(line=>line!==null)) {
          const active=snapshots.filter((line):line is NonNullable<typeof line>=>line!==null && line.quantity!==null && line.quantity>0);
          if(active.length && active.every(line=>line.commissionRate!==null && line.productID && !['0','00000000-0000-0000-0000-000000000000'].includes(String(line.productID))) &&
              active.reduce((total,line)=>total.plus(String(line.commissionAmount)),new D(0)).equals(new D(String(recordedTotal)))) {
            saved.splice(0,saved.length,...active);
            recoveredLedger=true;
          }
        }
      }
    }
  }
  let recoveredSingleProduct = false;
  // This copies recorded values, not a new percentage calculation. It is safe only
  // when one identified, non-return product covers this employee's entire invoice.
  if (frozen(sale) && rawOwnersMatch && recordedTotal !== null && sale!.commissionType === 'PERCENTAGE' &&
      amount(sale!.commissionPercent) !== null && saved.length <= 1 && raws.length <= 1) {
    const source = saved[0] ?? raws[0];
    if (source) {
      const identity = extractProductLineMeta(source);
      const revenue = amount(source.eligibleSaleAmount ?? source.eligibleRevenue ?? source.saleAmount ?? source.productNetAmount ?? source.netAmountExTax ?? source.netAmount ?? source.lineTotal ?? source.amount);
      const quantity = amount(source.quantity ?? source.qty);
      const employeeKeys = new Set((context.employeeIdentifiers ?? []).map(key => key.trim().toLowerCase()));
      const sourceHistoryVerified = saved.length === 1 || (meta?.eventType === 'INVOICE_CREATED' &&
        (!sale!.approvedAt || (context.sourceRecordedAt != null && context.sourceRecordedAt <= sale!.approvedAt)));
      const attributed = saved.length === 1 || [source.employeeCode,source.employeeId,source.employeeID,source.employeePhoneNo,meta?.employeeIdentifier]
        .some(key => key != null && employeeKeys.has(String(key).trim().toLowerCase()));
      const rawProduct = raws[0] ? extractProductLineMeta(raws[0]) : null;
      const rawVariant = raws[0]?.variantId ?? raws[0]?.variantID ?? raws[0]?.VariantID ?? rawProduct?.sku;
      const savedVariant = source.variantId ?? source.variantID ?? source.VariantID ?? identity.sku;
      const matchingProduct = !rawProduct || (String(rawProduct.productId) === String(identity.productId) &&
        (!rawVariant || !savedVariant || String(rawVariant) === String(savedVariant)));
      const productKnown = identity.productId != null && !['','0','00000000-0000-0000-0000-000000000000'].includes(String(identity.productId));
      const isReturn = parseIsOld(source);
      if (productKnown && sourceHistoryVerified && attributed && matchingProduct && !isReturn && quantity !== null && quantity > 0 && revenue !== null &&
          new D(String(revenue)).equals(new D(String(sale!.saleAmount))) &&
          (saved.length === 0 || saved[0].commissionAmount === null || saved[0].commissionRate === null || !new D(String(saved[0].commissionAmount)).equals(new D(String(recordedTotal))))) {
        const otherRecipients = await tx.commissionTransaction.count({where:{storeId:context.storeId,employeeId:{not:sale!.employeeId},
          OR:[...(sale!.billId?[{billId:sale!.billId}]:[]),...(sale!.invoiceNumber?[{invoiceNumber:sale!.invoiceNumber}]:[])],
          eventType:{in:['INVOICE_CREATED','INVOICE_UPDATED']}}});
        if (otherRecipients === 0) {
          saved.splice(0,saved.length,{...source,eligibleSaleAmount:revenue,saleAmount:revenue,quantity,
            commissionRate:sale!.commissionPercent,commissionAmount:recordedTotal,commissionType:sale!.commissionType,
            commissionSource:'SINGLE_PRODUCT_RECORDED',commissionState:'CONFIGURED',missingReason:null});
          recoveredSingleProduct = true;
        }
      }
    }
  }
  const valid = saved.length > 0 && saved.every(l => amount(l.commissionAmount) !== null);
  const sum = valid ? saved.reduce((n,l)=>n.plus(String(l.commissionAmount)),new D(0)) : null;
  const reconciled = recordedTotal !== null && sum !== null && sum.equals(new D(String(recordedTotal)));
  const recordedPending = sale?.status === 'PENDING' && reconciled && saved.every(l => l.commissionState === 'CONFIGURED' && !l.missingReason);
  if (frozen(sale) || recordedPending) {
    if (!reconciled) {
      const reason=valid?'HISTORICAL_TOTAL_MISMATCH':'HISTORICAL_SNAPSHOT_MISSING';
      const historical = saved.length ? saved.map(displayLine) : display;
      const lines=historical.map((line,index)=>({...line,
        // A partially missing history does not erase independently recorded rates
        // or other known item amounts. Contradictory totals still require review.
        commissionRate:saved[index]?.commissionRate ?? null,
        commissionAmount:!valid ? saved[index]?.commissionAmount ?? null : null,
        commissionType:saved[index]?.commissionType ?? sale!.commissionType,
        fixedBasis:saved[index]?.fixedBasis ?? null,
        commissionState:reason,missingReason:reason,configurationMessage:messages[reason]}));
      const recordedRate=amount(sale!.commissionPercent);
      const recordedRateDisplay=recordedRate===null?'Approved item breakdown unavailable':sale!.commissionType==='FIXED'?`Recorded fixed rate ₹${recordedRate}`:`Recorded ${recordedRate}%`;
      return {...summarizeInvoiceLines(lines),commissionSource:'APPROVED_HISTORY',
        commissionState:recordedTotal === null ? 'COMMISSION_RECORD_MISSING' : 'HISTORICAL_RECONCILIATION_REQUIRED',
        // Item completeness and the persisted employee total are independent. Never
        // discard an approved total or invent allocations for incomplete item history.
        commissionAmount:recordedTotal,commissionEarned:recordedTotal,commission:recordedTotal,totalCommission:recordedTotal,newCommission:recordedTotal,
        commissionTotalState:recordedTotal === null ? 'UNRESOLVED' : 'RECORDED',itemCommissionState:'UNRESOLVED',
        rateDisplay:recordedRateDisplay,recordedCommissionAmount:recordedTotal,recordedCommissionRate:recordedRate,
        reconciliationMessage:recordedTotal === null ? 'The approved commission record has no valid persisted amount. Accounting review is required.' : messages[reason],approvalStatus:sale!.status};
    }
    const lines=saved.map((snapshot,i)=>{
      const raw=matchingInvoiceItem(raws,snapshot)??snapshot;
      const base=displayLine({...raw,...snapshot},i);
      const revenue=amount(snapshot.eligibleSaleAmount??snapshot.eligibleRevenue??snapshot.saleAmount??snapshot.productNetAmount);
      return {...base,subcategoryId:snapshot.subcategoryId??null,subcategoryName:snapshot.subcategoryName??snapshot.subcategory??base.subcategoryName,subcategory:snapshot.subcategoryName??snapshot.subcategory??null,
        eligibleSaleAmount:revenue,saleAmount:revenue,commissionRate:amount(snapshot.commissionRate),commissionAmount:Number(snapshot.commissionAmount),
        commissionType:snapshot.commissionType??sale!.commissionType,fixedBasis:snapshot.fixedBasis??null,rateId:snapshot.rateId??null,commissionState:'CONFIGURED',missingReason:null,configurationMessage:null};
    });
    if(raws.length) lines.sort((a,b)=>{
      const first=raws.indexOf(matchingInvoiceItem(raws,a));
      const second=raws.indexOf(matchingInvoiceItem(raws,b));
      return (first<0?raws.length:first)-(second<0?raws.length:second);
    });
    const result=summarizeInvoiceLines(lines,'HISTORICAL_SNAPSHOT');
    return {...result,commissionSource:recoveredLedger?'APPROVED_LEDGER':recoveredSingleProduct?'SINGLE_PRODUCT_RECORDED':recordedPending?'RECORDED_SNAPSHOT':saved.every(l=>l.commissionSource==='SUBCATEGORY')?'SUBCATEGORY_SNAPSHOT':'APPROVED_HISTORY',rateDisplay:result.commissionRate===null?'Recorded item commissions':result.rateDisplay,calculatedCommissionAmount:recoveredSingleProduct||recoveredLedger?null:result.calculatedCommissionAmount,commission:recordedTotal,commissionTotalState:'RECORDED',itemCommissionState:'COMPLETE',recordedCommissionAmount:recordedTotal,approvalStatus:sale!.status};
  }

  const documents = await tx.hrmCommissionDocument.findMany({ where: { storeId: context.storeId, kind: 'SALE', OR: [
    { externalId: context.reference }, { externalId: String(meta?.billId ?? context.reference) }, { invoiceNumber: String(sale?.invoiceNumber ?? meta?.invoiceNumber ?? context.reference) },
  ] } });
  const projected = documents.length===1 ? await tx.hrmCommissionLine.findMany({where:{documentId:documents[0].id}}) : [];
  if(!raws.length && projected.length) {
    const lines=[];
    for(const snapshot of projected) {
      const matches=saved.filter(l=>String(l.saleItemId??l.lineItemId??'')===snapshot.externalLineId);
      const raw=matches.length===1?matches[0]:saved.find(l=>String(l.productID??l.productId)===snapshot.productId&&String(l.variantId??l.sku??'')===snapshot.variantId);
      const base=displayLine(raw??{productID:snapshot.productId,quantity:snapshot.quantity.toNumber()},lines.length);
      lines.push(await projectedInvoiceLine(tx,snapshot,base));
    }
    return {...summarizeInvoiceLines(lines),itemDataSource:'HRM_LEDGER_SNAPSHOT',approvalStatus:sale?.status??'PENDING'};
  }
  const calculationItems = raws.length ? await recoverInvoiceItemIdentities(tx,raws) : await recoverSavedInvoiceItems(tx,saved);
  // Render the recovered identities used for calculation, rather than stale placeholder snapshots.
  display.splice(0, display.length, ...calculationItems.map(displayLine));
  const itemDataSource = raws.length ? 'INVOICE_PAYLOAD' : saved.length ? 'SAVED_PRODUCT_BREAKDOWN' : 'UNAVAILABLE';
  const settings = await tx.hrmCommissionSettings.findUnique({ where: { id: 1 } });
  let doc;
  let saleTime: Awaited<ReturnType<typeof resolveInvoiceSaleTime>>;
  try {
    saleTime = await resolveInvoiceSaleTime(tx,meta?.invoice??{},context.storeId,sale?context.at:undefined);
    doc = normalizePayload({ eventType: 'INVOICE_CREATED', data: {
      storeId: context.storeId,
      invoice: { ...(meta?.invoice ?? {}),
        invoiceId: context.reference, invoiceDate: saleTime.occurredAt.toISOString(),
        storeId: context.storeId, lineItems: calculationItems } } }, (settings?.netBasis && settings.netBasis !== 'UNVERIFIED') ? settings : { netField: settings?.netField ?? 'productNetAmount', netBasis: 'NET_EX_TAX', discounted: true });
  } catch (e: any) {
    const lines = display.map(l => ({ ...l, missingReason: e.message, commissionState:'INVOICE_DATA_MISSING', configurationMessage: invoiceDataMessage(e.message) }));
    return { ...summarizeInvoiceLines(lines),itemDataSource,approvalStatus:sale?.status??'PENDING',reconciliationMessage:invoiceDataMessage(e.message),invoiceDataReason:e.message };
  }
  if (doc.cancelled || (documents.length===1 && documents[0].status==='CANCELLED')) {
    const cancelledLines=display.map(l=>({...l,eligibleSaleAmount:0,saleAmount:0,commissionAmount:0,commissionEarned:0,commissionState:'CANCELLED',missingReason:null,configurationMessage:null}));
    return {
    ...summarizeInvoiceLines([]), commissionState:'CANCELLED',commissionAmount:0,commissionEarned:0,totalCommission:0,newCommission:0,
    calculatedCommissionAmount:0,eligibleSaleAmount:0,hasMissingConfiguration:false,rateDisplay:'Commission reversed',approvalStatus:sale?.status??'REJECTED',
    hasUnresolvedInvoiceItems:false,hasMissingInvoiceData:false,productCommissionBreakdown:cancelledLines,productWiseCommission:cancelledLines,
  };
  }
  const lines: any[] = [];
  for (let i=0;i<doc.lines.length;i++) {
    const source: NormalizedLine = doc.lines[i], line = display[i] ?? displayLine(raws[i] ?? {},i);
    try {
      const snapshots = projected.filter(l => l.externalLineId === source.id && l.productId === source.productId && l.variantId === source.variantId && l.quantity.equals(source.quantity) && (l.basis === 'NET_EX_TAX' ? source.exTax : source.inclTax)?.equals(l.eligibleRevenue));
      if (snapshots.length === 1) {
        lines.push(await projectedInvoiceLine(tx,snapshots[0],line)); continue;
      }
      const subcategory=await resolveSubcategory(tx,source,doc.occurredAt);
      if (!subcategory) throw new Error('SUBCATEGORY_MAPPING_REQUIRED');
      Object.assign(line,{ subcategoryId:subcategory.id,subcategoryExternalId:subcategory.externalId,categoryId:line.categoryId??subcategory.categoryExternalId??null,subcategoryName:subcategory.name,subcategory:subcategory.name });
      const rate=await resolveSubcategoryRate(tx,subcategory.id,context.storeId,doc.occurredAt);
      Object.assign(line,{commissionRate:rate.rate.toNumber(),commissionType:rate.type,fixedBasis:rate.fixedBasis,rateId:rate.id,basis:rate.basis});
      const revenue=rate.basis==='NET_EX_TAX'?source.exTax:source.inclTax;
      if (revenue===undefined) { Object.assign(line,{eligibleSaleAmount:null,saleAmount:null}); throw new Error('DISCOUNTED_NET_AMOUNT_BASIS_UNVERIFIED'); }
      lines.push({ ...line,eligibleSaleAmount:revenue.toNumber(),saleAmount:revenue.toNumber(),commissionRate:rate.rate.toNumber(),
        commissionAmount:revenue.isZero()?0:earning(revenue,source.quantity,rate).toNumber(),commissionType:rate.type,fixedBasis:rate.fixedBasis,rateId:rate.id,
        basis:rate.basis,commissionState:'CONFIGURED',missingReason:null,configurationMessage:null });
    } catch(e:any) { lines.push({ ...line,missingReason:e.message,configurationMessage:messages[e.message] ?? 'Subcategory commission configuration requires review.' }); }
  }
  return { ...summarizeInvoiceLines(lines),itemDataSource,approvalStatus:sale?.status??'PENDING',
    saleOccurredAt:doc.occurredAt.toISOString(),saleTimestampField:saleTime.field,saleTimestampRaw:saleTime.rawValue,
    saleTimeZone:saleTime.timeZone,saleTimeZoneSource:saleTime.timeZoneSource,sourceRecordedAt:context.sourceRecordedAt??null };
}

export async function findInvoicePayload(tx: Tx, aliases: string[], storeId?: number | null) {
  const expanded = new Set<string>();
  for (const a of aliases) {
    if (!a) continue;
    const str = String(a).trim();
    if (!str) continue;
    expanded.add(str);
    const m = /^(?:HWM-|INV-)?(\d+)$/i.exec(str);
    if (m) {
      const num = m[1];
      expanded.add(num);
      expanded.add(`HWM-${num}`);
      expanded.add(`INV-${num}`);
    }
  }
  const ids = Array.from(expanded);
  if (!ids.length) return null;

  let firstCandidate: { raw: any; id: string; createdAt: Date; storeId?: number | null } | null = null;

  const primary = await tx.webhookLog.findMany({
    where: { OR: [{ id: { in: ids } }, { billId: { in: ids } }, { eventId: { in: ids } }] },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  for (const row of primary) {
    try {
      const raw = JSON.parse(row.payload), meta = extractWebhookMeta(raw);
      if (storeId) {
        if (meta.storeId === storeId) return { raw, id: row.id, createdAt: row.createdAt };
        const resolved = await resolveInvoiceStore(tx, {
          meta,
          aliases: [row.billId, row.id, ...(row.eventId ? [row.eventId] : [])].filter((v): v is string => Boolean(v)),
          persist: false
        });
        if (resolved === storeId) return { raw, id: row.id, createdAt: row.createdAt };
        if (!firstCandidate) firstCandidate = { raw, id: row.id, createdAt: row.createdAt };
        continue;
      }
      return { raw, id: row.id, createdAt: row.createdAt };
    } catch {}
  }

  const other = await tx.hopkidWebhookLog.findMany({
    where: { OR: [{ id: { in: ids } }, { billId: { in: ids } }] },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  for (const row of other) {
    try {
      const raw = JSON.parse(row.rawPayload), meta = extractWebhookMeta(raw);
      const logStore = meta.storeId ?? row.storeId;
      const rawWithStore = (row.storeId && !meta.storeId) ? { ...raw, storeId: row.storeId, data: { ...(raw.data || {}), storeId: row.storeId } } : raw;
      if (storeId) {
        if (logStore === storeId) return { raw: rawWithStore, id: row.id, createdAt: row.createdAt, storeId: row.storeId };
        const resolved = await resolveInvoiceStore(tx, {
          meta: { ...meta, storeId: logStore },
          aliases: [row.billId, row.id].filter((v): v is string => Boolean(v)),
          persist: false
        });
        if (resolved === storeId) return { raw: rawWithStore, id: row.id, createdAt: row.createdAt, storeId: row.storeId };
        if (!firstCandidate) firstCandidate = { raw: rawWithStore, id: row.id, createdAt: row.createdAt, storeId: row.storeId };
        continue;
      }
      return { raw: rawWithStore, id: row.id, createdAt: row.createdAt, storeId: row.storeId };
    } catch {}
  }

  if (firstCandidate) return firstCandidate;

  const numericIds = ids.filter(id => /^\d+$/.test(id));
  if (numericIds.length) {
    try {
      const fallbackLogs = await tx.hopkidWebhookLog.findMany({
        where: {
          OR: numericIds.flatMap(num => [
            { rawPayload: { contains: `"${num}"` } },
            { rawPayload: { contains: `HWM-${num}` } },
            { rawPayload: { contains: `INV-${num}` } }
          ])
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });
      for (const row of fallbackLogs) {
        try {
          const raw = JSON.parse(row.rawPayload);
          const meta = extractWebhookMeta(raw);
          const rawWithStore = (row.storeId && !meta.storeId) ? { ...raw, storeId: row.storeId, data: { ...(raw.data || {}), storeId: row.storeId } } : raw;
          return { raw: rawWithStore, id: row.id, createdAt: row.createdAt, storeId: row.storeId };
        } catch {}
      }
    } catch {}
  }

  return null;
}

/**
 * Resolves the authoritative Store ID for an invoice/bill using schema relations:
 * 1. sale.storeId (verified in Store table)
 * 2. meta.storeId (verified in Store table)
 * 3. POSSale by aliases / invoiceNo
 * 4. HrmCommissionDocument by aliases / externalId / invoiceNumber
 * 5. meta.storeCode matching Store.code
 * 6. meta.branchId matching Branch -> a unique Store.name
 * 7. meta.branchName / meta.storeName matching Store.name (case-insensitive)
 * 8. Selling employee's storeId or verified branch-name mapping
 * 9. Attributed employee's storeId or verified branch-name mapping
 *
 * If resolved and sale exists with missing storeId, performs safe auditable backfill.
 */
export async function resolveInvoiceStore(
  tx: Tx,
  options: {
    sale?: (CommissionTransaction & { store?: any; employee?: any }) | null;
    meta?: any;
    aliases?: string[];
    employee?: any;
    persist?: boolean;
  }
): Promise<number | null> {
  const { sale, meta, aliases = [], employee } = options;
  const uniqueStore = async (query: any) => {
    const stores = await tx.store.findMany({...query, take:2});
    if (stores.length > 1) throw Object.assign(new Error('STORE_MAPPING_AMBIGUOUS'), {status:409});
    return stores[0] ?? null;
  };

  // 1. Direct sale.storeId
  if (sale?.storeId) {
    if (sale.store?.id === sale.storeId) return sale.store.id;
    if (tx.store?.findUnique) {
      const directStore = await tx.store.findUnique({ where: { id: sale.storeId } });
      if (directStore) return directStore.id;
    } else {
      return sale.storeId;
    }
  }

  // 2. Direct meta.storeId from webhook payload
  if (meta?.storeId) {
    const sId = Number(meta.storeId);
    if (!isNaN(sId) && sId > 0) {
      if (tx.store?.findUnique) {
        const metaStore = await tx.store.findUnique({ where: { id: sId } });
        if (metaStore) {
          if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
            await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: metaStore.id } });
            sale.storeId = metaStore.id;
          }
          return metaStore.id;
        }
      } else {
        return sId;
      }
      if (tx.branch?.findUnique) {
        const branch = await tx.branch.findUnique({ where: { id: sId } });
        if (branch?.name) {
          const storeByName = await uniqueStore({
            where: { name: { equals: branch.name.trim(), mode: 'insensitive' } }
          });
          if (storeByName) {
            if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
              await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: storeByName.id } });
              sale.storeId = storeByName.id;
            }
            return storeByName.id;
          }
        }
      }
    }
  }

  // 5. meta.storeCode
  if (meta?.storeCode) {
    const codeStr = String(meta.storeCode).trim();
    if (codeStr) {
      const storeByCode = await uniqueStore({ where: { code: codeStr } });
      if (storeByCode) {
        if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
          await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: storeByCode.id } });
          sale.storeId = storeByCode.id;
        }
        return storeByCode.id;
      }
    }
  }

  // 6. meta.branchId
  if (meta?.branchId) {
    const bId = Number(meta.branchId);
    if (!isNaN(bId) && bId > 0) {
      if (tx.branch?.findUnique) {
        const branch = await tx.branch.findUnique({ where: { id: bId } });
        if (branch?.name) {
          const storeByName = await uniqueStore({
            where: { name: { equals: branch.name.trim(), mode: 'insensitive' } }
          });
          if (storeByName) {
            if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
              await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: storeByName.id } });
              sale.storeId = storeByName.id;
            }
            return storeByName.id;
          }
        }
      }
    }
  }

  // 7. meta.branchName or meta.storeName
  const metaName = String(meta?.branchName || meta?.storeName || '').trim();
  if (metaName) {
    const storeByName = await uniqueStore({
      where: { name: { equals: metaName, mode: 'insensitive' } }
    });
    if (storeByName) {
      if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
        await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: storeByName.id } });
        sale.storeId = storeByName.id;
      }
      return storeByName.id;
    }
    if (tx.branch?.findFirst) {
      const branchByName = await tx.branch.findFirst({
        where: { name: { equals: metaName, mode: 'insensitive' } }
      });
      if (branchByName?.name) {
        const storeByBranch = await uniqueStore({
          where: { name: { equals: branchByName.name.trim(), mode: 'insensitive' } }
        });
        if (storeByBranch) return storeByBranch.id;
      }
    }
  }

  // 7b. Line item storeId / branchId / storeName / branchName
  const candidateItems = Array.isArray(meta?.lineItems) && meta.lineItems.length ? meta.lineItems : (meta?.firstItem ? [meta.firstItem] : []);
  for (const item of candidateItems) {
    const itemStoreId = Number(item.storeId ?? item.StoreId ?? item.StoreID ?? item.store_id);
    if (!isNaN(itemStoreId) && itemStoreId > 0 && tx.store?.findUnique) {
      const itemStore = await tx.store.findUnique({ where: { id: itemStoreId } });
      if (itemStore) return itemStore.id;
    }
    const itemBranchId = Number(item.branchId ?? item.BranchId ?? item.BranchID ?? item.branch_id);
    if (!isNaN(itemBranchId) && itemBranchId > 0 && tx.branch?.findUnique) {
      const branch = await tx.branch.findUnique({ where: { id: itemBranchId } });
      if (branch?.name) {
        const storeByName = await uniqueStore({
          where: { name: { equals: branch.name.trim(), mode: 'insensitive' } }
        });
        if (storeByName) return storeByName.id;
      }
    }
    const itemStoreName = String(item.branchName ?? item.BranchName ?? item.storeName ?? item.StoreName ?? '').trim();
    if (itemStoreName) {
      const storeByName = await uniqueStore({
        where: { name: { equals: itemStoreName, mode: 'insensitive' } }
      });
      if (storeByName) return storeByName.id;
    }
  }

  const cleanAliases = [...new Set(aliases.map(a => String(a || '').trim()).filter(Boolean))];

  // 3. POSSale lookup by aliases / invoiceNo
  if (cleanAliases.length > 0 && tx.pOSSale?.findMany) {
    const matches = await tx.pOSSale.findMany({
      where: { invoiceNo: { in: cleanAliases } }, select: { storeId: true }, distinct:['storeId'], take:2
    });
    if(matches.length>1) throw Object.assign(new Error('STORE_MAPPING_AMBIGUOUS'),{status:409});
    const pos=matches[0];
    if (pos?.storeId) {
      const posStore = tx.store?.findUnique ? await tx.store.findUnique({ where: { id: pos.storeId } }) : { id: pos.storeId };
      if (posStore) {
        if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
          await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: posStore.id } });
          sale.storeId = posStore.id;
        }
        return posStore.id;
      }
    }
  }

  // 4. HrmCommissionDocument lookup by aliases
  if (cleanAliases.length > 0 && tx.hrmCommissionDocument?.findMany) {
    const matches = await tx.hrmCommissionDocument.findMany({
      where: {
        OR: [
          { externalId: { in: cleanAliases } },
          { invoiceNumber: { in: cleanAliases } }
        ]
      },
      select: { storeId: true }, distinct:['storeId'], take:2
    });
    if(matches.length>1) throw Object.assign(new Error('STORE_MAPPING_AMBIGUOUS'),{status:409});
    const doc=matches[0];
    if (doc?.storeId) {
      const docStore = tx.store?.findUnique ? await tx.store.findUnique({ where: { id: doc.storeId } }) : { id: doc.storeId };
      if (docStore) {
        if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
          await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: docStore.id } });
          sale.storeId = docStore.id;
        }
        return docStore.id;
      }
    }
  }

  // 4b. HopkidWebhookLog lookup by aliases
  if (cleanAliases.length > 0 && tx.hopkidWebhookLog?.findMany) {
    const hopkidLogs = await tx.hopkidWebhookLog.findMany({
      where: { billId: { in: cleanAliases } },
      select: { storeId: true, employeeCode: true, mobileNo: true },
      take: 5
    });
    for (const log of hopkidLogs) {
      if (log.storeId) {
        if (tx.store?.findUnique) {
          const logStore = await tx.store.findUnique({ where: { id: log.storeId } });
          if (logStore) return logStore.id;
        }
        if (tx.branch?.findUnique) {
          const branch = await tx.branch.findUnique({ where: { id: log.storeId } });
          if (branch?.name) {
            const storeByName = await uniqueStore({
              where: { name: { equals: branch.name.trim(), mode: 'insensitive' } }
            });
            if (storeByName) return storeByName.id;
          }
        }
      }
      if ((log.employeeCode || log.mobileNo) && tx.employee?.findFirst) {
        const emp = await tx.employee.findFirst({
          where: {
            OR: [
              ...(log.employeeCode ? [{ employeeCode: log.employeeCode }, { employeeID: log.employeeCode }] : []),
              ...(log.mobileNo ? [{ mobileNumber: log.mobileNo }] : [])
            ]
          },
          include: { store: true, branch: true }
        });
        if (emp?.storeId) {
          const empStore = emp.store ?? (tx.store?.findUnique ? await tx.store.findUnique({ where: { id: emp.storeId } }) : null);
          if (empStore) return empStore.id;
        }
        if (emp?.branchId && tx.branch?.findUnique) {
          const branch = emp.branch ?? await tx.branch.findUnique({ where: { id: emp.branchId } });
          if (branch?.name) {
            const storeByName = await uniqueStore({
              where: { name: { equals: branch.name.trim(), mode: 'insensitive' } }
            });
            if (storeByName) return storeByName.id;
          }
        }
      }
    }
  }

  // 8b. Salesman from webhook meta
  const salesmanIdent = meta?.employeeIdentifier || meta?.firstItem?.employeeCode || meta?.firstItem?.employeePhoneNo;
  if (salesmanIdent && tx.employee?.findFirst) {
    const sIdentStr = String(salesmanIdent).trim();
    const salesmanEmp = await tx.employee.findFirst({
      where: {
        OR: [
          { employeeCode: sIdentStr },
          { employeeID: sIdentStr },
          { mobileNumber: sIdentStr }
        ]
      },
      include: { store: true, branch: true }
    });
    if (salesmanEmp?.storeId) {
      const s = salesmanEmp.store ?? (tx.store?.findUnique ? await tx.store.findUnique({ where: { id: salesmanEmp.storeId } }) : null);
      if (s) return s.id;
    }
    if (salesmanEmp?.branchId && tx.branch?.findUnique) {
      const b = salesmanEmp.branch ?? await tx.branch.findUnique({ where: { id: salesmanEmp.branchId } });
      if (b?.name) {
        const s = await uniqueStore({ where: { name: { equals: b.name.trim(), mode: 'insensitive' } } });
        if (s) return s.id;
      }
    }
  }

  // 8. Selling employee's storeId / branchId / branchName
  const seller = sale?.employee ?? (sale?.employeeId && tx.employee?.findUnique ? await tx.employee.findUnique({
    where: { id: sale.employeeId },
    include: { store: true, branch: true }
  }) : null);

  if (seller?.storeId) {
    const sellerStore = seller.store ?? (tx.store?.findUnique ? await tx.store.findUnique({ where: { id: seller.storeId } }) : { id: seller.storeId });
    if (sellerStore) {
      if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
        await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: sellerStore.id } });
        sale.storeId = sellerStore.id;
      }
      return sellerStore.id;
    }
  }

  if (seller?.branchId) {
    if (tx.branch?.findUnique) {
      const branch = seller.branch ?? await tx.branch.findUnique({ where: { id: seller.branchId } });
      if (branch?.name) {
        const storeByName = await uniqueStore({
          where: { name: { equals: branch.name.trim(), mode: 'insensitive' } }
        });
        if (storeByName) {
          if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
            await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: storeByName.id } });
            sale.storeId = storeByName.id;
          }
          return storeByName.id;
        }
      }
    }
  }

  if (seller?.branchName) {
    const storeByName = await uniqueStore({
      where: { name: { equals: seller.branchName.trim(), mode: 'insensitive' } }
    });
    if (storeByName) {
      if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
        await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: storeByName.id } });
        sale.storeId = storeByName.id;
      }
      return storeByName.id;
    }
  }

  // 9. Attributed employee's store or branch (only if caller is the attributed seller or no sale exists)
  const isCallerUnrelatedManager = sale && employee && sale.employeeId !== employee.id;
  const empTarget = isCallerUnrelatedManager ? null : (employee ?? seller);

  if (empTarget?.storeId) {
    const empStore = empTarget.store ?? (tx.store?.findUnique ? await tx.store.findUnique({ where: { id: empTarget.storeId } }) : { id: empTarget.storeId });
    if (empStore) {
      if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
        await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: empStore.id } });
        sale.storeId = empStore.id;
      }
      return empStore.id;
    }
  }

  if (empTarget?.branchId) {
    if (tx.branch?.findUnique) {
      const branch = empTarget.branch ?? await tx.branch.findUnique({ where: { id: empTarget.branchId } });
      if (branch?.name) {
        const storeByName = await uniqueStore({
          where: { name: { equals: branch.name.trim(), mode: 'insensitive' } }
        });
        if (storeByName) {
          if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
            await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: storeByName.id } });
            sale.storeId = storeByName.id;
          }
          return storeByName.id;
        }
      }
    }
  }

  if (empTarget?.branchName) {
    const storeByName = await uniqueStore({
      where: { name: { equals: empTarget.branchName.trim(), mode: 'insensitive' } }
    });
    if (storeByName) {
      if (options.persist !== false && sale && !sale.storeId && tx.commissionTransaction?.update) {
        await tx.commissionTransaction.update({ where: { id: sale.id }, data: { storeId: storeByName.id } });
        sale.storeId = storeByName.id;
      }
      return storeByName.id;
    }
  }

  return null;
}

export async function mobileInvoiceDetail(userId: number, billId: string, role: string) {
  return prisma.$transaction(async tx=>{
    const employee=await tx.employee.findFirst({where:{userId},include:{store:true,branch:true}});
    if(!employee) throw Object.assign(new Error('Employee profile not found'),{status:404});

    const rawRef=billId.trim();
    const numbered=/^(?:HWM-|INV-)?(\d+)$/i.exec(rawRef);
    const aliases=[...new Set([rawRef,...(numbered?[numbered[1],`HWM-${numbered[1]}`,`INV-${numbered[1]}`]:[])])];
    const isManagerRole=['ADMIN','SUPERADMIN','SUPER_ADMIN','STORE_MANAGER'].includes(role);

    let matches=await tx.commissionTransaction.findMany({
      where:{employeeId:employee.id,OR:[{billId:{in:aliases}},{invoiceNumber:{in:aliases}}]},
      orderBy:{id:'desc'},
      take:2,
      include:{store:true,employee:{include:{store:true,branch:true}}}
    });
    if(matches.length>1) throw Object.assign(new Error('Invoice commission records are ambiguous. Accounting review is required.'),{status:409});

    let sale=matches[0]??null;
    if(!sale&&/^\d+$/.test(rawRef)&&Number(rawRef)<=2147483647) {
      const candidate=await tx.commissionTransaction.findFirst({
        where:{employeeId:employee.id,id:Number(rawRef)},
        include:{store:true,employee:{include:{store:true,branch:true}}}
      });
      if(candidate && (getNumericInvoiceNumber(candidate) === Number(rawRef) || (!candidate.billId && !candidate.invoiceNumber))) sale=candidate;
    }

    if(!sale&&isManagerRole) {
      const storeFilter=(role==='STORE_MANAGER'&&employee.storeId)?{storeId:employee.storeId}:{};
      const mgrMatches=await tx.commissionTransaction.findMany({
        where:{
          ...storeFilter,
          OR:[{billId:{in:aliases}},{invoiceNumber:{in:aliases}}]
        },
        orderBy:{id:'desc'},
        take:2,
        include:{store:true,employee:{include:{store:true,branch:true}}}
      });
      if(mgrMatches.length>1) throw Object.assign(new Error('Invoice commission records are ambiguous. Accounting review is required.'),{status:409});
      sale=mgrMatches[0]??null;
      if(!sale&&/^\d+$/.test(rawRef)&&Number(rawRef)<=2147483647) {
        const candidate=await tx.commissionTransaction.findFirst({
          where:{
            ...storeFilter,
            id:Number(rawRef)
          },
          include:{store:true,employee:{include:{store:true,branch:true}}}
        });
        if(candidate && (getNumericInvoiceNumber(candidate) === Number(rawRef) || (!candidate.billId && !candidate.invoiceNumber))) sale=candidate;
      }
    }

    if(role==='STORE_MANAGER'&&employee.storeId&&sale&&sale.storeId&&sale.storeId!==employee.storeId) {
      throw Object.assign(new Error('Invoice not found'),{status:404});
    }

    const payload=await findInvoicePayload(tx,[...aliases,sale?.billId??'',sale?.invoiceNumber??''],sale?.storeId);
    const meta=payload?extractWebhookMeta(payload.raw):null;

    if(!sale) {
      const identifiers=new Set([employee.employeeID,employee.employeeCode,employee.mobileNumber].filter(Boolean).map(String));
      const attributed=(meta?.lineItems??[]).some((item:any)=>[item.employeeCode,item.employeeId,item.employeeID,item.employeePhoneNo].some(v=>v!=null&&identifiers.has(String(v)))) || (meta?.employeeIdentifier!=null&&identifiers.has(String(meta.employeeIdentifier)));
      const manager=isManagerRole&&(!employee.storeId||employee.storeId===meta?.storeId);
      if(!payload||(!attributed&&!manager)) throw Object.assign(new Error('Invoice not found'),{status:404});
    }

    const storeId=await resolveInvoiceStore(tx,{
      sale,
      meta,
      aliases:[...aliases,sale?.billId??'',sale?.invoiceNumber??''].filter(Boolean),
      employee
    });

    if(!storeId) {
      console.warn(`[InvoiceCommission] Invoice store is missing for bill ${billId}`);
      throw Object.assign(new Error('STORE_ID_MISSING: Invoice store mapping is unavailable'),{status:409});
    }

    if(role==='STORE_MANAGER'&&employee.storeId&&storeId!==employee.storeId) {
      throw Object.assign(new Error('Invoice not found'),{status:404});
    }

    const at=sale?.createdAt??payload!.createdAt, reference=sale?.billId??String(meta?.billId??billId);
    const saleEmp=sale?.employee??employee;
    const result=await calculateInvoiceCommission(tx,sale,payload?.raw,{
      storeId,
      at,
      reference,
      sourceRecordedAt:payload?.createdAt,
      employeeIdentifiers:[saleEmp.employeeID,saleEmp.employeeCode,saleEmp.mobileNumber].filter((value):value is string=>Boolean(value))
    });

    const number=getNumericInvoiceNumber(sale??{billId:reference,invoiceNumber:meta?.invoiceNumber});
    const invoice=meta?.invoice??{};
    const storeRecord=(sale?.store?.id===storeId?sale.store:null)??(tx.store?.findUnique ? await tx.store.findUnique({where:{id:storeId}}) : null);
    const storeName=meta?.storeName??storeRecord?.name??employee.store?.name??null;

    return {
      billId:number,
      billNumber:number,
      invoiceNumber:sale?.invoiceNumber??meta?.invoiceNumber??reference,
      invoiceNo:sale?.invoiceNumber??meta?.invoiceNumber??reference,
      saleAmount:sale?.saleAmount??Number(meta?.amount??0),
      grossSale:Number(invoice.grandTotal??invoice.grossAmount??sale?.saleAmount??meta?.amount??0),
      discount:Number(invoice.discountTotal??invoice.discountAmount??invoice.discount??0),
      tax:Number(invoice.taxTotal??invoice.taxAmount??invoice.tax??0),
      ...result,
      status:sale?.status??'PENDING',
      date:(result as any).saleOccurredAt??at,
      createdAt:at,
      description:sale?.notes??null,
      oldAmount:0,
      oldCommission:0,
      newAmount:sale?.saleAmount??Number(meta?.amount??0),
      customerName:meta?.customerName??null,
      customerPhone:meta?.customerPhone??null,
      paymentMode:meta?.paymentMode??null,
      storeName,
      externalEventId:payload?.id??null,
      products:result.productCommissionBreakdown.map((line:any)=>({
        ...line,name:line.productName??'Product',price:line.unitPrice??invoiceUnitPrice(line),
      })),
      employee:{name:`${saleEmp.firstName} ${saleEmp.lastName}`.trim(),code:saleEmp.employeeCode}
    };
  },{timeout:30000});
}

/** Existing approval endpoint freezes resolved item snapshots once; never rewrites paid/approved history. */
export async function prepareInvoiceApproval(tx: Tx, sale: CommissionTransaction): Promise<{
  storeId?: number; createdAt?: Date; commissionAmount?: number; newCommission?: number;
  commissionPercent?: number | null; commissionType?: string; productBreakdown?: Prisma.InputJsonValue;
}> {
  if(!isExternalInvoice(sale)||frozen(sale)) return {};
  const aliases=[sale.billId??'',sale.invoiceNumber??''].filter(Boolean);
  const payload=await findInvoicePayload(tx,aliases,sale.storeId);
  const meta=payload?extractWebhookMeta(payload.raw):null;
  const storeId=await resolveInvoiceStore(tx,{sale,meta,aliases,persist:false});
  if(!storeId) throw Object.assign(new Error('STORE_ID_MISSING: Invoice store mapping is unavailable'),{status:409});
  const siblings=await tx.commissionTransaction.count({where:{storeId,OR:[...(sale.billId?[{billId:sale.billId}]:[]),...(sale.invoiceNumber?[{invoiceNumber:sale.invoiceNumber}]:[])],employeeId:{not:sale.employeeId},eventType:{in:['INVOICE_CREATED','INVOICE_UPDATED']}}});
  if(siblings) throw Object.assign(new Error('Shared invoice allocation requires accounting review before approval'),{status:409});
  const result=await calculateInvoiceCommission(tx,sale,payload?.raw,{storeId,at:sale.createdAt,reference:sale.billId??sale.invoiceNumber??String(sale.id)});
  if(result.commissionAmount===null) throw Object.assign(new Error(`Invoice commission unresolved: ${(result.productCommissionBreakdown as any[]).map(l=>l.missingReason).filter(Boolean).join(', ') || 'invoice data missing'}`),{status:409});
  return { storeId, ...((result as any).saleOccurredAt?{createdAt:new Date((result as any).saleOccurredAt)}:{}), commissionAmount:result.commissionAmount,newCommission:result.commissionAmount,commissionPercent:result.commissionRate,
    commissionType:result.productCommissionBreakdown.every((l:any)=>l.commissionType==='FIXED')?'FIXED':'PERCENTAGE',
    productBreakdown:JSON.parse(JSON.stringify(result.productCommissionBreakdown.map((l:any)=>({...l,commissionSource:'SUBCATEGORY'})))) };
}
