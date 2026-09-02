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
    const rate = Number(t.commissionPercent ?? t.employee?.commissionPercentage ?? 1);
    const effectiveSale = Number(t.newAmount !== undefined && t.newAmount !== null && Number(t.newAmount) > 0 ? t.newAmount : (t.saleAmount || 0));
    let comm = Number(t.newCommission !== undefined && t.newCommission !== null && Number(t.newCommission) > 0 ? t.newCommission : (t.commissionAmount || 0));
    if (!comm || comm === 0) {
      comm = Math.round(((effectiveSale * rate) / 100) * 100) / 100;
    }
    const invStr = (t.invoiceNumber && typeof t.invoiceNumber === 'string' && !/^[0-9a-fA-F-]{36}$/.test(t.invoiceNumber))
      ? t.invoiceNumber
      : `HWM-${numInv}`;

    const formattedTxn = {
      ...t,
      billId: numInv,
      billNumber: numInv,
      invoiceNumber: invStr,
      invoiceNo: invStr,
      saleAmount: Number(t.saleAmount || 0),
      commissionAmount: comm,
      commissionPercent: rate,
      totalCommission: comm,
      oldAmount: Number(t.oldAmount || 0),
      newAmount: Number(t.newAmount || t.saleAmount || 0),
      oldCommission: Number(t.oldCommission || 0),
      newCommission: Number(t.newCommission || comm),
    };

    if (!map.has(key)) {
      map.set(key, formattedTxn);
    } else {
      // If true duplicate records exist in the query result for exact same employeeId and billId, keep the newest one
      const existing = map.get(key)!;
      if (t.createdAt && existing.createdAt && new Date(t.createdAt) > new Date(existing.createdAt)) {
        map.set(key, formattedTxn);
      }
    }
  }

  return Array.from(map.values());
}

