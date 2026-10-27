import { CommissionTransaction, Prisma } from '@prisma/client';
import { prisma } from '../utils/db';
import { extractWebhookMeta, getNumericInvoiceNumber } from '../utils/commissionHelper';
import { calculateInvoiceCommission, findInvoicePayload, isExternalInvoice, resolveInvoiceStore } from './invoiceCommissionService';
import { hasUnresolvedInvoiceItems } from './invoiceCommissionCompleteness';

/** Read-only shared result for details, activity and wallet. Never approves or posts wallet money. */
export async function projectInvoiceCommissionForRead<T extends CommissionTransaction>(sale:T, tx:Prisma.TransactionClient=prisma):Promise<T> {
  if (!isExternalInvoice(sale) || sale.status !== 'PENDING' || !hasUnresolvedInvoiceItems(sale)) return sale;
  const rawAliases = [sale.billId ?? '', sale.invoiceNumber ?? '', String(sale.id)].filter(Boolean);
  const numInv = getNumericInvoiceNumber(sale);
  const aliases = [...new Set([...rawAliases, ...(numInv > 0 ? [String(numInv), `HWM-${numInv}`, `INV-${numInv}`] : [])])];
  const payload = await findInvoicePayload(tx, aliases, sale.storeId);
  const meta = payload ? extractWebhookMeta(payload.raw) : null;
  const storeId = await resolveInvoiceStore(tx, { sale, meta, aliases, persist: false });
  if (!storeId) return sale;
  const result=await calculateInvoiceCommission(tx,sale,payload?.raw,{storeId,at:sale.createdAt,
    reference:sale.billId??sale.invoiceNumber??String(sale.id),sourceRecordedAt:payload?.createdAt});
  // Unknown amounts remain explicitly unresolved in recordedInvoiceCommission.
  return {...sale,storeId,
    ...((result as any).saleOccurredAt?{createdAt:new Date((result as any).saleOccurredAt)}:{}),
    commissionSource:result.commissionSource,
    saleOccurredAt:(result as any).saleOccurredAt??null,saleTimestampField:(result as any).saleTimestampField??null,
    saleTimeZone:(result as any).saleTimeZone??null,saleTimeZoneSource:(result as any).saleTimeZoneSource??null,
    ...(result.commissionAmount!==null?{commissionAmount:result.commissionAmount,newCommission:result.commissionAmount,
      commissionPercent:result.commissionRate,commissionType:result.productCommissionBreakdown.every((line:any)=>line.commissionType==='FIXED')?'FIXED':'PERCENTAGE'}:{}),
    productBreakdown:JSON.parse(JSON.stringify(result.productCommissionBreakdown)),
  };
}
export async function projectInvoiceCommissionsForRead<T extends CommissionTransaction>(sales:T[], tx:Prisma.TransactionClient=prisma):Promise<T[]> {
  const result:T[]=[];
  // Bound database concurrency for wallets with many unresolved invoices.
  for (const sale of sales) result.push(await projectInvoiceCommissionForRead(sale,tx));
  return result;
}
