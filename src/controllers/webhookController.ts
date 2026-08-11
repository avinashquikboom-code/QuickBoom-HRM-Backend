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
 * Robust async background processor for HopKid sales webhook.
 */
export async function processHopkidSales(rawSalesData: any): Promise<void> {
  console.log(`\n======================================================`);
  console.log(`📥 [HopKid Webhook Received] Timestamp: ${new Date().toISOString()}`);
  console.log(`Payload snippet:`, typeof rawSalesData === 'string' ? rawSalesData.slice(0, 300) : JSON.stringify(rawSalesData).slice(0, 300));
  console.log(`======================================================\n`);

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [WEBHOOK DEBUG] Full payload inspection                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('[DEBUG] Full raw payload:');
  console.log(typeof rawSalesData === 'string' ? rawSalesData : JSON.stringify(rawSalesData, null, 2));

  // 1. Store raw payload log first
  await storeWebhookData(rawSalesData);

  let effectiveData = rawSalesData;
  let meta = extractWebhookMeta(effectiveData);

  const invoice = meta.invoice || {};
  console.log('\n[DEBUG] Invoice object:');
  console.log({
    invoiceNo: invoice.invoiceNo || meta.billId,
    invoiceDate: invoice.invoiceDate,
    netAmount: invoice.netAmount,
    totalAmount: invoice.totalAmount,
    salesType: invoice.salesType,
    branchName: invoice.branchName,
    keys: Object.keys(invoice)
  });

  const lineItems = meta.lineItems || [];
  console.log(`\n[DEBUG] Found ${lineItems.length} line items`);
  lineItems.forEach((item: any, index: number) => {
    console.log(`\n[DEBUG] LineItem ${index}:`);
    console.log({
      productID: item.productID,
      productName: item.productName,
      productNetAmount: item.productNetAmount,
      netAmount: item.netAmount,
      amount: item.amount,
      employeeID: item.employeeID,
      employeeCode: item.employeeCode,
      employeeName: item.employeeName,
      employeePhoneNo: item.employeePhoneNo,
      commission: item.commission,
      commissionAmount: item.commissionAmount,
      keys: Object.keys(item)
    });
  });

  // 2. Check if payload is sparse/event-only (amount is 0 or lineItems empty or employee missing)
  if ((meta.amount === 0 || meta.lineItems.length === 0 || !meta.employeeIdentifier) && (meta.billId || meta.eventId)) {
    const searchId = meta.billId || meta.eventId;
    console.log(`ℹ️ [HopKid Webhook] Sparse payload detected for ID "${searchId}". Auto-fetching full invoice details from HopKid API...`);
    const fetchedInvoice = await fetchHopkidInvoiceDetails(searchId as string);

    if (fetchedInvoice) {
      effectiveData = {
        ...(typeof rawSalesData === 'object' ? rawSalesData : {}),
        fetchedData: fetchedInvoice,
        data: fetchedInvoice.data || fetchedInvoice,
      };
      meta = extractWebhookMeta(effectiveData);
      console.log(`✅ [HopKid Webhook] Auto-fetched invoice details! Extracted Amount: ₹${meta.amount}, Bill ID: ${meta.billId}, Employee: ${meta.employeeIdentifier}`);
    } else {
      console.warn(`⚠️ [HopKid Webhook] Could not fetch invoice details from HopKid API for ID "${searchId}". Proceeding with existing payload.`);
    }
  }

  const primaryBillId = meta.billId;
  const primaryAmount = meta.amount;
  const itemsToProcess = meta.lineItems.length > 0 ? meta.lineItems : [effectiveData];

  // 3. Create WebhookLog entry for tracking
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

  // 4. Duplicate Check
  if (primaryBillId) {
    const existingTx = await prisma.commissionTransaction.findFirst({
      where: { billId: String(primaryBillId) },
    });
    if (existingTx) {
      console.log(`ℹ️ [HopKid Webhook] Duplicate Webhook skipped: Bill ID "${primaryBillId}" already processed in CommissionTransaction.`);
      if (logEntry) {
        await prisma.webhookLog.update({
          where: { id: logEntry.id },
          data: {
            status: 'SUCCESS',
            errorMessage: 'Skipped duplicate invoice processing',
            processedAt: new Date(),
          },
        }).catch(() => {});
      }
      return;
    }
  }

  let processedCount = 0;
  let lastError: string | null = null;

  // 5. Process line items / sales record with retries
  for (const item of itemsToProcess) {
    let success = false;
    let attempt = 0;
    const maxAttempts = 3;

    while (!success && attempt < maxAttempts) {
      attempt++;
      try {
        const employeeIdentifier =
          item.employeeCode ||
          item.code ||
          item.empCode ||
          item.hopkidCode ||
          item.employeePhoneNo ||
          item.employeeContactNo ||
          item.mobileNo ||
          item.mobileNumber ||
          item.phone ||
          item.phoneNumber ||
          item.employeeName ||
          item.name ||
          meta.employeeIdentifier ||
          item.employeeId ||
          item.employeeID ||
          item.SalesMan ||
          item.userId;

        const dateStr = meta.invoice?.invoiceDate || meta.invoice?.date || item.invoiceDate || item.date || effectiveData.createdAt || effectiveData.transactionDate;
        const itemBillId = meta.invoice?.invoiceNo || item.invoiceNo || item.billId || item.billNo || item.invoiceNumber || primaryBillId;
        const rawItemAmount =
          (meta.invoice?.netAmount && safeParseAmount(meta.invoice.netAmount) > 0 ? meta.invoice.netAmount : null) ??
          (meta.invoice?.totalAmount && safeParseAmount(meta.invoice.totalAmount) > 0 ? meta.invoice.totalAmount : null) ??
          (item.productNetAmount && safeParseAmount(item.productNetAmount) > 0 ? item.productNetAmount : null) ??
          (item.netAmount && safeParseAmount(item.netAmount) > 0 ? item.netAmount : null) ??
          primaryAmount ??
          item.amount ??
          item.saleAmount;

        if (!employeeIdentifier) {
          lastError = 'Missing employee identifier in webhook payload';
          console.error('[HopKid Webhook]', lastError, item);
          break;
        }

        const amount = safeParseAmount(rawItemAmount);
        if (amount <= 0) {
          lastError = `Invalid sale amount: ${rawItemAmount}`;
          console.error('[HopKid Webhook]', lastError);
          break;
        }

        let resolvedId = await resolveEmployeeId(employeeIdentifier);
        if (resolvedId === null && item.employeePhoneNo) {
          resolvedId = await resolveEmployeeId(item.employeePhoneNo);
        }
        if (resolvedId === null && item.employeeName) {
          resolvedId = await resolveEmployeeId(item.employeeName);
        }

        let employee = null;
        if (resolvedId !== null) {
          employee = await prisma.employee.findUnique({
            where: { id: resolvedId },
            include: {
              commissionPolicies: {
                where: { isActive: true },
                orderBy: { priority: 'asc' },
              },
            },
          });
        }

        // Auto-create HopKid Employee if not found
        if (!employee) {
          console.log('[HopKid Webhook] Auto-creating Employee for identifier:', employeeIdentifier);
          const rawName = item.employeeName || item.name || meta.employeeName || meta.customerName || 'HopKid Employee';
          const nameParts = String(rawName).trim().split(' ');
          const firstName = nameParts[0] || 'HopKid';
          const lastName = nameParts.slice(1).join(' ') || 'Employee';
          const mobileNumber = item.employeePhoneNo || item.employeeContactNo || item.mobileNo || item.mobileNumber || item.phone || item.phoneNumber || null;
          const empCode = item.employeeCode || item.code || item.empCode || item.hopkidCode || `HK_${String(employeeIdentifier).replace(/[^a-zA-Z0-9]/g, '')}`;
          const guid = String(employeeIdentifier).includes('-') ? String(employeeIdentifier) : null;

          try {
            employee = await prisma.employee.create({
              data: {
                employeeID: guid,
                employeeCode: String(empCode),
                firstName,
                lastName,
                mobileNumber: mobileNumber ? String(mobileNumber) : null,
                status: 'active',
                source: 'HOPKID',
                commissionPercentage: 1.00,
                storeId: meta.storeId,
              },
              include: {
                commissionPolicies: {
                  where: { isActive: true },
                  orderBy: { priority: 'asc' },
                },
              },
            });
            console.log(`✅ [HopKid Webhook] Auto-created Employee (ID: ${employee.id}, Code: ${employee.employeeCode})`);
          } catch (createErr: any) {
            console.error('[HopKid Webhook] Failed to auto-create employee:', createErr);
            lastError = createErr?.message || String(createErr);
            break;
          }
        }

        // Resolve Commission Policy
        let policy = employee.commissionPolicies[0];
        const targetStoreId = meta.storeId || employee.storeId;

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

        let commissionAmount = 0;
        let commissionPercent = 0;
        let commissionType = 'PERCENTAGE';

        if (policy) {
          commissionType = policy.commissionType;
          if (policy.commissionType === 'PERCENTAGE') {
            commissionAmount = (amount * policy.commissionValue) / 100;
            commissionPercent = policy.commissionValue;
          } else if (policy.commissionType === 'FIXED') {
            commissionAmount = policy.commissionValue;
          }
        } else if (employee.commissionPercentage !== null && employee.commissionPercentage !== undefined) {
          commissionType = 'PERCENTAGE';
          commissionPercent = employee.commissionPercentage;
          commissionAmount = (amount * employee.commissionPercentage) / 100;
        }

        const validDate = safeParseDate(dateStr);

        console.log('\n[DEBUG Parsed Data]', {
          billId: itemBillId,
          saleAmount: amount,
          invoiceDate: validDate.toISOString(),
          employeeIdentifier,
        });

        // Wrap transaction creation in atomic DB transaction
        const createdTx = await prisma.$transaction(async (tx) => {
          return tx.commissionTransaction.create({
            data: {
              employeeId: employee.id,
              storeId: targetStoreId,
              policyId: policy ? policy.id : null,
              saleAmount: amount,
              commissionType,
              commissionPercent: commissionPercent || null,
              commissionAmount: Math.round(commissionAmount * 100) / 100,
              billId: itemBillId ? String(itemBillId) : null,
              invoiceNumber: itemBillId ? String(itemBillId) : null,
              status: 'APPROVED',
              notes: meta.branchName || meta.customerName ? `Customer: ${meta.customerName || 'N/A'}, Branch: ${meta.branchName || 'N/A'}` : 'HopKid Webhook Sales Data',
              createdAt: validDate,
              history: {
                create: {
                  employeeId: employee.id,
                  action: 'CREATED',
                  newStatus: 'APPROVED',
                  newAmount: Math.round(commissionAmount * 100) / 100,
                  reason: 'HopKid Webhook Sales Data',
                  performedAt: new Date(),
                },
              },
            },
          });
        });

        console.log('\n[DEBUG Stored Database Values]', {
          id: createdTx.id,
          billId: createdTx.billId,
          saleAmount: createdTx.saleAmount,
          commissionAmount: createdTx.commissionAmount,
          createdAt: createdTx.createdAt.toISOString(),
          status: createdTx.status,
        });

        console.log(`✅ [HopKid Webhook] Success! Created Commission Transaction ID: ${createdTx.id} (Employee: ${employee.firstName} ${employee.lastName}, Sale: ₹${amount}, Commission: ₹${createdTx.commissionAmount})`);
        processedCount++;
        success = true;
      } catch (itemErr: any) {
        console.error(`⚠️ [HopKid Webhook] Attempt ${attempt}/${maxAttempts} failed:`, itemErr.message || itemErr);
        lastError = itemErr?.message || String(itemErr);
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, attempt * 500));
        }
      }
    }
  }

  // 6. Update WebhookLog status
  if (logEntry) {
    if (processedCount > 0) {
      await prisma.webhookLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'SUCCESS',
          errorMessage: null,
          processedAt: new Date(),
        },
      }).catch(() => {});
    } else {
      await prisma.webhookLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'FAILED',
          errorMessage: lastError || 'Failed to process webhook line items',
          processedAt: new Date(),
        },
      }).catch(() => {});
    }
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

