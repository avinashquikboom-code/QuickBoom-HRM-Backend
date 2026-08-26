import { getNumericInvoiceNumber } from './commissionHelper';

export interface RawCommissionTxn {
  id: number;
  employeeId: number;
  billId?: string | null;
  invoiceNumber?: string | number | null;
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
    const numInv = getNumericInvoiceNumber(t);

    if (!map.has(key)) {
      map.set(key, {
        ...t,
        invoiceNumber: numInv,
        billNumber: numInv,
        invoiceNo: numInv,
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
          invoiceNumber: numInv,
          billNumber: numInv,
          invoiceNo: numInv,
          billId: t.billId || rawBill || `TXN-${t.id}`,
          saleAmount: Number(t.saleAmount || 0),
          commissionAmount: Number(t.commissionAmount || 0),
        });
      }
    }
  }

  return Array.from(map.values());
}

