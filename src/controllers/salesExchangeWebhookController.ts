import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import { updateEmployeeWalletCommission, broadcastCommissionEvent, safeParseAmount } from '../utils/commissionHelper';

const router = Router();

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

async function processSalesExchangeCreated(payload: any): Promise<void> {
  try {
    console.log('[Process] Step 1: Validate exchange payload');

    const data = payload.data || payload;
    const exchange = data.salesExchange || data;
    const lineItems = data.lineItems || exchange.lineItems || [];

    const exchangeNo = String(exchange.exchangeNo || exchange.number || `EX-${Date.now()}`);
    const originalInvoiceNo = String(exchange.originalInvoiceNo || exchange.originalInvoiceNumber || exchange.billId || '');
    const newInvoiceNo = String(exchange.newInvoiceNo || exchange.newInvoiceNumber || `INV-EX-${Date.now()}`);
    const exchangeDate = new Date(exchange.exchangeDate || exchange.date || new Date());
    const reason = exchange.reason || 'Product exchange';

    if (!exchangeNo) {
      console.error('[Process] ❌ Invalid sales exchange payload');
      return;
    }

    console.log('[Process] ✅ Exchange details:', {
      exchangeNo,
      originalInvoiceNo,
      newInvoiceNo,
      lineItemCount: lineItems.length
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: IDEMPOTENCY CHECK
    // ═════════════════════════════════════════════════════════════════════════

    let existingExchange = await prisma.salesExchange.findUnique({
      where: { exchangeNo }
    });

    if (existingExchange) {
      console.log(`[Process] ⚠️ Sales exchange ${exchangeNo} already processed (idempotent skip)`);
      return;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: FIND ORIGINAL SALE & ORIGINAL SALESMAN
    // ═════════════════════════════════════════════════════════════════════════

    const originalSale = await prisma.sales.findFirst({
      where: {
        OR: [
          { billId: originalInvoiceNo },
          { id: exchange.originalSaleId || '' }
        ]
      }
    });

    const originalTx = await prisma.commissionTransaction.findFirst({
      where: {
        OR: [
          { billId: originalInvoiceNo },
          { invoiceNumber: originalInvoiceNo },
          { billId: { startsWith: `${originalInvoiceNo}-` } }
        ]
      },
      include: { employee: true }
    });

    const origSalesman = originalTx?.employee || (originalSale ? await prisma.employee.findUnique({ where: { id: originalSale.employeeId } }) : null);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: SEPARATE RETURNED ITEMS AND NEW REPLACEMENT ITEMS
    // ═════════════════════════════════════════════════════════════════════════

    const returnedItems: any[] = [];
    const newItems: any[] = [];

    for (const item of lineItems) {
      const isReturn = item.isReturn === true || item.type === 'RETURN' || item.returnedAmount > 0;
      if (isReturn) {
        returnedItems.push(item);
      } else {
        newItems.push(item);
      }
    }

    // If lineItems did not specify isReturn flag, check payload structure
    if (returnedItems.length === 0 && newItems.length === 0 && lineItems.length > 0) {
      // Default: lineItems are new replacement items, and original sale represents returned item
      newItems.push(...lineItems);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 5: CALCULATE RETURNED ITEM REVERSAL (ORIGINAL SALESMAN)
    // ═════════════════════════════════════════════════════════════════════════

    let totalOriginalAmount = Number(originalSale?.netAmount || originalTx?.saleAmount || exchange.originalAmount || 0);
    let totalOriginalCommission = Number(originalTx?.commissionAmount || (totalOriginalAmount * (origSalesman?.commissionPercentage || 1.0)) / 100);

    // If specific returned items given:
    if (returnedItems.length > 0) {
      totalOriginalAmount = returnedItems.reduce((sum, item) => sum + safeParseAmount(item.creditAmount || item.productNetAmount || item.amount), 0);
      const rate = origSalesman?.commissionPercentage || 1.0;
      totalOriginalCommission = Math.round(((totalOriginalAmount * rate) / 100) * 100) / 100;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 6: CALCULATE NEW REPLACEMENT ITEMS & NEW COMMISSIONS
    // ═════════════════════════════════════════════════════════════════════════

    let totalNewAmount = 0;
    let totalNewCommission = 0;
    const newSaleIds: string[] = [];
    let newSalesman: any = origSalesman;

    for (let i = 0; i < newItems.length; i++) {
      const lineItem = newItems[i];
      const itemAmount = safeParseAmount(lineItem.productNetAmount || lineItem.netAmount || lineItem.amount || exchange.newAmount);
      const productName = lineItem.productName || lineItem.name || 'Replacement Product';
      const productId = lineItem.productID || lineItem.productId || `rep-${i + 1}`;

      // Resolve employee for replacement item
      const empIdentifier =
        lineItem.employeeCode ||
        lineItem.code ||
        lineItem.empCode ||
        lineItem.employeePhoneNo ||
        lineItem.mobileNo ||
        lineItem.employeeName ||
        exchange.employeeCode;

      let itemSalesman: any = null;
      if (empIdentifier) {
        itemSalesman = await prisma.employee.findFirst({
          where: {
            OR: [
              { employeeCode: String(empIdentifier) },
              { mobileNumber: String(empIdentifier) },
              { employeeID: String(empIdentifier) }
            ]
          }
        });
      }

      if (!itemSalesman) {
        itemSalesman = origSalesman;
      }
      if (itemSalesman) {
        newSalesman = itemSalesman;
      }

      if (!itemSalesman) {
        console.error(`[Exchange] ❌ No employee found for replacement product ${productName}`);
        continue;
      }

      const rate = itemSalesman.commissionPercentage || 1.0;
      const itemCommission = Math.round(((itemAmount * rate) / 100) * 100) / 100;

      totalNewAmount += itemAmount;
      totalNewCommission += itemCommission;

      // Create new Sales record for replacement item
      const newSale = await prisma.sales.create({
        data: {
          employeeId: itemSalesman.id,
          netAmount: itemAmount,
          billId: `${newInvoiceNo}-${productId}`,
          saleDate: exchangeDate,
          description: `Sales Exchange (${exchangeNo}): ${originalInvoiceNo} → ${newInvoiceNo}`,
          source: 'EXCHANGE'
        }
      });
      newSaleIds.push(newSale.id);

      // Create new CommissionTransaction for replacement item
      await prisma.commissionTransaction.create({
        data: {
          employeeId: itemSalesman.id,
          storeId: itemSalesman.storeId || originalTx?.storeId,
          saleAmount: itemAmount,
          commissionType: 'PERCENTAGE',
          commissionPercent: rate,
          commissionAmount: itemCommission,
          billId: `${newInvoiceNo}-${productId}`,
          invoiceNumber: newInvoiceNo,
          status: 'APPROVED',
          notes: `Sales Exchange (${exchangeNo}) Replacement - Product: ${productName}`,
          createdAt: exchangeDate,
          history: {
            create: {
              employeeId: itemSalesman.id,
              action: 'CREATED',
              newStatus: 'APPROVED',
              newAmount: itemCommission,
              reason: `Commission Earned - Sales Exchange Replacement: ${productName}`,
              performedAt: new Date()
            }
          }
        }
      });
    }

    const commissionDifference = Math.round((totalNewCommission - totalOriginalCommission) * 100) / 100;

    console.log('[Exchange] Commission Breakdown:', {
      origSalesman: origSalesman ? `${origSalesman.firstName} (ID ${origSalesman.id})` : 'N/A',
      newSalesman: newSalesman ? `${newSalesman.firstName} (ID ${newSalesman.id})` : 'N/A',
      sameEmployee: origSalesman?.id === newSalesman?.id,
      totalOriginalAmount,
      totalNewAmount,
      totalOriginalCommission,
      totalNewCommission,
      commissionDifference
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 7: HANDLE WALLET UPDATES FOR SAME VS DIFFERENT EMPLOYEES
    // ═════════════════════════════════════════════════════════════════════════

    const isSameEmployee = origSalesman && newSalesman && origSalesman.id === newSalesman.id;

    if (isSameEmployee) {
      // SAME EMPLOYEE: adjust wallet by net difference
      if (commissionDifference > 0) {
        await updateEmployeeWalletCommission(
          origSalesman.id,
          commissionDifference,
          true,
          `Commission Adjustment - Sales Exchange Upgrade (${exchangeNo})`,
          'Commission Earned'
        );
      } else if (commissionDifference < 0) {
        await updateEmployeeWalletCommission(
          origSalesman.id,
          Math.abs(commissionDifference),
          false,
          `Commission Adjustment - Sales Exchange Difference (${exchangeNo})`,
          'Commission Reversed'
        );
      }
    } else {
      // DIFFERENT EMPLOYEES:
      // 1. Reverse original salesman's commission
      if (origSalesman && totalOriginalCommission > 0) {
        await updateEmployeeWalletCommission(
          origSalesman.id,
          totalOriginalCommission,
          false,
          `Commission Reversed - Sales Exchange (${exchangeNo}) handled by different employee`,
          'Commission Reversed'
        );

        if (originalTx) {
          await prisma.commissionHistory.create({
            data: {
              transactionId: originalTx.id,
              employeeId: origSalesman.id,
              action: 'REVERSED',
              previousStatus: originalTx.status,
              newStatus: 'EXCHANGED',
              previousAmount: originalTx.commissionAmount,
              newAmount: 0,
              reason: `Commission Reversed - Sales Exchange (${exchangeNo}) assigned to new employee`,
              performedAt: new Date()
            }
          });
        }
      }

      // 2. Award replacement salesman's commission
      if (newSalesman && totalNewCommission > 0) {
        await updateEmployeeWalletCommission(
          newSalesman.id,
          totalNewCommission,
          true,
          `Commission Earned - Sales Exchange Replacement (${exchangeNo})`,
          'Commission Earned'
        );
      }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 8: CREATE SALES EXCHANGE AUDIT RECORD
    // ═════════════════════════════════════════════════════════════════════════

    const primaryEmpId = origSalesman?.id || newSalesman?.id || (await prisma.employee.findFirst())?.id || 1;

    const exchangeRecord = await prisma.salesExchange.create({
      data: {
        exchangeNo,
        originalInvoiceNo,
        originalSaleId: originalSale?.id || null,
        newInvoiceNo,
        newSaleId: newSaleIds[0] || null,
        employeeId: primaryEmpId,
        originalEmployeeId: origSalesman?.id || null,
        newEmployeeId: newSalesman?.id || null,
        exchangeDate,
        reason,
        originalAmount: totalOriginalAmount,
        newAmount: totalNewAmount,
        amountDifference: totalNewAmount - totalOriginalAmount,
        originalCommission: totalOriginalCommission,
        newCommission: totalNewCommission,
        commissionDifference,
        status: 'ACTIVE'
      }
    });

    console.log('[Process] ✅ Exchange record created:', exchangeRecord.id);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 9: UPDATE ORIGINAL SALE STATUS TO EXCHANGED
    // ═════════════════════════════════════════════════════════════════════════

    if (originalSale) {
      await prisma.sales.update({
        where: { id: originalSale.id },
        data: {
          status: 'EXCHANGED',
          replacedBySaleId: newSaleIds[0] || null,
          returnDate: new Date(),
          returnReason: `Exchanged via ${exchangeNo}`
        }
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 10: RECALCULATE MONTHLY COMMISSIONS & BROADCAST REALTIME UPDATES
    // ═════════════════════════════════════════════════════════════════════════

    const month = `${exchangeDate.getFullYear()}-${String(exchangeDate.getMonth() + 1).padStart(2, '0')}`;
    const affectedEmpIds = new Set<number>();
    if (origSalesman) affectedEmpIds.add(origSalesman.id);
    if (newSalesman) affectedEmpIds.add(newSalesman.id);

    for (const empId of affectedEmpIds) {
      const calculation = await CommissionService.calculateMonthlyCommission(empId, month);
      await CommissionService.upsertMonthlyCommission(empId, month, calculation);

      await broadcastCommissionEvent(empId, {
        success: true,
        eventType: 'SALES_EXCHANGE_CREATED',
        exchangeNo,
        originalInvoiceNo,
        newInvoiceNo,
        employeeId: empId,
        newMonthlyCommission: calculation.totalCommissionAmount,
        updatedAt: new Date().toISOString()
      });
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [SALES EXCHANGE] ✅ COMPLETE                               ║');
    console.log(`║ Net commission diff: ${commissionDifference >= 0 ? '+' : ''}₹${commissionDifference}`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Process] 💥 FATAL ERROR:', error.message);
  }
}

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

async function processSalesExchangeUpdated(payload: any): Promise<void> {
  try {
    const data = payload.data || payload;
    const exchange = data.salesExchange || data;
    if (!exchange || !exchange.exchangeNo) return;

    const exchangeNo = String(exchange.exchangeNo);
    console.log('[Update] Processing Sales Exchange update:', exchangeNo);

    const existingRecord = await prisma.salesExchange.findUnique({
      where: { exchangeNo }
    });

    if (!existingRecord) {
      console.warn('[Update] ⚠️ Exchange not found in DB, running created processor...');
      await processSalesExchangeCreated(payload);
      return;
    }

    const updatedStatus = String(exchange.status || 'ACTIVE').toUpperCase();
    const cancelReason = exchange.cancelReason || exchange.reason || null;

    // If exchange is CANCELLED or REVERSED:
    if ((updatedStatus === 'CANCELLED' || updatedStatus === 'REVERSED') && existingRecord.status !== 'CANCELLED') {
      console.log('[Update] 🔄 Exchange cancelled/reversed - restoring original commissions and reversing replacement commissions...');

      const origEmpId = existingRecord.originalEmployeeId || existingRecord.employeeId;
      const newEmpId = existingRecord.newEmployeeId || existingRecord.employeeId;
      const isSameEmployee = origEmpId === newEmpId;

      if (isSameEmployee) {
        const diff = Number(existingRecord.commissionDifference);
        if (diff > 0) {
          await updateEmployeeWalletCommission(
            origEmpId,
            diff,
            false,
            `Commission Reversed - Exchange ${exchangeNo} Cancelled`,
            'Commission Reversed'
          );
        } else if (diff < 0) {
          await updateEmployeeWalletCommission(
            origEmpId,
            Math.abs(diff),
            true,
            `Commission Restored - Exchange ${exchangeNo} Cancelled`,
            'Commission Restored'
          );
        }
      } else {
        // Revert different-employee exchange:
        // 1. Credit original employee back
        const origComm = Number(existingRecord.originalCommission);
        if (origEmpId && origComm > 0) {
          await updateEmployeeWalletCommission(
            origEmpId,
            origComm,
            true,
            `Commission Restored - Exchange ${exchangeNo} Cancelled`,
            'Commission Restored'
          );
        }

        // 2. Debit replacement employee
        const newComm = Number(existingRecord.newCommission);
        if (newEmpId && newComm > 0) {
          await updateEmployeeWalletCommission(
            newEmpId,
            newComm,
            false,
            `Commission Reversed - Exchange ${exchangeNo} Cancelled`,
            'Commission Reversed'
          );
        }
      }

      // Recalculate monthly totals for affected employees
      const month = `${existingRecord.exchangeDate.getFullYear()}-${String(existingRecord.exchangeDate.getMonth() + 1).padStart(2, '0')}`;
      const affectedEmpIds = new Set<number>([origEmpId, newEmpId]);

      for (const empId of affectedEmpIds) {
        const calculation = await CommissionService.calculateMonthlyCommission(empId, month);
        await CommissionService.upsertMonthlyCommission(empId, month, calculation);

        await broadcastCommissionEvent(empId, {
          success: true,
          eventType: 'SALES_EXCHANGE_CANCELLED',
          exchangeNo,
          employeeId: empId,
          updatedAt: new Date().toISOString()
        });
      }
    }

    // Update exchange record
    await prisma.salesExchange.update({
      where: { exchangeNo },
      data: {
        status: updatedStatus,
        cancelledDate: updatedStatus === 'CANCELLED' || updatedStatus === 'REVERSED' ? new Date() : null,
        cancelReason,
        updatedAt: new Date()
      }
    });

    console.log(`[Update] ✅ Status updated to ${updatedStatus} for Exchange ${exchangeNo}`);

  } catch (error: any) {
    console.error('[Update] Error:', error.message);
  }
}

export default router;
