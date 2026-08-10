import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { resolveEmployeeId, extractWebhookMeta } from '../utils/commissionHelper';

/**
 * Stores raw HopKid webhook payload into HopkidWebhookLog table
 */
export async function storeWebhookData(data: any): Promise<void> {
  try {
    const meta = extractWebhookMeta(data);
    const dateVal = meta.invoice.invoiceDate || data.invoiceDate || data.date || data.createdAt || data.transactionDate;

    const mobileNo = meta.firstItem.employeePhoneNo || meta.firstItem.employeeContactNo || data.mobileNo || data.mobileNumber || data.phone || data.phoneNumber || null;
    const employeeCode = meta.firstItem.employeeCode || data.employeeCode || data.code || data.empCode || data.hopkidCode || null;
    const billId = meta.billId;
    const amountVal = meta.amount;
    const name = meta.firstItem.employeeName || data.employeeName || data.name || data.customerName || null;
    const description = meta.invoice.branchName || data.description || data.notes || (data.paymentMode ? `Payment: ${data.paymentMode}` : null);
    const storeId = data.storeId ? parseInt(data.storeId, 10) : (meta.invoice.storeId ? parseInt(meta.invoice.storeId, 10) : null);

    await prisma.hopkidWebhookLog.create({
      data: {
        mobileNo: mobileNo ? String(mobileNo) : null,
        employeeCode: employeeCode ? String(employeeCode) : null,
        amount: amountVal,
        billId: billId ? String(billId) : null,
        date: dateVal ? new Date(dateVal) : new Date(),
        name: name ? String(name) : null,
        storeId,
        description: description ? String(description) : null,
        rawPayload: typeof data === 'string' ? data : JSON.stringify(data),
      },
    });
    console.log('[HopKid] Data stored in HopkidWebhookLog');
  } catch (error: any) {
    console.error('[HopKid] Store log error:', error.message);
  }
}

/**
 * Separate async background processor for HopKid sales webhook.
 */
export async function processHopkidSales(salesData: any): Promise<void> {
  // 1. Store raw log first
  await storeWebhookData(salesData);

  const meta = extractWebhookMeta(salesData);
  const invoice = meta.invoice || {};
  const primaryBillId = meta.billId;
  const primaryAmount = meta.amount;
  const itemsToProcess = meta.lineItems.length > 0 ? meta.lineItems : [salesData];

  let logEntry: any = null;
  try {
    logEntry = await prisma.webhookLog.create({
      data: {
        eventType: meta.eventType,
        status: 'PROCESSING',
        payload: typeof salesData === 'string' ? salesData : JSON.stringify(salesData),
        billId: primaryBillId,
        amount: primaryAmount,
      },
    });
  } catch (e) {
    console.error('[WebhookLog] Failed to create log entry:', e);
  }

  let processedCount = 0;
  let lastError: string | null = null;

  for (const item of itemsToProcess) {
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
        item.employeeId ||
        item.employeeID ||
        item.hopkidEmployeeId ||
        item.SalesMan ||
        item.userId;

      const dateStr = invoice.invoiceDate || item.invoiceDate || item.date || salesData.createdAt || salesData.transactionDate;
      const itemBillId = invoice.invoiceNo || item.invoiceNo || item.billId || item.billNo || item.invoiceNumber || primaryBillId;
      const rawItemAmount = item.productNetAmount ?? item.netAmount ?? item.amount ?? item.saleAmount ?? primaryAmount;

      if (!employeeIdentifier) {
        lastError = 'Missing employee identifier in payload/lineItem';
        console.error('[HopKid]', lastError, item);
        continue;
      }

      const amount = parseFloat(rawItemAmount);
      if (isNaN(amount) || amount <= 0) {
        lastError = `Invalid amount: ${rawItemAmount}`;
        console.error('[HopKid]', lastError);
        continue;
      }

      // Check if billId already processed for this employee
      if (itemBillId) {
        const existingTx = await prisma.commissionTransaction.findFirst({
          where: {
            billId: String(itemBillId),
          },
        });
        if (existingTx) {
          console.log(`[HopKid Webhook] Bill ID ${itemBillId} already processed. Skipping duplicate.`);
          processedCount++;
          continue;
        }
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

      if (!employee) {
        console.log('[HopKid Webhook] Auto-creating HopKid employee for identifier:', employeeIdentifier);
        const rawName = item.employeeName || item.name || salesData.name || salesData.employeeName || 'HopKid Employee';
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
              storeId: invoice.storeId ? parseInt(invoice.storeId, 10) : (salesData.storeId ? parseInt(salesData.storeId, 10) : null),
            },
            include: {
              commissionPolicies: {
                where: { isActive: true },
                orderBy: { priority: 'asc' },
              },
            },
          });
          console.log(`[HopKid Webhook] Auto-created new employee (ID: ${employee.id})`);
        } catch (createErr: any) {
          console.error('[HopKid Webhook] Failed to auto-create employee:', createErr);
          lastError = createErr?.message || String(createErr);
          continue;
        }
      }

      let policy = employee.commissionPolicies[0];
      const targetStoreId = invoice.storeId ? parseInt(invoice.storeId, 10) : (salesData.storeId ? parseInt(salesData.storeId, 10) : employee.storeId);

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

      const saleDate = dateStr ? new Date(dateStr) : new Date();
      const validDate = isNaN(saleDate.getTime()) ? new Date() : saleDate;

      const transaction = await prisma.commissionTransaction.create({
        data: {
          employeeId: employee.id,
          storeId: targetStoreId,
          policyId: policy ? policy.id : null,
          saleAmount: amount,
          commissionType,
          commissionPercent: commissionPercent || null,
          commissionAmount,
          billId: itemBillId ? String(itemBillId) : null,
          invoiceNumber: itemBillId ? String(itemBillId) : null,
          status: 'APPROVED',
          notes: invoice.branchName || salesData.notes || salesData.description || 'HopKid Webhook Sales Data',
          createdAt: validDate,
          history: {
            create: {
              employeeId: employee.id,
              action: 'CREATED',
              newStatus: 'APPROVED',
              newAmount: commissionAmount,
              reason: 'HopKid Webhook Sales Data',
              performedAt: new Date(),
            },
          },
        },
      });

      console.log('[HopKid Webhook] Success — created commission transaction ID:', transaction.id);
      processedCount++;
    } catch (itemErr: any) {
      console.error('[HopKid Webhook] Item processing error:', itemErr);
      lastError = itemErr?.message || String(itemErr);
    }
  }

  if (logEntry) {
    if (processedCount > 0) {
      await prisma.webhookLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'SUCCESS',
          processedAt: new Date(),
        },
      }).catch(() => {});
    } else {
      await prisma.webhookLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'FAILED',
          errorMessage: lastError || 'Failed to process line items',
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

  // ✅ Respond immediately (non-blocking)
  res.json({
    success: true,
    message: 'HopKid webhook received successfully.',
  });

  // ✅ Process in background (no await)
  processHopkidSales(salesData).catch((err) => {
    console.error('[HopKid Webhook] Unhandled background error:', err);
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

