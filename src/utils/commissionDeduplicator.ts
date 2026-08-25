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
    const rawBill = String(t.billId || t.invoiceNumber || '').trim();
    const invoiceKey = rawBill || `TXN-${t.id}`;
    const key = `${t.employeeId}_${invoiceKey}`;

    if (!map.has(key)) {
      map.set(key, {
        ...t,
        invoiceNumber: t.invoiceNumber || rawBill || `TXN-${t.id}`,
        billId: t.billId || rawBill || `TXN-${t.id}`,
        saleAmount: Number(t.saleAmount || 0),
        commissionAmount: Number(t.commissionAmount || 0),
      });
    } else {
      // If true duplicate records exist in the query result for exact same employeeId and billId, keep the newest one
      const existing = map.get(key)!;
      if (t.createdAt && existing.createdAt && new Date(t.createdAt) > new Date(existing.createdAt)) {
        map.set(key, {
          ...t,
          invoiceNumber: t.invoiceNumber || rawBill || `TXN-${t.id}`,
          billId: t.billId || rawBill || `TXN-${t.id}`,
          saleAmount: Number(t.saleAmount || 0),
          commissionAmount: Number(t.commissionAmount || 0),
        });
      }
    }
  }

  return Array.from(map.values());
}

