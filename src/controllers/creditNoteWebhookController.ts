import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import { createWebhookLog } from '../utils/commissionHelper';
import { getWebSocketInstance } from '../utils/websocketSingleton';
import { checkWebhookIdempotency } from '../utils/webhookIdempotency';

const router = Router();

console.log('[Credit Note Webhook Controller] ✅ Loaded');

// ═══════════════════════════════════════════════════════════════════════════
// 3️⃣ CREDIT NOTE CREATED - Partial return/adjustment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhook/creditNote/created
 * HopKid sends: creditNote.created event
 */
router.post('/created', (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [CREDIT NOTE CREATED] Webhook received                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Credit note received'
  });

  processCreditNoteCreated(rawPayload).catch(err => {
    console.error('[Credit Note] ❌ Error:', err.message);
  });
});

export async function processCreditNoteCreated(payload: any, eventType: string = 'CREDIT_NOTE_CREATED'): Promise<void> {
  try {
    const idempotency = await checkWebhookIdempotency(payload, eventType);
    if (idempotency.isDuplicate) {
      console.log(`[CreditNote Webhook] ℹ️ Duplicate ${eventType} event safely ignored (Key: ${idempotency.dedupKey})`);
      return;
    }

    console.log('[Process] Step 1: Validate payload');

    const data = payload.data || payload;
    const creditNote = data.creditNote || payload.creditNote || data;
    const lineItems = data.lineItems || creditNote.lineItems || payload.lineItems || data.CreditNoteProducts || creditNote.CreditNoteProducts || [];

    if (!creditNote) {
      console.error('[Process] ❌ Invalid payload');
      await createWebhookLog({
        eventType: 'CREDIT_NOTE_CREATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing creditNote data'
      });
      return;
    }

    const creditNoteNo = String(creditNote.creditNoteNo || creditNote.CNNo || creditNote.number || `CN-${Date.now()}`);
    const invoiceNo = String(creditNote.invoiceNo || creditNote.invoiceNumber || creditNote.billId || '');
    const totalAmount = Number(creditNote.totalAmount || creditNote.creditAmount || creditNote.amount || 0);

    if (lineItems.length === 0) {
      console.warn('[Process] ⚠️ No line items in credit note:', creditNoteNo);
    }

    console.log('[Process] ✅ Valid credit note:', {
      creditNoteNo: creditNoteNo,
      invoiceNo: invoiceNo,
      totalCredit: totalAmount,
      lineItemCount: lineItems.length
    });

    let creditNoteRecord = await prisma.creditNote.findUnique({
      where: { creditNoteNo: creditNoteNo }
    });

    if (!creditNoteRecord) {
      creditNoteRecord = await prisma.creditNote.create({
        data: {
          creditNoteNo: creditNoteNo,
          invoiceNo: invoiceNo,
          creditDate: new Date(creditNote.creditDate || creditNote.date || new Date()),
          creditAmount: totalAmount,
          creditReason: creditNote.reason || creditNote.creditReason || 'Not specified',
          status: 'ACTIVE'
        }
      });
      console.log('[Process] ✅ Credit note created:', creditNoteRecord.id);
    } else {
      console.log('[Process] ℹ️ Credit note already exists:', creditNoteRecord.id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: PROCESS LINE ITEMS
    // ═════════════════════════════════════════════════════════════════════════

    const employeeCommissionMap = new Map();
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

        if (!employee) {
          console.warn('[LineItem] ⚠️ Employee not identified for line item:', lineItem.productName);
          continue;
        }

        if (!firstEmpId) firstEmpId = employee.id;

        const empName = `${employee.firstName} ${employee.lastName}`;
        const returnedAmount = Number(lineItem.creditAmount || lineItem.amount || lineItem.productNetAmount || 0);

        const existingItem = await prisma.creditNoteLine.findFirst({
          where: {
            creditNoteId: creditNoteRecord.id,
            productId: String(lineItem.productID || lineItem.productId || lineItem.name || 'ITEM')
          }
        });

        if (!existingItem) {
          await prisma.creditNoteLine.create({
            data: {
              creditNoteId: creditNoteRecord.id,
              productId: String(lineItem.productID || lineItem.productId || lineItem.name || 'ITEM'),
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

        const empData = employeeCommissionMap.get(employee.id);
        empData.totalReturnAmount += returnedAmount;

      } catch (itemError: any) {
        console.error('[LineItem] ❌ Error:', itemError.message);
        continue;
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: RECALCULATE COMMISSION FOR AFFECTED EMPLOYEES
    // ═════════════════════════════════════════════════════════════════════════

    const cnDate = new Date(creditNote.creditDate || creditNote.date || new Date());
    const month = `${cnDate.getFullYear()}-${String(cnDate.getMonth() + 1).padStart(2, '0')}`;

    for (const [empId, empData] of employeeCommissionMap.entries()) {
      const empName = `${empData.employee.firstName} ${empData.employee.lastName}`;
      console.log(`[Commission] Recalculating for ${empName} due to Credit Note (₹${empData.totalReturnAmount} return)...`);

      const calculation = await CommissionService.calculateMonthlyCommission(
        empId,
        month
      );

      await CommissionService.upsertMonthlyCommission(
        empId,
        month,
        calculation
      );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: CREATE WEBHOOK LOG
    // ═════════════════════════════════════════════════════════════════════════

    await createWebhookLog({
      eventType: 'CREDIT_NOTE_CREATED',
      status: 'SUCCESS',
      payload: payload,
      billId: creditNoteNo,
      amount: totalAmount,
      employeeId: firstEmpId
    });

    try {
      getWebSocketInstance().broadcastCommissionUpdate(firstEmpId || 0, {
        eventType: 'CREDIT_NOTE_CREATED',
        creditNoteNo,
        amount: totalAmount
      });
    } catch (wsErr) {
      console.error('❌ Failed to emit WebSocket commission update:', wsErr);
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [CREDIT NOTE CREATED] ✅ COMPLETE                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Credit Note] 💥 FATAL ERROR:', error.message);
    await createWebhookLog({
      eventType: 'CREDIT_NOTE_CREATED',
      status: 'FAILED',
      payload: payload,
      errorMessage: error.message
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4️⃣ CREDIT NOTE UPDATED - Void, cancel, or amount change
// ═══════════════════════════════════════════════════════════════════════════

router.post('/updated', (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [CREDIT NOTE UPDATED] Webhook received                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Credit note update received'
  });

  processCreditNoteUpdated(rawPayload).catch(err => {
    console.error('[Credit Note Update] ❌ Error:', err.message);
  });
});

export async function processCreditNoteUpdated(payload: any): Promise<void> {
  try {
    const idempotency = await checkWebhookIdempotency(payload, 'CREDIT_NOTE_UPDATED');
    if (idempotency.isDuplicate) {
      console.log(`[CreditNote Webhook] ℹ️ Duplicate CREDIT_NOTE_UPDATED event safely ignored (Key: ${idempotency.dedupKey})`);
      return;
    }

    console.log('[Update] Step 1: Validate payload');

    const data = payload.data || payload;
    const creditNote = data.creditNote || payload.creditNote || data;
    const creditNoteNo = String(creditNote.creditNoteNo || creditNote.CNNo || creditNote.number || '');
    const totalAmount = Number(creditNote.totalAmount || creditNote.creditAmount || creditNote.amount || 0);

    if (!creditNote || !creditNoteNo) {
      console.error('[Update] ❌ Invalid payload');
      await createWebhookLog({
        eventType: 'CREDIT_NOTE_UPDATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing creditNoteNo'
      });
      return;
    }

    let creditNoteRecord = await prisma.creditNote.findUnique({
      where: { creditNoteNo: creditNoteNo },
      include: { lineItems: true }
    });

    if (!creditNoteRecord) {
      console.warn('[Update] ⚠️ Credit note not found, processing as created...');
      await processCreditNoteCreated(payload, 'CREDIT_NOTE_UPDATED');
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
      const calculation = await CommissionService.calculateMonthlyCommission(
        empId,
        month
      );
      await CommissionService.upsertMonthlyCommission(
        empId,
        month,
        calculation
      );
    }

    const firstEmpId = Array.from(empIds)[0] || null;
    await createWebhookLog({
      eventType: 'CREDIT_NOTE_UPDATED',
      status: 'SUCCESS',
      payload: payload,
      billId: creditNoteNo,
      amount: totalAmount,
      employeeId: firstEmpId
    });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [CREDIT NOTE UPDATED] ✅ COMPLETE                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Credit Note Update] 💥 FATAL ERROR:', error.message);
    await createWebhookLog({
      eventType: 'CREDIT_NOTE_UPDATED',
      status: 'FAILED',
      payload: payload,
      errorMessage: error.message
    });
  }
}

export default router;
