import { CommissionTransaction, Prisma } from '@prisma/client';
import { prisma } from '../utils/db';
import { extractWebhookMeta, fetchHopkidInvoiceDetails, getNumericInvoiceNumber } from '../utils/commissionHelper';
import { extractProductLineMeta } from '../utils/productLineMeta';
import { normalizePayload, money, earning, NormalizedLine } from '../hrmCommission/normalize';
import { resolveSubcategory, resolveSubcategoryRate } from '../hrmCommission/resolution';
const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;
const frozen = (sale: CommissionTransaction | null) => !!sale && ['APPROVED','PAID'].includes(sale.status);
export const isExternalInvoice = (sale: CommissionTransaction) => ['INVOICE_CREATED','INVOICE_UPDATED'].includes(sale.eventType ?? '') && !/^(POS|RKD)[-A-Z]*-/i.test(sale.billId ?? '');
const list = (value: unknown): any[] => Array.isArray(value) ? value.filter(x => x && typeof x === 'object') : [];
const finite = (n: unknown) => (typeof n === 'number' || typeof n === 'string') && n !== '' && Number.isFinite(Number(n));
function amount(n: unknown): number | null { return finite(n) ? Number(n) : null; }
const messages: Record<string,string> = {
  SUBCATEGORY_MAPPING_REQUIRED: 'Product subcategory is missing or has no verified mapping.',
  HISTORICAL_OR_CURRENT_RATE_MISSING: 'No subcategory commission configuration is effective on the invoice date.',
  DISCOUNTED_NET_AMOUNT_BASIS_UNVERIFIED: 'Discounted eligible sales and GST basis need verification.',
  HISTORICAL_SNAPSHOT_MISSING: 'Saved approved item commissions are unavailable. The approved amount has not been recalculated.',
  HISTORICAL_TOTAL_MISMATCH: 'Saved item commissions do not reconcile to the approved amount. Accounting review is required.',
};
export function summarizeInvoiceLines(lines: any[], state = 'COMPLETE') {
  const complete = lines.length > 0 && lines.every(l => l.commissionAmount !== null && l.commissionState === 'CONFIGURED');
  const total = complete ? money(lines.reduce((sum,l) => sum.plus(String(l.commissionAmount)),new D(0))).toNumber() : null;
  const rates = new Set(lines.filter(l => l.commissionRate !== null).map(l => `${l.commissionType}:${l.commissionRate}:${l.fixedBasis}`));
  const uniform = complete && lines.every(l=>l.commissionRate!==null) && rates.size === 1;
  const rate = uniform ? lines[0].commissionRate : null;
  return { commissionSource: 'SUBCATEGORY', commissionState: complete ? state : 'MISSING_CONFIGURATION', commissionAmount: total,
    commissionEarned: total, totalCommission: total, newCommission: total, calculatedCommissionAmount: total,
    commissionRate: rate, commissionPercent: rate, commissionPercentage: rate,
    rateDisplay: !complete ? 'Configuration required' : !uniform ? 'Multiple subcategory rates' : lines[0].commissionType === 'FIXED' ? 'Fixed subcategory commission' : `${rate}%`,
    eligibleSaleAmount: complete && lines.every(l=>l.eligibleSaleAmount!==null) ? money(lines.reduce((s,l)=>s.plus(String(l.eligibleSaleAmount)),new D(0))).toNumber() : null,
    hasMissingConfiguration: !complete, productCommissionBreakdown: lines };
}
function displayLine(raw: any, index: number) {
  const meta = extractProductLineMeta(raw);
  const lineAmt = amount(raw.saleAmount ?? raw.eligibleSaleAmount ?? raw.productNetAmount ?? raw.netAmount ?? raw.lineTotal ?? raw.amount ?? (raw.unitPrice != null ? Number(raw.unitPrice) * Number(raw.quantity ?? raw.qty ?? 1) : null));
  return { saleItemId: String(raw.saleItemId ?? raw.lineItemId ?? raw.lineId ?? `${meta.productId ?? index}:${raw.variantId ?? meta.sku ?? ''}`),
    productID: meta.productId, productName: meta.productName ?? raw.name ?? 'Product', sku: meta.sku, variant: meta.variant,
    quantity: amount(raw.quantity ?? raw.qty) ?? 1, subcategoryId: null as string|null, subcategory: null as string|null,
    subcategoryName: raw.subcategoryName ?? raw.subCategoryName ?? raw.SubCategoryName ?? null,
    eligibleSaleAmount: lineAmt, saleAmount: lineAmt, commissionRate: null as number|null,
    commissionAmount: null as number|null, commissionType: null as string|null, fixedBasis: null as string|null,
    rateId: null as string|null, commissionState: 'MISSING_CONFIGURATION', missingReason: 'SUBCATEGORY_MAPPING_REQUIRED',
    configurationMessage: messages.SUBCATEGORY_MAPPING_REQUIRED };
}

/** Read-only invoice calculation. Approved/paid records are never recalculated using current policy. */
export async function calculateInvoiceCommission(tx: Tx, sale: CommissionTransaction | null, raw: any, context: { storeId: number; at: Date; reference: string }) {
  const meta = raw ? extractWebhookMeta(raw) : null;
  const raws = list(meta?.lineItems);
  const saved = list(sale?.productBreakdown);
  const display = (raws.length ? raws : saved).map(displayLine);
  if (frozen(sale) || (saved.length > 0 && raws.length === 0)) {
    const total = new D(String(sale?.commissionAmount ?? 0));
    const valid = saved.length > 0 && saved.every(l => amount(l.commissionAmount ?? l.productCommission) !== null);
    if (frozen(sale) && (!valid || !saved.reduce((s,l) => s.plus(String(l.commissionAmount ?? l.productCommission)),new D(0)).equals(total))) {
      const reason = valid ? 'HISTORICAL_TOTAL_MISMATCH' : 'HISTORICAL_SNAPSHOT_MISSING';
      const lines = display.map(l => ({ ...l, commissionState: reason, missingReason: reason, configurationMessage: messages[reason] }));
      return { ...summarizeInvoiceLines(lines), commissionSource: 'APPROVED_HISTORY', commissionState: 'HISTORICAL_RECONCILIATION_REQUIRED', rateDisplay: 'Approved item breakdown unavailable',
        recordedCommissionAmount: total.toNumber(), reconciliationMessage: messages[reason], approvalStatus: sale!.status };
    }
    const lines = await Promise.all(saved.map(async (s,i) => {
      const raw = raws.find(r => String(r.lineItemId ?? r.saleItemId ?? '') === String(s.saleItemId ?? s.lineItemId ?? '__missing')) ??
        raws.find(r => String(r.productID ?? r.productId) === String(s.productID ?? s.productId)) ?? s;
      const base = displayLine({ ...raw, ...s },i);
      let subcatId = s.subcategoryId ?? null;
      let subcatName = s.subcategoryName ?? s.subcategory ?? base.subcategoryName;
      let rateVal = amount(s.commissionRate);
      let commAmt = amount(s.commissionAmount ?? s.productCommission);
      let commType = s.commissionType ?? 'PERCENTAGE';
      let fixedBasis = s.fixedBasis ?? 'UNIT';
      let saleAmt = amount(s.eligibleSaleAmount ?? s.eligibleRevenue ?? s.saleAmount ?? s.productNetAmount) ?? 0;

      if ((rateVal === null || rateVal === 0 || commAmt === null || commAmt === 0) && saleAmt > 0) {
        try {
          const subcategory = await resolveSubcategory(tx, {
            id: String(s.saleItemId ?? s.lineItemId ?? s.productID ?? i),
            productId: String(s.productID ?? s.productId ?? base.productName),
            variantId: String(s.variantId ?? s.sku ?? ''),
            quantity: new D(String(s.quantity ?? 1)),
            subcategoryExternalId: s.subcategoryId ?? s.subcategoryExternalId ?? undefined,
            subcategoryName: subcatName ?? undefined,
          }, context.at);
          if (subcategory) {
            subcatId = subcategory.id;
            subcatName = subcategory.name;
            const rateObj = await resolveSubcategoryRate(tx, subcategory.id, context.storeId, context.at);
            if (rateObj && rateObj.rate) {
              rateVal = rateObj.rate.toNumber();
              commType = rateObj.type;
              fixedBasis = rateObj.fixedBasis;
              commAmt = commType === 'PERCENTAGE'
                ? Math.round(((saleAmt * rateVal) / 100) * 100) / 100
                : rateVal * (Number(s.quantity ?? 1));
            }
          }
        } catch {}
      }

      return { ...base, subcategoryId: subcatId, subcategoryName: subcatName,
        subcategory: subcatName,
        eligibleSaleAmount: saleAmt,
        saleAmount: saleAmt,
        commissionRate: rateVal, commissionAmount: commAmt,
        commissionType: commType, fixedBasis, rateId: s.rateId ?? null,
        commissionState: rateVal !== null && commAmt !== null ? 'CONFIGURED' : 'MISSING_CONFIGURATION',
        missingReason: rateVal !== null && commAmt !== null ? null : 'SUBCATEGORY_MAPPING_REQUIRED',
        configurationMessage: rateVal !== null && commAmt !== null ? null : messages.SUBCATEGORY_MAPPING_REQUIRED };
    }));
    const result = summarizeInvoiceLines(lines,'HISTORICAL_SNAPSHOT');
    return { ...result, commissionSource: saved.every(l=>l.commissionSource==='SUBCATEGORY') ? 'SUBCATEGORY_SNAPSHOT' : 'APPROVED_HISTORY',
      rateDisplay: result.commissionRate === null ? 'Recorded item commissions' : result.rateDisplay,
      recordedCommissionAmount: total.toNumber(), approvalStatus: sale?.status ?? 'PENDING' };
  }

  const settings = await tx.hrmCommissionSettings.findUnique({ where: { id: 1 } });
  let doc;
  try {
    doc = normalizePayload({ eventType: 'INVOICE_CREATED', data: { invoice: { ...(meta?.invoice ?? {}),
      invoiceId: context.reference, invoiceDate: meta?.invoice?.invoiceDate ?? meta?.invoice?.date ?? context.at.toISOString(),
      storeId: context.storeId, lineItems: raws } } }, settings ?? { netField:'productNetAmount',netBasis:'UNVERIFIED',discounted:false });
  } catch (e: any) {
    const lines = display.map(l => ({ ...l, missingReason: e.message, configurationMessage: 'Invoice product data requires verification.' }));
    return { ...summarizeInvoiceLines(lines), approvalStatus: sale?.status ?? 'PENDING', reconciliationMessage: e.message };
  }
  const documents = await tx.hrmCommissionDocument.findMany({ where: { storeId: context.storeId, kind: 'SALE', OR: [
    { externalId: context.reference }, { externalId: String(meta?.billId ?? context.reference) }, { invoiceNumber: String(sale?.invoiceNumber ?? meta?.invoiceNumber ?? context.reference) },
  ] } });
  if (doc.cancelled || (documents.length===1 && documents[0].status==='CANCELLED')) return {
    ...summarizeInvoiceLines([]), commissionState:'CANCELLED',commissionAmount:0,commissionEarned:0,totalCommission:0,newCommission:0,
    calculatedCommissionAmount:0,eligibleSaleAmount:0,hasMissingConfiguration:false,rateDisplay:'Commission reversed',approvalStatus:sale?.status??'REJECTED',
    productCommissionBreakdown:display.map(l=>({...l,eligibleSaleAmount:0,saleAmount:0,commissionAmount:0,commissionState:'CANCELLED',missingReason:null,configurationMessage:null})),
  };
  const projected = documents.length === 1 ? await tx.hrmCommissionLine.findMany({ where:{ documentId:documents[0].id } }) : [];
  const lines: any[] = [];
  for (let i=0;i<doc.lines.length;i++) {
    const source: NormalizedLine = doc.lines[i], line = display[i] ?? displayLine(raws[i] ?? {},i);
    try {
      const snapshots = projected.filter(l => l.externalLineId === source.id);
      if (snapshots.length === 1) {
        const s=snapshots[0];
        const returns = await tx.hrmCommissionLine.findMany({ where: { originalSaleLineId:s.id } });
        const revenue = s.eligibleRevenue.minus(returns.reduce((n,r)=>n.plus(r.eligibleRevenue),new D(0)));
        const commission = s.commissionAmount.minus(returns.reduce((n,r)=>n.plus(r.commissionAmount),new D(0)));
        lines.push({ ...line, subcategoryId:s.subcategoryId, subcategoryName:s.subcategoryName, subcategory:s.subcategoryName,
          eligibleSaleAmount:revenue.toNumber(),saleAmount:revenue.toNumber(),commissionRate:s.rate.toNumber(),commissionAmount:commission.toNumber(),
          commissionType:s.type,fixedBasis:s.fixedBasis,rateId:s.rateId,basis:s.basis,commissionState:'CONFIGURED',missingReason:null,configurationMessage:null }); continue;
      }
      const subcategory=await resolveSubcategory(tx,source,doc.occurredAt);
      if (!subcategory) throw new Error('SUBCATEGORY_MAPPING_REQUIRED');
      Object.assign(line,{ subcategoryId:subcategory.id,subcategoryName:subcategory.name,subcategory:subcategory.name });
      const rate=await resolveSubcategoryRate(tx,subcategory.id,context.storeId,doc.occurredAt);
      const revenue=rate.basis==='NET_EX_TAX'?source.exTax:source.inclTax;
      if (revenue===undefined) throw new Error('DISCOUNTED_NET_AMOUNT_BASIS_UNVERIFIED');
      lines.push({ ...line,eligibleSaleAmount:revenue.toNumber(),saleAmount:revenue.toNumber(),commissionRate:rate.rate.toNumber(),
        commissionAmount:revenue.isZero()?0:earning(revenue,source.quantity,rate).toNumber(),commissionType:rate.type,fixedBasis:rate.fixedBasis,rateId:rate.id,
        basis:rate.basis,commissionState:'CONFIGURED',missingReason:null,configurationMessage:null });
    } catch(e:any) { lines.push({ ...line,missingReason:e.message,configurationMessage:messages[e.message] ?? 'Subcategory commission configuration requires review.' }); }
  }
  return { ...summarizeInvoiceLines(lines), approvalStatus: sale?.status ?? 'PENDING' };
}

export async function findInvoicePayload(tx: Tx, aliases: string[]) {
  const ids=[...new Set(aliases.filter(Boolean))];
  const primary=await tx.webhookLog.findFirst({ where:{ OR:[{id:{in:ids}},{billId:{in:ids}}], eventType:{in:['INVOICE_CREATED','INVOICE_UPDATED']} },orderBy:{createdAt:'desc'} });
  if (primary) { try {return { raw:JSON.parse(primary.payload),id:primary.id,createdAt:primary.createdAt };} catch {} }
  const other=await tx.hopkidWebhookLog.findFirst({ where:{OR:[{id:{in:ids}},{billId:{in:ids}}]},orderBy:{createdAt:'desc'} });
  if (other) {try{return {raw:JSON.parse(other.rawPayload),id:other.id,createdAt:other.createdAt};}catch{}}
  for (const id of ids) {
    try {
      const fetched = await fetchHopkidInvoiceDetails(id);
      if (fetched) {
        return { raw: fetched, id, createdAt: new Date() };
      }
    } catch {}
  }
  return null;
}

export async function mobileInvoiceDetail(userId: number, billId: string, role: string) {
  return prisma.$transaction(async tx=>{
    const employee=await tx.employee.findFirst({where:{userId},include:{store:true}});
    if(!employee) throw Object.assign(new Error('Employee profile not found'),{status:404});
    const aliases=[billId,...(/^\d+$/.test(billId)?[`HWM-${billId}`]:[])];
    let sale=await tx.commissionTransaction.findFirst({where:{employeeId:employee.id,OR:[{billId:{in:aliases}},{invoiceNumber:{in:aliases}}]},orderBy:{id:'desc'}});
    if(!sale&&/^\d+$/.test(billId)&&Number(billId)<=2147483647) sale=await tx.commissionTransaction.findFirst({where:{employeeId:employee.id,id:Number(billId)}});
    const payload=await findInvoicePayload(tx,[...aliases,sale?.billId??'',sale?.invoiceNumber??'']);
    const meta=payload?extractWebhookMeta(payload.raw):null;
    if(!sale) {
      const identifiers=new Set([employee.employeeID,employee.employeeCode,employee.mobileNumber].filter(Boolean).map(String));
      const attributed=(meta?.lineItems??[]).some((item:any)=>[item.employeeCode,item.employeeId,item.employeeID,item.employeePhoneNo].some(v=>v!=null&&identifiers.has(String(v)))) || (meta?.employeeIdentifier!=null&&identifiers.has(String(meta.employeeIdentifier)));
      const manager=['ADMIN','SUPERADMIN','SUPER_ADMIN','STORE_MANAGER'].includes(role)&&employee.storeId===meta?.storeId;
      if(!payload||(!attributed&&!manager)) throw Object.assign(new Error('Invoice not found'),{status:404});
    }
    const storeId=sale?.storeId??meta?.storeId;
    if(!storeId) throw Object.assign(new Error('Invoice store is missing'),{status:409});
    const at=sale?.createdAt??payload!.createdAt, reference=sale?.billId??String(meta?.billId??billId);
    const result=await calculateInvoiceCommission(tx,sale,payload?.raw,{storeId,at,reference});
    const number=getNumericInvoiceNumber(sale??{billId:reference,invoiceNumber:meta?.invoiceNumber});
    const invoice=meta?.invoice??{};
    return { billId:number,billNumber:number,invoiceNumber:sale?.invoiceNumber??meta?.invoiceNumber??reference,invoiceNo:sale?.invoiceNumber??meta?.invoiceNumber??reference,
      saleAmount:sale?.saleAmount??Number(meta?.amount??0),grossSale:Number(invoice.grandTotal??invoice.grossAmount??sale?.saleAmount??meta?.amount??0),
      discount:Number(invoice.discountTotal??invoice.discountAmount??invoice.discount??0),tax:Number(invoice.taxTotal??invoice.taxAmount??invoice.tax??0),
      ...result,status:sale?.status??'PENDING',date:invoice.invoiceDate??at,createdAt:at,description:sale?.notes??null,
      oldAmount:0,oldCommission:0,newAmount:sale?.saleAmount??Number(meta?.amount??0),
      customerName:meta?.customerName??null,customerPhone:meta?.customerPhone??null,paymentMode:meta?.paymentMode??null,
      storeName:meta?.storeName??employee.store?.name??null,externalEventId:payload?.id??null,
      products:list(meta?.lineItems).length > 0
        ? list(meta?.lineItems).map((l:any)=>({name:extractProductLineMeta(l).productName??l.name??'Product',quantity:amount(l.quantity??l.qty)??1,price:Number(l.unitPrice??l.productPrice??l.price??0)}))
        : result.productCommissionBreakdown.map((l:any)=>({name:l.productName??'Product',quantity:l.quantity??1,price:l.saleAmount??0})),
      employee:{name:`${employee.firstName} ${employee.lastName}`.trim(),code:employee.employeeCode} };
  },{timeout:30000});
}

/** Existing approval endpoint freezes resolved item snapshots once; never rewrites paid/approved history. */
export async function prepareInvoiceApproval(tx: Tx, sale: CommissionTransaction) {
  if(!isExternalInvoice(sale)||frozen(sale)) return {};
  const siblings=await tx.commissionTransaction.count({where:{storeId:sale.storeId,OR:[...(sale.billId?[{billId:sale.billId}]:[]),...(sale.invoiceNumber?[{invoiceNumber:sale.invoiceNumber}]:[])],employeeId:{not:sale.employeeId},eventType:{in:['INVOICE_CREATED','INVOICE_UPDATED']}}});
  if(siblings) throw Object.assign(new Error('Shared invoice allocation requires accounting review before approval'),{status:409});
  const payload=await findInvoicePayload(tx,[sale.billId??'',sale.invoiceNumber??'']);
  if(!sale.storeId||!payload) throw Object.assign(new Error('Invoice product data is required before commission approval'),{status:409});
  const result=await calculateInvoiceCommission(tx,sale,payload.raw,{storeId:sale.storeId,at:sale.createdAt,reference:sale.billId??sale.invoiceNumber??String(sale.id)});
  if(result.commissionAmount===null) throw Object.assign(new Error('Subcategory commission configuration or invoice data is incomplete'),{status:409});
  return { commissionAmount:result.commissionAmount,newCommission:result.commissionAmount,commissionPercent:result.commissionRate,
    commissionType:result.productCommissionBreakdown.every((l:any)=>l.commissionType==='FIXED')?'FIXED':'PERCENTAGE',
    productBreakdown:JSON.parse(JSON.stringify(result.productCommissionBreakdown.map((l:any)=>({...l,commissionSource:'SUBCATEGORY'})))) };
}
