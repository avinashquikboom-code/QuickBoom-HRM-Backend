import { CommissionTransaction } from '@prisma/client';

/** Stored totals are provisional until every external pending item is resolved. */
export function hasUnresolvedInvoiceItems(sale: Pick<CommissionTransaction, 'status' | 'eventType' | 'productBreakdown'>): boolean {
  if (sale.status !== 'PENDING' || !['INVOICE_CREATED', 'INVOICE_UPDATED'].includes(sale.eventType ?? '')) return false;
  const lines = sale.productBreakdown;
  return !Array.isArray(lines) || lines.length === 0 || lines.some((value: any) =>
    !value || value.commissionState !== 'CONFIGURED' || value.commissionAmount == null || !!value.missingReason);
}
