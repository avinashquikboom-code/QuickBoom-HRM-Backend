import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import {
  extractWebhookMeta,
  resolveEmployeeId,
  safeParseAmount,
  safeParseDate,
  parseSaleDateCorrectly,
  fetchHopkidInvoiceDetails,
  updateEmployeeWalletCommission,
  broadcastCommissionEvent,
  parseIsOld,
  normalizeEventType,
} from '../utils/commissionHelper';
import { checkWebhookIdempotency } from '../utils/webhookIdempotency';
import { getWebSocketInstance } from '../utils/websocketSingleton';
import {
  processEmployeeCreated as execEmployeeCreated,
  processEmployeeUpdated as execEmployeeUpdated,
  processEmployeeDeleted as execEmployeeDeleted,
} from './employeeWebhookController';

console.log('[Webhook Controller] ✅ Centralized Webhook Controller Loaded');

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Store Raw Ingress Webhook Payload
// ═══════════════════════════════════════════════════════════════════════════════

export async function storeWebhookData(data: any): Promise<void> {
  try {
    const meta = extractWebhookMeta(data);
    const dateVal = meta.invoice?.invoiceDate || meta.invoice?.date || data.invoiceDate || data.date || data.createdAt || data.transactionDate;
    const parsedDate = safeParseDate(dateVal);

    const mobileNo = meta.firstItem?.employeePhoneNo || meta.firstItem?.employeeContactNo || data.mobileNo || data.mobileNumber || data.phone || data.phoneNumber || null;
    const employeeCode = meta.firstItem?.employeeCode || data.employeeCode || data.code || data.empCode || data.hopkidCode || null;
    const billId = meta.billId;
    const amountVal = safeParseAmount(meta.amount || data.amount || data.saleAmount);
    const name = meta.customerName || meta.firstItem?.employeeName || data.employeeName || data.name || data.customerName || null;
    const description = meta.branchName || data.description || data.notes || (data.paymentMode ? `Payment: ${data.paymentMode}` : null);
    const storeId = meta.storeId;

    await prisma.hopkidWebhookLog.create({
      data: {
        mobileNo: mobileNo ? String(mobileNo) : null,
        employeeCode: employeeCode ? String(employeeCode) : null,
        amount: amountVal,
        billId: billId ? String(billId) : null,
        date: parsedDate,
        name: name ? String(name) : null,
        storeId,
        description: description ? String(description) : null,
        rawPayload: typeof data === 'string' ? data : JSON.stringify(data),
      },
    });
  } catch (error: any) {
    console.error('[HopKid Raw Store Error]:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Group & Calculate Commission By Salesman for Invoices
// ═══════════════════════════════════════════════════════════════════════════════

export async function groupAndCalculateCommissionBySalesman(
  lineItems: any[],
  invoiceData: { invoiceNo: string; invoiceDate: string | Date; netAmount: number; metaStoreId?: number | null; defaultIdentifier?: string | null }
): Promise<Map<number, { salesman: any; totalAmount: number; totalCommission: number; products: any[] }>> {
  const commissionMap = new Map<number, { salesman: any; totalAmount: number; totalCommission: number; products: any[] }>();

  for (let i = 0; i < lineItems.length; i++) {
    const lineItem = lineItems[i];

    try {
      const productName = lineItem.productName || lineItem.name || 'Unknown Product';
      const productId = lineItem.productID || lineItem.productId || lineItem.id || `prod-${i + 1}`;

      const rawProdAmount =
        lineItem.productNetAmount ??
        lineItem.netAmount ??
        lineItem.amount ??
        lineItem.saleAmount ??
        (lineItems.length === 1 ? invoiceData.netAmount : 0);

      const productNetAmount = safeParseAmount(rawProdAmount) || (lineItems.length === 1 ? invoiceData.netAmount : 0);
      if (productNetAmount <= 0) continue;

      const employeeIdentifier =
        lineItem.employeeCode ||
        lineItem.code ||
        lineItem.empCode ||
        lineItem.hopkidCode ||
        lineItem.employeePhoneNo ||
        lineItem.employeeContactNo ||
        lineItem.mobileNo ||
        lineItem.mobileNumber ||
        lineItem.phone ||
        lineItem.phoneNumber ||
        lineItem.employeeName ||
        lineItem.name ||
        invoiceData.defaultIdentifier ||
        lineItem.employeeId ||
        lineItem.employeeID ||
        lineItem.SalesMan;

      if (!employeeIdentifier) {
        console.warn(`[Commission] Employee mapping failed\nBillId: ${invoiceData.invoiceNo}\nEmployee identifier received: None\nReason: No employee identifier found in product or invoice data`);
        continue;
      }

      let resolvedId = await resolveEmployeeId(employeeIdentifier);
      if (resolvedId === null && lineItem.employeePhoneNo) {
        resolvedId = await resolveEmployeeId(lineItem.employeePhoneNo);
      }
      if (resolvedId === null && lineItem.employeeName) {
        resolvedId = await resolveEmployeeId(lineItem.employeeName);
      }

      let salesman = null;
      if (resolvedId !== null) {
        salesman = await prisma.employee.findUnique({
          where: { id: resolvedId },
          include: {
            commissionPolicies: {
              where: { isActive: true },
              orderBy: { priority: 'asc' },
            },
          },
        });
      }

      if (!salesman) {
        try {
          const rawName = lineItem.employeeName || lineItem.name || 'HopKid Employee';
          const nameParts = String(rawName).trim().split(' ');
          const firstName = nameParts[0] || 'HopKid';
          const lastName = nameParts.slice(1).join(' ') || 'Employee';
          const mobileNumber = lineItem.employeePhoneNo || lineItem.employeeContactNo || lineItem.mobileNo || null;
          const empCode = lineItem.employeeCode || lineItem.code || `HK_${String(employeeIdentifier).replace(/[^a-zA-Z0-9]/g, '')}`;

          salesman = await prisma.employee.create({
            data: {
              employeeCode: String(empCode),
              firstName,
              lastName,
              mobileNumber: mobileNumber ? String(mobileNumber) : null,
              status: 'active',
              source: 'HOPKID',
              commissionPercentage: 1.00,
              storeId: invoiceData.metaStoreId,
            },
            include: {
              commissionPolicies: {
                where: { isActive: true },
                orderBy: { priority: 'asc' },
              },
            },
          });
        } catch (createErr: any) {
          console.error(`[Commission] Employee mapping failed\nBillId: ${invoiceData.invoiceNo}\nEmployee identifier received: ${employeeIdentifier}\nReason: ${createErr.message}`);
        }
      }

      if (!salesman) {
        console.error(`[Commission] Employee mapping failed\nBillId: ${invoiceData.invoiceNo}\nEmployee identifier received: ${employeeIdentifier}\nReason: Salesman could not be found or created`);
        continue;
      }

      let policy = salesman.commissionPolicies?.[0];
      const targetStoreId = invoiceData.metaStoreId || salesman.storeId;

      if (!policy && targetStoreId) {
        const store = await prisma.store.findUnique({
          where: { id: targetStoreId },
          include: {
            commissionPolicies: {
              where: { isActive: true },
              orderBy: { priority: 'asc' },
            },
          },
        });
        if (store && store.commissionPolicies.length > 0) {
          policy = store.commissionPolicies[0];
        }
      }

      let productCommission = 0;
      let commissionRate = 0;

      if (policy) {
        if (policy.commissionType === 'PERCENTAGE') {
          commissionRate = policy.commissionValue;
          productCommission = (productNetAmount * policy.commissionValue) / 100;
        } else if (policy.commissionType === 'FIXED') {
          productCommission = policy.commissionValue;
          commissionRate = 0;
        }
      } else {
        commissionRate = salesman.commissionPercentage ?? 1.0;
        productCommission = (productNetAmount * commissionRate) / 100;
      }

      const isOld = parseIsOld(lineItem);
      const effectiveProdAmount = isOld ? -Math.abs(productNetAmount) : Math.abs(productNetAmount);
      const effectiveProdComm = isOld ? -Math.abs(productCommission) : Math.abs(productCommission);

      if (commissionMap.has(salesman.id)) {
        const existing = commissionMap.get(salesman.id)!;
        existing.totalAmount += effectiveProdAmount;
        existing.totalCommission += effectiveProdComm;
        existing.products.push({
          productID: productId,
          productName: productName,
          productNetAmount: effectiveProdAmount,
          productCommission: effectiveProdComm,
          policyId: policy ? policy.id : null,
          storeId: targetStoreId,
          isOld,
        });
      } else {
        commissionMap.set(salesman.id, {
          salesman,
          totalAmount: effectiveProdAmount,
          totalCommission: effectiveProdComm,
          products: [
            {
              productID: productId,
              productName: productName,
              productNetAmount: effectiveProdAmount,
              productCommission: effectiveProdComm,
              policyId: policy ? policy.id : null,
              storeId: targetStoreId,
              isOld,
            },
          ],
        });
      }
    } catch (productError: any) {
      console.error(`[Product ${i + 1}] ❌ Error processing product:`, productError.message);
      continue;
    }
  }

  return commissionMap;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Resolve Employee For Exchange Line Item
// ═══════════════════════════════════════════════════════════════════════════════

async function resolveEmployeeForExchangeItem(lineItem: any, fallbackEmployeeId: number | null): Promise<any> {
  const rawCode = lineItem.employeeCode || lineItem.salesmanCode || lineItem.empCode || lineItem.staffCode || lineItem.SalesManCode || lineItem.SalesmanCode || lineItem.EmployeeCode || lineItem.salesman?.code;
  const rawId = lineItem.employeeId || lineItem.salesmanId || lineItem.empId || lineItem.employeeID || lineItem.SalesManID || lineItem.salesman?.id;
  const rawName = lineItem.employeeName || lineItem.salesmanName || lineItem.empName || lineItem.SalesManName || lineItem.SalesmanName || lineItem.salesman?.name || lineItem.name;
  const rawPhone = lineItem.employeePhoneNo || lineItem.phone || lineItem.mobileNo || lineItem.mobileNumber || lineItem.salesman?.phone;

  if (rawCode) {
    const codeStr = String(rawCode).trim();
    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: codeStr },
          { employeeCode: codeStr.toUpperCase() },
          { employeeID: codeStr },
        ]
      }
    }).catch(() => null);
    if (emp) return emp;
  }

  if (rawId) {
    const numId = Number(rawId);
    if (!isNaN(numId) && numId > 0) {
      const emp = await prisma.employee.findUnique({ where: { id: numId } }).catch(() => null);
      if (emp) return emp;
    }
    const strId = String(rawId).trim();
    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeID: strId },
          { employeeCode: strId }
        ]
      }
    }).catch(() => null);
    if (emp) return emp;
  }

  if (rawPhone) {
    const cleanPhone = String(rawPhone).replace(/\D/g, '').slice(-10);
    if (cleanPhone.length >= 10) {
      const emp = await prisma.employee.findFirst({
        where: {
          OR: [
            { mobileNumber: cleanPhone },
            { mobileNumber: `+91${cleanPhone}` },
            { mobileNumber: { contains: cleanPhone } }
          ]
        }
      }).catch(() => null);
      if (emp) return emp;
    }
  }

  if (rawName && typeof rawName === 'string' && rawName.trim().length > 0) {
    const trimmedName = rawName.trim();
    const parts = trimmedName.split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { firstName: { contains: trimmedName, mode: 'insensitive' as const } },
          { lastName: { contains: trimmedName, mode: 'insensitive' as const } },
          ...(firstName && lastName ? [
            {
              AND: [
                { firstName: { contains: firstName, mode: 'insensitive' as const } },
                { lastName: { contains: lastName, mode: 'insensitive' as const } }
              ]
            }
          ] : [])
        ]
      }
    }).catch(() => null);
    if (emp) return emp;
  }

  if (rawCode || rawName) {
    try {
      const codeToUse = String(rawCode || `EMP-${Date.now()}`).trim().toUpperCase();
      const nameStr = String(rawName || codeToUse).trim();
      const parts = nameStr.split(/\s+/);
      const fName = parts[0] || 'Salesman';
      const lName = parts.slice(1).join(' ') || '';

      const createdEmp = await prisma.employee.create({
        data: {
          employeeCode: codeToUse,
          firstName: fName,
          lastName: lName,
          designation: 'Salesman',
          status: 'active',
          source: 'HOPKID_EXCHANGE'
        }
      });
      return createdEmp;
    } catch (createErr: any) {
      console.warn('[SalesExchange] ⚠️ Could not auto-create employee for lineItem:', createErr.message);
    }
  }

  if (fallbackEmployeeId) {
    return prisma.employee.findUnique({ where: { id: fallbackEmployeeId } }).catch(() => null);
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1️⃣ INVOICE CREATED & 2️⃣ INVOICE UPDATED PROCESSORS
// ═══════════════════════════════════════════════════════════════════════════════

export async function processInvoiceCreated(payload: any, eventId?: string | null): Promise<void> {
  await processInvoiceInternal(payload, 'INVOICE_CREATED', eventId);
}

export async function processInvoiceUpdated(payload: any, eventId?: string | null): Promise<void> {
  await processInvoiceInternal(payload, 'INVOICE_UPDATED', eventId);
}

/**
 * Shared core for Invoice processing (Created / Updated)
 *
 * COMMISSION DUPLICATION FIX:
 * - INVOICE_CREATED: Uses a pre-upsert timestamp sentinel to detect whether the
 *   commissionTransaction.upsert was a true CREATE or a race-condition UPDATE.
 *   Wallet credits are ONLY issued on true creates, preventing double-crediting.
 * - INVOICE_UPDATED: Computes delta (newCommission - oldCommission) and only
 *   adjusts the wallet by the incremental difference.
 * - Both paths are fully idempotent: re-processing the same webhook produces
 *   zero net wallet change.
 */
async function processInvoiceInternal(rawSalesData: any, targetEventType: string, eventIdParam?: string | null): Promise<void> {
  let effectiveData = rawSalesData;
  let meta = extractWebhookMeta(effectiveData);

  const invoice = meta.invoice || {};
  const lineItems = meta.lineItems || [];

  if ((meta.amount === 0 || meta.lineItems.length === 0 || !meta.employeeIdentifier) && (meta.billId || meta.eventId)) {
    const searchId = meta.billId || meta.eventId;
    const fetchedInvoice = await fetchHopkidInvoiceDetails(searchId as string);

    if (fetchedInvoice) {
      effectiveData = {
        ...(typeof rawSalesData === 'object' ? rawSalesData : {}),
        fetchedData: fetchedInvoice,
        data: fetchedInvoice.data || fetchedInvoice,
      };
      meta = extractWebhookMeta(effectiveData);
    }
  }

  const primaryBillId = meta.billId || invoice.invoiceNo || invoice.invoiceId || `BILL-${Date.now()}`;
  const primaryAmount = meta.amount || invoice.netAmount || 0;

  let itemsToProcess: any[] = [];
  if (meta.salesmen && meta.salesmen.length > 0) {
    itemsToProcess = meta.salesmen.map((s, idx) => ({
      productID: s.productId || s.productID || `SALESMAN-${idx + 1}`,
      productName: s.productName || s.name || `Salesman Allocation`,
      productNetAmount: safeParseAmount(s.amount ?? s.saleAmount ?? s.applicableAmount ?? (primaryAmount * (s.percentage || s.sharePercent || 0) / 100)),
      employeeCode: s.employeeCode || s.code || s.empCode || s.employeeId || s.salesmanCode || s.id,
      employeeName: s.employeeName || s.name || s.salesmanName,
      employeePhoneNo: s.employeePhoneNo || s.mobileNo || s.phone,
      isOld: s.isOld ?? s.IsOld,
    }));
  } else if (meta.lineItems.length > 0) {
    itemsToProcess = meta.lineItems;
  } else {
    itemsToProcess = [effectiveData];
  }

  const resolvedEventId = eventIdParam || meta.eventId || null;

  const dateStr = meta.invoice?.invoiceDate || meta.invoice?.date || effectiveData.createdAt || effectiveData.transactionDate;
  const validDate = await parseSaleDateCorrectly(dateStr || '');

  const commissionMap = await groupAndCalculateCommissionBySalesman(itemsToProcess, {
    invoiceNo: String(primaryBillId),
    invoiceDate: validDate,
    netAmount: primaryAmount,
    metaStoreId: meta.storeId,
    defaultIdentifier: meta.employeeIdentifier,
  });

  const invoiceStatus = (invoice.status || effectiveData.status || 'ACTIVE').toUpperCase();
  const isCancelledOrReturned = invoiceStatus === 'CANCELLED' || invoiceStatus === 'CANCEL' || invoiceStatus === 'RETURNED' || invoiceStatus === 'RETURN' || invoiceStatus === 'INACTIVE';
  const targetSalesStatus = isCancelledOrReturned ? (invoiceStatus.includes('RETURN') ? 'RETURNED' : 'CANCELLED') : 'ACTIVE';
  const targetCommStatus = isCancelledOrReturned ? 'REJECTED' : 'APPROVED';

  const billIdKey = String(primaryBillId);
  const affectedEmployeeIds: number[] = [];
  let processedSalesCount = 0;

  console.log(`\n[Commission Audit] ═══════════════════════════════════════════════════`);
  console.log(`[Commission Audit] Event: ${targetEventType} | BillId: ${billIdKey} | EventId: ${resolvedEventId || 'N/A'}`);
  console.log(`[Commission Audit] Incoming Amount: ₹${primaryAmount} | Status: ${invoiceStatus}`);
  console.log(`[Commission Audit] ═══════════════════════════════════════════════════`);

  console.log(`\n[COMMISSION DEBUG]`);
  console.log(`Bill ID: ${billIdKey}`);
  console.log(`Invoice: ${invoice.invoiceNumber || invoice.invoiceNo || billIdKey}`);
  console.log(`Salesmen Count: ${commissionMap.size}`);
  console.log(`Salesmen: ${Array.from(commissionMap.values()).map(c => `${c.salesman.firstName} ${c.salesman.lastName} (${c.salesman.employeeCode || c.salesman.id})`).join(', ')}`);
  console.log(`Employee IDs: ${Array.from(commissionMap.keys()).join(', ')}`);
  console.log(`Applicable Amounts: ${Array.from(commissionMap.values()).map(c => `₹${c.totalAmount}`).join(', ')}`);

  await prisma.$transaction(async (tx) => {
    const existingTransactions = await tx.commissionTransaction.findMany({
      where: { billId: billIdKey }
    });

    const activeSalesmanIds = new Set<number>();

    for (const [salesmanId, commissionData] of commissionMap.entries()) {
      activeSalesmanIds.add(salesmanId);
      const salesman = commissionData.salesman;

      const saleAmount = Math.round(commissionData.totalAmount * 100) / 100;
      const commAmt = Math.round(commissionData.totalCommission * 100) / 100;
      const targetStoreId = commissionData.products[0]?.storeId || meta.storeId || salesman.storeId;
      const targetPolicyId = commissionData.products[0]?.policyId ?? null;
      const productNamesSummary = commissionData.products.map(p => p.productName).filter(Boolean).join(', ');
      const isUpdate = targetEventType === 'INVOICE_UPDATED' || existingTransactions.some(t => t.employeeId === salesman.id);
      const noteText = `HopKid Invoice ${billIdKey}${productNamesSummary ? ` - Products: ${productNamesSummary}` : ''}${isUpdate ? ' (Updated)' : ''}`;

      const existingTx = existingTransactions.find(t => t.employeeId === salesman.id);

      const oldSaleAmount = existingTx ? existingTx.saleAmount : 0;
      const oldCommission = existingTx ? existingTx.commissionAmount : 0;
      const newSaleAmount = isCancelledOrReturned ? 0 : saleAmount;
      const newCommissionAmount = isCancelledOrReturned ? 0 : commAmt;

      console.log(`\n[COMMISSION CALCULATION]`);
      console.log(`Bill: ${billIdKey}`);
      console.log(`Employee: ${salesman.employeeCode || salesman.id} (${salesman.firstName} ${salesman.lastName})`);
      console.log(`Old Amount: ₹${oldSaleAmount}`);
      console.log(`New Amount: ₹${newSaleAmount}`);
      console.log(`Applicable Amount: ₹${newSaleAmount}`);
      console.log(`Rate: ${salesman.commissionPercentage ?? 1}%`);
      console.log(`Commission: ₹${newCommissionAmount}`);
      console.log(`IsOld: ${commissionData.products.some(p => p.isOld) ? 1 : 0}`);
      console.log(`Event Type: ${targetEventType}`);

      if (existingTx) {
        // ═══════════════════════════════════════════════════════════════
        // INVOICE UPDATED / EXISTING RECORD PATH
        // Replace old amount with new amount; wallet gets ONLY the delta
        // ═══════════════════════════════════════════════════════════════
        const commDelta = newCommissionAmount - oldCommission;
        const saleDelta = newSaleAmount - oldSaleAmount;

        console.log(`[Invoice Updated]\nBillId: ${billIdKey}\nOld Amount: ₹${oldSaleAmount}\nNew Amount: ₹${newSaleAmount}\nFinal Amount: ₹${newSaleAmount}`);
        console.log(`[Commission]\nEmployee: ${salesman.employeeCode || salesman.id}\nOld Commission: ₹${oldCommission}\nNew Commission: ₹${newCommissionAmount}\nFinal Commission: ₹${newCommissionAmount}`);
        console.log(`[Commission Audit] UPDATE path | BillId: ${billIdKey} | EmployeeId: ${salesman.id}`);
        console.log(`[Commission Audit]   oldAmount: ₹${oldSaleAmount}`);
        console.log(`[Commission Audit]   newAmount: ₹${newSaleAmount}`);
        console.log(`[Commission Audit]   differenceAmount: ₹${saleDelta}`);
        console.log(`[Commission Audit]   oldCommission: ₹${oldCommission}`);
        console.log(`[Commission Audit]   incrementalCommission: ₹${commDelta}`);
        console.log(`[Commission Audit]   finalCommission: ₹${newCommissionAmount}`);
        console.log(`[Commission Audit]   eventId: ${resolvedEventId || 'N/A'}`);

        const updateNoteText = `HopKid Invoice ${billIdKey}${productNamesSummary ? ` - Products: ${productNamesSummary}` : ''} (Updated: Old Amount: ₹${oldSaleAmount}, New Amount: ₹${newSaleAmount}, Diff: ${saleDelta >= 0 ? '+' : ''}₹${saleDelta})`;

        await tx.commissionTransaction.update({
          where: { id: existingTx.id },
          data: {
            saleAmount: newSaleAmount,
            commissionAmount: newCommissionAmount,
            commissionPercent: salesman.commissionPercentage || 1.0,
            oldAmount: oldSaleAmount,
            newAmount: newSaleAmount,
            oldCommission: oldCommission,
            newCommission: newCommissionAmount,
            commissionDifference: commDelta,
            eventType: targetEventType || 'INVOICE_UPDATED',
            status: targetCommStatus,
            notes: updateNoteText,
            updatedAt: new Date(),
          },
        });

        const existingSale = await tx.sales.findFirst({
          where: { billId: billIdKey, employeeId: salesman.id }
        });

        if (existingSale) {
          await tx.sales.update({
            where: { id: existingSale.id },
            data: {
              netAmount: newSaleAmount,
              saleDate: validDate,
              status: targetSalesStatus,
              description: updateNoteText,
              updatedAt: new Date(),
            },
          });
        } else {
          await tx.sales.create({
            data: {
              billId: billIdKey,
              employeeId: salesman.id,
              netAmount: newSaleAmount,
              saleDate: validDate,
              status: targetSalesStatus,
              source: 'HOPKID',
              description: updateNoteText,
            },
          });
        }

        console.log(`[Invoice Updated]\nBillId: ${billIdKey}\nAmount: ₹${newSaleAmount}\nEmployee(s): ${salesman.employeeCode || salesman.id} (${salesman.firstName} ${salesman.lastName})`);
        console.log(`[Commission]\neventId: ${resolvedEventId || 'N/A'}\ninvoiceId: ${billIdKey}\nemployeeId: ${salesman.id}\nemployeeName: ${salesman.firstName} ${salesman.lastName}\nstoreId: ${targetStoreId || 'N/A'}\nisOld: 0\noldAmount: ${oldSaleAmount}\nnewAmount: ${newSaleAmount}\ncommissionRate: ${salesman.commissionPercentage || 1}%\noldCommission: ${oldCommission}\nnewCommission: ${newCommissionAmount}\ncommissionAdjustment: ${commDelta >= 0 ? '+' : ''}${commDelta}\nfinalCommission: ${newCommissionAmount}`);

        // Wallet adjustment for commission delta ONLY
        if (commDelta !== 0) {
          console.log(`[Commission Audit]   Wallet adjustment: ${commDelta > 0 ? '+' : ''}₹${commDelta}`);
          await updateEmployeeWalletCommission(
            salesman.id,
            Math.abs(commDelta),
            commDelta > 0,
            `Commission Adjustment - HopKid Invoice ${billIdKey} (₹${oldSaleAmount} → ₹${newSaleAmount}, diff: ₹${saleDelta})`,
            commDelta > 0 ? 'Commission Earned' : 'Commission Reversed'
          );
        } else {
          console.log(`[Commission Audit]   Wallet adjustment: NONE (delta=0, idempotent re-processing)`);
        }
      } else {
        // ═══════════════════════════════════════════════════════════════
        // INVOICE CREATED / NEW RECORD PATH
        // ═══════════════════════════════════════════════════════════════
        const finalSaleAmount = isCancelledOrReturned ? 0 : saleAmount;
        const finalCommAmount = isCancelledOrReturned ? 0 : commAmt;

        const existingTxInDb = await tx.commissionTransaction.findFirst({
          where: { billId: billIdKey, employeeId: salesman.id }
        });

        let upsertedTx: any;
        let wasCreated = false;

        if (existingTxInDb) {
          upsertedTx = await tx.commissionTransaction.update({
            where: { id: existingTxInDb.id },
            data: {
              saleAmount: finalSaleAmount,
              commissionAmount: finalCommAmount,
              commissionPercent: salesman.commissionPercentage || 1.0,
              oldAmount: existingTxInDb.saleAmount || 0,
              newAmount: finalSaleAmount,
              oldCommission: existingTxInDb.commissionAmount || 0,
              newCommission: finalCommAmount,
              commissionDifference: finalCommAmount - (existingTxInDb.commissionAmount || 0),
              eventType: targetEventType || 'INVOICE_CREATED',
              status: targetCommStatus,
              notes: noteText,
              updatedAt: new Date(),
            },
          });
        } else {
          upsertedTx = await tx.commissionTransaction.create({
            data: {
              employeeId: salesman.id,
              storeId: targetStoreId,
              policyId: targetPolicyId,
              saleAmount: finalSaleAmount,
              commissionType: 'PERCENTAGE',
              commissionPercent: salesman.commissionPercentage || 1.0,
              commissionAmount: finalCommAmount,
              oldAmount: 0,
              newAmount: finalSaleAmount,
              oldCommission: 0,
              newCommission: finalCommAmount,
              commissionDifference: finalCommAmount,
              eventType: targetEventType || 'INVOICE_CREATED',
              billId: billIdKey,
              invoiceNumber: billIdKey,
              status: targetCommStatus,
              notes: noteText,
              createdAt: validDate,
            },
          });
          wasCreated = true;
        }

        const existingSaleInDb = await tx.sales.findFirst({
          where: { billId: billIdKey, employeeId: salesman.id }
        });

        if (existingSaleInDb) {
          await tx.sales.update({
            where: { id: existingSaleInDb.id },
            data: {
              netAmount: finalSaleAmount,
              saleDate: validDate,
              status: targetSalesStatus,
              description: noteText,
              updatedAt: new Date(),
            },
          });
        } else {
          await tx.sales.create({
            data: {
              billId: billIdKey,
              employeeId: salesman.id,
              netAmount: finalSaleAmount,
              saleDate: validDate,
              status: targetSalesStatus,
              source: 'HOPKID',
              description: noteText,
            },
          });
        }

        console.log(`[Invoice Created]\nBillId: ${billIdKey}\nAmount: ₹${finalSaleAmount}\nEmployee(s): ${salesman.employeeCode || salesman.id} (${salesman.firstName} ${salesman.lastName})`);
        console.log(`[Commission]\neventId: ${resolvedEventId || 'N/A'}\ninvoiceId: ${billIdKey}\nemployeeId: ${salesman.id}\nemployeeName: ${salesman.firstName} ${salesman.lastName}\nstoreId: ${targetStoreId || 'N/A'}\nisOld: 0\noldAmount: 0\nnewAmount: ${finalSaleAmount}\ncommissionRate: ${salesman.commissionPercentage || 1}%\noldCommission: 0\nnewCommission: ${finalCommAmount}\ncommissionAdjustment: +${finalCommAmount}\nfinalCommission: ${finalCommAmount}`);
        console.log(`[Commission Audit] CREATE path | BillId: ${billIdKey} | EmployeeId: ${salesman.id}`);
        console.log(`[Commission Audit]   oldAmount: ₹0`);
        console.log(`[Commission Audit]   newAmount: ₹${finalSaleAmount}`);
        console.log(`[Commission Audit]   differenceAmount: ₹${finalSaleAmount}`);
        console.log(`[Commission Audit]   oldCommission: ₹0`);
        console.log(`[Commission Audit]   incrementalCommission: ₹${finalCommAmount}`);
        console.log(`[Commission Audit]   finalCommission: ₹${finalCommAmount}`);
        console.log(`[Commission Audit]   eventId: ${resolvedEventId || 'N/A'}`);
        console.log(`[Commission Audit]   upsertWasCreate: ${wasCreated}`);

        if (!isCancelledOrReturned && finalCommAmount > 0) {
          if (wasCreated) {
            console.log(`[Commission Audit]   Wallet credit: +₹${finalCommAmount} (new commission)`);
            await updateEmployeeWalletCommission(
              salesman.id,
              finalCommAmount,
              true,
              `Commission Earned - HopKid Invoice ${billIdKey}`,
              'Commission Earned'
            );
          } else {
            console.log(`[Commission Audit]   Wallet credit: SKIPPED (race condition — record already existed, concurrent request should have credited)`);
          }
        }
      }

      processedSalesCount++;
      affectedEmployeeIds.push(salesman.id);
    }

    // Handle salesmen removed during an Invoice Updated event
    for (const oldTx of existingTransactions) {
      if (!activeSalesmanIds.has(oldTx.employeeId) && (oldTx.commissionAmount > 0 || oldTx.saleAmount > 0)) {
        const reversedCommission = oldTx.commissionAmount;

        console.log(`[Commission Audit] REMOVAL path | BillId: ${billIdKey} | EmployeeId: ${oldTx.employeeId}`);
        console.log(`[Commission Audit]   Reversing commission: ₹${reversedCommission}`);

        await tx.commissionTransaction.update({
          where: { id: oldTx.id },
          data: {
            saleAmount: 0,
            commissionAmount: 0,
            oldAmount: oldTx.saleAmount,
            newAmount: 0,
            oldCommission: oldTx.commissionAmount,
            newCommission: 0,
            commissionDifference: -oldTx.commissionAmount,
            eventType: 'INVOICE_UPDATED',
            status: 'REJECTED',
            notes: `HopKid Invoice ${billIdKey} (Removed on Update)`,
            updatedAt: new Date(),
          },
        });

        const existingSaleToRemove = await tx.sales.findFirst({
          where: { billId: billIdKey, employeeId: oldTx.employeeId }
        });

        if (existingSaleToRemove) {
          await tx.sales.update({
            where: { id: existingSaleToRemove.id },
            data: {
              netAmount: 0,
              status: 'CANCELLED',
              description: `HopKid Invoice ${billIdKey} (Removed on Update)`,
              updatedAt: new Date(),
            },
          });
        } else {
          await tx.sales.create({
            data: {
              billId: billIdKey,
              employeeId: oldTx.employeeId,
              netAmount: 0,
              saleDate: validDate,
              status: 'CANCELLED',
              source: 'HOPKID',
              description: `HopKid Invoice ${billIdKey} (Removed on Update)`,
            },
          });
        }

        if (reversedCommission > 0) {
          await updateEmployeeWalletCommission(
            oldTx.employeeId,
            reversedCommission,
            false,
            `Commission Reversed - Removed from HopKid Invoice ${billIdKey}`,
            'Commission Reversed'
          );
        }

        affectedEmployeeIds.push(oldTx.employeeId);
      }
    }
  });

  // Post-transaction: Broadcast real-time updates and recalculate monthly totals
  for (const [salesmanId, commissionData] of commissionMap.entries()) {
    try {
      const saleAmount = Math.round(commissionData.totalAmount * 100) / 100;
      const commAmt = Math.round(commissionData.totalCommission * 100) / 100;
      await broadcastCommissionEvent(salesmanId, {
        success: true,
        eventType: targetEventType,
        billId: billIdKey,
        amount: isCancelledOrReturned ? 0 : saleAmount,
        commission: isCancelledOrReturned ? 0 : commAmt,
        employeeId: salesmanId,
        createdAt: validDate.toISOString(),
      });
    } catch (bcErr: any) {
      console.warn(`[Broadcast Warning] Failed for salesman ${salesmanId}:`, bcErr.message);
    }
  }

  // Recalculate monthly commission for all affected employees
  const monthKey = `${validDate.getFullYear()}-${String(validDate.getMonth() + 1).padStart(2, '0')}`;
  for (const empId of affectedEmployeeIds) {
    try {
      const calculation = await CommissionService.calculateMonthlyCommission(empId, monthKey);
      await CommissionService.upsertMonthlyCommission(empId, monthKey, calculation);
    } catch (recalcErr: any) {
      console.warn(`[Commission Recalc Warning] Failed for Employee ${empId}:`, recalcErr.message);
    }
  }

  console.log(`[Commission Audit] ✅ Completed ${targetEventType} for ${billIdKey} | ${processedSalesCount} salesman(s) processed`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3️⃣ CREDIT NOTE CREATED PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function processCreditNoteCreated(payload: any, eventId?: string | null): Promise<void> {
  const data = payload.data || payload;
  const creditNote = data.creditNote || payload.creditNote || data;
  const lineItems = data.lineItems || creditNote.lineItems || payload.lineItems || data.CreditNoteProducts || creditNote.CreditNoteProducts || [];

  if (!creditNote) {
    throw new Error('Invalid payload: missing creditNote data');
  }

  const creditNoteNo = String(creditNote.creditNoteNo || creditNote.CNNo || creditNote.number || `CN-${Date.now()}`);
  const invoiceNo = String(creditNote.invoiceNo || creditNote.invoiceNumber || creditNote.billId || '');
  const totalAmount = Number(creditNote.totalAmount || creditNote.creditAmount || creditNote.amount || 0);

  const creditNoteRecord = await prisma.creditNote.upsert({
    where: { creditNoteNo: creditNoteNo },
    update: {
      invoiceNo: invoiceNo,
      creditDate: new Date(creditNote.creditDate || creditNote.date || new Date()),
      creditAmount: totalAmount,
      creditReason: creditNote.reason || creditNote.creditReason || 'Not specified',
      status: 'ACTIVE',
      updatedAt: new Date(),
    },
    create: {
      creditNoteNo: creditNoteNo,
      invoiceNo: invoiceNo,
      creditDate: new Date(creditNote.creditDate || creditNote.date || new Date()),
      creditAmount: totalAmount,
      creditReason: creditNote.reason || creditNote.creditReason || 'Not specified',
      status: 'ACTIVE',
    }
  });

  const employeeCommissionMap = new Map<number, { employee: any; totalReturnAmount: number }>();
  let firstEmpId: number | null = null;

  for (const lineItem of lineItems) {
    try {
      let employee: any = null;

      if (lineItem.employeeCode) {
        employee = await prisma.employee.findUnique({
          where: { employeeCode: String(lineItem.employeeCode) }
        }).catch(() => null);
      }

      if (!employee && lineItem.employeePhoneNo) {
        const cleanPhone = String(lineItem.employeePhoneNo).replace(/[^0-9]/g, '').slice(-10);
        employee = await prisma.employee.findFirst({
          where: { mobileNumber: { contains: cleanPhone } }
        }).catch(() => null);
      }

      if (!employee && invoiceNo) {
        const originalSale = await prisma.sales.findFirst({
          where: { billId: { contains: invoiceNo } },
          include: { employee: true }
        });
        if (originalSale) employee = originalSale.employee;
      }

      if (!employee) continue;
      if (!firstEmpId) firstEmpId = employee.id;

      const returnedAmount = Number(lineItem.creditAmount || lineItem.amount || lineItem.productNetAmount || 0);
      const prodId = String(lineItem.productID || lineItem.productId || lineItem.name || 'ITEM');

      const existingItem = await prisma.creditNoteLine.findFirst({
        where: {
          creditNoteId: creditNoteRecord.id,
          productId: prodId
        }
      });

      if (!existingItem) {
        await prisma.creditNoteLine.create({
          data: {
            creditNoteId: creditNoteRecord.id,
            productId: prodId,
            productDescription: String(lineItem.productName || lineItem.name || 'Product'),
            creditAmount: returnedAmount,
            commissionAdjustment: (returnedAmount * (employee.commissionPercentage || 0)) / 100,
            employeeId: employee.id,
            reason: creditNote.reason || 'Return'
          }
        });
      }

      if (!employeeCommissionMap.has(employee.id)) {
        employeeCommissionMap.set(employee.id, {
          employee: employee,
          totalReturnAmount: 0
        });
      }

      const empData = employeeCommissionMap.get(employee.id)!;
      empData.totalReturnAmount += returnedAmount;
    } catch (itemError: any) {
      console.error('[CreditNote LineItem] ❌ Error:', itemError.message);
      continue;
    }
  }

  // Recalculate monthly commission for affected employees
  const cnDate = new Date(creditNote.creditDate || creditNote.date || new Date());
  const month = `${cnDate.getFullYear()}-${String(cnDate.getMonth() + 1).padStart(2, '0')}`;

  for (const [empId] of employeeCommissionMap.entries()) {
    const calculation = await CommissionService.calculateMonthlyCommission(empId, month);
    await CommissionService.upsertMonthlyCommission(empId, month, calculation);
  }

  await broadcastCommissionEvent(firstEmpId || 0, {
    eventType: 'CREDIT_NOTE_CREATED',
    creditNoteNo,
    amount: totalAmount
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4️⃣ CREDIT NOTE UPDATED PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function processCreditNoteUpdated(payload: any, eventId?: string | null): Promise<void> {
  const data = payload.data || payload;
  const creditNote = data.creditNote || payload.creditNote || data;
  const creditNoteNo = String(creditNote?.creditNoteNo || creditNote?.CNNo || creditNote?.number || '');

  if (!creditNote || !creditNoteNo) {
    throw new Error('Invalid payload: missing creditNoteNo');
  }

  const creditNoteRecord = await prisma.creditNote.findUnique({
    where: { creditNoteNo: creditNoteNo },
    include: { lineItems: true }
  });

  if (!creditNoteRecord) {
    console.warn('[CreditNote Update] ⚠️ Credit note not found, processing as created...');
    await processCreditNoteCreated(payload, eventId);
    return;
  }

  const newStatus = creditNote.status?.toUpperCase() || 'ACTIVE';
  let ourStatus = 'ACTIVE';
  if (newStatus === 'CANCELLED' || newStatus === 'VOID' || newStatus === 'INACTIVE') {
    ourStatus = 'CANCELLED';
  }

  await prisma.creditNote.update({
    where: { id: creditNoteRecord.id },
    data: {
      status: ourStatus,
      updatedAt: new Date()
    }
  });

  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const empIds = new Set<number>();
  for (const item of creditNoteRecord.lineItems) {
    if (item.employeeId) empIds.add(item.employeeId);
  }

  for (const empId of empIds) {
    const calculation = await CommissionService.calculateMonthlyCommission(empId, month);
    await CommissionService.upsertMonthlyCommission(empId, month, calculation);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5️⃣ SALES EXCHANGE CREATED PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function processSalesExchangeCreated(payload: any, eventId?: string | null): Promise<void> {
  const data = payload.data || payload;
  const exchange = data.salesExchange || payload.salesExchange || data;
  const rawLineItems =
    data.lineItems ||
    exchange.lineItems ||
    payload.lineItems ||
    data.SalesExchangeProductList ||
    exchange.SalesExchangeProductList ||
    payload.SalesExchangeProductList ||
    data.products ||
    exchange.products ||
    payload.products ||
    data.items ||
    payload.items ||
    [];
  const lineItems = Array.isArray(rawLineItems) ? rawLineItems : [];

  if (!exchange) {
    throw new Error('Invalid payload: missing salesExchange data');
  }

  const exchangeNo = String(exchange.exchangeNo || exchange.number || `EX-${Date.now()}`);
  const originalInvoiceNo = String(exchange.originalInvoiceNo || exchange.originalInvoiceNumber || exchange.billId || '');
  const newInvoiceNo = String(exchange.newInvoiceNo || exchange.newInvoiceNumber || `INV-EX-${Date.now()}`);

  const originalSale = await prisma.sales.findFirst({
    where: { billId: { contains: originalInvoiceNo } }
  });

  let totalNewSales = 0;
  let totalOldSales = 0;
  let totalNewCommission = 0;
  let totalOldCommission = 0;

  const newSaleIds: string[] = [];
  const affectedEmployeeIds = new Set<number>();
  let primaryNewEmployeeId: number | null = null;
  const exchangeEmployeeMap = new Map<string, any>();

  for (let i = 0; i < lineItems.length; i++) {
    const lineItem = lineItems[i];
    try {
      const employee = await resolveEmployeeForExchangeItem(lineItem, originalSale?.employeeId || null);
      if (!employee) continue;

      if (!primaryNewEmployeeId) primaryNewEmployeeId = employee.id;
      affectedEmployeeIds.add(employee.id);

      const isOld = parseIsOld(lineItem);
      const rawAmount = Number(lineItem.productNetAmount || lineItem.netAmount || lineItem.amount || lineItem.Total || lineItem.price || 0);
      if (isNaN(rawAmount) || rawAmount <= 0) continue;

      const rate = employee.commissionPercentage ?? 1.0;
      const baseComm = (rawAmount * rate) / 100;

      // Existing Sales Exchange Rule:
      // IsOld = 1 (Returned item) -> SUBTRACT (-)
      // IsOld = 0 (Sold item) -> ADD (+)
      const effectiveSaleAmount = isOld ? -Math.abs(rawAmount) : Math.abs(rawAmount);
      const effectiveCommission = isOld ? -Math.abs(baseComm) : Math.abs(baseComm);

      console.log(`[Sales Exchange]\nIsOld: ${isOld ? '1' : '0'}\nCommission: ₹${Math.abs(baseComm)}\nDirection: ${isOld ? 'MINUS' : 'ADD'}`);

      if (isOld) {
        totalOldSales += Math.abs(rawAmount);
        totalOldCommission += Math.abs(baseComm);
      } else {
        totalNewSales += Math.abs(rawAmount);
        totalNewCommission += Math.abs(baseComm);
      }

      const uniqueBillId = `${newInvoiceNo}-${lineItem.productID || lineItem.productId || i + 1}-${isOld ? 'RET' : 'NEW'}`;

      const existingExSale = await prisma.sales.findFirst({
        where: { billId: uniqueBillId, employeeId: employee.id }
      });

      let saleRecord: any;
      if (existingExSale) {
        saleRecord = await prisma.sales.update({
          where: { id: existingExSale.id },
          data: {
            netAmount: effectiveSaleAmount,
            saleDate: new Date(exchange.exchangeDate || exchange.date || new Date()),
            description: `Exchange ${isOld ? 'Return Item (IsOld: 1)' : 'New Item (IsOld: 0)'}: ${lineItem.productName || lineItem.name || 'Product'} (EX: ${exchangeNo})`,
            updatedAt: new Date(),
          },
        });
      } else {
        saleRecord = await prisma.sales.create({
          data: {
            employeeId: employee.id,
            netAmount: effectiveSaleAmount,
            billId: uniqueBillId,
            saleDate: new Date(exchange.exchangeDate || exchange.date || new Date()),
            description: `Exchange ${isOld ? 'Return Item (IsOld: 1)' : 'New Item (IsOld: 0)'}: ${lineItem.productName || lineItem.name || 'Product'} (EX: ${exchangeNo})`,
            source: 'HOPKID',
            status: 'ACTIVE',
          },
        });
      }

      const key = `${employee.id}_${isOld ? 'RET' : 'NEW'}`;
      if (!exchangeEmployeeMap.has(key)) {
        exchangeEmployeeMap.set(key, {
          employee: employee,
          isOld: isOld,
          totalSaleAmount: 0,
          totalCommissionAmount: 0,
          rate: rate,
        });
      }
      const group = exchangeEmployeeMap.get(key);
      group.totalSaleAmount += effectiveSaleAmount;
      group.totalCommissionAmount += effectiveCommission;

      newSaleIds.push(saleRecord.id.toString());
    } catch (itemError: any) {
      console.error(`[Exchange LineItem ${i + 1}] ❌ Error:`, itemError.message);
      continue;
    }
  }

  // Update/create aggregated CommissionTransactions per (Employee + isOld)
  const txnExDate = new Date(exchange.exchangeDate || exchange.date || new Date());
  for (const group of exchangeEmployeeMap.values()) {
    const exchangeBillId = `${newInvoiceNo}-${group.isOld ? 'RET' : 'NEW'}`;
    const roundedAmount = Number(group.totalSaleAmount.toFixed(2));
    const roundedCommission = Number(group.totalCommissionAmount.toFixed(2));

    const existingExTx = await prisma.commissionTransaction.findFirst({
      where: { billId: exchangeBillId, employeeId: group.employee.id }
    });

    if (existingExTx) {
      await prisma.commissionTransaction.update({
        where: { id: existingExTx.id },
        data: {
          saleAmount: roundedAmount,
          commissionAmount: roundedCommission,
          commissionPercent: group.rate,
          oldAmount: existingExTx.saleAmount || 0,
          newAmount: roundedAmount,
          oldCommission: existingExTx.commissionAmount || 0,
          newCommission: roundedCommission,
          commissionDifference: roundedCommission - (existingExTx.commissionAmount || 0),
          eventType: 'SALES_EXCHANGE',
          createdAt: txnExDate,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.commissionTransaction.create({
        data: {
          employeeId: group.employee.id,
          storeId: group.employee.storeId || null,
          saleAmount: roundedAmount,
          commissionType: 'PERCENTAGE',
          commissionPercent: group.rate,
          commissionAmount: roundedCommission,
          oldAmount: group.isOld ? Math.abs(roundedAmount) : 0,
          newAmount: roundedAmount,
          oldCommission: group.isOld ? Math.abs(roundedCommission) : 0,
          newCommission: roundedCommission,
          commissionDifference: roundedCommission,
          eventType: 'SALES_EXCHANGE',
          billId: exchangeBillId,
          invoiceNumber: exchangeBillId,
          status: 'APPROVED',
          createdAt: txnExDate,
          notes: `Sales Exchange ${group.isOld ? 'Return/Old Item (IsOld: 1)' : 'New Sale (IsOld: 0)'} (EX: ${exchangeNo})`,
        },
      });
    }
  }

  if (!primaryNewEmployeeId) {
    primaryNewEmployeeId = originalSale?.employeeId || 1;
  }

  const origAmountVal = totalOldSales > 0 ? totalOldSales : Number(originalSale?.netAmount || 0);
  const newAmountVal = Number(totalNewSales || 0);
  const diffAmountVal = newAmountVal - origAmountVal;
  const diffCommVal = totalNewCommission - totalOldCommission;

  await prisma.salesExchange.upsert({
    where: { exchangeNo: exchangeNo },
    update: {
      originalInvoiceNo: originalInvoiceNo,
      newInvoiceNo: newInvoiceNo,
      exchangeDate: new Date(exchange.exchangeDate || exchange.date || new Date()),
      originalSaleId: originalSale?.id || null,
      newSaleId: newSaleIds.join(','),
      employeeId: primaryNewEmployeeId,
      originalAmount: origAmountVal,
      newAmount: newAmountVal,
      amountDifference: diffAmountVal,
      originalCommission: totalOldCommission,
      newCommission: totalNewCommission,
      commissionDifference: diffCommVal,
      reason: exchange.reason || 'Sales Exchange',
      status: 'ACTIVE',
      updatedAt: new Date(),
    },
    create: {
      exchangeNo: exchangeNo,
      originalInvoiceNo: originalInvoiceNo,
      newInvoiceNo: newInvoiceNo,
      exchangeDate: new Date(exchange.exchangeDate || exchange.date || new Date()),
      originalSaleId: originalSale?.id || null,
      newSaleId: newSaleIds.join(','),
      employeeId: primaryNewEmployeeId,
      originalAmount: origAmountVal,
      newAmount: newAmountVal,
      amountDifference: diffAmountVal,
      originalCommission: totalOldCommission,
      newCommission: totalNewCommission,
      commissionDifference: diffCommVal,
      reason: exchange.reason || 'Sales Exchange',
      status: 'ACTIVE'
    }
  });

  const exDate = new Date(exchange.exchangeDate || exchange.date || new Date());
  const month = `${exDate.getFullYear()}-${String(exDate.getMonth() + 1).padStart(2, '0')}`;

  if (originalSale?.employeeId) {
    affectedEmployeeIds.add(originalSale.employeeId);
  }

  for (const empId of affectedEmployeeIds) {
    try {
      const calculation = await CommissionService.calculateMonthlyCommission(empId, month);
      await CommissionService.upsertMonthlyCommission(empId, month, calculation);
    } catch (commErr: any) {
      console.error(`[Commission] ⚠️ Failed recalculating commission for employee #${empId}:`, commErr.message);
    }
  }

  for (const empId of affectedEmployeeIds) {
    await broadcastCommissionEvent(empId, {
      eventType: 'SALES_EXCHANGE_CREATED',
      exchangeNo,
      amount: Number(exchange.totalAmount || totalNewSales)
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6️⃣ SALES EXCHANGE UPDATED PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function processSalesExchangeUpdated(payload: any, eventId?: string | null): Promise<void> {
  console.log(`[Sales Exchange Updated] Processing Sales Exchange update for eventId: ${eventId || 'N/A'}`);
  await processSalesExchangeCreated(payload, eventId);
}

// Backward compatibility alias for legacy callers
export const processHopkidSales = processInvoiceCreated;

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED WEBHOOK EXECUTION PIPELINE (Idempotency + Single Log + Execution)
// ═══════════════════════════════════════════════════════════════════════════════

async function executeWebhookPipeline(
  req: Request,
  res: Response,
  canonicalEventType: string,
  processor: (payload: any, eventId?: string | null) => Promise<void>
): Promise<void> {
  const payload = req.body;
  const meta = extractWebhookMeta(payload);
  const normalizedType = normalizeEventType(canonicalEventType, 'INVOICE_CREATED', payload);
  const billId = meta.billId || meta.invoiceNumber || null;
  const amount = meta.amount || null;

  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║ [WEBHOOK INGRESS] Event: ${normalizedType.padEnd(33)} ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);

  // Handle empty or test verification payload from HopKid test delivery button
  if (!payload || (typeof payload === 'object' && Object.keys(payload).length === 0) || payload.test === true || payload.isTest === true || payload.ping === true) {
    console.log(`[Webhook Ingress] ℹ️ Test delivery / verification ping received for ${normalizedType}. Responding HTTP 200 OK.`);
    res.status(200).json({
      success: true,
      status: 'ACTIVE',
      message: `HopKid ${canonicalEventType} test delivery received successfully.`,
      eventType: canonicalEventType,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  await storeWebhookData(payload);

  let logEntry: any = null;

  try {
    // STEP 1: IDEMPOTENCY CHECK
    const idempotency = await checkWebhookIdempotency(payload, normalizedType);
    const resolvedEventId = idempotency.eventId || (meta.eventId ? String(meta.eventId) : null);
    console.log(`[Webhook Idempotency]\nEventId: ${resolvedEventId || 'N/A'}\nDuplicate: ${idempotency.isDuplicate ? 'YES' : 'NO'}`);

    if (idempotency.isDuplicate) {
      console.log(`[Webhook Idempotency] ℹ️ Duplicate event safely ignored (Key: ${idempotency.dedupKey})`);
      res.status(200).json({
        success: true,
        message: 'Webhook already processed',
        duplicate: true,
        dedupKey: idempotency.dedupKey,
      });
      return;
    }

    // STEP 2: CREATE SINGLE PROCESSING LOG ENTRY
    try {
      logEntry = await prisma.webhookLog.create({
        data: {
          eventId: resolvedEventId,
          eventType: normalizedType,
          status: 'PROCESSING',
          payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
          billId: billId ? String(billId) : null,
          amount: amount !== null ? Number(amount) : null,
        },
      });
    } catch (logErr) {
      console.warn('[WebhookLog] Concurrent duplicate detected during insert:', logErr);
      res.status(200).json({
        success: true,
        message: 'Webhook already processed',
        duplicate: true,
        dedupKey: idempotency.dedupKey,
      });
      return;
    }

    // STEP 3: EXECUTE PROCESSOR
    await processor(payload, resolvedEventId);

    // STEP 4: UPDATE WEBHOOK LOG TO SUCCESS
    if (logEntry) {
      await prisma.webhookLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'SUCCESS',
          processedAt: new Date(),
        },
      }).catch(() => {});
    }

    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      duplicate: false,
    });
  } catch (err: any) {
    const errorDetails = `[${err.name || 'Error'}] ${err.message}${err.code ? ` (Code: ${err.code})` : ''}${err.stack ? `\nStack:\n${err.stack}` : ''}`;
    console.error(`[Webhook Handler] ❌ Error processing ${normalizedType}:\n${errorDetails}`);

    const resolvedEventId = meta.eventId ? String(meta.eventId) : null;
    if (logEntry?.id) {
      await prisma.webhookLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'FAILED',
          errorMessage: errorDetails,
          processedAt: new Date(),
        },
      }).catch(() => {});
    } else if (resolvedEventId) {
      await prisma.webhookLog.updateMany({
        where: { eventId: resolvedEventId },
        data: {
          status: 'FAILED',
          errorMessage: errorDetails,
          processedAt: new Date(),
        }
      }).catch(() => {});
    }

    res.status(500).json({
      success: false,
      message: 'Failed to process webhook.',
      error: err.message,
      code: err.code || undefined,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE CONTROLLER HANDLERS (EXACTLY ONE HANDLER PER EVENT)
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleInvoiceCreated(req: Request, res: Response): Promise<void> {
  await executeWebhookPipeline(req, res, 'INVOICE_CREATED', processInvoiceCreated);
}

export async function handleInvoiceUpdated(req: Request, res: Response): Promise<void> {
  await executeWebhookPipeline(req, res, 'INVOICE_UPDATED', processInvoiceUpdated);
}

export async function handleCreditNoteCreated(req: Request, res: Response): Promise<void> {
  await executeWebhookPipeline(req, res, 'CREDIT_NOTE_CREATED', processCreditNoteCreated);
}

export async function handleCreditNoteUpdated(req: Request, res: Response): Promise<void> {
  await executeWebhookPipeline(req, res, 'CREDIT_NOTE_UPDATED', processCreditNoteUpdated);
}

export async function handleSalesExchangeCreated(req: Request, res: Response): Promise<void> {
  await executeWebhookPipeline(req, res, 'SALES_EXCHANGE_CREATED', processSalesExchangeCreated);
}

export async function handleSalesExchangeUpdated(req: Request, res: Response): Promise<void> {
  await executeWebhookPipeline(req, res, 'SALES_EXCHANGE_UPDATED', processSalesExchangeUpdated);
}

export async function handleEmployeeCreated(req: Request, res: Response): Promise<void> {
  await executeWebhookPipeline(req, res, 'EMPLOYEE_CREATED', execEmployeeCreated);
}

export async function handleEmployeeUpdated(req: Request, res: Response): Promise<void> {
  await executeWebhookPipeline(req, res, 'EMPLOYEE_UPDATED', execEmployeeUpdated);
}

export async function handleEmployeeDeleted(req: Request, res: Response): Promise<void> {
  await executeWebhookPipeline(req, res, 'EMPLOYEE_DELETED', execEmployeeDeleted);
}

/**
 * Unified / Ingress Router for single-webhook setups
 */
export async function handleUnifiedWebhook(req: Request, res: Response): Promise<void> {
  const payload = req.body;
  const meta = extractWebhookMeta(payload);
  const normalizedType = normalizeEventType(meta.eventType, 'INVOICE_CREATED', payload);

  switch (normalizedType) {
    case 'CREDIT_NOTE_CREATED':
      return handleCreditNoteCreated(req, res);
    case 'CREDIT_NOTE_UPDATED':
      return handleCreditNoteUpdated(req, res);
    case 'SALES_EXCHANGE_CREATED':
      return handleSalesExchangeCreated(req, res);
    case 'SALES_EXCHANGE_UPDATED':
      return handleSalesExchangeUpdated(req, res);
    case 'EMPLOYEE_CREATED':
      return handleEmployeeCreated(req, res);
    case 'EMPLOYEE_UPDATED':
      return handleEmployeeUpdated(req, res);
    case 'EMPLOYEE_DELETED':
      return handleEmployeeDeleted(req, res);
    case 'INVOICE_UPDATED':
      return handleInvoiceUpdated(req, res);
    case 'INVOICE_CREATED':
    default:
      return handleInvoiceCreated(req, res);
  }
}

// Backward compatibility alias
export const handleHopkidWebhook = handleUnifiedWebhook;

/**
 * GET Endpoint to view raw stored webhook logs
 */
export async function getHopkidLogs(req: Request, res: Response): Promise<void> {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const logs = await prisma.hopkidWebhookLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ success: true, count: logs.length, data: logs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch webhook logs', error: error.message });
  }
}
