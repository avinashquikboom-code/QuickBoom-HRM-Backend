import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { resolveEmployeeId } from '../utils/commissionHelper';

/**
 * Separate async background processor for HopKid sales webhook.
 * Handles validation, employee lookup, policy resolution, and commission transaction creation.
 */
export async function processHopkidSales(salesData: any): Promise<void> {
  try {
    console.log('[HopKid Webhook] Processing:', salesData);

    const employeeIdentifier =
      salesData.employeeId ||
      salesData.employeeID ||
      salesData.employeeCode ||
      salesData.SalesMan ||
      salesData.userId;

    const rawAmount = salesData.amount ?? salesData.saleAmount ?? salesData.totalAmount;
    const dateStr = salesData.date || salesData.createdAt || salesData.transactionDate;

    // ── STEP 8A: Data validation ─────────────────────────────────────────────
    if (!employeeIdentifier) {
      console.error('[HopKid] Missing employeeId in payload:', salesData);
      return;
    }

    const amount = parseFloat(rawAmount);
    if (isNaN(amount) || amount <= 0) {
      console.error('[HopKid] Invalid amount:', rawAmount);
      return;
    }

    if (!dateStr) {
      console.error('[HopKid] Missing date in payload:', salesData);
      return;
    }

    // ── STEP 8B: Employee existence check ────────────────────────────────────
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
      console.error('[HopKid] Employee not found:', employeeIdentifier);
      return; // Skip invalid employee
    }

    // Resolve store and commission policy
    let policy = employee.commissionPolicies[0];
    const targetStoreId = salesData.storeId
      ? parseInt(salesData.storeId, 10)
      : employee.storeId;

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
    } else if (
      employee.commissionPercentage !== null &&
      employee.commissionPercentage !== undefined
    ) {
      commissionType = 'PERCENTAGE';
      commissionPercent = employee.commissionPercentage;
      commissionAmount = (amount * employee.commissionPercentage) / 100;
    }

    const saleDate = new Date(dateStr);
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
        billId: salesData.billId || salesData.billNo || null,
        invoiceNumber: salesData.invoiceNumber || salesData.invoiceNo || null,
        status: 'APPROVED',
        notes: salesData.notes || 'HopKid Webhook Sales Data',
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
  } catch (error: any) {
    console.error('[HopKid Webhook] Failed:', error?.message || error);
  }
}

/**
 * Non-blocking HopKid sales webhook handler.
 * Responds immediately with 200 OK to avoid blocking callers,
 * and delegates processing to `processHopkidSales` in background.
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
