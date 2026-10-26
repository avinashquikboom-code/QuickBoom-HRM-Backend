import { CommissionTransaction } from '@prisma/client';
import { hasUnresolvedInvoiceItems } from './invoiceCommissionCompleteness';

const numeric = (value: unknown): number | null => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
/** Projection of recorded policy/snapshot values. Never estimates a policy from revenue or employee defaults. */
export function recordedInvoiceCommission(sale: Partial<CommissionTransaction>) {
  const unresolved=hasUnresolvedInvoiceItems(sale);
  const lines=Array.isArray(sale.productBreakdown)?sale.productBreakdown as any[]:[];
  const fullyRated=lines.length>0&&lines.every(line=>line&&numeric(line.commissionRate)!==null);
  const signatures=new Set(lines.map(line=>`${line?.commissionType??sale.commissionType}:${line?.commissionRate}:${line?.fixedBasis??'UNIT'}`));
  const mixed=fullyRated&&signatures.size>1;
  const rate=unresolved||mixed?null:fullyRated?numeric(lines[0].commissionRate):numeric(sale.commissionPercent);
  const type=fullyRated&&!mixed?(lines[0].commissionType??sale.commissionType):sale.commissionType;
  const fixedBasis=fullyRated&&!mixed?(lines[0].fixedBasis??'UNIT'):null;
  const earned=unresolved?null:numeric(sale.commissionAmount);
  const missingData=unresolved&&(!lines.length||lines.some(line=>line?.commissionState==='INVOICE_DATA_MISSING'));
  const reason=unresolved?(lines.find(line=>line?.missingReason)?.missingReason??'PRODUCT_LINES_MISSING'):null;
  const state=unresolved?(missingData?'INVOICE_DATA_MISSING':'MISSING_CONFIGURATION'):'COMPLETE';
  const rateDisplay=unresolved?(missingData?'Invoice item data unavailable':'Configuration required'):mixed?'Multiple subcategory rates':rate===null?'Rate unavailable':type==='FIXED'?`₹${rate} / ${fixedBasis==='LINE'?'line':'unit'}`:`${rate}%`;
  return {commissionRate:rate,commissionPercent:rate,commissionPercentage:rate,commissionType:type,fixedBasis,
    commissionAmount:earned,commissionEarned:earned,commission:earned,totalCommission:earned,
    hasUnresolvedInvoiceItems:unresolved,hasMissingConfiguration:unresolved&&!missingData,hasMissingInvoiceData:missingData,
    commissionState:state,missingReason:reason,rateDisplay};
}
