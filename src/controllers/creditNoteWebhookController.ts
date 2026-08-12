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
    const lineItems =
      data.CreditNoteProducts ||
      creditNote.CreditNoteProducts ||
      payload.CreditNoteProducts ||
      data.lineItems ||
      creditNote.lineItems ||
      payload.lineItems ||
      data.products ||
      creditNote.products ||
      payload.products ||
      [];

    const creditNoteNo = String(
      creditNote.CNNo ||
      creditNote.CNID ||
      creditNote.creditNoteNo ||
      creditNote.number ||
      payload.CNNo ||
      payload.CNID ||
      payload.creditNoteNo ||
      `CN-${Date.now()}`
    );

    let invoiceNo = String(
      creditNote.InvoiceNo ||
      creditNote.invoiceNo ||
      creditNote.invoiceNumber ||
      creditNote.SalesID ||
      creditNote.billId ||
      payload.InvoiceNo ||
      payload.SalesID ||
      payload.invoiceNo ||
      ''
    );

    const salesId = creditNote.SalesID || payload.SalesID || null;

    // Resolve original sale record from DB if invoiceNo / SalesID is present
    let originalSaleRecord: any = null;
    if (invoiceNo || salesId) {
      originalSaleRecord = await prisma.sales.findFirst({
        where: {
          OR: [
            invoiceNo ? { billId: invoiceNo } : {},
            salesId ? { id: String(salesId) } : {},
            invoiceNo ? { billId: { contains: invoiceNo } } : {}
          ].filter(o => Object.keys(o).length > 0)
        }
      });
      if (originalSaleRecord && !invoiceNo) {
        invoiceNo = originalSaleRecord.billId;
      }
    }

    let totalCreditAmount = Number(
      creditNote.CNAmount ??
      creditNote.creditAmount ??
      creditNote.RefundAmount ??
      creditNote.BillAmount ??
      creditNote.totalAmount ??
      creditNote.amount ??
      payload.CNAmount ??
      payload.RefundAmount ??
      payload.creditAmount ??
      0
    );

    if (totalCreditAmount <= 0 && lineItems.length > 0) {
      for (const item of lineItems) {
        const itemAmt = Number(
          item.CNAmount ??
          item.creditAmount ??
          item.Amount ??
          item.amount ??
          item.productNetAmount ??
          (Number(item.Price || item.price || 0) * Number(item.Quantity || item.quantity || 1))
        ) || 0;
        totalCreditAmount += itemAmt;
      }
    }

    if (!creditNoteNo) {
      console.error('[Process] ❌ Invalid credit note payload structure');
      return;
    }

    console.log('[Process] ✅ Valid credit note:', {
      creditNoteNo,
      invoiceNo,
      salesId,
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
        creditDate: new Date(creditNote.CNDate || creditNote.creditDate || creditNote.date || payload.CNDate || new Date()),
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
      const productName = lineItem.ProductName || lineItem.productName || lineItem.name || 'Returned Product';
      const productId = lineItem.ProductID || lineItem.productID || lineItem.productId || lineItem.id || null;
      const returnedQty = Number(lineItem.Quantity || lineItem.ReturnQuantity || lineItem.quantity || 1);
      const unitPrice = Number(lineItem.Price || lineItem.price || 0);

      const creditAmount = Number(
        lineItem.CNAmount ??
        lineItem.creditAmount ??
        lineItem.Amount ??
        lineItem.amount ??
        lineItem.productNetAmount ??
        (unitPrice > 0 ? unitPrice * returnedQty : (totalCreditAmount / itemsToProcess.length))
      ) || 0;

      console.log(`\n[LineItem ${i + 1}] Processing returned item: ${productName} (Qty: ${returnedQty}, Credit: ₹${creditAmount})`);

      try {
        // Resolve employee assigned to this returned product
        const employeeIdentifier =
          lineItem.Salesman ||
          lineItem.CreatedBy ||
          lineItem.employeeCode ||
          lineItem.code ||
          lineItem.empCode ||
          lineItem.salesmanCode ||
          lineItem.employeePhoneNo ||
          lineItem.employeeContactNo ||
          lineItem.mobileNo ||
          lineItem.employeeName ||
          creditNote.Salesman ||
          creditNote.CreatedBy ||
          creditNote.employeeCode ||
          creditNote.employeePhoneNo ||
          payload.Salesman ||
          payload.CreatedBy ||
          payload.employeeCode;

        let employee: any = null;
        if (employeeIdentifier) {
          employee = await prisma.employee.findFirst({
            where: {
              OR: [
                { employeeCode: { equals: String(employeeIdentifier), mode: 'insensitive' } },
                { mobileNumber: { contains: String(employeeIdentifier) } },
                { employeeID: { equals: String(employeeIdentifier), mode: 'insensitive' } },
                { firstName: { equals: String(employeeIdentifier), mode: 'insensitive' } },
                { lastName: { equals: String(employeeIdentifier), mode: 'insensitive' } }
              ]
            }
          });
        }

        // Fallback 1: search original commission transaction for this invoice / sale
        let originalTx: any = null;
        if (invoiceNo || salesId) {
          originalTx = await prisma.commissionTransaction.findFirst({
            where: {
              OR: [
                invoiceNo ? { billId: invoiceNo } : {},
                invoiceNo ? { invoiceNumber: invoiceNo } : {},
                invoiceNo ? { billId: { startsWith: `${invoiceNo}-` } } : {}
              ].filter(o => Object.keys(o).length > 0),
              ...(employee ? { employeeId: employee.id } : {})
            },
            include: { employee: true }
          });
          if (!employee && originalTx?.employee) {
            employee = originalTx.employee;
          }
        }

        // Fallback 2: search original sale record
        if (!employee && originalSaleRecord?.employeeId) {
          employee = await prisma.employee.findUnique({
            where: { id: originalSaleRecord.employeeId }
          });
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
