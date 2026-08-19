import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import { createWebhookLog, parseIsOld } from '../utils/commissionHelper';
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

async function resolveEmployeeForLineItem(lineItem: any, fallbackEmployeeId: number | null): Promise<any> {
  const rawCode = lineItem.employeeCode || lineItem.salesmanCode || lineItem.empCode || lineItem.staffCode || lineItem.SalesManCode || lineItem.SalesmanCode || lineItem.EmployeeCode || lineItem.salesman?.code;
  const rawId = lineItem.employeeId || lineItem.salesmanId || lineItem.empId || lineItem.employeeID || lineItem.SalesManID || lineItem.salesman?.id;
  const rawName = lineItem.employeeName || lineItem.salesmanName || lineItem.empName || lineItem.SalesManName || lineItem.SalesmanName || lineItem.salesman?.name || lineItem.name;
  const rawPhone = lineItem.employeePhoneNo || lineItem.phone || lineItem.mobileNo || lineItem.mobileNumber || lineItem.salesman?.phone;

  // 1. Try by code
  if (rawCode) {
    const codeStr = String(rawCode).trim();
    let emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: codeStr },
          { employeeCode: codeStr.toUpperCase() },
          { employeeID: codeStr },
        ]
      }
    }).catch(() => null);
    if (emp) return emp;
  }

  // 2. Try by ID
  if (rawId) {
    const numId = Number(rawId);
    if (!isNaN(numId) && numId > 0) {
      let emp = await prisma.employee.findUnique({
        where: { id: numId }
      }).catch(() => null);
      if (emp) return emp;
    }
    const strId = String(rawId).trim();
    let emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeID: strId },
          { employeeCode: strId }
        ]
      }
    }).catch(() => null);
    if (emp) return emp;
  }

  // 3. Try by Phone
  if (rawPhone) {
    const cleanPhone = String(rawPhone).replace(/\D/g, '').slice(-10);
    if (cleanPhone.length >= 10) {
      let emp = await prisma.employee.findFirst({
        where: {
          OR: [
            { mobileNumber: cleanPhone },
            { mobileNumber: `+91${cleanPhone}` },
            { mobileNumber: { contains: cleanPhone } }
          ]
        }
      }).catch(() => null);
      if (emp) return emp;
    }
  }

  // 4. Try by Name
  if (rawName && typeof rawName === 'string' && rawName.trim().length > 0) {
    const trimmedName = rawName.trim();
    const parts = trimmedName.split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    let emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { firstName: { contains: trimmedName, mode: 'insensitive' as const } },
          { lastName: { contains: trimmedName, mode: 'insensitive' as const } },
          ...(firstName && lastName ? [
            {
              AND: [
                { firstName: { contains: firstName, mode: 'insensitive' as const } },
                { lastName: { contains: lastName, mode: 'insensitive' as const } }
              ]
            }
          ] : [])
        ]
      }
    }).catch(() => null);
    if (emp) return emp;
  }

  // 5. If specific salesman identifier (code/name) was provided in line item but not in HRM DB yet,
  // create an Employee record dynamically for this salesman instead of assigning to someone else!
  if (rawCode || rawName) {
    try {
      const codeToUse = String(rawCode || `EMP-${Date.now()}`).trim().toUpperCase();
      const nameStr = String(rawName || codeToUse).trim();
      const parts = nameStr.split(/\s+/);
      const fName = parts[0] || 'Salesman';
      const lName = parts.slice(1).join(' ') || '';

      const createdEmp = await prisma.employee.create({
        data: {
          employeeCode: codeToUse,
          firstName: fName,
          lastName: lName,
          designation: 'Salesman',
          status: 'active',
          source: 'HOPKID_EXCHANGE'
        }
      });
      console.log(`[SalesExchange] ✅ Auto-registered salesman from exchange line item: ${createdEmp.employeeCode} (${fName} ${lName})`);
      return createdEmp;
    } catch (createErr: any) {
      console.warn('[SalesExchange] ⚠️ Could not auto-create employee for lineItem:', createErr.message);
    }
  }

  // 6. Only fallback to original sale employee if no item-specific employee info exists
  if (fallbackEmployeeId) {
    return prisma.employee.findUnique({ where: { id: fallbackEmployeeId } }).catch(() => null);
  }

  return null;
}

export async function processSalesExchangeCreated(payload: any, eventType: string = 'SALES_EXCHANGE_CREATED'): Promise<void> {
  try {
    console.log('[Process] Step 1: Validate payload');

    const data = payload.data || payload;
    const exchange = data.salesExchange || payload.salesExchange || data;
    const rawLineItems = 
      data.lineItems || 
      exchange.lineItems || 
      payload.lineItems || 
      data.SalesExchangeProductList || 
      exchange.SalesExchangeProductList || 
      payload.SalesExchangeProductList || 
      data.products || 
      exchange.products || 
      payload.products || 
      data.items || 
      payload.items || 
      [];
    const lineItems = Array.isArray(rawLineItems) ? rawLineItems : [];

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
      newInvoice: newInvoiceNo,
      lineItemsCount: lineItems.length
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
    // STEP 3: CREATE NEW SALES RECORDS PER LINE ITEM
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 3: Create sales & commission records per line item');

    let totalNewSales = 0;
    let totalOldSales = 0;
    let totalNewCommission = 0;
    let totalOldCommission = 0;

    const newSaleIds: string[] = [];
    const affectedEmployeeIds = new Set<number>();
    let primaryNewEmployeeId: number | null = null;
    const exchangeEmployeeMap = new Map<string, any>();

    for (let i = 0; i < lineItems.length; i++) {
      const lineItem = lineItems[i];
      try {
        const employee = await resolveEmployeeForLineItem(lineItem, originalSale?.employeeId || null);

        if (!employee) {
          console.warn('[LineItem] ⚠️ Employee not identified for exchange item:', lineItem.productName || lineItem.productID || i + 1);
          continue;
        }

        if (!primaryNewEmployeeId) primaryNewEmployeeId = employee.id;
        affectedEmployeeIds.add(employee.id);

        const isOld = parseIsOld(lineItem);
        const rawAmount = Number(lineItem.productNetAmount || lineItem.netAmount || lineItem.amount || lineItem.Total || lineItem.price || 0);
        if (isNaN(rawAmount) || rawAmount <= 0) continue;

        const rate = employee.commissionPercentage ?? 1.0;
        const baseComm = (rawAmount * rate) / 100;

        const effectiveSaleAmount = isOld ? -Math.abs(rawAmount) : Math.abs(rawAmount);
        const effectiveCommission = isOld ? -Math.abs(baseComm) : Math.abs(baseComm);

        if (isOld) {
          totalOldSales += Math.abs(rawAmount);
          totalOldCommission += Math.abs(baseComm);
        } else {
          totalNewSales += Math.abs(rawAmount);
          totalNewCommission += Math.abs(baseComm);
        }

        const uniqueBillId = `${newInvoiceNo}-${lineItem.productID || lineItem.productId || i + 1}-${isOld ? 'RET' : 'NEW'}`;

        const saleRecord = await prisma.sales.create({
          data: {
            employeeId: employee.id,
            netAmount: effectiveSaleAmount,
            billId: uniqueBillId,
            saleDate: new Date(exchange.exchangeDate || exchange.date || new Date()),
            description: `Exchange ${isOld ? 'Return Item (IsOld: 1)' : 'New Item (IsOld: 0)'}: ${lineItem.productName || lineItem.name || 'Product'} (EX: ${exchangeNo})`,
            source: 'HOPKID',
            status: 'ACTIVE'
          }
        });

        const key = `${employee.id}_${isOld ? 'RET' : 'NEW'}`;
        if (!exchangeEmployeeMap.has(key)) {
          exchangeEmployeeMap.set(key, {
            employee: employee,
            isOld: isOld,
            totalSaleAmount: 0,
            totalCommissionAmount: 0,
            rate: rate,
          });
        }
        const group = exchangeEmployeeMap.get(key);
        group.totalSaleAmount += effectiveSaleAmount;
        group.totalCommissionAmount += effectiveCommission;

        newSaleIds.push(saleRecord.id.toString());
        console.log(`[LineItem ${i + 1}] ✅ Recorded sale #${saleRecord.id} for employee #${employee.id} (${isOld ? 'RETURN' : 'NEW SALE'}) - ₹${effectiveSaleAmount}`);

      } catch (itemError: any) {
        console.error(`[LineItem ${i + 1}] ❌ Error:`, itemError.message);
        continue;
      }
    }

    // Upsert aggregated CommissionTransactions per (Employee + isOld)
    const txnExDate = new Date(exchange.exchangeDate || exchange.date || new Date());
    for (const group of exchangeEmployeeMap.values()) {
      const exchangeBillId = `${newInvoiceNo}-${group.isOld ? 'RET' : 'NEW'}`;
      const roundedAmount = Number(group.totalSaleAmount.toFixed(2));
      const roundedCommission = Number(group.totalCommissionAmount.toFixed(2));

      const existingCommTxn = await prisma.commissionTransaction.findFirst({
        where: {
          employeeId: group.employee.id,
          billId: exchangeBillId
        }
      });

      if (existingCommTxn) {
        await prisma.commissionTransaction.update({
          where: { id: existingCommTxn.id },
          data: {
            saleAmount: roundedAmount,
            commissionAmount: roundedCommission,
            commissionPercent: group.rate,
            createdAt: txnExDate,
          }
        });
        console.log(`[ExchangeTxn] 🔄 Updated aggregated txn #${existingCommTxn.id} for ${exchangeBillId}, Emp #${group.employee.id}`);
      } else {
        const commTxn = await prisma.commissionTransaction.create({
          data: {
            employeeId: group.employee.id,
            storeId: group.employee.storeId || null,
            saleAmount: roundedAmount,
            commissionType: 'PERCENTAGE',
            commissionPercent: group.rate,
            commissionAmount: roundedCommission,
            billId: exchangeBillId,
            invoiceNumber: `${newInvoiceNo}-${group.isOld ? 'RET' : 'NEW'}`,
            status: 'APPROVED',
            createdAt: txnExDate,
            notes: `Sales Exchange ${group.isOld ? 'Return/Old Item (IsOld: 1)' : 'New Sale (IsOld: 0)'} (EX: ${exchangeNo})`
          }
        });
        console.log(`[ExchangeTxn] ✅ Created aggregated txn #${commTxn.id} for ${exchangeBillId}, Emp #${group.employee.id}`);
      }
    }

    if (!primaryNewEmployeeId) {
      primaryNewEmployeeId = originalSale?.employeeId || 1;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: CREATE SALES EXCHANGE RECORD
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 4: Create sales exchange record');

    const origAmountVal = totalOldSales > 0 ? totalOldSales : Number(originalSale?.netAmount || 0);
    const newAmountVal = Number(totalNewSales || 0);
    const diffAmountVal = newAmountVal - origAmountVal;
    const diffCommVal = totalNewCommission - totalOldCommission;

    const exchangeRecord = await prisma.salesExchange.create({
      data: {
        exchangeNo: exchangeNo,
        originalInvoiceNo: originalInvoiceNo,
        newInvoiceNo: newInvoiceNo,
        exchangeDate: new Date(exchange.exchangeDate || exchange.date || new Date()),
        originalSaleId: originalSale?.id || null,
        newSaleId: newSaleIds.join(','),
        employeeId: primaryNewEmployeeId,
        originalAmount: origAmountVal,
        newAmount: newAmountVal,
        amountDifference: diffAmountVal,
        originalCommission: totalOldCommission,
        newCommission: totalNewCommission,
        commissionDifference: diffCommVal,
        reason: exchange.reason || 'Sales Exchange',
        status: 'ACTIVE'
      }
    });

    console.log('[Process] ✅ Sales exchange created:', exchangeRecord.id, {
      newAmount: newAmountVal,
      originalAmount: origAmountVal,
      newCommission: totalNewCommission,
      oldCommissionReversed: totalOldCommission,
      netCommission: diffCommVal,
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 5: RECALCULATE COMMISSION FOR ALL AFFECTED EMPLOYEES
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 5: Recalculate commission');

    const exDate = new Date(exchange.exchangeDate || exchange.date || new Date());
    const month = `${exDate.getFullYear()}-${String(exDate.getMonth() + 1).padStart(2, '0')}`;

    if (originalSale?.employeeId) {
      affectedEmployeeIds.add(originalSale.employeeId);
    }

    for (const empId of affectedEmployeeIds) {
      try {
        const calculation = await CommissionService.calculateMonthlyCommission(empId, month);
        await CommissionService.upsertMonthlyCommission(empId, month, calculation);
        console.log(`[Commission] ✅ Recalculated commission for employee #${empId}`);
      } catch (commErr: any) {
        console.error(`[Commission] ⚠️ Failed recalculating commission for employee #${empId}:`, commErr.message);
      }
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
      for (const empId of affectedEmployeeIds) {
        getWebSocketInstance().broadcastCommissionUpdate(empId, {
          eventType: 'SALES_EXCHANGE_CREATED',
          exchangeNo,
          amount: totalAmount || totalNewSales
        });
      }
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
