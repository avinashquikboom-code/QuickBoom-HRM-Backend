import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import { createWebhookLog } from '../utils/commissionHelper';
import { getWebSocketInstance } from '../utils/websocketSingleton';

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
      await createWebhookLog({
        eventType: 'SALES_EXCHANGE_CREATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing salesExchange data'
      });
      return;
    }

    const exchangeNo = String(exchange.exchangeNo || exchange.number || `EX-${Date.now()}`);
    const originalInvoiceNo = String(exchange.originalInvoiceNo || exchange.originalInvoiceNumber || exchange.billId || '');
    const newInvoiceNo = String(exchange.newInvoiceNo || exchange.newInvoiceNumber || `INV-EX-${Date.now()}`);
    const totalAmount = Number(exchange.totalAmount || exchange.amount || 0);

    console.log('[Process] ✅ Valid exchange:', {
      exchangeNo: exchangeNo,
      originalInvoice: originalInvoiceNo,
      newInvoice: newInvoiceNo
    });

    const existingExchange = await prisma.salesExchange.findUnique({
      where: { exchangeNo: exchangeNo }
    });

    if (existingExchange) {
      console.log(`[Process] ℹ️ Sales exchange record already exists: ${existingExchange.id}`);
      await createWebhookLog({
        eventType: 'SALES_EXCHANGE_CREATED',
        status: 'SUCCESS',
        payload: payload,
        billId: exchangeNo,
        amount: totalAmount
      });
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
          console.warn('[LineItem] ⚠️ Employee not identified for exchange item:', lineItem.productName);
          continue;
        }

        if (!primaryNewEmployeeId) primaryNewEmployeeId = employee.id;

        const productNetAmount = Number(lineItem.productNetAmount || lineItem.netAmount || lineItem.amount || 0);
        const uniqueBillId = `${newInvoiceNo}-${lineItem.productID || i + 1}`;

        const newSale = await prisma.sales.create({
          data: {
            employeeId: employee.id,
            netAmount: productNetAmount,
            billId: uniqueBillId,
            saleDate: new Date(exchange.exchangeDate || exchange.date || new Date()),
            description: `Exchange New Item: ${lineItem.productName || 'Product'} (EX: ${exchangeNo})`,
            source: 'HOPKID',
            status: 'ACTIVE'
          }
        });

        totalNewSales += productNetAmount;
        newSaleIds.push(newSale.id.toString());
        console.log('[LineItem] ✅ Created new sale:', newSale.id);

      } catch (itemError: any) {
        console.error('[LineItem] ❌ Error:', itemError.message);
        continue;
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: CREATE SALES EXCHANGE RECORD
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 4: Create sales exchange record');

    const origAmountVal = Number(originalSale?.netAmount || 0);
    const newAmountVal = Number(totalNewSales || 0);
    const diffAmountVal = newAmountVal - origAmountVal;

    const exchangeRecord = await prisma.salesExchange.create({
      data: {
        exchangeNo: exchangeNo,
        originalInvoiceNo: originalInvoiceNo,
        newInvoiceNo: newInvoiceNo,
        exchangeDate: new Date(exchange.exchangeDate || exchange.date || new Date()),
        originalSaleId: originalSale?.id || null,
        newSaleId: newSaleIds.join(','),
        employeeId: primaryNewEmployeeId || 1,
        originalAmount: origAmountVal,
        newAmount: newAmountVal,
        amountDifference: diffAmountVal,
        originalCommission: 0,
        newCommission: 0,
        commissionDifference: 0,
        reason: exchange.reason || 'Sales Exchange',
        status: 'ACTIVE'
      }
    });

    console.log('[Process] ✅ Sales exchange created:', exchangeRecord.id);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 5: RECALCULATE COMMISSION
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 5: Recalculate commission');

    const exDate = new Date(exchange.exchangeDate || exchange.date || new Date());
    const month = `${exDate.getFullYear()}-${String(exDate.getMonth() + 1).padStart(2, '0')}`;

    if (originalSale?.employeeId) {
      const calculation = await CommissionService.calculateMonthlyCommission(
        originalSale.employeeId,
        month
      );
      await CommissionService.upsertMonthlyCommission(
        originalSale.employeeId,
        month,
        calculation
      );
    }

    if (primaryNewEmployeeId && primaryNewEmployeeId !== originalSale?.employeeId) {
      const calculation = await CommissionService.calculateMonthlyCommission(
        primaryNewEmployeeId,
        month
      );
      await CommissionService.upsertMonthlyCommission(
        primaryNewEmployeeId,
        month,
        calculation
      );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 6: CREATE WEBHOOK LOG
    // ═════════════════════════════════════════════════════════════════════════

    await createWebhookLog({
      eventType: 'SALES_EXCHANGE_CREATED',
      status: 'SUCCESS',
      payload: payload,
      billId: exchangeNo,
      amount: totalAmount || totalNewSales,
      employeeId: primaryNewEmployeeId
    });

    try {
      getWebSocketInstance().broadcastCommissionUpdate(primaryNewEmployeeId || 0, {
        eventType: 'SALES_EXCHANGE_CREATED',
        exchangeNo,
        amount: totalAmount || totalNewSales
      });
    } catch (wsErr) {
      console.error('❌ Failed to emit WebSocket commission update:', wsErr);
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [SALES EXCHANGE CREATED] ✅ COMPLETE                       ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Exchange] 💥 FATAL ERROR:', error.message);
    await createWebhookLog({
      eventType: 'SALES_EXCHANGE_CREATED',
      status: 'FAILED',
      payload: payload,
      errorMessage: error.message
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6️⃣ SALES EXCHANGE UPDATED - Status changed or void
// ═══════════════════════════════════════════════════════════════════════════

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
    console.error('[Exchange Update] ❌ Error:', err.message);
  });
});

export async function processSalesExchangeUpdated(payload: any): Promise<void> {
  try {
    console.log('[Update] Step 1: Validate payload');

    const data = payload.data || payload;
    const exchange = data.salesExchange || payload.salesExchange || data;
    const exchangeNo = String(exchange.exchangeNo || exchange.number || '');
    const totalAmount = Number(exchange.totalAmount || exchange.amount || 0);

    if (!exchange || !exchangeNo) {
      console.error('[Update] ❌ Invalid payload');
      await createWebhookLog({
        eventType: 'SALES_EXCHANGE_UPDATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing exchangeNo'
      });
      return;
    }

    const existingExchange = await prisma.salesExchange.findUnique({
      where: { exchangeNo: exchangeNo }
    });

    if (!existingExchange) {
      console.warn('[Update] ⚠️ Exchange not found, creating new...');
      await processSalesExchangeCreated(payload, 'SALES_EXCHANGE_UPDATED');
      return;
    }

    const newStatus = exchange.status?.toUpperCase() || 'COMPLETED';
    let ourStatus = 'COMPLETED';
    if (newStatus === 'CANCELLED' || newStatus === 'VOID' || newStatus === 'INACTIVE') {
      ourStatus = 'CANCELLED';
    }

    await prisma.salesExchange.update({
      where: { id: existingExchange.id },
      data: {
        status: ourStatus,
        updatedAt: new Date()
      }
    });

    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    if (existingExchange.originalSaleId) {
      const origSale = await prisma.sales.findUnique({ where: { id: existingExchange.originalSaleId } });
      if (origSale?.employeeId) {
        const calculation = await CommissionService.calculateMonthlyCommission(origSale.employeeId, month);
        await CommissionService.upsertMonthlyCommission(origSale.employeeId, month, calculation);
      }
    }

    await createWebhookLog({
      eventType: 'SALES_EXCHANGE_UPDATED',
      status: 'SUCCESS',
      payload: payload,
      billId: exchangeNo,
      amount: totalAmount,
      employeeId: null
    });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [SALES EXCHANGE UPDATED] ✅ COMPLETE                       ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Exchange Update] 💥 FATAL ERROR:', error.message);
    await createWebhookLog({
      eventType: 'SALES_EXCHANGE_UPDATED',
      status: 'FAILED',
      payload: payload,
      errorMessage: error.message
    });
  }
}

export default router;
