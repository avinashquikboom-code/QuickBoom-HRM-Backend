import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';

const router = Router();

console.log('[Sales Exchange Webhook Controller] ✅ Loaded');

// ═══════════════════════════════════════════════════════════════════════════
// 5️⃣ SALES EXCHANGE CREATED - Product replacement, same employee
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhook/salesExchange/created
 * HopKid sends: salesExchange.created event
 */
router.post('/created', (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [SALES EXCHANGE CREATED] Webhook received                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Sales exchange received'
  });

  processSalesExchangeCreated(rawPayload).catch(err => {
    console.error('[Exchange] ❌ Error:', err.message);
  });
});

export async function processSalesExchangeCreated(payload: any, eventType: string = 'SALES_EXCHANGE_CREATED'): Promise<void> {
  try {
    console.log('[Process] Step 1: Validate payload');

    const data = payload.data || payload;
    const exchange = data.salesExchange || payload.salesExchange || data;
    const lineItems = data.lineItems || exchange.lineItems || payload.lineItems || [];

    if (!exchange) {
      console.error('[Process] ❌ Invalid payload');
      return;
    }

    const exchangeNo = String(exchange.exchangeNo || exchange.number || `EX-${Date.now()}`);
    const originalInvoiceNo = String(exchange.originalInvoiceNo || exchange.originalInvoiceNumber || exchange.billId || '');
    const newInvoiceNo = String(exchange.newInvoiceNo || exchange.newInvoiceNumber || `INV-EX-${Date.now()}`);

    console.log('[Process] ✅ Valid exchange:', {
      exchangeNo: exchangeNo,
      originalInvoice: originalInvoiceNo,
      newInvoice: newInvoiceNo
    });

    // Idempotency check
    const existingExchange = await prisma.salesExchange.findUnique({
      where: { exchangeNo: exchangeNo }
    });

    if (existingExchange) {
      console.log(`[Process] ℹ️ Sales exchange record already exists: ${existingExchange.id}`);
      return;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: FIND ORIGINAL SALE
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 2: Find original sale');

    const originalSale = await prisma.sales.findFirst({
      where: { billId: { contains: originalInvoiceNo } }
    });

    if (originalSale) {
      console.log('[Process] ✅ Original sale found:', {
        id: originalSale.id,
        amount: originalSale.netAmount,
        employee: originalSale.employeeId
      });
    } else {
      console.warn('[Process] ⚠️ Original sale not found for invoice:', originalInvoiceNo);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: CREATE NEW SALES RECORDS
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 3: Create new sales records');

    let totalNewSales = 0;
    const newSaleIds: string[] = [];
    let primaryNewEmployeeId: number | null = originalSale?.employeeId || null;

    for (let i = 0; i < lineItems.length; i++) {
      const lineItem = lineItems[i];
      try {
        let employee: any = null;

        if (lineItem.employeeCode) {
          employee = await prisma.employee.findUnique({
            where: { employeeCode: String(lineItem.employeeCode) }
          }).catch(() => null);
        }

        if (!employee && originalSale) {
          employee = await prisma.employee.findUnique({
            where: { id: originalSale.employeeId }
          }).catch(() => null);
        }

        if (!employee) {
          console.error(`[LineItem] ❌ Employee not found for line item ${i + 1}`);
          continue;
        }

        if (!primaryNewEmployeeId) {
          primaryNewEmployeeId = employee.id;
        }

        const newAmount = Number(lineItem.productNetAmount || lineItem.netAmount || lineItem.amount || 0);

        const newSale = await prisma.sales.create({
          data: {
            employeeId: employee.id,
            netAmount: newAmount,
            billId: `${newInvoiceNo}-${lineItem.productID || lineItem.productName || i + 1}`,
            saleDate: new Date(exchange.exchangeDate || exchange.date || new Date()),
            description: `Exchange: ${originalInvoiceNo} → ${newInvoiceNo}`,
            source: 'EXCHANGE',
            status: 'ACTIVE'
          }
        });

        newSaleIds.push(newSale.id);
        totalNewSales += newAmount;

        console.log(`[LineItem] ✅ New sale created: ₹${newAmount}`);

      } catch (error: any) {
        console.error(`[LineItem] ❌ Error:`, error.message);
        continue;
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: CALCULATE COMMISSIONS
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 4: Calculate commissions');

    const effectiveEmpId = primaryNewEmployeeId || originalSale?.employeeId || 1;
    const employee = await prisma.employee.findUnique({
      where: { id: effectiveEmpId }
    });

    const rate = employee?.commissionPercentage || 0;
    const originalAmount = Number(originalSale?.netAmount || 0);
    const originalCommission = (originalAmount * rate) / 100;
    const newCommission = (totalNewSales * rate) / 100;
    const commissionDifference = newCommission - originalCommission;

    console.log('[Process] Commissions:', {
      original: originalCommission,
      new: newCommission,
      difference: commissionDifference
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 5: CREATE EXCHANGE RECORD
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 5: Create exchange record');

    await prisma.salesExchange.create({
      data: {
        exchangeNo: exchangeNo,
        originalInvoiceNo: originalInvoiceNo,
        originalSaleId: originalSale?.id || null,
        newInvoiceNo: newInvoiceNo,
        newSaleId: newSaleIds[0] || null,
        employeeId: effectiveEmpId,
        exchangeDate: new Date(exchange.exchangeDate || exchange.date || new Date()),
        reason: exchange.reason || 'Product exchange',
        originalAmount: originalAmount,
        newAmount: totalNewSales,
        amountDifference: totalNewSales - originalAmount,
        originalCommission: originalCommission,
        newCommission: newCommission,
        commissionDifference: commissionDifference,
        status: 'ACTIVE'
      }
    });

    console.log('[Process] ✅ Exchange record created');

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 6: UPDATE ORIGINAL SALE STATUS
    // ═════════════════════════════════════════════════════════════════════════

    if (originalSale) {
      console.log('[Process] Step 6: Mark original sale as EXCHANGED');

      await prisma.sales.update({
        where: { id: originalSale.id },
        data: {
          status: 'EXCHANGED',
          replacedBySaleId: newSaleIds[0] || null,
          returnDate: new Date(),
          returnReason: 'Exchanged for new product'
        }
      });

      console.log('[Process] ✅ Original sale marked as EXCHANGED');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 7: RECALCULATE COMMISSION
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 7: Recalculate commission');

    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const calculation = await CommissionService.calculateMonthlyCommission(
      effectiveEmpId,
      month
    );

    await CommissionService.upsertMonthlyCommission(
      effectiveEmpId,
      month,
      calculation
    );

    console.log('[Process] ✅ Commission updated');

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [SALES EXCHANGE CREATED] ✅ COMPLETE                       ║');
    console.log(`║ Commission change: ${commissionDifference > 0 ? '+' : ''}₹${commissionDifference}`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Process] 💥 FATAL ERROR:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6️⃣ SALES EXCHANGE UPDATED - Status changed
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhook/salesExchange/updated
 * HopKid sends: salesExchange.updated event
 */
router.post('/updated', (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [SALES EXCHANGE UPDATED] Webhook received                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Sales exchange update received'
  });

  processSalesExchangeUpdated(rawPayload).catch(err => {
    console.error('[Update] ❌ Error:', err.message);
  });
});

export async function processSalesExchangeUpdated(payload: any): Promise<void> {
  try {
    const data = payload.data || payload;
    const exchange = data.salesExchange || payload.salesExchange || data;
    if (!exchange) return;

    const exchangeNo = String(exchange.exchangeNo || exchange.number || '');
    if (!exchangeNo) return;

    console.log(`[Update] Exchange: ${exchangeNo}`);
    console.log(`[Update] Status: ${exchange.status}`);

    const updatedStatus = exchange.status?.toUpperCase() || 'ACTIVE';

    if (updatedStatus === 'CANCELLED' || updatedStatus === 'REVERSED') {
      console.log('[Update] Exchange cancelled - recalculating commission...');

      const exchangeRecord = await prisma.salesExchange.findUnique({
        where: { exchangeNo: exchangeNo }
      });

      if (exchangeRecord) {
        const month = `${exchangeRecord.exchangeDate.getFullYear()}-${String(exchangeRecord.exchangeDate.getMonth() + 1).padStart(2, '0')}`;

        const calculation = await CommissionService.calculateMonthlyCommission(
          exchangeRecord.employeeId,
          month
        );

        await CommissionService.upsertMonthlyCommission(
          exchangeRecord.employeeId,
          month,
          calculation
        );

        console.log('[Update] ✅ Commission recalculated');
      }
    }

    await prisma.salesExchange.update({
      where: { exchangeNo: exchangeNo },
      data: {
        status: updatedStatus,
        cancelledDate: updatedStatus === 'CANCELLED' || updatedStatus === 'REVERSED' ? new Date() : null,
        updatedAt: new Date()
      }
    });

    console.log(`[Update] ✅ Status updated to ${updatedStatus}`);

  } catch (error: any) {
    console.error('[Update] Error:', error.message);
  }
}

export default router;
