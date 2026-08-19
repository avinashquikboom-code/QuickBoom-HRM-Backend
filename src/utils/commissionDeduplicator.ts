/**
 * Commission Deduplicator & Aggregator Utility
 *
 * Ensures that Commission Transactions are strictly aggregated 1-to-1 per (Invoice Number + Employee ID).
 * Deduplicates line-item level database records for Admin Panel & Mobile APIs while preserving historical amounts.
 */

export interface RawCommissionTxn {
  id: number;
  employeeId: number;
  billId?: string | null;
  invoiceNumber?: string | null;
  saleAmount: number | string;
  commissionAmount: number | string;
  createdAt: Date | string;
  [key: string]: any;
}

export function deduplicateCommissionTransactions<T extends RawCommissionTxn>(transactions: T[]): T[] {
  if (!transactions || transactions.length === 0) return [];

  const map = new Map<string, T>();

  for (const t of transactions) {
    let invoiceKey = t.invoiceNumber || t.billId || `TXN-${t.id}`;
    
    // Normalize invoiceKey: strip line-item suffix e.g. "INV-1001-ProductA-NEW" -> "INV-1001-NEW" or "INV-1001"
    if (invoiceKey.includes('-') && (invoiceKey.includes('-RET') || invoiceKey.includes('-NEW'))) {
      const parts = invoiceKey.split('-');
      const flag = invoiceKey.includes('-RET') ? 'RET' : 'NEW';
      const baseNo = parts[0];
      invoiceKey = `${baseNo}-${flag}`;
    } else if (invoiceKey.includes('-') && !invoiceKey.startsWith('TXN-')) {
      const parts = invoiceKey.split('-');
      if (parts.length > 2) {
        invoiceKey = parts[0];
      }
    }

    const key = `${t.employeeId}_${invoiceKey}`;

    if (!map.has(key)) {
      map.set(key, {
        ...t,
        invoiceNumber: t.invoiceNumber || invoiceKey,
        billId: invoiceKey,
        saleAmount: Number(t.saleAmount || 0),
        commissionAmount: Number(t.commissionAmount || 0),
      });
    } else {
      const existing = map.get(key)!;
      existing.saleAmount = Number((Number(existing.saleAmount) + Number(t.saleAmount || 0)).toFixed(2));
      existing.commissionAmount = Number((Number(existing.commissionAmount) + Number(t.commissionAmount || 0)).toFixed(2));
      if (t.createdAt && existing.createdAt && new Date(t.createdAt) > new Date(existing.createdAt)) {
        existing.createdAt = t.createdAt;
      }
    }
  }

  return Array.from(map.values());
}
