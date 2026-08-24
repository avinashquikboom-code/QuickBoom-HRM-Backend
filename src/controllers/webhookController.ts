import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import { extractWebhookMeta, resolveEmployeeId, safeParseAmount, safeParseDate, parseSaleDateCorrectly, fetchHopkidInvoiceDetails, updateEmployeeWalletCommission, broadcastCommissionEvent, createWebhookLog, parseIsOld } from '../utils/commissionHelper';
import { processCreditNoteCreated } from './creditNoteWebhookController';
import { processSalesExchangeCreated } from './salesExchangeWebhookController';
import { processEmployeeCreated, processEmployeeUpdated, processEmployeeDeleted } from './employeeWebhookController';
import { checkWebhookIdempotency } from '../utils/webhookIdempotency';

/**
 * Stores raw HopKid webhook payload into HopkidWebhookLog table
 */
export async function storeWebhookData(data: any): Promise<void> {
  try {
    const meta = extractWebhookMeta(data);
    const dateVal = meta.invoice?.invoiceDate || meta.invoice?.date || data.invoiceDate || data.date || data.createdAt || data.transactionDate;
    const parsedDate = safeParseDate(dateVal);

    const mobileNo = meta.firstItem.employeePhoneNo || meta.firstItem.employeeContactNo || data.mobileNo || data.mobileNumber || data.phone || data.phoneNumber || null;
    const employeeCode = meta.firstItem.employeeCode || data.employeeCode || data.code || data.empCode || data.hopkidCode || null;
    const billId = meta.billId;
    const amountVal = safeParseAmount(meta.amount || data.amount || data.saleAmount);
    const name = meta.customerName || meta.firstItem.employeeName || data.employeeName || data.name || data.customerName || null;
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

    console.log(`[HopKid Raw Store] Log stored in HopkidWebhookLog for Bill ID: ${billId || 'N/A'}, Amount: ₹${amountVal}, Date: ${parsedDate.toISOString()}`);
  } catch (error: any) {
    console.error('[HopKid Store Error]:', error.message);
  }
}

/**
 * HELPER: Group and calculate commission per salesman for multi-product invoices
 */
export async function groupAndCalculateCommissionBySalesman(
  lineItems: any[],
  invoiceData: { invoiceNo: string; invoiceDate: string | Date; netAmount: number; metaStoreId?: number | null; defaultIdentifier?: string | null }
): Promise<Map<number, { salesman: any; totalAmount: number; totalCommission: number; products: any[] }>> {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [COMMISSION GROUPING] Multi-Product Commission Calculator  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const commissionMap = new Map<number, { salesman: any; totalAmount: number; totalCommission: number; products: any[] }>();

  console.log(`\n[Grouping] Processing ${lineItems.length} products from invoice ${invoiceData.invoiceNo}`);
  console.log(`[Grouping] Invoice Date: ${invoiceData.invoiceDate}`);
  console.log(`[Grouping] Invoice Total: ₹${invoiceData.netAmount}`);

  for (let i = 0; i < lineItems.length; i++) {
    const lineItem = lineItems[i];

    console.log(`\n───────────────────────────────────────────────────────────`);
    console.log(`[Product ${i + 1}] Processing...`);
    console.log(`───────────────────────────────────────────────────────────`);

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

      console.log(`[Product ${i + 1}] Details:`, {
        productID: productId,
        productName: productName,
        netAmount: productNetAmount,
      });

      if (productNetAmount <= 0) {
        console.error(`[Product ${i + 1}] ❌ Invalid amount: ${productNetAmount}`);
        continue;
      }

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
        console.error(`[Product ${i + 1}] ❌ Missing employee identifier`);
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
        console.log(`[Product ${i + 1}] Auto-creating Employee for identifier: ${employeeIdentifier}`);
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
        console.log(`[Product ${i + 1}] ✅ Auto-created salesman: ${salesman.firstName} ${salesman.lastName} (ID: ${salesman.id})`);
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

      console.log(`[Product ${i + 1}] Commission Calculation:`, {
        netAmount: effectiveProdAmount,
        commissionRate,
        commission: effectiveProdComm,
        isOld,
      });

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

        console.log(`[Product ${i + 1}] 📊 Merged with existing commission for ${salesman.firstName} ${salesman.lastName}:`, {
          totalAmount: existing.totalAmount,
          totalCommission: existing.totalCommission,
          productCount: existing.products.length,
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

        console.log(`[Product ${i + 1}] ✅ New commission entry for ${salesman.firstName} ${salesman.lastName}:`, {
          totalAmount: productNetAmount,
          totalCommission: productCommission,
        });
      }
    } catch (productError: any) {
      console.error(`[Product ${i + 1}] ❌ Error processing product:`, productError.message);
      continue;
    }
  }

  return commissionMap;
}

/**
 * Robust async background processor for HopKid sales webhook.
 */
export async function processHopkidSales(rawSalesData: any): Promise<void> {
  console.log(`\n======================================================`);
  console.log(`📥 [HopKid Webhook Received] Timestamp: ${new Date().toISOString()}`);
  console.log(`Payload snippet:`, typeof rawSalesData === 'string' ? rawSalesData.slice(0, 300) : JSON.stringify(rawSalesData).slice(0, 300));
  console.log(`======================================================\n`);

  await storeWebhookData(rawSalesData);

  let effectiveData = rawSalesData;
  let meta = extractWebhookMeta(effectiveData);

  // ✅ Delegate Credit Note and Sales Exchange events if received on main webhook endpoint
  if (meta.eventType === 'CREDIT_NOTE_CREATED' || meta.eventType === 'CREDIT_NOTE_UPDATED') {
    console.log(`🔀 [Webhook Delegate] Delegating ${meta.eventType} to CreditNote processor...`);
    await processCreditNoteCreated(effectiveData, meta.eventType);
    return;
  }
  if (meta.eventType === 'SALES_EXCHANGE_CREATED' || meta.eventType === 'SALES_EXCHANGE_UPDATED') {
    console.log(`🔀 [Webhook Delegate] Delegating ${meta.eventType} to SalesExchange processor...`);
    await processSalesExchangeCreated(effectiveData, meta.eventType);
    return;
  }
  if (meta.eventType === 'EMPLOYEE_CREATED') {
    console.log(`🔀 [Webhook Delegate] Delegating ${meta.eventType} to Employee processor...`);
    await processEmployeeCreated(effectiveData);
    return;
  }
  if (meta.eventType === 'EMPLOYEE_UPDATED') {
    console.log(`🔀 [Webhook Delegate] Delegating ${meta.eventType} to Employee processor...`);
    await processEmployeeUpdated(effectiveData);
    return;
  }
  if (meta.eventType === 'EMPLOYEE_DELETED') {
    console.log(`🔀 [Webhook Delegate] Delegating ${meta.eventType} to Employee processor...`);
    await processEmployeeDeleted(effectiveData);
    return;
  }

  const invoice = meta.invoice || {};
  const lineItems = meta.lineItems || [];

  if ((meta.amount === 0 || meta.lineItems.length === 0 || !meta.employeeIdentifier) && (meta.billId || meta.eventId)) {
    const searchId = meta.billId || meta.eventId;
    console.log(`ℹ️ [HopKid Webhook] Sparse payload detected for ID "${searchId}". Auto-fetching full invoice details...`);
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
  const itemsToProcess = meta.lineItems.length > 0 ? meta.lineItems : [effectiveData];
  const eventId = meta.eventId;

  let logEntry: any = null;
  try {
    logEntry = await prisma.webhookLog.create({
      data: {
        eventId: eventId ? String(eventId) : null,
        eventType: meta.eventType,
        status: 'PROCESSING',
        payload: typeof effectiveData === 'string' ? effectiveData : JSON.stringify(effectiveData),
        billId: String(primaryBillId),
        amount: primaryAmount,
      },
    });
  } catch (e) {
    console.error('[WebhookLog] Failed to create log entry (may be duplicate eventId):', e);
  }

  const dateStr = meta.invoice?.invoiceDate || meta.invoice?.date || effectiveData.createdAt || effectiveData.transactionDate;
  const validDate = await parseSaleDateCorrectly(dateStr || '');
  console.log('[Webhook] Parsed invoice date:', {
    input: dateStr,
    parsed: validDate.toISOString(),
    localDate: validDate.toLocaleDateString('en-IN'),
    day: validDate.getDate(),
    month: validDate.getMonth() + 1,
    year: validDate.getFullYear()
  });

  const commissionMap = await groupAndCalculateCommissionBySalesman(itemsToProcess, {
    invoiceNo: String(primaryBillId),
    invoiceDate: validDate,
    netAmount: primaryAmount,
    metaStoreId: meta.storeId,
    defaultIdentifier: meta.employeeIdentifier,
  });

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [WEBHOOK] Saving Sales & Commission Records (Transactional) ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const invoiceStatus = (invoice.status || effectiveData.status || 'ACTIVE').toUpperCase();
  const isCancelledOrReturned = invoiceStatus === 'CANCELLED' || invoiceStatus === 'CANCEL' || invoiceStatus === 'RETURNED' || invoiceStatus === 'RETURN' || invoiceStatus === 'INACTIVE';
  const targetSalesStatus = isCancelledOrReturned ? (invoiceStatus.includes('RETURN') ? 'RETURNED' : 'CANCELLED') : 'ACTIVE';
  const targetCommStatus = isCancelledOrReturned ? 'REJECTED' : 'APPROVED';

  const billIdKey = String(primaryBillId);
  const affectedEmployeeIds: number[] = [];
  let processedSalesCount = 0;
  let lastError: string | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Fetch all existing commission transactions for this billIdKey
      const existingTransactions = await tx.commissionTransaction.findMany({
        where: { billId: billIdKey }
      });

      const activeSalesmanIds = new Set<number>();

      // 2. Process all salesmen in the current/updated commissionMap
      for (const [salesmanId, commissionData] of commissionMap.entries()) {
        activeSalesmanIds.add(salesmanId);
        const salesman = commissionData.salesman;
        console.log(`\n[Save] Processing Salesman: ${salesman.firstName} ${salesman.lastName} (${salesman.employeeCode})`);

        const saleAmount = Math.round(commissionData.totalAmount * 100) / 100;
        const commAmt = Math.round(commissionData.totalCommission * 100) / 100;
        const targetStoreId = commissionData.products[0]?.storeId || meta.storeId || salesman.storeId;
        const targetPolicyId = commissionData.products[0]?.policyId ?? null;
        const productNamesSummary = commissionData.products.map(p => p.productName).filter(Boolean).join(', ');
        const noteText = `HopKid Invoice ${billIdKey}${productNamesSummary ? ` - Products: ${productNamesSummary}` : ''}`;

        const existingTx = existingTransactions.find(t => t.employeeId === salesman.id) ||
          await tx.commissionTransaction.findUnique({
            where: {
              billId_employeeId: {
                billId: billIdKey,
                employeeId: salesman.id,
              }
            }
          });

        if (existingTx) {
          console.log(`[Save] 🔄 Transaction already exists for ${billIdKey} + Salesman ${salesman.id}. Updating existing record...`);
          const commDelta = isCancelledOrReturned ? -existingTx.commissionAmount : (commAmt - existingTx.commissionAmount);

          console.log(`[INVOICE_AUDIT_LOG]`, {
            invoiceId: billIdKey,
            oldAmount: existingTx.saleAmount,
            newAmount: isCancelledOrReturned ? 0 : saleAmount,
            oldCommission: existingTx.commissionAmount,
            newCommission: isCancelledOrReturned ? 0 : commAmt,
            salesmanId: salesman.id,
            oldNetSale: existingTx.saleAmount,
            newNetSale: isCancelledOrReturned ? 0 : saleAmount,
            webhookEventId: eventId || 'N/A',
            operation: 'UPDATED',
          });

          await tx.commissionTransaction.upsert({
            where: {
              billId_employeeId: {
                billId: billIdKey,
                employeeId: salesman.id,
              }
            },
            update: {
              saleAmount: isCancelledOrReturned ? 0 : saleAmount,
              commissionAmount: isCancelledOrReturned ? 0 : commAmt,
              commissionPercent: salesman.commissionPercentage || 1.0,
              status: targetCommStatus,
              notes: `${noteText} (Updated)`,
              updatedAt: new Date(),
            },
            create: {
              employeeId: salesman.id,
              storeId: targetStoreId,
              policyId: targetPolicyId,
              saleAmount: isCancelledOrReturned ? 0 : saleAmount,
              commissionType: 'PERCENTAGE',
              commissionPercent: salesman.commissionPercentage || 1.0,
              commissionAmount: isCancelledOrReturned ? 0 : commAmt,
              billId: billIdKey,
              invoiceNumber: billIdKey,
              status: targetCommStatus,
              notes: `${noteText} (Updated)`,
              createdAt: validDate,
            },
          });

          await tx.sales.upsert({
            where: {
              billId_employeeId: {
                billId: billIdKey,
                employeeId: salesman.id,
              }
            },
            update: {
              netAmount: isCancelledOrReturned ? 0 : saleAmount,
              saleDate: validDate,
              status: targetSalesStatus,
              description: `${noteText} (Updated)`,
              updatedAt: new Date(),
            },
            create: {
              billId: billIdKey,
              employeeId: salesman.id,
              netAmount: isCancelledOrReturned ? 0 : saleAmount,
              saleDate: validDate,
              status: targetSalesStatus,
              source: 'HOPKID',
              description: noteText,
            },
          });

          // Adjust wallet balance for delta if commission changed
          if (commDelta !== 0) {
            await updateEmployeeWalletCommission(
              salesman.id,
              Math.abs(commDelta),
              commDelta > 0,
              `Commission Adjustment - HopKid Invoice ${billIdKey}`,
              commDelta > 0 ? 'Commission Earned' : 'Commission Reversed'
            );
          }
        } else {
          console.log(`[Save] ➕ Creating new CommissionTransaction for ${billIdKey} + Salesman ${salesman.id}...`);

          console.log(`[INVOICE_AUDIT_LOG]`, {
            invoiceId: billIdKey,
            oldAmount: 0,
            newAmount: isCancelledOrReturned ? 0 : saleAmount,
            oldCommission: 0,
            newCommission: isCancelledOrReturned ? 0 : commAmt,
            salesmanId: salesman.id,
            oldNetSale: 0,
            newNetSale: isCancelledOrReturned ? 0 : saleAmount,
            webhookEventId: eventId || 'N/A',
            operation: 'CREATED',
          });

          await tx.commissionTransaction.upsert({
            where: {
              billId_employeeId: {
                billId: billIdKey,
                employeeId: salesman.id,
              }
            },
            update: {
              saleAmount: isCancelledOrReturned ? 0 : saleAmount,
              commissionAmount: isCancelledOrReturned ? 0 : commAmt,
              commissionPercent: salesman.commissionPercentage || 1.0,
              status: targetCommStatus,
              notes: noteText,
              updatedAt: new Date(),
            },
            create: {
              employeeId: salesman.id,
              storeId: targetStoreId,
              policyId: targetPolicyId,
              saleAmount: isCancelledOrReturned ? 0 : saleAmount,
              commissionType: 'PERCENTAGE',
              commissionPercent: salesman.commissionPercentage || 1.0,
              commissionAmount: isCancelledOrReturned ? 0 : commAmt,
              billId: billIdKey,
              invoiceNumber: billIdKey,
              status: targetCommStatus,
              notes: noteText,
              createdAt: validDate,
            },
          });

          await tx.sales.upsert({
            where: {
              billId_employeeId: {
                billId: billIdKey,
                employeeId: salesman.id,
              }
            },
            update: {
              netAmount: isCancelledOrReturned ? 0 : saleAmount,
              saleDate: validDate,
              status: targetSalesStatus,
              description: noteText,
              updatedAt: new Date(),
            },
            create: {
              billId: billIdKey,
              employeeId: salesman.id,
              netAmount: isCancelledOrReturned ? 0 : saleAmount,
              saleDate: validDate,
              status: targetSalesStatus,
              source: 'HOPKID',
              description: noteText,
            },
          });

          if (!isCancelledOrReturned && commAmt > 0) {
            await updateEmployeeWalletCommission(
              salesman.id,
              commAmt,
              true,
              `Commission Earned - HopKid Invoice ${billIdKey}`,
              'Commission Earned'
            );
          }
        }

        processedSalesCount++;
        affectedEmployeeIds.push(salesman.id);

        await broadcastCommissionEvent(salesman.id, {
          success: true,
          eventType: meta.eventType || 'INVOICE_CREATED',
          billId: billIdKey,
          amount: saleAmount,
          commission: isCancelledOrReturned ? 0 : commAmt,
          employeeId: salesman.id,
          createdAt: validDate.toISOString(),
        });
      }

      // 3. Handle removed salesmen who were in existingTransactions but no longer in commissionMap
      for (const oldTx of existingTransactions) {
        if (!activeSalesmanIds.has(oldTx.employeeId) && (oldTx.commissionAmount > 0 || oldTx.saleAmount > 0)) {
          console.log(`[Save] 🔄 Salesman ${oldTx.employeeId} removed from invoice ${billIdKey}. Reversing previous commission of ₹${oldTx.commissionAmount}...`);
          const reversedCommission = oldTx.commissionAmount;

          await tx.commissionTransaction.update({
            where: { id: oldTx.id },
            data: {
              saleAmount: 0,
              commissionAmount: 0,
              status: 'REJECTED',
              notes: `HopKid Invoice ${billIdKey} (Removed on Update)`,
              updatedAt: new Date(),
            },
          });

          await tx.sales.upsert({
            where: {
              billId_employeeId: {
                billId: billIdKey,
                employeeId: oldTx.employeeId,
              }
            },
            update: {
              netAmount: 0,
              status: 'CANCELLED',
              description: `HopKid Invoice ${billIdKey} (Removed on Update)`,
              updatedAt: new Date(),
            },
            create: {
              billId: billIdKey,
              employeeId: oldTx.employeeId,
              netAmount: 0,
              saleDate: validDate,
              status: 'CANCELLED',
              source: 'HOPKID',
              description: `HopKid Invoice ${billIdKey} (Removed on Update)`,
            },
          });

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
  } catch (txErr: any) {
    console.error(`[Save] ❌ Transactional save error for invoice ${billIdKey}:`, txErr.message);
    lastError = txErr.message;
  }

  // Recalculate monthly commission for all affected employees
  const monthKey = `${validDate.getFullYear()}-${String(validDate.getMonth() + 1).padStart(2, '0')}`;
  for (const empId of affectedEmployeeIds) {
    try {
      const calculation = await CommissionService.calculateMonthlyCommission(empId, monthKey);
      await CommissionService.upsertMonthlyCommission(empId, monthKey, calculation);
      console.log(`[Commission Service] ✅ Recalculated monthly commission for Employee ${empId} (${monthKey}): ₹${calculation.totalCommissionAmount}`);
    } catch (recalcErr: any) {
      console.warn(`[Commission Recalc Warning] Failed for Employee ${empId}:`, recalcErr.message);
    }
  }

  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║ [WEBHOOK] ✅ COMPLETE                                      ║`);
  console.log(`║ Salespersons processed: ${processedSalesCount}                                ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);

  if (logEntry) {
    const firstSalesmanId = affectedEmployeeIds[0] || Array.from(commissionMap.keys())[0];
    await prisma.webhookLog.update({
      where: { id: logEntry.id },
      data: {
        employeeId: firstSalesmanId || undefined,
        status: processedSalesCount > 0 ? 'SUCCESS' : (commissionMap.size === 0 ? 'SUCCESS' : 'FAILED'),
        errorMessage: lastError ?? undefined,
        processedAt: new Date(),
      },
    }).catch(() => {});
  }
}

/**
 * Synchronous HopKid sales webhook handler.
 */
export async function handleHopkidWebhook(req: Request, res: Response): Promise<void> {
  const salesData = req.body;

  // ✅ Log immediately
  console.log(`📥 [HopKid Webhook Ingress] Incoming payload at ${new Date().toISOString()}`);

  try {
    const idempotency = await checkWebhookIdempotency(salesData);
    if (idempotency.isDuplicate) {
      console.log(`[HopKid Webhook] ℹ️ Duplicate event safely ignored (Key: ${idempotency.dedupKey})`);
      res.status(200).json({
        success: true,
        message: 'Webhook already processed',
        duplicate: true,
        dedupKey: idempotency.dedupKey,
      });
      return;
    }

    // ✅ Process and await database persistence before responding
    await processHopkidSales(salesData);

    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      duplicate: false,
    });
  } catch (err: any) {
    console.error('❌ [HopKid Webhook] Fatal processing error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to process webhook.',
      error: err.message,
    });
  }
}

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

