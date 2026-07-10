import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

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
