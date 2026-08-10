import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { resolveEmployeeId } from '../utils/commissionHelper';

/**
 * Stores raw HopKid webhook payload into HopkidWebhookLog table
 */
export async function storeWebhookData(data: any): Promise<void> {
  try {
    const rawAmount = data.amount ?? data.saleAmount ?? data.totalAmount;
    const amountVal = rawAmount !== undefined && rawAmount !== null ? parseFloat(rawAmount) : null;
    const dateVal = data.invoiceDate || data.date || data.createdAt || data.transactionDate;

    await prisma.hopkidWebhookLog.create({
      data: {
        mobileNo: data.mobileNo || data.mobileNumber || data.phone || data.phoneNumber || null,
        employeeCode: data.employeeCode || data.code || data.empCode || data.hopkidCode || null,
        amount: isNaN(amountVal as number) ? null : amountVal,
        billId: data.invoiceNo || data.billId || data.billNo || data.invoiceNumber || null,
        date: dateVal ? new Date(dateVal) : new Date(),
        name: data.employeeName || data.name || data.customerName || null,
        storeId: data.storeId ? parseInt(data.storeId, 10) : null,
        description: data.description || data.notes || (data.paymentMode ? `Payment: ${data.paymentMode}` : null),
        rawPayload: JSON.stringify(data),
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

  const rawAmount = salesData.amount ?? salesData.saleAmount ?? salesData.totalAmount;
  const amountVal = rawAmount !== undefined && rawAmount !== null ? parseFloat(rawAmount) : null;
  const billIdVal = salesData.invoiceNo || salesData.billId || salesData.billNo || salesData.invoiceNumber || null;

  let logEntry: any = null;
  try {
    logEntry = await prisma.webhookLog.create({
      data: {
        eventType: salesData.eventType || 'COMMISSION',
        status: 'PROCESSING',
        payload: JSON.stringify(salesData),
        billId: billIdVal,
        amount: isNaN(amountVal as number) ? null : amountVal,
      },
    });
  } catch (e) {
    console.error('[WebhookLog] Failed to create log entry:', e);
  }

  try {
    console.log('[HopKid Webhook] Processing:', salesData);

    const employeeIdentifier =
      salesData.employeeId ||
      salesData.employeeID ||
      salesData.hopkidEmployeeId ||
      salesData.employeeCode ||
      salesData.code ||
      salesData.empCode ||
      salesData.hopkidCode ||
      salesData.mobileNo ||
      salesData.mobileNumber ||
      salesData.phone ||
      salesData.phoneNumber ||
      salesData.SalesMan ||
      salesData.employeeName ||
      salesData.name ||
      salesData.userId;

    const dateStr = salesData.invoiceDate || salesData.date || salesData.createdAt || salesData.transactionDate;

    if (!employeeIdentifier) {
      const errMsg = 'Missing employeeId in payload';
      console.error('[HopKid]', errMsg, salesData);
      if (logEntry) {
        await prisma.webhookLog.update({
          where: { id: logEntry.id },
          data: { status: 'FAILED', errorMessage: errMsg, processedAt: new Date() },
        }).catch(() => {});
      }
      return;
    }

    const amount = parseFloat(rawAmount);
    if (isNaN(amount) || amount <= 0) {
      const errMsg = `Invalid amount: ${rawAmount}`;
      console.error('[HopKid]', errMsg);
      if (logEntry) {
        await prisma.webhookLog.update({
          where: { id: logEntry.id },
          data: { status: 'FAILED', errorMessage: errMsg, processedAt: new Date() },
        }).catch(() => {});
      }
      return;
    }

    const resolvedId = await resolveEmployeeId(employeeIdentifier);
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
      const rawName = salesData.name || salesData.employeeName || salesData.fullName || 'HopKid Employee';
      const nameParts = String(rawName).trim().split(' ');
      const firstName = nameParts[0] || 'HopKid';
      const lastName = nameParts.slice(1).join(' ') || 'Employee';
      const mobileNumber = salesData.mobileNo || salesData.mobileNumber || salesData.phone || salesData.phoneNumber || null;
      const empCode = salesData.employeeCode || salesData.code || salesData.empCode || salesData.hopkidCode || `HK_${String(employeeIdentifier).replace(/[^a-zA-Z0-9]/g, '')}`;
      const guid = String(employeeIdentifier).includes('-') ? String(employeeIdentifier) : null;

      try {
        employee = await prisma.employee.create({
          data: {
            employeeID: guid,
            employeeCode: empCode,
            firstName,
            lastName,
            mobileNumber,
            status: 'active',
            source: 'HOPKID',
            commissionPercentage: 1.00,
            storeId: salesData.storeId ? parseInt(salesData.storeId, 10) : null,
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
        if (logEntry) {
          await prisma.webhookLog.update({
            where: { id: logEntry.id },
            data: { status: 'FAILED', errorMessage: createErr?.message || String(createErr), processedAt: new Date() },
          }).catch(() => {});
        }
        return;
      }
    }

    let policy = employee.commissionPolicies[0];
    const targetStoreId = salesData.storeId ? parseInt(salesData.storeId, 10) : employee.storeId;

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
        billId: salesData.invoiceNo || salesData.billId || salesData.billNo || null,
        invoiceNumber: salesData.invoiceNo || salesData.invoiceNumber || salesData.billId || salesData.billNo || null,
        status: 'APPROVED',
        notes: salesData.notes || salesData.description || 'HopKid Webhook Sales Data',
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

    if (logEntry) {
      await prisma.webhookLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'SUCCESS',
          employeeId: employee.id,
          processedAt: new Date(),
        },
      }).catch(() => {});
    }
  } catch (error: any) {
    console.error('[HopKid Webhook] Failed:', error?.message || error);
    if (logEntry) {
      await prisma.webhookLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'FAILED',
          errorMessage: error?.message || String(error),
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
