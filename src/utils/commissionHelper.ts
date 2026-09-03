import { prisma } from './db';

/**
 * Safely parses any amount value (number or string with currency symbols/commas).
 * Example: "1,056.00" -> 1056, "₹1,056.00" -> 1056.
 */
export function safeParseAmount(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.abs(val);
  const cleanStr = String(val).replace(/,/g, '').replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleanStr);
  return isNaN(num) ? 0 : Math.abs(num);
}

/**
 * Resolves the IsOld flag from a transaction or line item.
 * IsOld = 1 / true -> Returned / Old Item / Credit Note (Commission SUBTRACTED / REVERSED)
 * IsOld = 0 / false -> New Sold Item / POS Sale (Commission ADDED / POSITIVE)
 */
export function parseIsOld(item: any): boolean {
  if (item === null || item === undefined) return false;
  const val = item.IsOld ?? item.isOld ?? item.is_old ?? item.Is_Old ?? item.isOldItem;
  if (val === true || val === 1 || val === '1' || String(val).trim().toLowerCase() === 'true') {
    return true;
  }
  return false;
}

/**
 * Calculates the current/effective contribution of a commission transaction:
 * - Returns the current/effective sale amount and commission amount.
 * - Historical old values are preserved in the record for audit/history, but are never added to current earnings.
 */
export function getTransactionNetContribution(t: {
  eventType?: string | null;
  saleAmount: number | string;
  commissionAmount: number | string;
  oldAmount?: number | string | null;
  newAmount?: number | string | null;
  oldCommission?: number | string | null;
  newCommission?: number | string | null;
  commissionDifference?: number | string | null;
}): { netSales: number; netCommission: number } {
  const currentSales = t.newAmount !== null && t.newAmount !== undefined && Number(t.newAmount) > 0
    ? Number(t.newAmount)
    : Number(t.saleAmount || 0);

  const currentCommission = t.newCommission !== null && t.newCommission !== undefined && Number(t.newCommission) > 0
    ? Number(t.newCommission)
    : Number(t.commissionAmount || 0);

  return {
    netSales: currentSales,
    netCommission: currentCommission,
  };
}

export interface NormalizedBillReconciliation {
  oldBillAmount: number | null;
  differenceAmount: number | null;
  newBillAmount: number | null;
  oldBillCommission: number | null;
  commissionDifference: number | null;
  newBillCommission: number | null;
}

/**
 * Resolves full bill and commission reconciliation (Old Bill, New Bill, Difference, Old Comm, New Comm, Comm Diff)
 * Core business rule:
 *   Original Bill is the OLD BILL.
 *   Exchange / Credit Note is the NEW BILL.
 *   differenceAmount = oldBillAmount - newBillAmount (e.g. 848 - 1398 = -550)
 *   commissionDifference = oldBillCommission - newBillCommission (e.g. 8.48 - 13.98 = -5.50)
 * For normal Invoice Created:
 *   oldBillAmount: null, differenceAmount: null, newBillAmount: null, oldBillCommission: null, commissionDifference: null, newBillCommission: actualCommission
 */
export function resolveBillAndCommissionReconciliation(params: {
  eventType?: string | null;
  billId?: string | number | null;
  invoiceNumber?: string | number | null;
  invoiceNo?: string | number | null;
  amount?: number | string | null;
  commissionAmount?: number | string | null;
  commissionPercent?: number | string | null;
  employeeRate?: number | string | null;
  notes?: string | null;
  description?: string | null;
  payload?: any;
  oldAmount?: number | string | null;
  oldBillAmount?: number | string | null;
  newAmount?: number | string | null;
  newBillAmount?: number | string | null;
  differenceAmount?: number | string | null;
  oldCommission?: number | string | null;
  oldBillCommission?: number | string | null;
  newCommission?: number | string | null;
  newBillCommission?: number | string | null;
  commissionDifference?: number | string | null;
  cnAmount?: number | string | null;
  lookups?: {
    salesMap?: Map<string, any>;
    creditNotesMap?: Map<string, any>;
    exchangesMap?: Map<string, any>;
    invoiceLogMap?: Map<string, any>;
    transactionsMap?: Map<string, any>;
  };
}): NormalizedBillReconciliation {
  const normKey = (s: any) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const evStr = String(params.eventType || '').toUpperCase();
  const billStr = String(params.billId || params.invoiceNumber || params.invoiceNo || '').toUpperCase();
  const notesStr = String(params.notes || params.description || '');

  let parsedPayload: any = {};
  if (params.payload) {
    if (typeof params.payload === 'object') {
      parsedPayload = params.payload;
    } else if (typeof params.payload === 'string') {
      try {
        parsedPayload = JSON.parse(params.payload);
      } catch {
        parsedPayload = {};
      }
    }
  }

  const isCreditNote =
    evStr.includes('CREDIT_NOTE') ||
    billStr.startsWith('CN-') ||
    billStr.startsWith('HKACN') ||
    notesStr.toUpperCase().includes('CREDIT NOTE') ||
    notesStr.toUpperCase().includes('CREDIT_NOTE') ||
    (params.cnAmount !== undefined && params.cnAmount !== null && Number(params.cnAmount) > 0) ||
    Boolean(parsedPayload?.data?.creditNote || parsedPayload?.creditNote || parsedPayload?.CreditNoteProducts);

  const isExchange =
    evStr.includes('EXCHANGE') ||
    billStr.startsWith('EX-') ||
    billStr.startsWith('INV-EX-') ||
    notesStr.toUpperCase().includes('EXCHANGE') ||
    Boolean(parsedPayload?.data?.salesExchange || parsedPayload?.salesExchange || parsedPayload?.SalesExchangeProductList || parsedPayload?.data?.SalesExchangeProductList);

  const isInvoiceUpdated =
    evStr.includes('INVOICE_UPDATED') ||
    notesStr.toUpperCase().includes('INVOICE_UPDATED');

  const isAdjustment = isCreditNote || isExchange || isInvoiceUpdated;

  const rawAmount = safeParseAmount(params.amount);
  const commRate = params.commissionPercent !== undefined && params.commissionPercent !== null && !isNaN(Number(params.commissionPercent))
    ? Number(params.commissionPercent)
    : (params.employeeRate !== undefined && params.employeeRate !== null && !isNaN(Number(params.employeeRate)) ? Number(params.employeeRate) : 1);

  // Parse notes regex for old/new amounts (e.g. "Original Bill: ₹848", "Old Amount: ₹848", "CN Amount: ₹1398", "New Amount: ₹1398")
  const oldNotesMatch = notesStr.match(/(?:Original Bill|Old Amount|Old Bill|Original Amount):\s*[₹$]?([0-9.]+)/i);
  const newNotesMatch = notesStr.match(/(?:CN Amount|New Amount|Replacement Amount|New Bill):\s*[₹$]?([0-9.]+)/i);
  const notesOld = oldNotesMatch ? Number(oldNotesMatch[1]) : null;
  const notesNew = newNotesMatch ? Number(newNotesMatch[1]) : null;

  // 1. Normal Invoice Created: No related Exchange / Credit Note
  if (!isAdjustment && (!notesOld || notesOld <= 0) && (!params.oldBillAmount || Number(params.oldBillAmount) <= 0) && (!params.oldAmount || Number(params.oldAmount) <= 0)) {
    const directComm = params.commissionAmount !== undefined && params.commissionAmount !== null && !isNaN(Number(params.commissionAmount)) && Number(params.commissionAmount) > 0
      ? Number(params.commissionAmount)
      : (params.newBillCommission !== undefined && params.newBillCommission !== null && Number(params.newBillCommission) > 0
          ? Number(params.newBillCommission)
          : (params.newCommission !== undefined && params.newCommission !== null && Number(params.newCommission) > 0
              ? Number(params.newCommission)
              : Math.round(((rawAmount * commRate) / 100) * 100) / 100));

    return {
      oldBillAmount: null,
      differenceAmount: null,
      newBillAmount: null,
      oldBillCommission: null,
      commissionDifference: null,
      newBillCommission: directComm,
    };
  }

  // 2. Adjustment: Resolve Old Bill Amount
  let oldBillAmount: number | null = null;
  let oldBillCommission: number | null = null;

  // For exchanges, first check if explicit previous bill / exchange record exists
  if (isExchange) {
    const ex = parsedPayload?.data?.salesExchange || parsedPayload?.salesExchange || parsedPayload || {};
    const refInv =
      ex.originalInvoiceNo ||
      ex.originalInvoiceNumber ||
      ex.originalBillId ||
      ex.originalInvoiceId ||
      ex.refInvoiceNo ||
      ex.refInvoiceNumber ||
      ex.salesID ||
      ex.SalesID ||
      ex.parentInvoiceId ||
      ex.parentInvoiceNo ||
      ex.relatedInvoiceId ||
      ex.relatedInvoiceNo ||
      parsedPayload?.salesID ||
      parsedPayload?.SalesID ||
      parsedPayload?.originalInvoiceNo ||
      parsedPayload?.originalInvoiceNumber;

    if (params.lookups?.exchangesMap) {
      const cleanBill = String(params.billId || billStr || '').trim();
      const cleanInvNo = String(params.invoiceNo || params.invoiceNumber || '').trim();
      const baseBill = cleanBill.replace(/-(NEW|RET)$/i, '').replace(/^HWM-/i, '');
      const baseInv = cleanInvNo.replace(/-(NEW|RET)$/i, '').replace(/^HWM-/i, '');

      const exRec =
        params.lookups.exchangesMap.get(normKey(billStr)) ||
        params.lookups.exchangesMap.get(normKey(params.billId)) ||
        params.lookups.exchangesMap.get(normKey(params.invoiceNo)) ||
        params.lookups.exchangesMap.get(normKey(params.invoiceNumber)) ||
        params.lookups.exchangesMap.get(normKey(cleanBill)) ||
        params.lookups.exchangesMap.get(normKey(cleanInvNo)) ||
        params.lookups.exchangesMap.get(normKey(baseBill)) ||
        params.lookups.exchangesMap.get(normKey(baseInv)) ||
        params.lookups.exchangesMap.get(normKey(ex.exchangeNo)) ||
        params.lookups.exchangesMap.get(normKey(ex.newInvoiceNo)) ||
        params.lookups.exchangesMap.get(normKey(ex.originalInvoiceNo)) ||
        (refInv ? params.lookups.exchangesMap.get(normKey(refInv)) : null);

      if (exRec) {
        if (Number(exRec.originalAmount) > 0) oldBillAmount = Number(exRec.originalAmount);
        if (Number(exRec.originalCommission) > 0) oldBillCommission = Number(exRec.originalCommission);
      }
    }

    // Check line items for IsOld: true items (returned items from original bill)
    if (oldBillAmount === null) {
      const rawExchangeItems =
        parsedPayload?.SalesExchangeProductList ||
        parsedPayload?.data?.SalesExchangeProductList ||
        parsedPayload?.data?.lineItems ||
        parsedPayload?.lineItems ||
        [];
      if (Array.isArray(rawExchangeItems) && rawExchangeItems.length > 0) {
        let oldItemsSum = 0;
        for (const item of rawExchangeItems) {
          if (parseIsOld(item)) {
            const itemAmt = Number(item.productNetAmount || item.Total || item.price || item.amount || item.netAmount || 0);
            if (!isNaN(itemAmt) && itemAmt > 0) {
              oldItemsSum += itemAmt;
            }
          }
        }
        if (oldItemsSum > 0) {
          oldBillAmount = oldItemsSum;
        }
      }
    }

    if (oldBillAmount === null && Number(ex.originalAmount || ex.oldAmount || ex.returnAmount || ex.originalBillAmount) > 0) {
      oldBillAmount = Number(ex.originalAmount || ex.oldAmount || ex.returnAmount || ex.originalBillAmount);
    }

    if (oldBillAmount === null && refInv && params.lookups) {
      const origSale =
        params.lookups.salesMap?.get(normKey(refInv)) ||
        params.lookups.salesMap?.get(normKey(String(refInv).replace(/^HWM-/i, ''))) ||
        params.lookups.salesMap?.get(normKey(`HWM-${refInv}`)) ||
        params.lookups.transactionsMap?.get(normKey(refInv)) ||
        params.lookups.transactionsMap?.get(normKey(String(refInv).replace(/^HWM-/i, ''))) ||
        params.lookups.transactionsMap?.get(normKey(`HWM-${refInv}`)) ||
        params.lookups.invoiceLogMap?.get(normKey(refInv)) ||
        params.lookups.invoiceLogMap?.get(normKey(String(refInv).replace(/^HWM-/i, ''))) ||
        params.lookups.invoiceLogMap?.get(normKey(`HWM-${refInv}`));
      if (origSale) {
        oldBillAmount = Number(origSale.netAmount || origSale.saleAmount || origSale.amount || 0) || null;
        oldBillCommission = Number(origSale.commissionAmount || origSale.commission || 0) || null;
      }
    }

    if (oldBillAmount === null && notesOld !== null && notesOld > 0) {
      oldBillAmount = notesOld;
    }

    if (oldBillAmount === null && params.oldBillAmount !== undefined && params.oldBillAmount !== null && Number(params.oldBillAmount) > 0) {
      oldBillAmount = Number(params.oldBillAmount);
    } else if (oldBillAmount === null && params.oldAmount !== undefined && params.oldAmount !== null && Number(params.oldAmount) > 0) {
      oldBillAmount = Number(params.oldAmount);
    } else if (oldBillAmount === null && params.amount !== undefined && params.amount !== null && Number(params.amount) > 0) {
      oldBillAmount = Number(params.amount);
    }
  } else {
    // Non-exchange adjustments (e.g. Credit Note)
    if (params.oldBillAmount !== undefined && params.oldBillAmount !== null && Number(params.oldBillAmount) > 0) {
      oldBillAmount = Number(params.oldBillAmount);
    } else if (params.oldAmount !== undefined && params.oldAmount !== null && Number(params.oldAmount) > 0) {
      oldBillAmount = Number(params.oldAmount);
    } else if (notesOld !== null && notesOld > 0) {
      oldBillAmount = notesOld;
    }

    if (oldBillAmount === null && isCreditNote) {
      const cn = parsedPayload?.data?.creditNote || parsedPayload?.creditNote || {};
      const refInv = cn.invoiceNo || cn.invoiceNumber || cn.salesID || cn.salesExchangeID || params.invoiceNumber || params.invoiceNo;

      if (!refInv && params.lookups?.creditNotesMap) {
        const cnRec =
          params.lookups.creditNotesMap.get(normKey(billStr)) ||
          params.lookups.creditNotesMap.get(normKey(params.billId)) ||
          params.lookups.creditNotesMap.get(normKey(params.invoiceNo));
        if (cnRec?.invoiceNo) {
          const origSale =
            params.lookups.salesMap?.get(normKey(cnRec.invoiceNo)) ||
            params.lookups.transactionsMap?.get(normKey(cnRec.invoiceNo)) ||
            params.lookups.invoiceLogMap?.get(normKey(cnRec.invoiceNo));
          if (origSale) {
            oldBillAmount = Number(origSale.netAmount || origSale.saleAmount || origSale.amount || 0) || null;
            oldBillCommission = Number(origSale.commissionAmount || origSale.commission || 0) || null;
          }
        }
      }

      if (oldBillAmount === null && refInv && params.lookups) {
        const origSale =
          params.lookups.salesMap?.get(normKey(refInv)) ||
          params.lookups.transactionsMap?.get(normKey(refInv)) ||
          params.lookups.invoiceLogMap?.get(normKey(refInv));
        if (origSale) {
          oldBillAmount = Number(origSale.netAmount || origSale.saleAmount || origSale.amount || 0) || null;
          oldBillCommission = Number(origSale.commissionAmount || origSale.commission || 0) || null;
        }
      }
    }
  }

  // 3. Adjustment: Resolve New Bill Amount
  let newBillAmount: number | null = null;
  if (params.newBillAmount !== undefined && params.newBillAmount !== null && Number(params.newBillAmount) > 0) {
    newBillAmount = Number(params.newBillAmount);
  } else if (params.newAmount !== undefined && params.newAmount !== null && Number(params.newAmount) > 0) {
    newBillAmount = Number(params.newAmount);
  } else if (notesNew !== null && notesNew > 0) {
    newBillAmount = notesNew;
  } else if (isCreditNote) {
    const cn = parsedPayload?.data?.creditNote || parsedPayload?.creditNote || {};
    const cnAmt = Number(params.cnAmount || cn.cnAmount || cn.creditAmount || cn.totalAmount || rawAmount || 0);
    newBillAmount = cnAmt > 0 ? cnAmt : (rawAmount > 0 ? rawAmount : null);
  } else if (isExchange) {
    const ex = parsedPayload?.data?.salesExchange || parsedPayload?.salesExchange || {};
    // Check line items for IsOld: false items (new items being purchased)
    const rawExchangeItems =
      parsedPayload?.SalesExchangeProductList ||
      parsedPayload?.data?.SalesExchangeProductList ||
      parsedPayload?.data?.lineItems ||
      parsedPayload?.lineItems ||
      [];
    let newItemsSum = 0;
    if (Array.isArray(rawExchangeItems) && rawExchangeItems.length > 0) {
      for (const item of rawExchangeItems) {
        if (!parseIsOld(item)) {
          const itemAmt = Number(item.productNetAmount || item.Total || item.price || item.amount || item.netAmount || 0);
          if (!isNaN(itemAmt) && itemAmt > 0) {
            newItemsSum += itemAmt;
          }
        }
      }
    }
    const exAmt = Number(ex.newAmount || ex.newSaleAmount || (newItemsSum > 0 ? newItemsSum : (rawAmount > 0 ? rawAmount : 0)));
    newBillAmount = exAmt > 0 ? exAmt : (rawAmount > 0 ? rawAmount : null);
  } else {
    newBillAmount = rawAmount > 0 ? rawAmount : null;
  }

  // 4. Calculate Difference: differenceAmount = oldBillAmount - newBillAmount (e.g. 2300 - 2998 = -698)
  let differenceAmount: number | null = null;
  if (oldBillAmount !== null && newBillAmount !== null) {
    differenceAmount = Math.round((oldBillAmount - newBillAmount) * 100) / 100;
  } else if (params.differenceAmount !== undefined && params.differenceAmount !== null) {
    differenceAmount = Number(params.differenceAmount);
  }

  // 5. Resolve Commissions
  // OLD BILL COMMISSION: commission calculated from PREVIOUS/ORIGINAL BILL
  if (oldBillCommission === null && oldBillAmount !== null) {
    if (params.oldBillCommission !== undefined && params.oldBillCommission !== null && Number(params.oldBillCommission) > 0) {
      oldBillCommission = Number(params.oldBillCommission);
    } else if (params.oldCommission !== undefined && params.oldCommission !== null && Number(params.oldCommission) > 0) {
      oldBillCommission = Number(params.oldCommission);
    } else {
      oldBillCommission = Math.round(((oldBillAmount * commRate) / 100) * 100) / 100;
    }
  }

  // NEW BILL COMMISSION: commission calculated from CURRENT EXCHANGE BILL
  let newBillCommission: number | null = null;
  if (newBillAmount !== null) {
    if (params.newBillCommission !== undefined && params.newBillCommission !== null && Number(params.newBillCommission) > 0) {
      newBillCommission = Number(params.newBillCommission);
    } else if (params.newCommission !== undefined && params.newCommission !== null && Number(params.newCommission) > 0) {
      newBillCommission = Number(params.newCommission);
    } else if (params.commissionAmount !== undefined && params.commissionAmount !== null && Number(params.commissionAmount) > 0) {
      newBillCommission = Number(params.commissionAmount);
    } else {
      newBillCommission = Math.round(((newBillAmount * commRate) / 100) * 100) / 100;
    }
  }

  // COMMISSION DIFFERENCE: oldBillCommission - newBillCommission (e.g. 23.00 - 29.98 = -6.98)
  let commissionDifference: number | null = null;
  if (oldBillCommission !== null && newBillCommission !== null) {
    commissionDifference = Math.round((oldBillCommission - newBillCommission) * 100) / 100;
  } else if (params.commissionDifference !== undefined && params.commissionDifference !== null) {
    commissionDifference = Number(params.commissionDifference);
  }

  // Debug logging for every Invoice Exchange
  if (isExchange) {
    const ex = parsedPayload?.data?.salesExchange || parsedPayload?.salesExchange || parsedPayload || {};
    const refInv =
      ex.originalInvoiceNo ||
      ex.originalInvoiceNumber ||
      ex.originalBillId ||
      ex.salesID ||
      ex.SalesID ||
      ex.refInvoiceNo ||
      'N/A';
    console.log(`[Invoice Exchange Debug]
currentExchangeInvoiceId: ${billStr || params.billId || 'N/A'}
currentExchangeInvoiceNo: ${params.invoiceNumber || params.invoiceNo || billStr || 'N/A'}
previousInvoiceId: ${refInv}
previousInvoiceNo: ${refInv}
previousBillAmount: ${oldBillAmount}
newBillAmount: ${newBillAmount}
differenceAmount: ${differenceAmount}`);
  }

  return {
    oldBillAmount,
    differenceAmount,
    newBillAmount,
    oldBillCommission,
    commissionDifference,
    newBillCommission,
  };
}

export function resolveBillReconciliation(params: any) {
  const res = resolveBillAndCommissionReconciliation(params);
  return {
    oldBillAmount: res.oldBillAmount,
    newBillAmount: res.newBillAmount,
    differenceAmount: res.differenceAmount,
  };
}

export function resolveCommissionReconciliation(params: any) {
  const res = resolveBillAndCommissionReconciliation(params);
  return {
    oldBillCommission: res.oldBillCommission,
    newBillCommission: res.newBillCommission,
    commissionDifference: res.commissionDifference,
  };
}

/**
 * Safely parses any date value (ISO strings, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, or timestamps).
 * Resolves Indian date format (DD/MM/YYYY or DD-MM-YYYY) correctly without treating day as month,
 * and ensures date-only strings land on the correct day without shifting to the previous day in UTC.
 */
export function safeParseDate(val: any): Date {
  if (val === undefined || val === null || val === '') return new Date();
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
  if (typeof val === 'number') {
    const ms = val < 1e11 ? val * 1000 : val;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  const str = String(val).trim();
  if (!str) return new Date();

  // Check if string is pure numeric timestamp
  if (/^\d+$/.test(str)) {
    const num = Number(str);
    const ms = num < 1e11 ? num * 1000 : num;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d;
  }

  // Check DD/MM/YYYY or DD-MM-YYYY (with optional time HH:mm:ss)
  const dmyMatch = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hasTime = dmyMatch[4] !== undefined;
    const hour = hasTime ? parseInt(dmyMatch[4], 10) : 12; // Default to 12:00 noon if no time given
    const min = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const sec = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
    const utcMs = Date.UTC(year, month, day, hour, min, sec) - 5.5 * 60 * 60 * 1000;
    const d = new Date(utcMs);
    if (!isNaN(d.getTime())) return d;
  }

  // If string contains explicit numeric timezone offset (e.g. +05:30, -04:00)
  if (/[\+\-]\d{2}:?\d{2}$/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
  }

  // Parse ISO / DateTime strings (e.g. "2026-08-12T11:30:00", "2026-08-12T11:30:00Z", "2026-08-12 11:30:00")
  // Treat numerical hours/mins as IST local clock time (UTC+5:30)
  const cleanIso = str.replace(/Z$/i, '');
  if (cleanIso.includes('T') || cleanIso.includes(' ')) {
    const separator = cleanIso.includes('T') ? 'T' : ' ';
    const [datePart, timePart] = cleanIso.split(separator);
    const dateParts = datePart.split('-');
    const timeParts = (timePart || '12:00:00').split(':');
    if (dateParts.length >= 3) {
      const year = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1;
      const day = parseInt(dateParts[2], 10);
      const hour = parseInt(timeParts[0], 10) || 0;
      const min = parseInt(timeParts[1], 10) || 0;
      const sec = parseInt((timeParts[2] || '0').split('.')[0], 10) || 0;
      const utcMs = Date.UTC(year, month, day, hour, min, sec) - 5.5 * 60 * 60 * 1000;
      const d = new Date(utcMs);
      if (!isNaN(d.getTime())) return d;
    }
  } else if (str.includes('-')) {
    // Date-only YYYY-MM-DD -> treat as 12:00 noon IST to avoid UTC day-shift
    const parts = str.split('-');
    if (parts.length >= 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const utcMs = Date.UTC(year, month, day, 12, 0, 0, 0) - 5.5 * 60 * 60 * 1000;
      const d = new Date(utcMs);
      if (!isNaN(d.getTime())) return d;
    }
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Resolves the start of day (00:00:00.000 IST) in UTC Date object.
 * e.g., "2026-09-01" -> 2026-08-31T18:30:00.000Z
 */
export function parseIstStartOfDay(dateInput?: string | Date | null): Date {
  if (!dateInput) {
    const now = new Date();
    const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istTime);
    return new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate(), 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
  }
  const str = String(dateInput).trim();
  const dateOnly = str.split('T')[0].split(' ')[0];
  if (dateOnly.includes('-')) {
    const parts = dateOnly.split('-').map(Number);
    if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
    }
  } else if (dateOnly.includes('/')) {
    const parts = dateOnly.split('/').map(Number);
    if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(Date.UTC(parts[2], parts[1] - 1, parts[0], 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
    }
  }
  const parsed = safeParseDate(dateInput);
  const istTime = parsed.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istTime);
  return new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate(), 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
}

/**
 * Resolves the end of day (23:59:59.999 IST) in UTC Date object.
 * e.g., "2026-09-01" -> 2026-09-01T18:29:59.999Z
 */
export function parseIstEndOfDay(dateInput?: string | Date | null): Date {
  if (!dateInput) {
    const now = new Date();
    const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istTime);
    return new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate(), 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
  }
  const str = String(dateInput).trim();
  const dateOnly = str.split('T')[0].split(' ')[0];
  if (dateOnly.includes('-')) {
    const parts = dateOnly.split('-').map(Number);
    if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
    }
  } else if (dateOnly.includes('/')) {
    const parts = dateOnly.split('/').map(Number);
    if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(Date.UTC(parts[2], parts[1] - 1, parts[0], 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
    }
  }
  const parsed = safeParseDate(dateInput);
  const istTime = parsed.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istTime);
  return new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate(), 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
}

/**
 * Resolves exact UTC Date boundaries for an IST month (00:00:00.000 IST 1st day to 23:59:59.999 IST last day).
 * Month is 1-based (1 = Jan, ..., 12 = Dec).
 */
export function getIstMonthRange(yearInput?: number | null, monthInput?: number | null): {
  monthStart: Date;
  monthEnd: Date;
  year: number;
  month: number;
  startDateStr: string;
  endDateStr: string;
} {
  const now = new Date();
  const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istTime);

  const year = yearInput && !isNaN(yearInput) ? yearInput : istDate.getUTCFullYear();
  const month = monthInput && !isNaN(monthInput) ? monthInput : (istDate.getUTCMonth() + 1);

  const totalCalendarDays = new Date(year, month, 0).getDate();

  // monthStart in UTC corresponding to 00:00:00.000 IST 1st of month
  const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
  // monthEnd in UTC corresponding to 23:59:59.999 IST last of month
  const monthEnd = new Date(Date.UTC(year, month - 1, totalCalendarDays, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);

  const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(totalCalendarDays).padStart(2, '0')}`;

  return {
    monthStart,
    monthEnd,
    year,
    month,
    startDateStr,
    endDateStr
  };
}

/**
 * Parse sale date correctly handling timezone, ISO, YYYY-MM-DD, and Indian date formats.
 */
export async function parseSaleDateCorrectly(invoiceDateString: string): Promise<Date> {
  console.log('[Date Parse] Input:', invoiceDateString);
  try {
    const date = safeParseDate(invoiceDateString);
    console.log('[Date Parse] Parsed ISO:', date.toISOString());
    console.log('[Date Parse] Local String:', date.toString());
    return date;
  } catch (error: any) {
    console.error('[Date Parse] ❌ Error parsing date:', error.message);
    return new Date();
  }
}

/**
 * Resolves an employee identifier (GUID string, employeeCode, or integer ID)
 * to the canonical local Employee DB primary key (id).
 */
export async function resolveEmployeeId(identifier?: string | number | null): Promise<number | null> {
  if (!identifier) return null;
  const str = String(identifier).trim();
  if (!str) return null;

  // 1. Check for GUID match on employeeID (case-insensitive)
  const byGuid = await prisma.employee.findFirst({
    where: { employeeID: { equals: str, mode: 'insensitive' } },
  });
  if (byGuid) return byGuid.id;

  // 2. Check for employeeCode match
  const byCode = await prisma.employee.findFirst({
    where: { employeeCode: { equals: str, mode: 'insensitive' } },
  });
  if (byCode) return byCode.id;

  // 3. Check for DB integer primary key match
  // Guard: skip if it looks like a phone number (7+ pure digits which would overflow PostgreSQL int)
  const parsedInt = parseInt(str, 10);
  const isPureDigits = /^\d+$/.test(str);
  if (!isNaN(parsedInt) && parsedInt > 0 && parsedInt <= 2147483647 && !(isPureDigits && str.length >= 7)) {
    const byPk = await prisma.employee.findUnique({ where: { id: parsedInt } }).catch(() => null);
    if (byPk) return byPk.id;
  }

  // 4. Check for mobileNumber match (matching last 10 digits)
  const digitsOnly = str.replace(/\D/g, '');
  if (digitsOnly.length >= 10) {
    const last10 = digitsOnly.slice(-10);
    const byMobile = await prisma.employee.findFirst({
      where: { mobileNumber: { contains: last10 } },
    });
    if (byMobile) return byMobile.id;
  }

  // 5. Check for First/Last Name match (case-insensitive)
  const nameParts = str.trim().split(/\s+/);
  const byName = await prisma.employee.findFirst({
    where: {
      OR: [
        { firstName: { equals: str, mode: 'insensitive' } },
        { lastName: { equals: str, mode: 'insensitive' } },
        nameParts.length >= 2 ? {
          AND: [
            { firstName: { equals: nameParts[0], mode: 'insensitive' } },
            { lastName: { equals: nameParts.slice(1).join(' '), mode: 'insensitive' } },
          ],
        } : { firstName: { equals: str, mode: 'insensitive' } },
      ],
    },
  });
  if (byName) return byName.id;

  return null;
}


export interface ExtractedWebhookMeta {
  billId: string | null;
  invoiceNumber: string | null;
  amount: number;
  cnAmount?: number;
  refundAmount?: number;
  cnNo?: string | null;
  creditNote?: any;
  eventType: string;
  customerName: string | null;
  customerPhone: string | null;
  paymentMode: string | null;
  branchName: string | null;
  storeName: string | null;
  storeId: number | null;
  invoice: any;
  lineItems: any[];
  firstItem: any;
  employeeIdentifier: string | null;
  employeeName: string | null;
  commissionAmount: number | null;
  eventId: string | null;
  salesmen: any[];
  isActive?: boolean | null;
}

export function extractWebhookMeta(data: any): ExtractedWebhookMeta {
  if (!data) {
    return {
      billId: null,
      invoiceNumber: null,
      amount: 0,
      cnAmount: 0,
      refundAmount: 0,
      cnNo: null,
      creditNote: {},
      eventType: 'INVOICE_CREATED',
      customerName: null,
      customerPhone: null,
      paymentMode: null,
      branchName: null,
      storeName: null,
      storeId: null,
      invoice: {},
      lineItems: [],
      firstItem: {},
      employeeIdentifier: null,
      employeeName: null,
      commissionAmount: null,
      eventId: null,
      salesmen: [],
    };
  }

  let payload = data;
  if (typeof data === 'string') {
    try {
      payload = JSON.parse(data);
    } catch (_) {
      return {
        billId: null,
        invoiceNumber: null,
        amount: 0,
        cnAmount: 0,
        refundAmount: 0,
        cnNo: null,
        creditNote: {},
        eventType: 'INVOICE_CREATED',
        customerName: null,
        customerPhone: null,
        paymentMode: null,
        branchName: null,
        storeName: null,
        storeId: null,
        invoice: {},
        lineItems: [],
        firstItem: {},
        employeeIdentifier: null,
        employeeName: null,
        commissionAmount: null,
        eventId: null,
        salesmen: [],
      };
    }
  }

  const rawEventType = payload?.eventType || payload?.topic || payload?.event || null;
  const eventType = normalizeEventType(rawEventType, 'INVOICE_CREATED', payload);
  const isCreditNote =
    eventType === 'CREDIT_NOTE_CREATED' ||
    eventType === 'CREDIT_NOTE_UPDATED' ||
    rawEventType === 'creditnote.created' ||
    rawEventType === 'credit_note.created' ||
    rawEventType === 'creditnote.updated' ||
    rawEventType === 'credit_note.updated' ||
    Boolean(payload?.data?.creditNote || payload?.creditNote);

  const creditNote = payload?.data?.creditNote || payload?.creditNote || payload?.data?.salesExchange || payload?.salesExchange || {};
  const invoice = payload?.data?.invoice || payload?.invoice || {};

  const cnAmount = safeParseAmount(
    creditNote.cnAmount ??
    creditNote.cn_amount ??
    creditNote.CNAmount ??
    creditNote.creditAmount ??
    payload?.data?.creditNote?.cnAmount ??
    payload?.creditNote?.cnAmount ??
    null
  );

  const refundAmount = safeParseAmount(
    creditNote.refundAmount ??
    creditNote.RefundAmount ??
    creditNote.refund_amount ??
    payload?.data?.creditNote?.refundAmount ??
    payload?.creditNote?.refundAmount ??
    0
  );

  const cnNo =
    creditNote.cnNo ||
    creditNote.CNNo ||
    creditNote.cn_no ||
    creditNote.creditNoteNo ||
    creditNote.CreditNoteNo ||
    payload?.data?.creditNote?.cnNo ||
    payload?.creditNote?.cnNo ||
    null;

  const rawSalesmen =
    payload?.data?.salesmen ||
    payload?.salesmen ||
    payload?.data?.salesPersons ||
    payload?.salesPersons ||
    payload?.data?.salesmanList ||
    payload?.salesmanList ||
    payload?.data?.employees ||
    payload?.employees ||
    invoice?.salesmen ||
    invoice?.salesPersons ||
    invoice?.salesmanList ||
    invoice?.employees ||
    creditNote?.salesmen ||
    creditNote?.salesPersons ||
    [];
  const salesmen = Array.isArray(rawSalesmen) ? rawSalesmen : [];

  const lineItems = Array.isArray(payload?.data?.lineItems)
    ? payload.data.lineItems
    : Array.isArray(payload?.lineItems)
    ? payload.lineItems
    : Array.isArray(payload?.data?.CreditNoteProducts)
    ? payload.data.CreditNoteProducts
    : Array.isArray(payload?.CreditNoteProducts)
    ? payload.CreditNoteProducts
    : Array.isArray(creditNote?.CreditNoteProducts)
    ? creditNote.CreditNoteProducts
    : Array.isArray(payload?.data?.SalesExchangeProductList)
    ? payload.data.SalesExchangeProductList
    : Array.isArray(payload?.SalesExchangeProductList)
    ? payload.SalesExchangeProductList
    : Array.isArray(payload?.data?.products)
    ? payload.data.products
    : Array.isArray(payload?.products)
    ? payload.products
    : [];

  const firstItem = lineItems[0] || {};
  const eventId =
    payload?.eventId ||
    payload?.event_id ||
    payload?.webhookEventId ||
    payload?.webhook_event_id ||
    payload?.id ||
    payload?.data?.eventId ||
    payload?.data?.event_id ||
    payload?.data?.id ||
    null;

  // 1. Resolve raw string invoice number / code (e.g. "HKACN373", "HWM-89", "CN-12", "INV-102")
  const rawInvoiceNumber =
    (isCreditNote && cnNo) ||
    creditNote.cnNo ||
    creditNote.CNNo ||
    creditNote.creditNoteNo ||
    creditNote.InvoiceNo ||
    creditNote.invoiceNo ||
    creditNote.invoiceNumber ||
    creditNote.InvoiceNumber ||
    creditNote.SalesID ||
    payload?.InvoiceNo ||
    payload?.SalesID ||
    payload?.data?.InvoiceNo ||
    payload?.data?.SalesID ||
    invoice.invoiceNumber ||
    invoice.InvoiceNumber ||
    invoice.invoiceNo ||
    invoice.InvoiceNo ||
    invoice.invoice_no ||
    payload?.data?.invoiceNumber ||
    payload?.data?.InvoiceNumber ||
    payload?.data?.invoiceNo ||
    payload?.data?.InvoiceNo ||
    payload?.data?.invoice_no ||
    payload?.invoiceNumber ||
    payload?.InvoiceNumber ||
    payload?.invoiceNo ||
    payload?.InvoiceNo ||
    payload?.invoice_no ||
    firstItem?.invoiceNumber ||
    firstItem?.InvoiceNumber ||
    firstItem?.invoiceNo ||
    firstItem?.InvoiceNo ||
    (invoice.invoiceId && !/^[0-9a-fA-F-]{36}$/.test(String(invoice.invoiceId)) ? invoice.invoiceId : null) ||
    null;

  // 2. Resolve numeric Bill ID (strictly numeric, never a UUID)
  const isUuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;
  let resolvedBillId: string | null = null;

  const billCandidates = [
    (isCreditNote && cnNo),
    creditNote.cnNo,
    creditNote.CNNo,
    creditNote.creditNoteNo,
    creditNote.billNumber,
    creditNote.billNo,
    creditNote.bill_no,
    creditNote.BillNo,
    creditNote.BillNumber,
    creditNote.CNID,
    creditNote.number,
    creditNote.exchangeNo,
    invoice.billNumber,
    invoice.BillNumber,
    invoice.billNo,
    invoice.BillNo,
    invoice.bill_no,
    invoice.billId,
    invoice.BillId,
    invoice.BillID,
    invoice.bill_id,
    invoice.invoiceNumber,
    invoice.InvoiceNumber,
    invoice.invoiceNo,
    invoice.InvoiceNo,
    invoice.invoice_no,
    payload?.data?.billNumber,
    payload?.data?.BillNumber,
    payload?.data?.billNo,
    payload?.data?.BillNo,
    payload?.data?.bill_no,
    payload?.data?.billId,
    payload?.data?.BillId,
    payload?.data?.BillID,
    payload?.data?.bill_id,
    payload?.data?.invoiceNumber,
    payload?.data?.InvoiceNumber,
    payload?.data?.invoiceNo,
    payload?.data?.InvoiceNo,
    payload?.data?.invoice_no,
    payload?.billNumber,
    payload?.BillNumber,
    payload?.billNo,
    payload?.BillNo,
    payload?.bill_no,
    payload?.billId,
    payload?.BillId,
    payload?.BillID,
    payload?.bill_id,
    payload?.invoiceNumber,
    payload?.InvoiceNumber,
    payload?.invoiceNo,
    payload?.InvoiceNo,
    payload?.invoice_no,
    firstItem?.billNumber,
    firstItem?.BillNumber,
    firstItem?.billNo,
    firstItem?.BillNo,
    firstItem?.bill_no,
    firstItem?.billId,
    firstItem?.BillId,
    firstItem?.BillID,
    firstItem?.bill_id,
    firstItem?.invoiceNumber,
    firstItem?.InvoiceNumber,
    firstItem?.invoiceNo,
    firstItem?.InvoiceNo,
    rawInvoiceNumber,
  ];

  for (const cand of billCandidates) {
    if (cand === null || cand === undefined) continue;
    if (typeof cand === 'number' && cand > 0 && cand <= 2147483647) {
      resolvedBillId = String(cand);
      break;
    }
    const candStr = String(cand).trim();
    if (!candStr || isUuidPattern.test(candStr)) continue;
    // Extract digits
    const digits = candStr.replace(/\D/g, '');
    if (digits.length > 0 && digits.length <= 9) {
      const parsed = parseInt(digits, 10);
      if (parsed > 0 && parsed <= 2147483647) {
        resolvedBillId = String(parsed);
        break;
      }
    }
  }

  // Fallback: If no digits found but rawInvoiceNumber is a clean string code
  if (!resolvedBillId && rawInvoiceNumber && !isUuidPattern.test(String(rawInvoiceNumber))) {
    resolvedBillId = String(rawInvoiceNumber).trim();
  }

  const billId = resolvedBillId;

  // 3. Resolve formatted invoice number
  let invoiceNumber: string | null = null;
  if (rawInvoiceNumber && !isUuidPattern.test(String(rawInvoiceNumber))) {
    invoiceNumber = String(rawInvoiceNumber).trim();
  } else if (billId && /^\d+$/.test(billId)) {
    invoiceNumber = isCreditNote ? (cnNo || `CN-${billId}`) : `HWM-${billId}`;
  } else if (billId) {
    invoiceNumber = billId;
  }

  // Calculate line items sum dynamically from productNetAmount / amount
  let lineItemsSum = 0;
  let hasLineItemsWithAmount = false;
  if (!isCreditNote && Array.isArray(lineItems) && lineItems.length > 0) {
    for (const item of lineItems) {
      const itemAmt = Number(
        item.productNetAmount ??
        item.Amount ??
        item.amount ??
        item.netAmount ??
        (Number(item.Price || item.price || 0) * Number(item.Quantity || item.quantity || 1))
      );
      if (!isNaN(itemAmt) && itemAmt > 0) {
        lineItemsSum += itemAmt;
        hasLineItemsWithAmount = true;
      }
    }
  }

  let rawAmount = isCreditNote
    ? cnAmount
    : (hasLineItemsWithAmount
        ? lineItemsSum
        : (
            invoice.netAmount ??
            invoice.totalAmount ??
            invoice.grandTotal ??
            payload?.data?.invoice?.netAmount ??
            payload?.data?.invoice?.totalAmount ??
            payload?.data?.netAmount ??
            payload?.data?.totalAmount ??
            payload?.data?.grandTotal ??
            firstItem?.productNetAmount ??
            firstItem?.netAmount ??
            firstItem?.amount ??
            payload?.data?.amount ??
            payload?.data?.saleAmount ??
            payload?.amount ??
            payload?.saleAmount ??
            payload?.totalAmount ??
            payload?.grandTotal ??
            payload?.netAmount
          ));

  let amount = safeParseAmount(rawAmount);

  const customerName =
    invoice.customerName ||
    invoice.CustomerName ||
    creditNote.CustomerName ||
    creditNote.customerName ||
    creditNote.Customer ||
    creditNote.customer ||
    payload?.data?.invoice?.customerName ||
    payload?.data?.invoice?.CustomerName ||
    payload?.CustomerName ||
    payload?.customerName ||
    payload?.data?.CustomerName ||
    payload?.data?.customerName ||
    firstItem?.CustomerName ||
    firstItem?.customerName ||
    null;

  const customerPhone =
    invoice.customerPhoneNo ||
    invoice.CustomerPhoneNo ||
    invoice.customerPhone ||
    invoice.CustomerPhone ||
    creditNote.PhoneNumber ||
    creditNote.customerPhone ||
    creditNote.customerPhoneNo ||
    creditNote.phone ||
    payload?.data?.invoice?.customerPhoneNo ||
    payload?.data?.invoice?.customerPhone ||
    payload?.PhoneNumber ||
    payload?.customerPhone ||
    payload?.customerPhoneNo ||
    payload?.data?.PhoneNumber ||
    payload?.data?.customerPhone ||
    payload?.data?.customerPhoneNo ||
    firstItem?.PhoneNumber ||
    firstItem?.customerPhone ||
    firstItem?.customerPhoneNo ||
    null;

  const rawPaymentMode =
    creditNote.PaymentMode ||
    creditNote.paymentMode ||
    creditNote.payment_mode ||
    creditNote.PaymentMethod ||
    creditNote.paymentMethod ||
    creditNote.paymentType ||
    creditNote.payMode ||
    payload?.PaymentMode ||
    payload?.paymentMode ||
    payload?.payment_mode ||
    payload?.PaymentMethod ||
    payload?.paymentMethod ||
    payload?.paymentType ||
    payload?.payMode ||
    payload?.pay_mode ||
    payload?.tenderMode ||
    payload?.modeOfPayment ||
    payload?.data?.PaymentMode ||
    payload?.data?.paymentMode ||
    payload?.data?.payment_mode ||
    payload?.data?.PaymentMethod ||
    payload?.data?.paymentMethod ||
    payload?.data?.paymentType ||
    payload?.data?.payMode ||
    payload?.data?.tenderMode ||
    payload?.data?.modeOfPayment ||
    payload?.invoice?.PaymentMode ||
    payload?.invoice?.paymentMode ||
    payload?.invoice?.payment_mode ||
    payload?.invoice?.paymentType ||
    invoice.PaymentMode ||
    invoice.paymentMode ||
    invoice.payment_mode ||
    invoice.PaymentMethod ||
    invoice.paymentMethod ||
    invoice.paymentType ||
    invoice.payMode ||
    invoice.tenderMode ||
    invoice.modeOfPayment ||
    firstItem?.PaymentMode ||
    firstItem?.paymentMode ||
    firstItem?.payment_mode ||
    firstItem?.payMode ||
    firstItem?.tenderMode ||
    (Array.isArray(payload?.payments) && (payload.payments[0]?.mode || payload.payments[0]?.paymentMode || payload.payments[0]?.paymentType)) ||
    (Array.isArray(payload?.data?.payments) && (payload.data.payments[0]?.mode || payload.data.payments[0]?.paymentMode || payload.data.payments[0]?.paymentType)) ||
    (Array.isArray(invoice.payments) && (invoice.payments[0]?.mode || invoice.payments[0]?.paymentMode || invoice.payments[0]?.paymentType)) ||
    (Array.isArray(invoice.paymentDetails) && (invoice.paymentDetails[0]?.paymentMode || invoice.paymentDetails[0]?.mode)) ||
    (Array.isArray(payload?.tenders) && (payload.tenders[0]?.tenderType || payload.tenders[0]?.mode)) ||
    null;

  let paymentMode: string | null = null;
  if (rawPaymentMode) {
    const str = String(rawPaymentMode).trim();
    if (str.length > 0 && str !== '-' && str.toLowerCase() !== 'null' && str.toLowerCase() !== 'undefined') {
      paymentMode = str.toUpperCase();
    }
  }

  const branchName =
    invoice.branchName ||
    invoice.BranchName ||
    creditNote.branchName ||
    creditNote.BranchName ||
    payload?.data?.invoice?.branchName ||
    payload?.data?.invoice?.BranchName ||
    payload?.data?.branchName ||
    payload?.data?.BranchName ||
    payload?.branchName ||
    payload?.BranchName ||
    firstItem?.branchName ||
    null;

  const storeName =
    invoice.branchName ||
    invoice.BranchName ||
    invoice.storeName ||
    invoice.StoreName ||
    creditNote.branchName ||
    creditNote.storeName ||
    invoice.store ||
    invoice.branch ||
    payload?.data?.invoice?.branchName ||
    payload?.data?.invoice?.storeName ||
    payload?.data?.storeName ||
    payload?.data?.branchName ||
    payload?.data?.store ||
    payload?.data?.branch ||
    payload?.storeName ||
    payload?.branchName ||
    payload?.store ||
    payload?.branch ||
    firstItem?.storeName ||
    firstItem?.branchName ||
    firstItem?.store ||
    firstItem?.branch ||
    null;

  const storeIdParsed = creditNote.storeId ? parseInt(String(creditNote.storeId), 10) : (invoice.storeId ? parseInt(String(invoice.storeId), 10) : (payload?.storeId ? parseInt(String(payload.storeId), 10) : null));
  const storeId = isNaN(storeIdParsed as number) ? null : storeIdParsed;

  const firstSalesman = (Array.isArray(salesmen) && salesmen[0]) || {};

  const employeeIdentifier =
    firstSalesman.SalesmanCode ||
    firstSalesman.salesmanCode ||
    firstSalesman.Code ||
    firstSalesman.code ||
    firstSalesman.SalesmanId ||
    firstSalesman.salesmanId ||
    firstSalesman.employeeID ||
    firstSalesman.employeeId ||
    firstSalesman.Id ||
    firstSalesman.id ||
    firstSalesman.SalesmanName ||
    firstSalesman.salesmanName ||
    firstSalesman.Name ||
    firstSalesman.name ||
    firstItem?.employeeCode ||
    firstItem?.employeeID ||
    firstItem?.employeeId ||
    firstItem?.code ||
    firstItem?.empCode ||
    firstItem?.hopkidCode ||
    firstItem?.salesmanCode ||
    firstItem?.Salesman ||
    firstItem?.salesman ||
    firstItem?.employeePhoneNo ||
    firstItem?.employeeContactNo ||
    firstItem?.mobileNo ||
    firstItem?.mobileNumber ||
    firstItem?.phone ||
    firstItem?.phoneNumber ||
    firstItem?.employeeName ||
    firstItem?.name ||
    creditNote.Salesman ||
    creditNote.CreatedBy ||
    creditNote.salesmanName ||
    creditNote.employeeCode ||
    creditNote.salesmanCode ||
    creditNote.employeeId ||
    creditNote.salesmanId ||
    payload?.Salesman ||
    payload?.CreatedBy ||
    payload?.salesmanName ||
    payload?.data?.Salesman ||
    payload?.data?.CreatedBy ||
    invoice?.employeeCode ||
    invoice?.salesmanCode ||
    invoice?.empCode ||
    invoice?.hopkidCode ||
    invoice?.employeeId ||
    invoice?.salesmanId ||
    invoice?.mobileNo ||
    invoice?.mobileNumber ||
    invoice?.phone ||
    invoice?.phoneNumber ||
    invoice?.employeeName ||
    invoice?.salesmanName ||
    invoice?.salesman ||
    payload?.data?.employeeCode ||
    payload?.data?.salesmanCode ||
    payload?.data?.employeeId ||
    payload?.data?.salesmanId ||
    payload?.data?.mobileNo ||
    payload?.data?.mobileNumber ||
    payload?.data?.employeeName ||
    payload?.employeeCode ||
    payload?.code ||
    payload?.empCode ||
    payload?.hopkidCode ||
    payload?.mobileNo ||
    payload?.mobileNumber ||
    payload?.phone ||
    payload?.phoneNumber ||
    payload?.employeeName ||
    payload?.name ||
    null;

  const employeeName =
    firstSalesman.SalesmanName ||
    firstSalesman.salesmanName ||
    firstSalesman.SalesPersonName ||
    firstSalesman.salespersonName ||
    firstSalesman.Name ||
    firstSalesman.name ||
    firstSalesman.employeeName ||
    firstSalesman.Salesman ||
    firstSalesman.salesman ||
    firstItem?.employeeName ||
    firstItem?.salesmanName ||
    firstItem?.name ||
    firstItem?.Salesman ||
    firstItem?.salesman ||
    firstItem?.salesPerson ||
    firstItem?.salespersonName ||
    firstItem?.empName ||
    creditNote.Salesman ||
    creditNote.CreatedBy ||
    creditNote.salesmanName ||
    creditNote.employeeName ||
    payload?.Salesman ||
    payload?.CreatedBy ||
    payload?.salesmanName ||
    payload?.data?.Salesman ||
    payload?.data?.CreatedBy ||
    invoice?.employeeName ||
    invoice?.salesmanName ||
    invoice?.salesman ||
    invoice?.salesPerson ||
    invoice?.salespersonName ||
    invoice?.empName ||
    payload?.data?.employeeName ||
    payload?.data?.salesmanName ||
    payload?.data?.salesman ||
    payload?.data?.salesPerson ||
    payload?.data?.salespersonName ||
    payload?.data?.empName ||
    payload?.employeeName ||
    payload?.salesmanName ||
    payload?.salesman ||
    payload?.salesPerson ||
    payload?.salespersonName ||
    payload?.empName ||
    payload?.name ||
    null;

  // Calculate total commission across all line items if line items provide commission or commissionAmount
  let totalCommissionFromItems = 0;
  let hasLineItemCommission = false;

  for (const item of lineItems) {
    const rawItemComm = item.commissionAmount ?? item.commission_amount ?? item.CommissionAmount ?? item.commAmount;
    if (rawItemComm !== undefined && rawItemComm !== null && !isNaN(Number(rawItemComm))) {
      totalCommissionFromItems += Number(rawItemComm);
      hasLineItemCommission = true;
    } else {
      const rawRate = item.commission ?? item.commissionRate ?? item.Commission;
      const rawNet = item.productNetAmount ?? item.netAmount ?? item.amount;
      if (rawRate !== undefined && rawRate !== null && rawNet !== undefined && rawNet !== null) {
        const calculated = (Number(rawNet) * Number(rawRate)) / 100;
        if (!isNaN(calculated)) {
          totalCommissionFromItems += calculated;
          hasLineItemCommission = true;
        }
      }
    }
  }

  const rawComm = hasLineItemCommission
    ? totalCommissionFromItems
    : (payload?.commissionAmount ?? payload?.data?.commissionAmount ?? payload?.data?.invoice?.commissionAmount);

  const commissionAmount = rawComm !== undefined && rawComm !== null && !isNaN(parseFloat(String(rawComm))) ? Math.round(parseFloat(String(rawComm)) * 100) / 100 : null;

  return {
    billId: billId ? String(billId) : null,
    invoiceNumber: invoiceNumber ? String(invoiceNumber) : null,
    amount,
    cnAmount: isCreditNote ? cnAmount : 0,
    refundAmount: isCreditNote ? refundAmount : 0,
    cnNo: cnNo ? String(cnNo) : null,
    creditNote,
    eventType: String(eventType),
    customerName: customerName ? String(customerName) : null,
    customerPhone: customerPhone ? String(customerPhone) : null,
    paymentMode: paymentMode ? String(paymentMode) : null,
    branchName: branchName ? String(branchName) : null,
    storeName: storeName ? String(storeName) : null,
    storeId,
    invoice,
    lineItems,
    firstItem,
    employeeIdentifier: employeeIdentifier ? String(employeeIdentifier) : null,
    employeeName: employeeName ? String(employeeName) : null,
    commissionAmount,
    eventId: eventId ? String(eventId) : null,
    salesmen,
    isActive: (() => {
      const raw =
        firstItem?.isActive ??
        lineItems.find((i: any) => i && i.isActive !== undefined && i.isActive !== null)?.isActive ??
        invoice?.isActive ??
        creditNote?.isActive ??
        payload?.data?.invoice?.isActive ??
        payload?.data?.creditNote?.isActive ??
        payload?.data?.isActive ??
        payload?.isActive ??
        null;
      return raw !== null && raw !== undefined ? Boolean(raw) : null;
    })(),
  };
}

/**
 * Fetches full HopKid invoice details from external HopKid API if webhook payload is sparse/event-only
 */
export async function fetchHopkidInvoiceDetails(identifier: string): Promise<any | null> {
  if (!identifier) return null;
  try {
    const { getIntegrationSettings } = await import('./configService');
    const { hopkidApiUrl, hopkidApiKey } = await getIntegrationSettings();
    const baseUrl = hopkidApiUrl.replace(/\/Employee\/.*$/i, '');

    const endpoints = [
      `${baseUrl}/Sales/GetInvoiceDetail`,
      `${baseUrl}/Sales/GetSalesDetail`,
      `${baseUrl}/Sales/GetSalesList`,
    ];

    for (const endpoint of endpoints) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'x-api-key': hopkidApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              InvoiceNo: identifier,
              BillId: identifier,
              EventId: identifier,
              SalesID: identifier,
            }),
          });

          if (response.ok) {
            const json = (await response.json()) as any;
            if (json && (json.data || json.invoice || json.lineItems)) {
              console.log(`✅ [fetchHopkidInvoiceDetails] Successfully fetched full invoice for ${identifier} from ${endpoint}`);
              return json.data || json;
            }
          }
        } catch (attemptErr) {
          console.warn(`⚠️ [fetchHopkidInvoiceDetails] Attempt ${attempt} failed for ${endpoint}:`, attemptErr);
        }
        await new Promise((r) => setTimeout(r, attempt * 400));
      }
    }
  } catch (err) {
    console.error('❌ [fetchHopkidInvoiceDetails] Error fetching invoice from HopKid API:', err);
  }
  return null;
}

export function isEligibleCommissionEmployee(emp: any): boolean {
  if (!emp) return true;

  // Must not be MANUAL source
  const source = String(emp.source || 'HOPKID').toUpperCase();
  if (source === 'MANUAL') return false;

  return true;
}

export interface CommissionSummaryStats {
  today: {
    commission: number;
    sales: number;
    transactions: number;
  };
  month: {
    commission: number;
    sales: number;
    transactions: number;
  };
  pending: {
    commission: number;
    transactions: number;
  };
  paid: {
    commission: number;
    transactions: number;
  };
  lifetime: {
    commission: number;
    sales: number;
    transactions: number;
  };
  topPerformers: Array<{
    employee: any;
    totalCommission: number;
    totalSales: number;
  }>;
}

export async function getCommissionStats(params?: {
  employeeId?: number | null;
  storeId?: number | null;
  startDate?: Date | string;
  endDate?: Date | string;
}): Promise<CommissionSummaryStats> {
  const whereClause: any = {};
  if (params?.employeeId && params.employeeId !== -1) {
    whereClause.employeeId = params.employeeId;
  }
  if (params?.storeId && !isNaN(params.storeId) && params.storeId > 0) {
    whereClause.OR = [
      { storeId: params.storeId },
      { employee: { storeId: params.storeId } },
    ];
  }

  if (params?.startDate || params?.endDate) {
    whereClause.createdAt = {};
    if (params.startDate) {
      whereClause.createdAt.gte = parseIstStartOfDay(params.startDate);
    }
    if (params.endDate) {
      whereClause.createdAt.lte = parseIstEndOfDay(params.endDate);
    }
  }

  // Filter for valid active/approved/paid/pending commission transactions
  whereClause.status = { in: ['PENDING', 'APPROVED', 'PAID'] };

  const rawTransactions = await prisma.commissionTransaction.findMany({
    where: whereClause,
    include: {
      employee: {
        include: {
          store: true,
          user: true,
        },
      },
      store: true,
    },
    orderBy: [{ id: 'desc' }, { createdAt: 'desc' }],
  });

  const allTransactions = rawTransactions.filter((t) => isEligibleCommissionEmployee(t.employee));

  const now = new Date();
  // Convert UTC time to IST (UTC+5:30)
  const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istTime);

  const year = istDate.getUTCFullYear();
  const month = istDate.getUTCMonth();
  const dateVal = istDate.getUTCDate();

  // todayStart in UTC corresponding to 00:00:00.000 IST today
  const todayStart = new Date(Date.UTC(year, month, dateVal, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
  // todayEnd in UTC corresponding to 23:59:59.999 IST today
  const todayEnd = new Date(Date.UTC(year, month, dateVal, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);

  const monthRange = getIstMonthRange(year, month + 1);

  const todayTxns = allTransactions.filter(
    (t) => new Date(t.createdAt) >= todayStart && new Date(t.createdAt) <= todayEnd
  );
  // If dateRange filter was explicitly provided, allTransactions is the filtered set; otherwise filter strictly by current month
  const monthTxns = (params?.startDate || params?.endDate)
    ? allTransactions
    : allTransactions.filter((t) => {
        const txnDate = new Date(t.createdAt);
        return txnDate >= monthRange.monthStart && txnDate <= monthRange.monthEnd;
      });

  const pendingTxns = allTransactions.filter(
    (t) => t.status === 'PENDING' || t.status === 'APPROVED'
  );
  const paidTxns = allTransactions.filter((t) => t.status === 'PAID');

  const todayComm = todayTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0);
  const todaySales = todayTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netSales, 0);

  const monthComm = monthTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0);
  const monthSales = monthTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netSales, 0);

  const pendingComm = pendingTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0);
  const paidComm = paidTxns.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0);

  const lifetimeComm = allTransactions.reduce((sum, t) => sum + getTransactionNetContribution(t).netCommission, 0);
  const lifetimeSales = allTransactions.reduce((sum, t) => sum + getTransactionNetContribution(t).netSales, 0);

  // Group top performers from the active transaction set using net contribution (accounting for deltas)
  // When a timeframe is selected, allTransactions represents that timeframe. When 'ALL' is selected, rank across all records.
  const performerMap = new Map<string, { employee: any; totalCommission: number; totalSales: number }>();

  allTransactions.forEach((t) => {
    const empId = String(t.employeeId || t.employee?.id || 'unknown');
    const { netSales, netCommission } = getTransactionNetContribution(t);
    const existing = performerMap.get(empId);

    const resolvedEmployee = t.employee || {
      id: t.employeeId || null,
      firstName: 'Employee',
      lastName: t.employeeId ? `#${t.employeeId}` : 'N/A',
      employeeCode: t.employeeId ? `EMP-${t.employeeId}` : 'N/A',
      store: t.store || null
    };

    if (existing) {
      existing.totalCommission += netCommission;
      existing.totalSales += netSales;
      if (t.employee && (!existing.employee || existing.employee.firstName === 'Employee')) {
        existing.employee = t.employee;
      }
    } else {
      performerMap.set(empId, {
        employee: resolvedEmployee,
        totalCommission: netCommission,
        totalSales: netSales,
      });
    }
  });

  const topPerformers = Array.from(performerMap.values())
    .map(p => ({
      ...p,
      totalCommission: Math.round(p.totalCommission * 100) / 100,
      totalSales: Math.round(p.totalSales * 100) / 100,
    }))
    .filter((p) => p.totalSales > 0 || p.totalCommission > 0)
    .sort((a, b) => (b.totalCommission - a.totalCommission) || (b.totalSales - a.totalSales))
    .slice(0, 10);

  console.log(`[Commission Dashboard]\nFilters:\nstartDate: ${params?.startDate || 'none'}\nendDate: ${params?.endDate || 'none'}\nstoreId: ${params?.storeId || 'all'}\nemployeeId: ${params?.employeeId || 'all'}`);
  console.log(`[Commission Dashboard]\nTransactions found: ${allTransactions.length}\nTop performers found: ${topPerformers.length}\nTotal sales: ₹${Math.round(monthSales * 100) / 100}\nTotal commission: ₹${Math.round(monthComm * 100) / 100}`);

  return {
    today: {
      commission: Math.round(todayComm * 100) / 100,
      sales: Math.round(todaySales * 100) / 100,
      transactions: todayTxns.length,
    },
    month: {
      commission: Math.round(monthComm * 100) / 100,
      sales: Math.round(monthSales * 100) / 100,
      transactions: monthTxns.length,
    },
    pending: {
      commission: Math.round(pendingComm * 100) / 100,
      transactions: pendingTxns.length,
    },
    paid: {
      commission: Math.round(paidComm * 100) / 100,
      transactions: paidTxns.length,
    },
    lifetime: {
      commission: Math.round(lifetimeComm * 100) / 100,
      sales: Math.round(lifetimeSales * 100) / 100,
      transactions: allTransactions.length,
    },
    topPerformers,
  };
}

/**
 * Updates an Employee's Wallet balance and records a WalletTransaction for commission credit/debit.
 */
export async function updateEmployeeWalletCommission(
  employeeId: number,
  amount: number,
  isCredit: boolean,
  description: string,
  title: string = isCredit ? 'Commission Earned' : 'Commission Reversed'
): Promise<void> {
  const roundedAmount = Math.round(amount * 100) / 100;
  if (roundedAmount <= 0) return;

  try {
    let wallet = await prisma.wallet.findUnique({
      where: { employeeId }
    });

    if (!wallet) {
      const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
      const empCode = emp?.employeeCode || String(employeeId);
      wallet = await prisma.wallet.create({
        data: {
          employeeId,
          availableBalance: 0,
          advanceLimit: 25000,
          pendingClaims: 0,
          cardNumber: `QB-${empCode.replace(/\D/g, '')}-XXXX`,
          isActive: true
        }
      });
    }

    const currentBalance = wallet.availableBalance || 0;
    const newBalance = isCredit
      ? currentBalance + roundedAmount
      : Math.max(0, currentBalance - roundedAmount);

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { availableBalance: newBalance }
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        title,
        category: 'Commission',
        amount: roundedAmount,
        date: new Date(),
        status: 'COMPLETED',
        isCredit,
        description
      }
    });

    console.log(`[Wallet] ✅ Employee ${employeeId} wallet updated: ${isCredit ? '+' : '-'}₹${roundedAmount}. New Balance: ₹${newBalance}`);
  } catch (err: any) {
    console.error(`[Wallet Error] ❌ Failed to update wallet for Employee ${employeeId}:`, err.message);
  }
}

/**
 * Emits real-time WebSocket updates for employee commission, dashboard, and reports.
 */
export async function broadcastCommissionEvent(employeeId: number, eventData: any): Promise<void> {
  try {
    const { getWebSocketInstance } = require('./websocketSingleton');
    const ws = getWebSocketInstance();
    if (ws) {
      console.log(`[WebSocket] Broadcasting event for Employee ID ${employeeId}`);
      if (typeof ws.broadcastCommissionUpdate === 'function') {
        await ws.broadcastCommissionUpdate(employeeId, eventData);
      } else if (ws.getServer()) {
        ws.getServer().to(`employee_${employeeId}`).emit('commissionUpdate', eventData);
      }
    }
  } catch (err: any) {
    console.error('[WebSocket Error] Broadcast failed:', err.message);
  }
}

/**
 * Normalizes event type strings to canonical uppercase format:
 * INVOICE_CREATED, INVOICE_UPDATED, CREDIT_NOTE_CREATED, CREDIT_NOTE_UPDATED,
 * SALES_EXCHANGE_CREATED, SALES_EXCHANGE_UPDATED, EMPLOYEE_CREATED, EMPLOYEE_UPDATED, EMPLOYEE_DELETED
 */
export function normalizeEventType(rawType?: string | null, routeDefault: string = 'INVOICE_CREATED', payload?: any): string {
  if (rawType && typeof rawType === 'string' && rawType.trim()) {
    const s = rawType.trim().toLowerCase().replace(/[\.\-]/g, '_');
    if (s.includes('credit') && (s.includes('update') || s.includes('cancel') || s.includes('reverse'))) return 'CREDIT_NOTE_UPDATED';
    if (s.includes('credit') && (s.includes('create') || s.includes('add'))) return 'CREDIT_NOTE_CREATED';
    if (s.includes('credit')) return 'CREDIT_NOTE_CREATED';

    if (s.includes('exchange') && (s.includes('update') || s.includes('cancel') || s.includes('reverse'))) return 'SALES_EXCHANGE_UPDATED';
    if (s.includes('exchange') && (s.includes('create') || s.includes('add'))) return 'SALES_EXCHANGE_CREATED';
    if (s.includes('exchange')) return 'SALES_EXCHANGE_CREATED';

    if (s.includes('invoice') && s.includes('update')) return 'INVOICE_UPDATED';
    if (s.includes('invoice') && s.includes('create')) return 'INVOICE_CREATED';

    if (s.includes('employee') && s.includes('delete')) return 'EMPLOYEE_DELETED';
    if (s.includes('employee') && s.includes('update')) return 'EMPLOYEE_UPDATED';
    if (s.includes('employee') && (s.includes('create') || s.includes('add'))) return 'EMPLOYEE_CREATED';

    return rawType.toUpperCase().replace(/[\.\-]/g, '_');
  }

  if (payload) {
    const dataStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const lowerStr = dataStr.toLowerCase();
    if (lowerStr.includes('creditnote') || lowerStr.includes('credit_note')) {
      if (lowerStr.includes('cancel') || lowerStr.includes('update') || lowerStr.includes('reverse')) return 'CREDIT_NOTE_UPDATED';
      return 'CREDIT_NOTE_CREATED';
    }
    if (lowerStr.includes('salesexchange') || lowerStr.includes('sales_exchange') || lowerStr.includes('exchangeno')) {
      if (lowerStr.includes('cancel') || lowerStr.includes('update') || lowerStr.includes('reverse')) return 'SALES_EXCHANGE_UPDATED';
      return 'SALES_EXCHANGE_CREATED';
    }
  }

  return routeDefault;
}

/**
 * Creates an explicit WebhookLog entry in DB with authoritative event type.
 */
export async function createWebhookLog(data: {
  eventType: string;
  status: string;
  payload: any;
  billId?: string | null;
  eventId?: string | null;
  amount?: number | null;
  employeeId?: number | null;
  errorMessage?: string | null;
}): Promise<any> {
  try {
    const normalizedType = normalizeEventType(data.eventType, 'INVOICE_CREATED', data.payload);
    const payloadStr = typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload);
    const meta = extractWebhookMeta(data.payload);
    const resolvedEventId = data.eventId || meta.eventId || null;

    const log = await prisma.webhookLog.create({
      data: {
        eventType: normalizedType,
        status: data.status || 'SUCCESS',
        payload: payloadStr,
        billId: data.billId || meta.billId || null,
        eventId: resolvedEventId ? String(resolvedEventId) : null,
        amount: data.amount !== undefined && data.amount !== null ? Number(data.amount) : (meta.amount || null),
        employeeId: data.employeeId || null,
        errorMessage: data.errorMessage || null,
        processedAt: new Date(),
      },
    });
    console.log(`[WEBHOOK LOG] ✅ Recorded Log ID ${log.id} | EventType: ${normalizedType} | Status: ${log.status} | EventId: ${log.eventId || 'N/A'}`);
    return log;
  } catch (err: any) {
    console.error('[WEBHOOK LOG] ❌ Failed to record log:', err.message);
    return null;
  }
}

/**
 * Resolves a clean integer POS invoice / bill number for mobile UI and API responses.
 * Reuses numeric billNumber, billId, or invoiceNumber if present; preserves true POS bill number.
 * Example: 89, 93, 94...
 */
export function getNumericInvoiceNumber(item: {
  id?: number | string | null;
  invoiceNumber?: string | number | null;
  billId?: string | number | null;
  billNumber?: number | null;
  invoiceNo?: string | number | null;
  notes?: string | null;
  description?: string | null;
}): number {
  // 1. Direct positive integer billNumber
  if (item.billNumber !== null && item.billNumber !== undefined) {
    if (typeof item.billNumber === 'number' && item.billNumber > 0 && item.billNumber <= 2147483647) {
      return item.billNumber;
    }
    const parsed = parseInt(String(item.billNumber).replace(/\D/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 2147483647) return parsed;
  }

  // 2. Direct billId (numeric or clean code like "89", "HWM-89")
  if (item.billId !== null && item.billId !== undefined) {
    if (typeof item.billId === 'number' && item.billId > 0 && item.billId <= 2147483647) {
      return item.billId;
    }
    const str = String(item.billId).trim();
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(str);
    if (!isUuid && str.length > 0) {
      const digits = str.replace(/\D/g, '');
      if (digits.length > 0 && digits.length <= 9) {
        const num = parseInt(digits, 10);
        if (num > 0 && num <= 2147483647) return num;
      }
    }
  }

  // 3. Invoice Number string / number (e.g. "HWM-89", "INV-93", "89")
  const rawInv = item.invoiceNumber ?? item.invoiceNo;
  if (rawInv !== null && rawInv !== undefined) {
    if (typeof rawInv === 'number' && rawInv > 0 && rawInv <= 2147483647) {
      return rawInv;
    }
    const str = String(rawInv).trim();
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(str);
    if (!isUuid && str.length > 0) {
      const digits = str.replace(/\D/g, '');
      if (digits.length > 0 && digits.length <= 9) {
        const num = parseInt(digits, 10);
        if (num > 0 && num <= 2147483647) return num;
      }
    }
  }

  // 4. Notes / Description inspect for embedded bill reference
  const noteStr = String(item.notes || item.description || '');
  if (noteStr) {
    const match = noteStr.match(/(?:Invoice|Bill|INV|HWM)\s*#?\s*(\d+)/i);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (num > 0 && num <= 2147483647) return num;
    }
  }

  // 5. Fallback cleanly to integer id if available
  if (typeof item.id === 'number' && Number.isSafeInteger(item.id) && item.id > 0 && item.id <= 2147483647) {
    return item.id;
  }
  if (item.id) {
    const rawId = String(item.id).trim();
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(rawId);
    if (!isUuid && rawId.length > 0) {
      const digits = rawId.replace(/\D/g, '');
      if (digits.length > 0 && digits.length <= 9) {
        const num = parseInt(digits, 10);
        if (num > 0 && num <= 2147483647) return num;
      }
    }
  }

  return 1;
}

/**
 * Calculates commission for standard created invoice.
 * commission = (saleAmount * rate) / 100
 */
export function calculateCommissionAmount(saleAmount: number, rate: number): number {
  if (!saleAmount || !rate || isNaN(saleAmount) || isNaN(rate)) return 0;
  return Math.round(((Math.abs(saleAmount) * rate) / 100) * 100) / 100;
}

/**
 * Calculates commission breakdown for invoice update.
 * Old commission = (oldAmount * rate) / 100
 * New commission = (newAmount * rate) / 100
 * Total commission earned = Old commission + New commission
 */
export function calculateInvoiceUpdateCommission(
  oldAmount: number,
  newAmount: number,
  rate: number
): {
  oldCommission: number;
  newCommission: number;
  totalCommission: number;
  commissionDifference: number;
} {
  const safeRate = isNaN(rate) ? 0 : rate;
  const oldComm = Math.round(((Math.abs(oldAmount || 0) * safeRate) / 100) * 100) / 100;
  const newComm = Math.round(((Math.abs(newAmount || 0) * safeRate) / 100) * 100) / 100;
  const totalCommission = Math.round((oldComm + newComm) * 100) / 100;
  const commissionDifference = Math.round((newComm - oldComm) * 100) / 100;
  return {
    oldCommission: oldComm,
    newCommission: newComm,
    totalCommission,
    commissionDifference,
  };
}

