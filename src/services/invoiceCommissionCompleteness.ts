import { CommissionTransaction } from '@prisma/client';

/** Stored totals are provisional until every external pending item is resolved. */
export function hasUnresolvedInvoiceItems(sale: Partial<CommissionTransaction>): boolean {
  if (sale.status !== 'PENDING' || !['INVOICE_CREATED', 'INVOICE_UPDATED'].includes(sale.eventType ?? '')) return false;
  const lines = sale.productBreakdown;
  const hasExplicitError = Array.isArray(lines) && lines.some((value: any) =>
    value && (value.commissionState === 'INVOICE_DATA_MISSING' || value.commissionState === 'MISSING_CONFIGURATION' || !!value.missingReason));
  if (hasExplicitError) return true;
  return !Array.isArray(lines) || lines.length === 0 || lines.some((value: any) =>
    !value || value.commissionState !== 'CONFIGURED' || value.commissionAmount == null || value.commissionRate == null || !!value.missingReason);
}
