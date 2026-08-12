import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import { updateEmployeeWalletCommission, broadcastCommissionEvent, createWebhookLog, normalizeEventType } from '../utils/commissionHelper';

const router = Router();

/**
 * POST /api/webhook/creditNote/created
 * HopKid sends: creditNote.created event
 */
router.post('/created', (req: Request, res: Response) => {
  const rawPayload = req.body;
  const eventType = 'CREDIT_NOTE_CREATED';

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [WEBHOOK] Route: /creditNote/created                       ║');
  console.log(`║ [WEBHOOK] Event Type: ${eventType}                        ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Credit note received'
  });

  // Process in background
  processCreditNoteCreated(rawPayload, eventType).catch(err => {
    console.error('[Credit Note] ❌ Background error:', err.message);
  });
});

async function processCreditNoteCreated(payload: any, eventType: string = 'CREDIT_NOTE_CREATED'): Promise<void> {
  try {
    console.log('[Process] Step 1: Validate payload');

    const data = payload.data || payload;
    const creditNote = data.creditNote || data;
    const lineItems = data.lineItems || creditNote.lineItems || [];

    const creditNoteNo = String(creditNote.creditNoteNo || creditNote.number || `CN-${Date.now()}`);
    const invoiceNo = String(creditNote.invoiceNo || creditNote.invoiceNumber || creditNote.billId || '');
    const totalCreditAmount = Number(creditNote.creditAmount || creditNote.totalAmount || creditNote.amount || 0);

    if (!creditNoteNo) {
      console.error('[Process] ❌ Invalid credit note payload structure');
      return;
    }

    console.log('[Process] ✅ Valid credit note:', {
      creditNoteNo,
      invoiceNo,
      totalCreditAmount,
      lineItemCount: lineItems.length
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: CREATE CREDIT NOTE RECORD (IDEMPOTENT)
    // ═════════════════════════════════════════════════════════════════════════

    let creditNoteRecord = await prisma.creditNote.findUnique({
      where: { creditNoteNo }
    });

    if (creditNoteRecord) {
      console.log(`[Process] ⚠️ Credit note ${creditNoteNo} already processed (idempotent skip)`);
      return;
    }

    creditNoteRecord = await prisma.creditNote.create({
      data: {
        creditNoteNo,
        invoiceNo,
        creditDate: new Date(creditNote.creditDate || creditNote.date || new Date()),
        creditAmount: totalCreditAmount,
        creditReason: creditNote.reason || creditNote.creditReason || 'Product Return / Discount adjustment',
        status: 'ACTIVE'
      }
    });

    console.log('[Process] ✅ Credit note record created:', creditNoteRecord.id);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: PROCESS EACH RETURNED LINE ITEM (ITEM-WISE COMMISSION REVERSAL)
    // ═════════════════════════════════════════════════════════════════════════

    const itemsToProcess = lineItems.length > 0 ? lineItems : [creditNote];
    const employeeCommissionMap = new Map<number, { employee: any; totalCredit: number; totalAdjustment: number }>();
    let totalCommissionAdjustment = 0;

    for (let i = 0; i < itemsToProcess.length; i++) {
      const lineItem = itemsToProcess[i];
      const productName = lineItem.productName || lineItem.name || 'Returned Product';
      const productId = lineItem.productID || lineItem.productId || lineItem.id || null;
      const creditAmount = Number(lineItem.creditAmount || lineItem.amount || lineItem.productNetAmount || totalCreditAmount) || 0;

      console.log(`\n[LineItem ${i + 1}] Processing returned item: ${productName} (Credit: ₹${creditAmount})`);

      try {
        // Resolve employee assigned to this returned product
        const employeeIdentifier =
          lineItem.employeeCode ||
          lineItem.code ||
          lineItem.empCode ||
          lineItem.employeePhoneNo ||
          lineItem.employeeContactNo ||
          lineItem.mobileNo ||
          lineItem.employeeName ||
          creditNote.employeeCode ||
          creditNote.employeePhoneNo;

        let employee: any = null;
        if (employeeIdentifier) {
          employee = await prisma.employee.findFirst({
            where: {
              OR: [
                { employeeCode: String(employeeIdentifier) },
                { mobileNumber: String(employeeIdentifier) },
                { employeeID: String(employeeIdentifier) }
              ]
            }
          });
        }

        // Fallback: search original commission transaction for this invoice to identify original salesman
        let originalTx: any = null;
        if (invoiceNo) {
          originalTx = await prisma.commissionTransaction.findFirst({
            where: {
              OR: [
                { billId: invoiceNo },
                { invoiceNumber: invoiceNo },
                { billId: { startsWith: `${invoiceNo}-` } }
              ],
              ...(employee ? { employeeId: employee.id } : {})
            },
            include: { employee: true }
          });
          if (!employee && originalTx?.employee) {
            employee = originalTx.employee;
          }
        }

        if (!employee) {
          console.error(`[LineItem ${i + 1}] ❌ Employee not found for returned product ${productName}`);
          continue;
        }

        // Calculate commission adjustment (to reverse ONLY for this returned product)
        const rate = employee.commissionPercentage || (originalTx?.commissionPercent ?? 1.0);
        const commissionAdjustment = Math.round(((creditAmount * rate) / 100) * 100) / 100;

        console.log(`[LineItem ${i + 1}] Salesman: ${employee.firstName} ${employee.lastName} (Rate: ${rate}%, Reversed Commission: ₹${commissionAdjustment})`);

        // Record CreditNoteLine
        await prisma.creditNoteLine.create({
          data: {
            creditNoteId: creditNoteRecord.id,
            originalSaleId: originalTx ? String(originalTx.id) : null,
            employeeId: employee.id,
            productId: productId ? String(productId) : null,
            productDescription: productName,
            creditAmount: creditAmount,
            commissionAdjustment: commissionAdjustment,
            reason: lineItem.reason || creditNote.reason || 'Commission Reversed - Product Returned'
          }
        });

        // Audit Trail: Record in CommissionHistory & update transaction
        if (originalTx) {
          await prisma.commissionHistory.create({
            data: {
              transactionId: originalTx.id,
              employeeId: employee.id,
              action: 'REVERSED',
              previousStatus: originalTx.status,
              newStatus: 'ADJUSTED',
              previousAmount: originalTx.commissionAmount,
              newAmount: Math.max(0, originalTx.commissionAmount - commissionAdjustment),
              reason: `Commission Reversed - Product Returned: ${productName}`,
              performedAt: new Date()
            }
          });

          await prisma.commissionTransaction.update({
            where: { id: originalTx.id },
            data: {
              commissionAmount: Math.max(0, originalTx.commissionAmount - commissionAdjustment),
              notes: `${originalTx.notes || ''} | Reversed ₹${commissionAdjustment} via Credit Note ${creditNoteNo}`
            }
          });
        }

        // Update Employee Wallet (decrease wallet by reversed commission)
        await updateEmployeeWalletCommission(
          employee.id,
          commissionAdjustment,
          false,
          `Commission Reversed - Product Returned (${productName})`,
          'Commission Reversed'
        );

        // Group employee totals for monthly calculation
        if (!employeeCommissionMap.has(employee.id)) {
          employeeCommissionMap.set(employee.id, {
            employee,
            totalCredit: 0,
            totalAdjustment: 0
          });
        }
        const empData = employeeCommissionMap.get(employee.id)!;
        empData.totalCredit += creditAmount;
        empData.totalAdjustment += commissionAdjustment;
        totalCommissionAdjustment += commissionAdjustment;

      } catch (lineErr: any) {
        console.error(`[LineItem ${i + 1}] ❌ Error:`, lineErr.message);
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: RECALCULATE MONTHLY COMMISSION & BROADCAST REALTIME UPDATES
    // ═════════════════════════════════════════════════════════════════════════

    for (const [empId, empData] of employeeCommissionMap.entries()) {
      const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      console.log(`\n[Commission] Recalculating monthly totals for ${empData.employee.firstName} ${empData.employee.lastName}...`);

      const calculation = await CommissionService.calculateMonthlyCommission(empId, month);
      await CommissionService.upsertMonthlyCommission(empId, month, calculation);

      await broadcastCommissionEvent(empId, {
        success: true,
        eventType: 'CREDIT_NOTE_CREATED',
        creditNoteNo,
        invoiceNo,
        employeeId: empId,
        reversedCommission: empData.totalAdjustment,
        newMonthlyCommission: calculation.totalCommissionAmount,
        updatedAt: new Date().toISOString()
      });
    }

    // ✅ Persist WebhookLog with authoritative eventType
    const firstEmpId = Array.from(employeeCommissionMap.keys())[0] || null;
    await createWebhookLog({
      eventType,
      status: 'SUCCESS',
      payload,
      billId: creditNoteNo,
      amount: totalCreditAmount,
      employeeId: firstEmpId,
    });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [CREDIT NOTE] ✅ COMPLETE                                  ║');
    console.log(`║ Total commission reversed: -₹${totalCommissionAdjustment}`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Process] 💥 FATAL ERROR:', error.message);
    await createWebhookLog({
      eventType,
      status: 'FAILED',
      payload,
      errorMessage: error.message,
    });
  }
}

/**
 * POST /api/webhook/creditNote/updated
 * HopKid sends: creditNote.updated event
 */
router.post('/updated', (req: Request, res: Response) => {
  const rawPayload = req.body;
  const eventType = 'CREDIT_NOTE_UPDATED';

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [WEBHOOK] Route: /creditNote/updated                       ║');
  console.log(`║ [WEBHOOK] Event Type: ${eventType}                        ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Credit note update received'
  });

  processCreditNoteUpdated(rawPayload, eventType).catch(err => {
    console.error('[Credit Update] ❌ Error:', err.message);
  });
});

async function processCreditNoteUpdated(payload: any, eventType: string = 'CREDIT_NOTE_UPDATED'): Promise<void> {
  try {
    const data = payload.data || payload;
    const creditNote = data.creditNote || data;
    if (!creditNote || !creditNote.creditNoteNo) return;

    const creditNoteNo = String(creditNote.creditNoteNo);
    console.log('[Update] Processing Credit Note update:', creditNoteNo);

    const existingRecord = await prisma.creditNote.findUnique({
      where: { creditNoteNo },
      include: { lineItems: true }
    });

    if (!existingRecord) {
      console.warn('[Update] ⚠️ Credit note not found in DB, executing created processor...');
      await processCreditNoteCreated(payload);
      return;
    }

    const updatedStatus = String(creditNote.status || 'ACTIVE').toUpperCase();

    // If Credit Note is CANCELLED/REVERSED: Revert the credit note line reversals!
    if ((updatedStatus === 'CANCELLED' || updatedStatus === 'REVERSED') && existingRecord.status !== 'CANCELLED') {
      console.log('[Update] 🔄 Credit note cancelled - restoring reversed commissions to employee wallets...');

      for (const line of existingRecord.lineItems) {
        const adjustment = Number(line.commissionAdjustment);
        if (adjustment > 0) {
          // Credit wallet back to restore employee's commission
          await updateEmployeeWalletCommission(
            line.employeeId,
            adjustment,
            true,
            `Commission Restored - Credit Note ${creditNoteNo} Cancelled`,
            'Commission Restored'
          );

          // Recalculate monthly commission
          const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
          const calculation = await CommissionService.calculateMonthlyCommission(line.employeeId, month);
          await CommissionService.upsertMonthlyCommission(line.employeeId, month, calculation);

          await broadcastCommissionEvent(line.employeeId, {
            success: true,
            eventType: 'CREDIT_NOTE_CANCELLED',
            creditNoteNo,
            employeeId: line.employeeId,
            restoredCommission: adjustment,
            updatedAt: new Date().toISOString()
          });
        }
      }
    }

    await prisma.creditNote.update({
      where: { creditNoteNo },
      data: {
        status: updatedStatus,
        updatedAt: new Date()
      }
    });

    console.log(`[Update] ✅ Status updated to ${updatedStatus} for Credit Note ${creditNoteNo}`);

    await createWebhookLog({
      eventType,
      status: 'SUCCESS',
      payload,
      billId: creditNoteNo,
      amount: Number(creditNote.creditAmount || creditNote.totalAmount || 0),
    });

  } catch (error: any) {
    console.error('[Update] Error:', error.message);
    await createWebhookLog({
      eventType,
      status: 'FAILED',
      payload,
      errorMessage: error.message,
    });
  }
}

export default router;
