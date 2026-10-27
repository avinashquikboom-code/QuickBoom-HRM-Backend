import { Prisma } from '@prisma/client';
import { date, pick, requireValue } from '../hrmCommission/normalize';

const saleFields = ['invoiceDate','saleDate','generatedDate','date','invoice_date','sale_date','generated_date'];
export function invoiceTimestampField(invoice: any): {field: string; value: unknown} | null {
  for (const field of [...saleFields,'createdAt','created_at']) {
    if (invoice?.[field] !== undefined && invoice[field] !== null && invoice[field] !== '') return {field,value:invoice[field]};
  }
  return null;
}

/** A source sale clock and a database/webhook receipt clock are independent. */
export async function resolveInvoiceSaleTime(tx: Prisma.TransactionClient, invoice: any, storeId: number, persistedSaleTime?: Date) {
  const selected=invoiceTimestampField(invoice);
  if (!selected) {
    requireValue(persistedSaleTime instanceof Date && Number.isFinite(persistedSaleTime.getTime()),'SALE_DATE_MISSING');
    return {occurredAt:persistedSaleTime,field:'persistedSaleTime',timeZone:'UTC',timeZoneSource:'PERSISTED_SALE',rawValue:persistedSaleTime.toISOString()};
  }
  const creationField=['createdAt','created_at'].includes(selected.field);
  let configuredZone=pick(invoice,creationField?['createdAtTimeZone','createdAtTimezone']:['saleTimeZone','saleTimezone'])
    ?? pick(invoice,['timeZone','timezone']);
  let provenance=configuredZone?'INVOICE_METADATA':null;
  const rawValue=selected.value;
  const explicitInstant=rawValue instanceof Date || (typeof rawValue==='string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawValue.trim()));
  if (!explicitInstant && !configuredZone) {
    if (tx.systemSetting?.findUnique) {
      const settings=await tx.systemSetting.findUnique({where:{id:1},select:{integrations:true}});
      const config=settings?.integrations as any;
      configuredZone=config?.hopkidStoreTimezones?.[String(storeId)]??config?.hopkidInvoiceTimeZone;
      if(configuredZone) provenance=config?.hopkidStoreTimezones?.[String(storeId)]?'STORE_SOURCE_CONTRACT':'HOPKID_SOURCE_CONTRACT';
    }
    if (!configuredZone) {
      configuredZone = 'Asia/Kolkata';
      provenance = 'STORE_SOURCE_CONTRACT';
    }
  }
  const calendarDate=typeof rawValue==='string' && /^\d{4}-\d{2}-\d{2}$/.test(rawValue.trim());
  if(!explicitInstant && !calendarDate) requireValue(typeof configuredZone==='string' && configuredZone.trim().length>0,'SALE_DATE_TIMEZONE_REQUIRED');
  const occurredAt=date(rawValue,'SALE_DATE',typeof configuredZone==='string'?configuredZone:undefined);
  const actualZone=explicitInstant?(rawValue instanceof Date?'UTC':String(rawValue).trim().match(/(?:Z|[+-]\d{2}:?\d{2})$/i)?.[0]??null)
    :configuredZone??'DATE_ONLY_IST_CONTRACT';
  return {occurredAt,field:selected.field,timeZone:actualZone,timeZoneSource:explicitInstant?'SOURCE_TIMESTAMP':provenance??'DATE_ONLY_CONTRACT',
    rawValue:rawValue instanceof Date?rawValue.toISOString():rawValue};
}
