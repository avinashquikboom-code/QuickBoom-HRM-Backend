import { CommissionTransaction } from '@prisma/client';
import { hasUnresolvedInvoiceItems } from './invoiceCommissionCompleteness';

const numeric = (value: unknown): number | null => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
/** Projection of recorded policy/snapshot values. Never estimates a policy from revenue or employee defaults. */
export function recordedInvoiceCommission(sale: Partial<CommissionTransaction>) {
  const recordedEarned = numeric(sale.commissionAmount);
  const lines = Array.isArray(sale.productBreakdown) ? (sale.productBreakdown as any[]) : [];
  const missingData = !lines.length || lines.some(line => line?.commissionState === 'INVOICE_DATA_MISSING');
  const missingConfig = lines.some(line => line?.commissionState === 'MISSING_CONFIGURATION' || (line?.missingReason && line.missingReason !== ''));
  const hasRealFailure = sale.status === 'PENDING' && (missingData || missingConfig);

  const unresolved = hasRealFailure || hasUnresolvedInvoiceItems(sale);
  const fullyRated = lines.length > 0 && lines.every(line => line && numeric(line.commissionRate) !== null);
  const signatures = new Set(lines.map(line => `${line?.commissionType ?? sale.commissionType}:${line?.commissionRate}:${line?.fixedBasis ?? 'UNIT'}`));
  const mixed = fullyRated && signatures.size > 1;
  const rawRate = unresolved || mixed ? null : fullyRated ? numeric(lines[0].commissionRate) : numeric(sale.commissionPercent);
  const rawType = fullyRated && !mixed ? (lines[0].commissionType ?? sale.commissionType) : sale.commissionType;
  const fixedBasis = fullyRated && !mixed ? (lines[0].fixedBasis ?? 'UNIT') : (sale as any)?.fixedBasis ?? 'UNIT';
  const earned = unresolved ? null : recordedEarned;

  // Bill #116 / rate consistency: A positive commission with rate: 0 is a fixed/unit commission, never 0%.
  const isFixed = rawType === 'FIXED' || (rawRate === 0 && earned !== null && earned > 0);
  const type = isFixed ? 'FIXED' : rawType;
  const rate = isFixed
    ? ((rawRate !== null && rawRate > 0) ? rawRate : (earned !== null && earned > 0 ? earned : rawRate))
    : rawRate;

  const reason = unresolved ? (lines.find(line => line?.missingReason)?.missingReason ?? (missingData ? 'PRODUCT_LINES_MISSING' : 'CONFIGURATION_REQUIRED')) : null;
  const state = unresolved ? (missingData ? 'INVOICE_DATA_MISSING' : 'MISSING_CONFIGURATION') : 'COMPLETE';
  const rateDisplay = unresolved
    ? (missingData ? (String(reason??'').startsWith('SALE_DATE') ? 'Invoice sale timestamp unavailable' : reason === 'STORE_ID_MISSING' ? 'Invoice store mapping unavailable' : 'Invoice item data unavailable') : 'Configuration required')
    : mixed
    ? 'Multiple subcategory rates'
    : rate === null
    ? 'Rate unavailable'
    : type === 'FIXED'
    ? `₹${rate} / ${fixedBasis === 'LINE' ? 'line' : 'unit'}`
    : `${rate}%`;
  return {
    commissionRate: rate, commissionPercent: rate, commissionPercentage: rate, commissionType: type, fixedBasis,
    commissionAmount: earned, commissionEarned: earned, commission: earned, totalCommission: earned,
    hasUnresolvedInvoiceItems: unresolved, hasMissingConfiguration: unresolved && !missingData, hasMissingInvoiceData: unresolved && missingData,
    productCommissionBreakdown:lines,productWiseCommission:lines,
    commissionSource:unresolved?'UNRESOLVED':(sale as any).commissionSource??(lines.length>0&&lines.every(line=>line.commissionState==='CONFIGURED')?'SUBCATEGORY':'RECORDED'),
    saleOccurredAt:(sale as any).saleOccurredAt??null,saleTimestampField:(sale as any).saleTimestampField??null,
    saleTimeZone:(sale as any).saleTimeZone??null,saleTimeZoneSource:(sale as any).saleTimeZoneSource??null,
    commissionState: state, missingReason: reason, rateDisplay
  };
}
