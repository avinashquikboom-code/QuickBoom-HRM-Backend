import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import { createWebhookLog } from '../utils/commissionHelper';

const router = Router();

console.log('[Commission Webhook Controller] ✅ Loaded');

// ═══════════════════════════════════════════════════════════════════════════
// 1️⃣ INVOICE CREATED - New sale
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhook/commission
 * HopKid sends: invoice.created event
 */
router.post('/', (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [INVOICE CREATED] Webhook received                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Invoice received'
  });

  processInvoiceCreated(rawPayload).catch(err => {
    console.error('[Invoice Created] ❌ Error:', err.message);
  });
});

export async function processInvoiceCreated(payload: any): Promise<void> {
  try {
    console.log('[Process] Step 1: Validate payload');

    const data = payload.data || payload;
    const invoice = data.invoice || payload.invoice || data;
    const lineItems = data.lineItems || payload.lineItems || data.products || [];

    if (!invoice || (!invoice.invoiceNo && !invoice.billId)) {
      console.error('[Process] ❌ Invalid payload structure');
      await createWebhookLog({
        eventType: 'INVOICE_CREATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload structure: missing invoice number'
      });
      return;
    }

    const invoiceNo = String(invoice.invoiceNo || invoice.billId);
    const invoiceTotal = Number(invoice.netAmount || invoice.totalAmount || invoice.grandTotal || 0);

    if (lineItems.length === 0) {
      console.warn('[Process] ⚠️ No line items');
    }

    console.log('[Process] ✅ Valid invoice:', {
      invoiceNo: invoiceNo,
      totalAmount: invoiceTotal,
      lineItemCount: lineItems.length,
      date: invoice.invoiceDate || invoice.date
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: PROCESS EACH LINE ITEM (EACH PRODUCT/SALESMAN)
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 2: Process line items');

    const employeeCommissionMap = new Map();

    for (let i = 0; i < lineItems.length; i++) {
      const lineItem = lineItems[i];
      console.log(`\n[LineItem] Processing: ${lineItem.productName || lineItem.name || 'Product'}`);

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
          console.error(`[LineItem] ❌ Employee not found: ${lineItem.employeeName} (${lineItem.employeeCode})`);
          continue;
        }

        const empName = `${employee.firstName} ${employee.lastName}`;
        console.log(`[LineItem] ✅ Employee found: ${empName}`);

        const productNetAmount = Number(lineItem.productNetAmount || lineItem.netAmount || lineItem.amount || 0);
        const rate = employee.commissionPercentage || 0;
        const commission = (productNetAmount * rate) / 100;

        console.log(`[LineItem] Amount: ₹${productNetAmount}, Commission: ₹${commission}`);

        const uniqueBillId = lineItems.length > 1 
          ? `${invoiceNo}-${lineItem.productID || lineItem.productName || i + 1}`
          : invoiceNo;

        const existingSale = await prisma.sales.findFirst({
          where: { billId: uniqueBillId }
        });

        if (existingSale) {
          console.log(`[LineItem] ℹ️ Sale record already exists: ${existingSale.id}`);
        } else {
          const sale = await prisma.sales.create({
            data: {
              employeeId: employee.id,
              netAmount: productNetAmount,
              billId: uniqueBillId,
              saleDate: new Date(invoice.invoiceDate || invoice.date || new Date()),
              description: `${lineItem.productName || 'Sale'} - ${invoice.branchName || 'HopKid'}`,
              source: 'HOPKID',
              status: 'ACTIVE'
            }
          });

          console.log(`[LineItem] ✅ Sale record created: ${sale.id}`);
        }

        if (!employeeCommissionMap.has(employee.id)) {
          employeeCommissionMap.set(employee.id, {
            employee: employee,
            totalAmount: 0,
            totalCommission: 0,
            saleCount: 0
          });
        }

        const empData = employeeCommissionMap.get(employee.id);
        empData.totalAmount += productNetAmount;
        empData.totalCommission += commission;
        empData.saleCount += 1;

      } catch (lineError: any) {
        console.error(`[LineItem] ❌ Error:`, lineError.message);
        continue;
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: RECALCULATE MONTHLY COMMISSION
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 3: Recalculate commission');

    const invDate = new Date(invoice.invoiceDate || invoice.date || new Date());
    const saleMonth = `${invDate.getFullYear()}-${String(invDate.getMonth() + 1).padStart(2, '0')}`;

    for (const [empId, empData] of employeeCommissionMap.entries()) {
      const empName = `${empData.employee.firstName} ${empData.employee.lastName}`;
      console.log(`\n[Commission] Recalculating for ${empName}...`);
      console.log(`[Commission] Sales: ${empData.saleCount}, Amount: ₹${empData.totalAmount}, Commission: ₹${empData.totalCommission}`);

      const calculation = await CommissionService.calculateMonthlyCommission(
        empId,
        saleMonth
      );

      await CommissionService.upsertMonthlyCommission(
        empId,
        saleMonth,
        calculation
      );

      console.log(`[Commission] ✅ Updated. New total: ₹${calculation.totalCommissionAmount}`);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: CREATE WEBHOOK LOG Persistence
    // ═════════════════════════════════════════════════════════════════════════

    const firstEmpId = Array.from(employeeCommissionMap.keys())[0] || null;
    await createWebhookLog({
      eventType: 'INVOICE_CREATED',
      status: 'SUCCESS',
      payload: payload,
      billId: invoiceNo,
      amount: invoiceTotal,
      employeeId: firstEmpId
    });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [INVOICE CREATED] ✅ COMPLETE                              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Invoice Created] 💥 FATAL ERROR:', error.message);
    await createWebhookLog({
      eventType: 'INVOICE_CREATED',
      status: 'FAILED',
      payload: payload,
      errorMessage: error.message
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2️⃣ INVOICE UPDATED - Status changed, cancel, return
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhook/commission/updated
 * HopKid sends: invoice.updated event
 */
router.post('/updated', (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [INVOICE UPDATED] Webhook received                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Invoice update received'
  });

  processInvoiceUpdated(rawPayload).catch(err => {
    console.error('[Invoice Update] ❌ Error:', err.message);
  });
});

export async function processInvoiceUpdated(payload: any): Promise<void> {
  try {
    console.log('[Update] Step 1: Validate payload');

    const data = payload.data || payload;
    const invoice = data.invoice || payload.invoice || data;
    const invoiceNo = String(invoice.invoiceNo || invoice.billId || '');
    const invoiceTotal = Number(invoice.netAmount || invoice.totalAmount || invoice.grandTotal || 0);

    if (!invoice || !invoiceNo) {
      console.error('[Update] ❌ Invalid payload');
      await createWebhookLog({
        eventType: 'INVOICE_UPDATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing invoiceNo'
      });
      return;
    }

    console.log('[Update] Invoice:', {
      invoiceNo: invoiceNo,
      status: invoice.status
    });

    const sales = await prisma.sales.findMany({
      where: { billId: { contains: invoiceNo } }
    });

    if (sales.length === 0) {
      console.warn('[Update] ⚠️ No sales found for invoice:', invoiceNo);
    }

    const newStatus = invoice.status?.toUpperCase() || 'ACTIVE';
    let ourStatus = 'ACTIVE';

    switch (newStatus) {
      case 'CANCELLED':
      case 'CANCEL':
        ourStatus = 'CANCELLED';
        break;
      case 'RETURNED':
      case 'RETURN':
        ourStatus = 'RETURNED';
        break;
      case 'INACTIVE':
        ourStatus = 'INACTIVE';
        break;
      default:
        ourStatus = 'ACTIVE';
    }

    const employeeCommissionMap = new Map();

    for (const sale of sales) {
      const wasActive = sale.status === 'ACTIVE';
      const isNowInactive = ourStatus === 'CANCELLED' || ourStatus === 'RETURNED' || ourStatus === 'INACTIVE';

      await prisma.sales.update({
        where: { id: sale.id },
        data: {
          status: ourStatus,
          updatedAt: new Date()
        }
      });

      if (wasActive && isNowInactive) {
        if (!employeeCommissionMap.has(sale.employeeId)) {
          employeeCommissionMap.set(sale.employeeId, 0);
        }
        employeeCommissionMap.set(
          sale.employeeId, 
          employeeCommissionMap.get(sale.employeeId) + Number(sale.netAmount)
        );
      }
    }

    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    for (const [empId, reversalAmount] of employeeCommissionMap.entries()) {
      console.log(`[Commission] Recalculating for ${empId} (reversing ₹${reversalAmount})`);

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

    const firstEmpId = sales.length > 0 ? sales[0].employeeId : null;
    await createWebhookLog({
      eventType: 'INVOICE_UPDATED',
      status: 'SUCCESS',
      payload: payload,
      billId: invoiceNo,
      amount: invoiceTotal,
      employeeId: firstEmpId
    });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [INVOICE UPDATED] ✅ COMPLETE                              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Invoice Update] 💥 FATAL ERROR:', error.message);
    await createWebhookLog({
      eventType: 'INVOICE_UPDATED',
      status: 'FAILED',
      payload: payload,
      errorMessage: error.message
    });
  }
}

export default router;
