import { Prisma } from '@prisma/client';
import { date, pick, requireValue } from '../hrmCommission/normalize';

const saleFields = ['invoiceDate','saleDate','generatedDate','date','invoice_date','sale_date','generated_date'];
export function invoiceTimestampField(invoice: any): {field: string; value: unknown} | null {
  for (const field of [...saleFields,'createdAt','created_at']) {
    if (invoice?.[field] !== undefined && invoice[field] !== null && invoice[field] !== '') return {field,value:invoice[field]};
  }
  return null;
}

/** Source sale time is independent of webhook/database receipt time. No profile/host timezone. */
export async function resolveInvoiceSaleTime(tx: Prisma.TransactionClient, invoice: any, storeId: number,
  persistedSaleTime?: Date) {
  const source = invoiceTimestampField(invoice);
  if (!source) {
    requireValue(persistedSaleTime instanceof Date && Number.isFinite(persistedSaleTime.getTime()),'SALE_DATE_MISSING');
    return {occurredAt:persistedSaleTime,field:'persistedSaleTime',timeZone:'UTC',timeZoneSource:'PERSISTED_SALE',rawValue:persistedSaleTime.toISOString()};
  }
  const fromCreation = ['createdAt','created_at'].includes(source.field);
  // A UTC createdAt cannot supply the timezone for a separate naive invoiceDate.
  let zone = pick(invoice, fromCreation ? ['createdAtTimeZone','createdAtTimezone'] : ['saleTimeZone','saleTimezone']);
  zone ??= pick(invoice,['timeZone','timezone']);
  let timeZoneSource = zone ? 'INVOICE_METADATA' : null;
  const raw = source.value;
  const qualified = raw instanceof Date || (typeof raw === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw.trim()));
  if (!qualified && !zone && tx.systemSetting?.findUnique) {
    const settings=await tx.systemSetting.findUnique({where:{id:1},select:{integrations:true}});
    const integrations=settings?.integrations as any;
    zone=integrations?.hopkidStoreTimezones?.[String(storeId)] ?? integrations?.hopkidInvoiceTimeZone;
    if (zone) timeZoneSource=integrations?.hopkidStoreTimezones?.[String(storeId)]?'STORE_SOURCE_CONTRACT':'HOPKID_SOURCE_CONTRACT';
  }
  const dateOnly=typeof raw==='string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim());
  if (!qualified && !dateOnly) requireValue(typeof zone==='string' && zone.trim().length>0,'SALE_DATE_TIMEZONE_REQUIRED');
  const occurredAt=date(raw,'SALE_DATE',typeof zone==='string'?zone:undefined);
  return {occurredAt,field:source.field,timeZone:qualified?(raw instanceof Date?'UTC':String(raw).trim().match(/(?:Z|[+-]\d{2}:?\d{2})$/i)?.[0]??null):zone??'DATE_ONLY_IST_CONTRACT',
    timeZoneSource:qualified?'SOURCE_TIMESTAMP':timeZoneSource??'DATE_ONLY_CONTRACT',rawValue:raw instanceof Date?raw.toISOString():raw};
}
