import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';

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
    console.log('[Process] Step 1: Validate payload');

    const data = payload.data || payload;
    const creditNote = data.creditNote || payload.creditNote || data;
    const lineItems = data.lineItems || creditNote.lineItems || payload.lineItems || data.CreditNoteProducts || creditNote.CreditNoteProducts || [];

    if (!creditNote) {
      console.error('[Process] ❌ Invalid payload');
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

    // Idempotency check
    let creditNoteRecord = await prisma.creditNote.findUnique({
      where: { creditNoteNo: creditNoteNo }
    });

    if (!creditNoteRecord) {
      // Create credit note record
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

    console.log('[Process] Step 2: Process line items');

    const employeeCommissionMap = new Map();

    for (const lineItem of lineItems) {
      try {
        let employee: any = null;

        if (lineItem.employeeCode) {
          employee = await prisma.employee.findUnique({
            where: { employeeCode: String(lineItem.employeeCode) }
          }).catch(() => null);
        }

        if (!employee && lineItem.employeePhoneNo) {
          const cleanPhone = String(lineItem.employeePhoneNo)
            .replace(/[^0-9]/g, '')
            .slice(-10);
          employee = await prisma.employee.findFirst({
            where: { mobileNumber: { contains: cleanPhone } }
          }).catch(() => null);
        }

        if (!employee && lineItem.employeeName) {
          employee = await prisma.employee.findFirst({
            where: {
              OR: [
                { firstName: { contains: lineItem.employeeName, mode: 'insensitive' } },
                { lastName: { contains: lineItem.employeeName, mode: 'insensitive' } }
              ]
            }
          }).catch(() => null);
        }

        if (!employee) {
          console.error(`[LineItem] ❌ Employee not found: ${lineItem.employeeName || lineItem.employeeCode}`);
          continue;
        }

        const empName = `${employee.firstName} ${employee.lastName}`;
        const creditAmount = Number(lineItem.creditAmount || lineItem.amount || 0);
        const rate = employee.commissionPercentage || 0;
        const commissionAdjustment = (creditAmount * rate) / 100;

        console.log(`[LineItem] ✅ ${empName}: Credit ₹${creditAmount}, Commission adjustment ₹${commissionAdjustment}`);

        // Create credit line
        await prisma.creditNoteLine.create({
          data: {
            creditNoteId: creditNoteRecord.id,
            employeeId: employee.id,
            productDescription: lineItem.productName || lineItem.productDescription || 'Credit adjustment',
            creditAmount: creditAmount,
            commissionAdjustment: commissionAdjustment,
            reason: lineItem.reason || creditNote.reason || 'Credit note'
          }
        });

        // Track for commission recalculation
        if (!employeeCommissionMap.has(employee.id)) {
          employeeCommissionMap.set(employee.id, {
            employee: employee,
            totalCredit: 0,
            totalAdjustment: 0
          });
        }

        const empData = employeeCommissionMap.get(employee.id);
        empData.totalCredit += creditAmount;
        empData.totalAdjustment += commissionAdjustment;

      } catch (error: any) {
        console.error(`[LineItem] ❌ Error:`, error.message);
        continue;
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: RECALCULATE COMMISSION
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 3: Recalculate commission');

    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    for (const [empId, empData] of employeeCommissionMap.entries()) {
      const empName = `${empData.employee.firstName} ${empData.employee.lastName}`;
      console.log(`[Commission] Recalculating for ${empName}...`);

      const calculation = await CommissionService.calculateMonthlyCommission(
        empId,
        month
      );

      await CommissionService.upsertMonthlyCommission(
        empId,
        month,
        calculation
      );

      console.log(`[Commission] ✅ Updated. New total: ₹${calculation.totalCommissionAmount}`);
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [CREDIT NOTE CREATED] ✅ COMPLETE                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Process] 💥 FATAL ERROR:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4️⃣ CREDIT NOTE UPDATED - Status changed
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhook/creditNote/updated
 * HopKid sends: creditNote.updated event
 */
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
    console.error('[Credit Update] ❌ Error:', err.message);
  });
});

export async function processCreditNoteUpdated(payload: any): Promise<void> {
  try {
    const data = payload.data || payload;
    const creditNote = data.creditNote || payload.creditNote || data;
    if (!creditNote) return;

    const creditNoteNo = String(creditNote.creditNoteNo || creditNote.CNNo || creditNote.number || '');
    if (!creditNoteNo) return;

    console.log(`[Update] Credit note: ${creditNoteNo}`);
    console.log(`[Update] New status: ${creditNote.status}`);

    const updatedStatus = creditNote.status?.toUpperCase() || 'ACTIVE';

    await prisma.creditNote.update({
      where: { creditNoteNo: creditNoteNo },
      data: {
        status: updatedStatus,
        updatedAt: new Date()
      }
    });

    console.log(`[Update] ✅ Status updated to ${updatedStatus}`);

  } catch (error: any) {
    console.error('[Update] Error:', error.message);
  }
}

export default router;
