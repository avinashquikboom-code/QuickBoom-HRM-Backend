import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { pushNotificationService } from '../services/pushNotificationService';

export const addSales = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { billId, invoiceNumber, saleAmount, storeId, notes } = req.body;

    if (!billId && !invoiceNumber) {
      res.status(400).json({ success: false, message: 'Either billId or invoiceNumber is required.' });
      return;
    }

    if (saleAmount === undefined || isNaN(Number(saleAmount))) {
      res.status(400).json({ success: false, message: 'Valid saleAmount is required.' });
      return;
    }

    // Identify logged in employee
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        commissionPolicies: {
          where: { isActive: true },
          orderBy: { priority: 'asc' },
        },
      },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee record not found for the logged-in user.' });
      return;
    }

    // Find applicable commission policy
    let policy = employee.commissionPolicies[0];
    const targetStoreId = storeId ? parseInt(storeId, 10) : employee.storeId;

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
        commissionAmount = (Number(saleAmount) * policy.commissionValue) / 100;
        commissionPercent = policy.commissionValue;
      } else if (policy.commissionType === 'FIXED') {
        commissionAmount = policy.commissionValue;
      }
    } else if (employee.commissionPercentage !== null && employee.commissionPercentage !== undefined) {
      commissionType = 'PERCENTAGE';
      commissionPercent = employee.commissionPercentage;
      commissionAmount = (Number(saleAmount) * employee.commissionPercentage) / 100;
    }

    // Create the transaction
    const transaction = await prisma.commissionTransaction.create({
      data: {
        employeeId: employee.id,
        storeId: targetStoreId,
        policyId: policy ? policy.id : null,
        saleAmount: parseFloat(saleAmount),
        commissionType,
        commissionPercent: commissionPercent || null,
        commissionAmount,
        billId: billId || null,
        invoiceNumber: invoiceNumber || null,
        status: 'PENDING',
        notes: notes || null,
      },
      include: {
        employee: true,
        store: true,
        policy: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Sale added and commission transaction created successfully.',
      transaction,
    });
  } catch (error) {
    console.error('Add sale error:', error);
    res.status(500).json({ success: false, message: 'Failed to add sale.' });
  }
};

export const updateSales = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { billId, invoiceNumber, saleAmount, storeId, notes } = req.body;

    if (!billId && !invoiceNumber) {
      res.status(400).json({ success: false, message: 'Either billId or invoiceNumber is required.' });
      return;
    }

    if (saleAmount === undefined || isNaN(Number(saleAmount))) {
      res.status(400).json({ success: false, message: 'Valid saleAmount is required.' });
      return;
    }

    // Find original transaction
    const whereClause: any = {};
    if (billId) whereClause.billId = billId;
    if (invoiceNumber) whereClause.invoiceNumber = invoiceNumber;

    const transaction = await prisma.commissionTransaction.findFirst({
      where: whereClause,
      include: {
        policy: true,
      },
    });

    if (!transaction) {
      res.status(404).json({ success: false, message: 'Original sale/commission transaction not found.' });
      return;
    }

    // Recalculate commission
    let commissionAmount = 0;
    let commissionPercent = transaction.commissionPercent || 0;
    const commissionType = transaction.commissionType;

    if (transaction.policy) {
      if (commissionType === 'PERCENTAGE') {
        commissionAmount = (Number(saleAmount) * transaction.policy.commissionValue) / 100;
        commissionPercent = transaction.policy.commissionValue;
      } else if (commissionType === 'FIXED') {
        commissionAmount = transaction.policy.commissionValue;
      }
    } else {
      // Fallback to original rates
      if (commissionType === 'PERCENTAGE') {
        commissionAmount = (Number(saleAmount) * commissionPercent) / 100;
      } else {
        commissionAmount = transaction.commissionAmount;
      }
    }

    const updatedTransaction = await prisma.commissionTransaction.update({
      where: { id: transaction.id },
      data: {
        saleAmount: parseFloat(saleAmount),
        commissionAmount,
        commissionPercent: commissionPercent || null,
        notes: notes || transaction.notes,
        storeId: storeId ? parseInt(storeId, 10) : transaction.storeId,
      },
      include: {
        employee: true,
        store: true,
        policy: true,
      },
    });

    res.json({
      success: true,
      message: 'Sale and commission transaction updated successfully.',
      transaction: updatedTransaction,
    });
  } catch (error) {
    console.error('Update sale error:', error);
    res.status(500).json({ success: false, message: 'Failed to update sale.' });
  }
};

export const addCreditNote = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { billId, invoiceNumber, creditAmount, notes } = req.body;

    if (!billId && !invoiceNumber) {
      res.status(400).json({ success: false, message: 'Either billId or invoiceNumber is required.' });
      return;
    }

    if (creditAmount === undefined || isNaN(Number(creditAmount)) || Number(creditAmount) <= 0) {
      res.status(400).json({ success: false, message: 'Valid positive creditAmount is required.' });
      return;
    }

    // Find original transaction
    const whereClause: any = {};
    if (billId) whereClause.billId = billId;
    if (invoiceNumber) whereClause.invoiceNumber = invoiceNumber;

    const originalTransaction = await prisma.commissionTransaction.findFirst({
      where: whereClause,
      include: {
        policy: true,
      },
    });

    if (!originalTransaction) {
      res.status(404).json({ success: false, message: 'Original sale transaction not found.' });
      return;
    }

    // Proportional reduction in commission
    let reducedCommission = 0;
    if (originalTransaction.commissionPercent) {
      reducedCommission = (Number(creditAmount) * originalTransaction.commissionPercent) / 100;
    } else if (originalTransaction.commissionType === 'FIXED') {
      reducedCommission = (Number(creditAmount) / originalTransaction.saleAmount) * originalTransaction.commissionAmount;
    }

    // Create negative adjustment transaction
    const creditTransaction = await prisma.commissionTransaction.create({
      data: {
        employeeId: originalTransaction.employeeId,
        storeId: originalTransaction.storeId,
        policyId: originalTransaction.policyId,
        saleAmount: -parseFloat(creditAmount),
        commissionType: originalTransaction.commissionType,
        commissionPercent: originalTransaction.commissionPercent,
        commissionAmount: -reducedCommission,
        billId: billId || null,
        invoiceNumber: invoiceNumber ? `${invoiceNumber}-CN` : null,
        status: 'PENDING',
        notes: notes || `Credit Note for original sale of amount ₹${originalTransaction.saleAmount}`,
      },
      include: {
        employee: true,
        store: true,
        policy: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Credit Note added and commission adjusted successfully.',
      transaction: creditTransaction,
    });
  } catch (error) {
    console.error('Add credit note error:', error);
    res.status(500).json({ success: false, message: 'Failed to add credit note.' });
  }
};

export const addSalesExchange = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { billId, invoiceNumber, returnAmount, newSaleAmount, notes } = req.body;

    if (!billId && !invoiceNumber) {
      res.status(400).json({ success: false, message: 'Either billId or invoiceNumber is required.' });
      return;
    }

    if (returnAmount === undefined || isNaN(Number(returnAmount)) || returnAmount < 0) {
      res.status(400).json({ success: false, message: 'Valid returnAmount is required.' });
      return;
    }

    if (newSaleAmount === undefined || isNaN(Number(newSaleAmount)) || newSaleAmount < 0) {
      res.status(400).json({ success: false, message: 'Valid newSaleAmount is required.' });
      return;
    }

    // Find original transaction
    const whereClause: any = {};
    if (billId) whereClause.billId = billId;
    if (invoiceNumber) whereClause.invoiceNumber = invoiceNumber;

    const originalTransaction = await prisma.commissionTransaction.findFirst({
      where: whereClause,
      include: {
        policy: true,
      },
    });

    if (!originalTransaction) {
      res.status(404).json({ success: false, message: 'Original sale transaction not found.' });
      return;
    }

    const netDifference = Number(newSaleAmount) - Number(returnAmount);
    let adjustedCommission = 0;

    if (originalTransaction.commissionPercent) {
      adjustedCommission = (netDifference * originalTransaction.commissionPercent) / 100;
    } else if (originalTransaction.commissionType === 'FIXED') {
      adjustedCommission = (netDifference / originalTransaction.saleAmount) * originalTransaction.commissionAmount;
    }

    // Create adjustment transaction for exchange
    const exchangeTransaction = await prisma.commissionTransaction.create({
      data: {
        employeeId: originalTransaction.employeeId,
        storeId: originalTransaction.storeId,
        policyId: originalTransaction.policyId,
        saleAmount: netDifference,
        commissionType: originalTransaction.commissionType,
        commissionPercent: originalTransaction.commissionPercent,
        commissionAmount: adjustedCommission,
        billId: billId || null,
        invoiceNumber: invoiceNumber ? `${invoiceNumber}-EX` : null,
        status: 'PENDING',
        notes: notes || `Sales Exchange: returned ₹${returnAmount}, purchased ₹${newSaleAmount}`,
      },
      include: {
        employee: true,
        store: true,
        policy: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Sales Exchange added and commission adjusted successfully.',
      transaction: exchangeTransaction,
    });
  } catch (error) {
    console.error('Add sales exchange error:', error);
    res.status(500).json({ success: false, message: 'Failed to process sales exchange.' });
  }
};

export const syncSalesBatch = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { transactions } = req.body;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      res.status(400).json({ success: false, message: 'Valid transactions array is required.' });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        commissionPolicies: {
          where: { isActive: true },
          orderBy: { priority: 'asc' },
        },
      },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee record not found for the logged-in user.' });
      return;
    }

    let syncedCount = 0;
    const results: any[] = [];

    for (const tx of transactions) {
      const { endpoint, payload } = tx;
      if (!endpoint || !payload) continue;
      const normEndpoint = endpoint.toLowerCase().replace(/^\/api/, '');

      if (normEndpoint === '/sales/addsales' || normEndpoint === 'addsales' ||
          normEndpoint.includes('/api/sales/addsales')) {
        // Support both old shape (saleAmount, invoiceNumber) and new DTO shape (NetAmount/FinalAmount, InvoiceNo).
        const resolvedSaleAmount = payload.saleAmount ?? payload.NetAmount ?? payload.FinalAmount;
        const resolvedInvoiceNumber = payload.invoiceNumber ?? payload.InvoiceNo;
        const resolvedBillId = payload.billId;
        const { storeId, notes } = payload;

        if (resolvedSaleAmount === undefined || isNaN(Number(resolvedSaleAmount))) continue;

        let policy = employee.commissionPolicies[0];
        const targetStoreId = storeId ? parseInt(storeId, 10) : employee.storeId;

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
            commissionAmount = (Number(resolvedSaleAmount) * policy.commissionValue) / 100;
            commissionPercent = policy.commissionValue;
          } else if (policy.commissionType === 'FIXED') {
            commissionAmount = policy.commissionValue;
          }
        }

        const transaction = await prisma.commissionTransaction.create({
          data: {
            employeeId: employee.id,
            storeId: targetStoreId,
            policyId: policy ? policy.id : null,
            saleAmount: parseFloat(resolvedSaleAmount),
            commissionType,
            commissionPercent: commissionPercent || null,
            commissionAmount,
            billId: resolvedBillId || null,
            invoiceNumber: resolvedInvoiceNumber || null,
            status: 'PENDING',
            notes: notes || null,
          }
        });

        results.push({ success: true, transactionId: transaction.id, endpoint });
        syncedCount++;

      } else if (normEndpoint === '/sales/addcreditnote' || normEndpoint === 'addcreditnote' ||
                 normEndpoint.includes('/api/sales/addcreditnote')) {
        const resolvedCreditAmount = payload.creditAmount ?? payload.CNAmount;
        const resolvedInvoiceNumber = payload.invoiceNumber ?? payload.CNNo;
        const resolvedBillId = payload.billId;
        const { notes } = payload;

        if (resolvedCreditAmount === undefined || isNaN(Number(resolvedCreditAmount)) || Number(resolvedCreditAmount) <= 0) continue;

        const whereClause: any = {};
        if (resolvedBillId) whereClause.billId = resolvedBillId;
        if (resolvedInvoiceNumber) whereClause.invoiceNumber = resolvedInvoiceNumber;

        // Fallback: search for original transaction using SalesID (new DTO has SalesID)
        const originalTransaction = await prisma.commissionTransaction.findFirst({
          where: payload.SalesID
            ? { OR: [whereClause, { billId: payload.SalesID }] }
            : whereClause,
        });

        if (!originalTransaction) continue;

        let reducedCommission = 0;
        if (originalTransaction.commissionPercent) {
          reducedCommission = (Number(resolvedCreditAmount) * originalTransaction.commissionPercent) / 100;
        } else if (originalTransaction.commissionType === 'FIXED') {
          reducedCommission = (Number(resolvedCreditAmount) / originalTransaction.saleAmount) * originalTransaction.commissionAmount;
        }

        const creditTransaction = await prisma.commissionTransaction.create({
          data: {
            employeeId: originalTransaction.employeeId,
            storeId: originalTransaction.storeId,
            policyId: originalTransaction.policyId,
            saleAmount: -parseFloat(resolvedCreditAmount),
            commissionType: originalTransaction.commissionType,
            commissionPercent: originalTransaction.commissionPercent,
            commissionAmount: -reducedCommission,
            billId: resolvedBillId || null,
            invoiceNumber: resolvedInvoiceNumber ? `${resolvedInvoiceNumber}-CN` : null,
            status: 'PENDING',
            notes: notes || `Credit Note for original sale of amount ₹${originalTransaction.saleAmount}`,
          }
        });

        results.push({ success: true, transactionId: creditTransaction.id, endpoint });
        syncedCount++;
      } else if (normEndpoint === '/sales/addsalesexchange' || normEndpoint === 'addsalesexchange' ||
                 normEndpoint.includes('/api/sales/addsalesexchange')) {
        const resolvedInvoiceNumber = payload.invoiceNumber ?? payload.ExchangeInvoiceNo;
        const resolvedBillId = payload.billId;
        const { notes } = payload;

        let resolvedReturnAmount = payload.returnAmount;
        let resolvedNewSaleAmount = payload.newSaleAmount;

        // If return/new amounts are missing, compute from SalesExchangeProductList (new DTO shape)
        if ((resolvedReturnAmount === undefined || resolvedNewSaleAmount === undefined) &&
            Array.isArray(payload.SalesExchangeProductList)) {
          let sumReturn = 0;
          let sumNew = 0;
          for (const item of payload.SalesExchangeProductList) {
            const itemTotal = Number(item.Total ?? item.price ?? 0);
            if (item.IsOld === true || item.isOld === true) {
              sumReturn += itemTotal;
            } else {
              sumNew += itemTotal;
            }
          }
          resolvedReturnAmount = sumReturn;
          resolvedNewSaleAmount = sumNew;
        }

        if (resolvedReturnAmount === undefined || isNaN(Number(resolvedReturnAmount)) || resolvedReturnAmount < 0) continue;
        if (resolvedNewSaleAmount === undefined || isNaN(Number(resolvedNewSaleAmount)) || resolvedNewSaleAmount < 0) continue;

        const whereClause: any = {};
        if (resolvedBillId) whereClause.billId = resolvedBillId;
        if (resolvedInvoiceNumber) whereClause.invoiceNumber = resolvedInvoiceNumber;

        // Fallback: search for original transaction using SalesID (new DTO has SalesID)
        const originalTransaction = await prisma.commissionTransaction.findFirst({
          where: payload.SalesID
            ? { OR: [whereClause, { billId: payload.SalesID }] }
            : whereClause,
        });

        if (!originalTransaction) continue;

        const netDifference = Number(resolvedNewSaleAmount) - Number(resolvedReturnAmount);
        let adjustedCommission = 0;

        if (originalTransaction.commissionPercent) {
          adjustedCommission = (netDifference * originalTransaction.commissionPercent) / 100;
        } else if (originalTransaction.commissionType === 'FIXED') {
          adjustedCommission = (netDifference / originalTransaction.saleAmount) * originalTransaction.commissionAmount;
        }

        const exchangeTransaction = await prisma.commissionTransaction.create({
          data: {
            employeeId: originalTransaction.employeeId,
            storeId: originalTransaction.storeId,
            policyId: originalTransaction.policyId,
            saleAmount: netDifference,
            commissionType: originalTransaction.commissionType,
            commissionPercent: originalTransaction.commissionPercent,
            commissionAmount: adjustedCommission,
            billId: resolvedBillId || null,
            invoiceNumber: resolvedInvoiceNumber ? `${resolvedInvoiceNumber}-EX` : null,
            status: 'PENDING',
            notes: notes || `Sales Exchange: returned ₹${resolvedReturnAmount}, purchased ₹${resolvedNewSaleAmount}`,
          }
        });

        results.push({ success: true, transactionId: exchangeTransaction.id, endpoint });
        syncedCount++;
      }
    }

    // Trigger push notification to employee (fire-and-forget, never awaited)
    if (syncedCount > 0 && req.user?.id) {
      pushNotificationService.sendPush(
        [req.user.id],
        'Sales Synced',
        `${syncedCount} sales synced`,
        {
          screen: 'commission',
          id: employee.id.toString()
        }
      ).catch(err => {
        console.error('[salesLegacyController] Failed to send sales sync push notification:', err);
      });
    }

    res.json({
      success: true,
      message: `${syncedCount} transactions synced successfully.`,
      results
    });
  } catch (error) {
    console.error('Batch sales sync error:', error);
    res.status(500).json({ success: false, message: 'Failed to sync batch.' });
  }
};

