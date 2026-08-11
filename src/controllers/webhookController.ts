import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { extractWebhookMeta, resolveEmployeeId, safeParseAmount, safeParseDate, fetchHopkidInvoiceDetails } from '../utils/commissionHelper';

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

      console.log(`[Product ${i + 1}] Commission Calculation:`, {
        netAmount: productNetAmount,
        commissionRate,
        commission: productCommission,
      });

      if (commissionMap.has(salesman.id)) {
        const existing = commissionMap.get(salesman.id)!;
        existing.totalAmount += productNetAmount;
        existing.totalCommission += productCommission;
        existing.products.push({
          productID: productId,
          productName: productName,
          productNetAmount: productNetAmount,
          productCommission: productCommission,
          policyId: policy ? policy.id : null,
          storeId: targetStoreId,
        });

        console.log(`[Product ${i + 1}] 📊 Merged with existing commission for ${salesman.firstName} ${salesman.lastName}:`, {
          totalAmount: existing.totalAmount,
          totalCommission: existing.totalCommission,
          productCount: existing.products.length,
        });
      } else {
        commissionMap.set(salesman.id, {
          salesman,
          totalAmount: productNetAmount,
          totalCommission: productCommission,
          products: [
            {
              productID: productId,
              productName: productName,
              productNetAmount: productNetAmount,
              productCommission: productCommission,
              policyId: policy ? policy.id : null,
              storeId: targetStoreId,
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

  const primaryBillId = meta.billId || invoice.invoiceNo || `BILL-${Date.now()}`;
  const primaryAmount = meta.amount || invoice.netAmount || 0;
  const itemsToProcess = meta.lineItems.length > 0 ? meta.lineItems : [effectiveData];

  let logEntry: any = null;
  try {
    logEntry = await prisma.webhookLog.create({
      data: {
        eventType: meta.eventType,
        status: 'PROCESSING',
        payload: typeof effectiveData === 'string' ? effectiveData : JSON.stringify(effectiveData),
        billId: primaryBillId,
        amount: primaryAmount,
      },
    });
  } catch (e) {
    console.error('[WebhookLog] Failed to create log entry:', e);
  }

  const dateStr = meta.invoice?.invoiceDate || meta.invoice?.date || effectiveData.createdAt || effectiveData.transactionDate;
  const validDate = safeParseDate(dateStr);

  const commissionMap = await groupAndCalculateCommissionBySalesman(itemsToProcess, {
    invoiceNo: String(primaryBillId),
    invoiceDate: validDate,
    netAmount: primaryAmount,
    metaStoreId: meta.storeId,
    defaultIdentifier: meta.employeeIdentifier,
  });

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [WEBHOOK] Saving Sales & Commission Records                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  let processedSalesCount = 0;
  let lastError: string | null = null;

  for (const [salesmanId, commissionData] of commissionMap.entries()) {
    const salesman = commissionData.salesman;
    console.log(`\n[Save] Salesman: ${salesman.firstName} ${salesman.lastName} (${salesman.employeeCode})`);

    try {
      for (const product of commissionData.products) {
        const uniqueBillId = itemsToProcess.length > 1 ? `${primaryBillId}-${product.productID}` : String(primaryBillId);

        console.log(`[Save] Product: ${product.productName}`);
        console.log(`[Save]   billId: ${uniqueBillId}`);
        console.log(`[Save]   amount: ₹${product.productNetAmount}`);

        const existingTx = await prisma.commissionTransaction.findFirst({
          where: {
            employeeId: salesman.id,
            OR: [{ billId: uniqueBillId }, { invoiceNumber: uniqueBillId }],
          },
        });

        if (existingTx) {
          console.log(`[Save]   ⚠️ Already exists (idempotent skip)`);
          continue;
        }

        const createdTx = await prisma.commissionTransaction.create({
          data: {
            employeeId: salesman.id,
            storeId: product.storeId || meta.storeId,
            policyId: product.policyId ?? undefined,
            saleAmount: product.productNetAmount,
            commissionType: 'PERCENTAGE',
            commissionPercent: salesman.commissionPercentage || 1.0,
            commissionAmount: Math.round(product.productCommission * 100) / 100,
            billId: uniqueBillId,
            invoiceNumber: uniqueBillId,
            status: 'APPROVED',
            notes: `HopKid Invoice ${primaryBillId} - Product: ${product.productName}`,
            createdAt: validDate,
            history: {
              create: {
                employeeId: salesman.id,
                action: 'CREATED',
                newStatus: 'APPROVED',
                newAmount: Math.round(product.productCommission * 100) / 100,
                reason: `HopKid Invoice ${primaryBillId} - Product: ${product.productName}`,
                performedAt: new Date(),
              },
            },
          },
        });

        console.log(`[Save]   ✅ Sale & Commission created: ID ${createdTx.id}`);
        processedSalesCount++;
      }
    } catch (salesmanErr: any) {
      console.error(`[Save] ❌ Error processing salesman ${salesman.firstName}:`, salesmanErr.message);
      lastError = salesmanErr.message;
    }
  }

  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║ [WEBHOOK] ✅ COMPLETE                                      ║`);
  console.log(`║ Sales created: ${processedSalesCount}                                       ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);

  if (logEntry) {
    await prisma.webhookLog.update({
      where: { id: logEntry.id },
      data: {
        status: processedSalesCount > 0 ? 'SUCCESS' : (commissionMap.size === 0 ? 'SUCCESS' : 'FAILED'),
        errorMessage: lastError ?? undefined,
        processedAt: new Date(),
      },
    }).catch(() => {});
  }
}

/**
 * Non-blocking HopKid sales webhook handler.
 */
export function handleHopkidWebhook(req: Request, res: Response): void {
  const salesData = req.body;

  // ✅ Log immediately
  console.log(`📥 [HopKid Webhook Ingress] Incoming payload at ${new Date().toISOString()}`);

  // ✅ Respond immediately (non-blocking HTTP 200)
  res.json({
    success: true,
    message: 'HopKid webhook received successfully.',
  });

  // ✅ Process in background asynchronously
  processHopkidSales(salesData).catch((err) => {
    console.error('❌ [HopKid Webhook] Fatal background processing error:', err);
  });
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

