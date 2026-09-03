import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { pushNotificationService } from '../services/pushNotificationService';
import { resolveEmployeeId, parseIsOld } from '../utils/commissionHelper';

export const addSales = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { billId, invoiceNumber, saleAmount, storeId, notes, employeeId, employeeCode, employeeID } = req.body;

    if (!billId && !invoiceNumber) {
      res.status(400).json({ success: false, message: 'Either billId or invoiceNumber is required.' });
      return;
    }

    if (saleAmount === undefined || isNaN(Number(saleAmount))) {
      res.status(400).json({ success: false, message: 'Valid saleAmount is required.' });
      return;
    }

    // Identify target employee (via payload GUID/code/int OR logged in user)
    let employee = null;
    const identifier = employeeId || employeeID || employeeCode;
    if (identifier) {
      const resolvedId = await resolveEmployeeId(identifier);
      if (resolvedId !== null) {
        employee = await prisma.employee.findUnique({
          where: { id: resolvedId },
          include: {
            commissionPolicies: {
              where: { isActive: true },
              orderBy: { priority: 'asc' },
            },
          },
        });
      }
    }

    if (!employee && req.user?.id) {
      employee = await prisma.employee.findFirst({
        where: { userId: req.user.id },
        include: {
          commissionPolicies: {
            where: { isActive: true },
            orderBy: { priority: 'asc' },
          },
        },
      });
    }

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee record not found for the sale.' });
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

    // ── COMMISSION-DIAG: amount tracing ──────────────────────────────────────
    const parsedSaleAmount = parseFloat(saleAmount);
    console.log(`[COMMISSION-DIAG] addSales called | raw saleAmount from body: ${JSON.stringify(saleAmount)} | parsed: ${parsedSaleAmount}`);
    console.log(`[COMMISSION-DIAG] employee: id=${employee.id}, code=${employee.employeeCode}, commissionPercentage=${employee.commissionPercentage}`);
    console.log(`[COMMISSION-DIAG] policy resolved: ${policy ? `id=${policy.id}, type=${policy.commissionType}, value=${policy.commissionValue}` : 'null (no active policy)'}`);
    // ─────────────────────────────────────────────────────────────────────────

    if (policy) {
      commissionType = policy.commissionType;
      if (policy.commissionType === 'PERCENTAGE') {
        commissionAmount = (parsedSaleAmount * policy.commissionValue) / 100;
        commissionPercent = policy.commissionValue;
        console.log(`[COMMISSION-DIAG] Branch: POLICY PERCENTAGE | ${parsedSaleAmount} × ${policy.commissionValue}% / 100 = ${commissionAmount}`);
      } else if (policy.commissionType === 'FIXED') {
        commissionAmount = policy.commissionValue;
        console.log(`[COMMISSION-DIAG] Branch: POLICY FIXED | commissionAmount = ${commissionAmount}`);
      }
    } else if (employee.commissionPercentage !== null && employee.commissionPercentage !== undefined) {
      commissionType = 'PERCENTAGE';
      commissionPercent = employee.commissionPercentage;
      commissionAmount = (parsedSaleAmount * employee.commissionPercentage) / 100;
      console.log(`[COMMISSION-DIAG] Branch: EMPLOYEE commissionPercentage | ${parsedSaleAmount} × ${employee.commissionPercentage}% / 100 = ${commissionAmount}`);
    } else {
      console.warn(`[COMMISSION-DIAG] Branch: NO POLICY & NO commissionPercentage — commissionAmount=0 for employee id=${employee.id}`);
    }

    console.log(`[COMMISSION-DIAG] Final stored values → saleAmount=${parsedSaleAmount}, commissionAmount=${commissionAmount}, commissionPercent=${commissionPercent}`);

    // Create or update the transaction
    let transaction;
    if (billId) {
      transaction = await prisma.commissionTransaction.upsert({
        where: {
          billId_employeeId: {
            billId: String(billId),
            employeeId: employee.id,
          }
        },
        update: {
          storeId: targetStoreId,
          policyId: policy ? policy.id : null,
          saleAmount: parsedSaleAmount,
          commissionType,
          commissionPercent: commissionPercent || null,
          commissionAmount,
          invoiceNumber: invoiceNumber || null,
          status: 'PENDING',
          notes: notes || null,
          updatedAt: new Date(),
        },
        create: {
          employeeId: employee.id,
          storeId: targetStoreId,
          policyId: policy ? policy.id : null,
          saleAmount: parsedSaleAmount,
          commissionType,
          commissionPercent: commissionPercent || null,
          commissionAmount,
          billId: String(billId),
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
    } else {
      transaction = await prisma.commissionTransaction.create({
        data: {
          employeeId: employee.id,
          storeId: targetStoreId,
          policyId: policy ? policy.id : null,
          saleAmount: parsedSaleAmount,
          commissionType,
          commissionPercent: commissionPercent || null,
          commissionAmount,
          billId: null,
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
    }

    console.log(`[COMMISSION-DIAG] DB row saved → id=${transaction.id}, saleAmount=${transaction.saleAmount}, commissionAmount=${transaction.commissionAmount}`);

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
    const { billId, invoiceNumber, returnAmount, newSaleAmount, employeeId: inputEmpId, notes, SalesExchangeProductList } = req.body;
    const resolvedInvoiceNumber = invoiceNumber ?? req.body.ExchangeInvoiceNo;
    const resolvedBillId = billId;

    // Handle line items if provided in SalesExchangeProductList
    if (Array.isArray(SalesExchangeProductList) && SalesExchangeProductList.length > 0) {
      const createdTxns: any[] = [];
      let totalOldCommission = 0;
      let totalNewCommission = 0;

      for (const item of SalesExchangeProductList) {
        const itemAmount = Number(item.Total ?? item.price ?? item.amount ?? item.netAmount ?? 0);
        if (isNaN(itemAmount) || itemAmount <= 0) continue;

        const isOld = parseIsOld(item);
        const empIdentifier = item.SalesMan || item.employeeId || item.employeeCode || inputEmpId || req.user?.id;
        let resolvedEmpId: number | null = null;
        if (empIdentifier) {
          resolvedEmpId = await resolveEmployeeId(String(empIdentifier));
        }
        if (!resolvedEmpId && inputEmpId) {
          resolvedEmpId = Number(inputEmpId);
        }

        const employee = resolvedEmpId ? await prisma.employee.findUnique({
          where: { id: resolvedEmpId },
          include: { commissionPolicies: { where: { isActive: true }, orderBy: { priority: 'asc' } } }
        }) : null;

        const rate = employee?.commissionPercentage ?? 1.0;
        const baseComm = (itemAmount * rate) / 100;
        const commAmount = isOld ? -Math.abs(baseComm) : Math.abs(baseComm);
        const effectiveSaleAmount = isOld ? -Math.abs(itemAmount) : Math.abs(itemAmount);

        if (isOld) totalOldCommission += Math.abs(baseComm);
        else totalNewCommission += Math.abs(baseComm);

        if (employee) {
          const txn = await prisma.commissionTransaction.create({
            data: {
              employeeId: employee.id,
              storeId: employee.storeId || null,
              policyId: employee.commissionPolicies?.[0]?.id || null,
              saleAmount: effectiveSaleAmount,
              commissionType: 'PERCENTAGE',
              commissionPercent: rate,
              commissionAmount: commAmount,
              billId: resolvedBillId || null,
              invoiceNumber: resolvedInvoiceNumber ? `${resolvedInvoiceNumber}-${isOld ? 'RET' : 'NEW'}` : null,
              status: 'APPROVED',
              eventType: 'SALES_EXCHANGE',
              notes: notes || `Sales Exchange ${isOld ? 'Return/Old Item (IsOld: 1)' : 'New Sale (IsOld: 0)'}: ${item.productName || item.name || 'Product'} (₹${itemAmount})`,
            }
          });
          createdTxns.push(txn);
        }
      }

      res.status(201).json({
        success: true,
        message: 'Sales Exchange processed with distinct return and new sale commissions.',
        transactions: createdTxns,
        summary: {
          newSaleCommission: totalNewCommission,
          oldSaleCommissionReversed: totalOldCommission,
          netCommission: totalNewCommission - totalOldCommission
        }
      });
      return;
    }

    if (!resolvedBillId && !resolvedInvoiceNumber) {
      res.status(400).json({ success: false, message: 'Either billId or invoiceNumber is required.' });
      return;
    }

    const retAmt = Number(returnAmount || 0);
    const newAmt = Number(newSaleAmount || 0);

    if (retAmt <= 0 && newAmt <= 0) {
      res.status(400).json({ success: false, message: 'Valid returnAmount or newSaleAmount is required.' });
      return;
    }

    // Resolve employee
    let employee = null;
    if (inputEmpId) {
      const empIdInt = await resolveEmployeeId(String(inputEmpId));
      if (empIdInt) {
        employee = await prisma.employee.findUnique({
          where: { id: empIdInt },
          include: { commissionPolicies: { where: { isActive: true }, orderBy: { priority: 'asc' } } }
        });
      }
    }

    const whereClause: any = {};
    if (resolvedBillId) whereClause.billId = resolvedBillId;
    if (resolvedInvoiceNumber) whereClause.invoiceNumber = resolvedInvoiceNumber;

    const originalTransaction = await prisma.commissionTransaction.findFirst({
      where: whereClause,
      include: { employee: { include: { commissionPolicies: { where: { isActive: true } } } }, policy: true },
    });

    if (!employee && originalTransaction?.employee) {
      employee = originalTransaction.employee;
    }

    if (!employee && req.user?.id) {
      employee = await prisma.employee.findFirst({
        where: { userId: req.user.id },
        include: { commissionPolicies: { where: { isActive: true } } }
      });
    }

    if (!employee) {
      employee = await prisma.employee.findFirst({
        where: { status: 'active' },
        include: { commissionPolicies: { where: { isActive: true } } }
      });
    }

    if (!employee) {
      res.status(400).json({ success: false, message: 'Could not resolve employee for sales exchange.' });
      return;
    }

    const rate = originalTransaction?.commissionPercent ?? employee.commissionPercentage ?? 1.0;
    const oldComm = (retAmt * rate) / 100;
    const newComm = (newAmt * rate) / 100;
    const createdTxns: any[] = [];

    const diffAmt = Math.round((retAmt - newAmt) * 100) / 100;
    const diffComm = Math.round((oldComm - newComm) * 100) / 100;

    // 1. Old returned transaction (IsOld = 1) -> negative commission calculated on full return amount
    if (retAmt > 0) {
      const oldTxn = await prisma.commissionTransaction.create({
        data: {
          employeeId: employee.id,
          storeId: employee.storeId || originalTransaction?.storeId || null,
          policyId: originalTransaction?.policyId || employee.commissionPolicies?.[0]?.id || null,
          saleAmount: -Math.abs(retAmt),
          commissionType: 'PERCENTAGE',
          commissionPercent: rate,
          commissionAmount: -Math.abs(oldComm),
          oldAmount: retAmt,
          newAmount: newAmt,
          oldCommission: oldComm,
          newCommission: newComm,
          commissionDifference: diffComm,
          eventType: 'SALES_EXCHANGE',
          billId: resolvedBillId || null,
          invoiceNumber: resolvedInvoiceNumber ? `${resolvedInvoiceNumber}-RET` : null,
          status: 'APPROVED',
          notes: notes || `Sales Exchange Return: Old Item ₹${retAmt} (IsOld: 1) (Old Bill: ₹${retAmt}, New Bill: ₹${newAmt}, Diff: ${diffAmt >= 0 ? '+' : ''}₹${diffAmt})`,
        }
      });
      createdTxns.push(oldTxn);
    }

    // 2. New sale transaction (IsOld = 0) -> positive commission calculated on full new sale amount
    if (newAmt > 0) {
      const newTxn = await prisma.commissionTransaction.create({
        data: {
          employeeId: employee.id,
          storeId: employee.storeId || originalTransaction?.storeId || null,
          policyId: originalTransaction?.policyId || employee.commissionPolicies?.[0]?.id || null,
          saleAmount: Math.abs(newAmt),
          commissionType: 'PERCENTAGE',
          commissionPercent: rate,
          commissionAmount: Math.abs(newComm),
          oldAmount: retAmt,
          newAmount: newAmt,
          oldCommission: oldComm,
          newCommission: newComm,
          commissionDifference: diffComm,
          eventType: 'SALES_EXCHANGE',
          billId: resolvedBillId || null,
          invoiceNumber: resolvedInvoiceNumber ? `${resolvedInvoiceNumber}-NEW` : null,
          status: 'APPROVED',
          notes: notes || `Sales Exchange New Sale: ₹${newAmt} (IsOld: 0) (Old Bill: ₹${retAmt}, New Bill: ₹${newAmt}, Diff: ${diffAmt >= 0 ? '+' : ''}₹${diffAmt})`,
        }
      });
      createdTxns.push(newTxn);
    }

    res.status(201).json({
      success: true,
      message: 'Sales Exchange added with separate new sale and returned item commissions.',
      transactions: createdTxns,
      summary: {
        newSaleAmount: newAmt,
        newCommission: newComm,
        returnAmount: retAmt,
        reversedCommission: -oldComm,
        netCommission: newComm - oldComm,
      }
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

    const defaultEmployee = req.user?.id
      ? await prisma.employee.findFirst({
          where: { userId: req.user.id },
          include: {
            commissionPolicies: {
              where: { isActive: true },
              orderBy: { priority: 'asc' },
            },
          },
        })
      : null;

    let syncedCount = 0;
    const results: any[] = [];

    for (const tx of transactions) {
      const { endpoint, payload } = tx;
      if (!endpoint || !payload) continue;
      const normEndpoint = endpoint.toLowerCase().replace(/^\/api/, '');

      // Resolve target employee for this transaction item
      let employee = defaultEmployee;
      const identifier = payload.employeeId || payload.employeeID || payload.employeeCode || payload.SalesMan;
      if (identifier) {
        const resolvedId = await resolveEmployeeId(identifier);
        if (resolvedId !== null) {
          const empFound = await prisma.employee.findUnique({
            where: { id: resolvedId },
            include: {
              commissionPolicies: {
                where: { isActive: true },
                orderBy: { priority: 'asc' },
              },
            },
          });
          if (empFound) employee = empFound;
        }
      }

      if (!employee) {
        employee = await prisma.employee.findFirst({
          where: { status: 'active' },
          include: {
            commissionPolicies: {
              where: { isActive: true },
              orderBy: { priority: 'asc' },
            },
          },
        });
      }

      if (!employee) continue;

      if (normEndpoint === '/sales/addsales' || normEndpoint === 'addsales' ||
          normEndpoint.includes('/api/sales/addsales')) {
        // Support both old shape (saleAmount, invoiceNumber) and new DTO shape (NetAmount/FinalAmount, InvoiceNo).
        const resolvedSaleAmount = payload.saleAmount ?? payload.NetAmount ?? payload.FinalAmount;
        const resolvedInvoiceNumber = payload.invoiceNumber ?? payload.InvoiceNo;
        const resolvedBillId = payload.billId;
        const { storeId, notes } = payload;

        // ── COMMISSION-DIAG: sync batch amount tracing ────────────────────────
        console.log(`[COMMISSION-DIAG] syncSalesBatch addSales | endpoint: ${endpoint}`);
        console.log(`[COMMISSION-DIAG] payload.saleAmount=${payload.saleAmount}, payload.NetAmount=${payload.NetAmount}, payload.FinalAmount=${payload.FinalAmount}`);
        console.log(`[COMMISSION-DIAG] resolvedSaleAmount=${resolvedSaleAmount}, resolvedInvoiceNumber=${resolvedInvoiceNumber}`);
        // ─────────────────────────────────────────────────────────────────────

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

        const parsedBatchAmount = parseFloat(resolvedSaleAmount);
        console.log(`[COMMISSION-DIAG] syncSalesBatch calc | employee.id=${employee.id}, commissionPercentage=${employee.commissionPercentage}, policy=${policy ? `id=${policy.id} val=${policy.commissionValue}` : 'null'}`);

        if (policy) {
          commissionType = policy.commissionType;
          if (policy.commissionType === 'PERCENTAGE') {
            commissionAmount = (parsedBatchAmount * policy.commissionValue) / 100;
            commissionPercent = policy.commissionValue;
            console.log(`[COMMISSION-DIAG] Branch: POLICY PERCENTAGE | ${parsedBatchAmount} × ${policy.commissionValue}% / 100 = ${commissionAmount}`);
          } else if (policy.commissionType === 'FIXED') {
            commissionAmount = policy.commissionValue;
            console.log(`[COMMISSION-DIAG] Branch: POLICY FIXED | commissionAmount=${commissionAmount}`);
          }
        } else if (employee.commissionPercentage !== null && employee.commissionPercentage !== undefined) {
          // Fallback: use per-employee commissionPercentage when no CommissionPolicy exists
          commissionType = 'PERCENTAGE';
          commissionPercent = employee.commissionPercentage;
          commissionAmount = (parsedBatchAmount * employee.commissionPercentage) / 100;
          console.log(`[COMMISSION-DIAG] Branch: EMPLOYEE commissionPercentage | ${parsedBatchAmount} × ${employee.commissionPercentage}% / 100 = ${commissionAmount}`);
        } else {
          console.warn(`[COMMISSION-DIAG] Branch: NO POLICY & NO commissionPercentage — commissionAmount=0 for employee id=${employee.id}`);
        }

        console.log(`[COMMISSION-DIAG] syncSalesBatch → saleAmount=${parsedBatchAmount}, commissionAmount=${commissionAmount}`);

        const transaction = await prisma.commissionTransaction.create({
          data: {
            employeeId: employee.id,
            storeId: targetStoreId,
            policyId: policy ? policy.id : null,
            saleAmount: parsedBatchAmount,
            commissionType,
            commissionPercent: commissionPercent || null,
            commissionAmount,
            billId: resolvedBillId || null,
            invoiceNumber: resolvedInvoiceNumber || null,
            status: 'PENDING',
            notes: notes || null,
          }
        });

        console.log(`[COMMISSION-DIAG] syncSalesBatch DB row created → id=${transaction.id}, saleAmount=${transaction.saleAmount}, commissionAmount=${transaction.commissionAmount}`);
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

        // If line items provided in SalesExchangeProductList
        if (Array.isArray(payload.SalesExchangeProductList) && payload.SalesExchangeProductList.length > 0) {
          for (const item of payload.SalesExchangeProductList) {
            const itemTotal = Number(item.Total ?? item.price ?? item.amount ?? item.netAmount ?? 0);
            if (isNaN(itemTotal) || itemTotal <= 0) continue;

            const isOld = parseIsOld(item);
            const empIdentifier = item.SalesMan || item.employeeId || item.employeeCode || payload.employeeId;
            let resolvedEmpId: number | null = null;
            if (empIdentifier) {
              resolvedEmpId = await resolveEmployeeId(String(empIdentifier));
            }
            const emp = resolvedEmpId
              ? await prisma.employee.findUnique({ where: { id: resolvedEmpId }, include: { commissionPolicies: { where: { isActive: true } } } })
              : defaultEmployee;

            if (!emp) continue;

            const rate = emp.commissionPercentage ?? 1.0;
            const baseComm = (itemTotal * rate) / 100;
            const commAmount = isOld ? -Math.abs(baseComm) : Math.abs(baseComm);
            const effectiveSaleAmount = isOld ? -Math.abs(itemTotal) : Math.abs(itemTotal);

            const txn = await prisma.commissionTransaction.create({
              data: {
                employeeId: emp.id,
                storeId: emp.storeId || null,
                policyId: emp.commissionPolicies?.[0]?.id || null,
                saleAmount: effectiveSaleAmount,
                commissionType: 'PERCENTAGE',
                commissionPercent: rate,
                commissionAmount: commAmount,
                billId: resolvedBillId || null,
                invoiceNumber: resolvedInvoiceNumber ? `${resolvedInvoiceNumber}-${isOld ? 'RET' : 'NEW'}` : null,
                status: 'APPROVED',
                notes: notes || `Sales Exchange ${isOld ? 'Return/Old Item (IsOld: 1)' : 'New Sale (IsOld: 0)'}: ${item.productName || item.name || 'Product'} (₹${itemTotal})`,
              }
            });
            results.push({ success: true, transactionId: txn.id, endpoint });
            syncedCount++;
          }
        } else {
          // Direct aggregate amounts
          const retAmt = Number(payload.returnAmount || 0);
          const newAmt = Number(payload.newSaleAmount || 0);

          if (retAmt > 0 || newAmt > 0) {
            const whereClause: any = {};
            if (resolvedBillId) whereClause.billId = resolvedBillId;
            if (resolvedInvoiceNumber) whereClause.invoiceNumber = resolvedInvoiceNumber;

            const originalTransaction = await prisma.commissionTransaction.findFirst({
              where: payload.SalesID
                ? { OR: [whereClause, { billId: payload.SalesID }] }
                : whereClause,
              include: { employee: { include: { commissionPolicies: { where: { isActive: true } } } }, policy: true }
            });

            const emp = originalTransaction?.employee || defaultEmployee;
            if (emp) {
              const rate = originalTransaction?.commissionPercent ?? emp.commissionPercentage ?? 1.0;

              if (retAmt > 0) {
                const oldComm = (retAmt * rate) / 100;
                const oldTxn = await prisma.commissionTransaction.create({
                  data: {
                    employeeId: emp.id,
                    storeId: emp.storeId || originalTransaction?.storeId || null,
                    policyId: originalTransaction?.policyId || emp.commissionPolicies?.[0]?.id || null,
                    saleAmount: -Math.abs(retAmt),
                    commissionType: 'PERCENTAGE',
                    commissionPercent: rate,
                    commissionAmount: -Math.abs(oldComm),
                    billId: resolvedBillId || null,
                    invoiceNumber: resolvedInvoiceNumber ? `${resolvedInvoiceNumber}-RET` : null,
                    status: 'APPROVED',
                    notes: notes || `Sales Exchange Return: Old Item ₹${retAmt} (IsOld: 1)`,
                  }
                });
                results.push({ success: true, transactionId: oldTxn.id, endpoint });
                syncedCount++;
              }

              if (newAmt > 0) {
                const newComm = (newAmt * rate) / 100;
                const newTxn = await prisma.commissionTransaction.create({
                  data: {
                    employeeId: emp.id,
                    storeId: emp.storeId || originalTransaction?.storeId || null,
                    policyId: originalTransaction?.policyId || emp.commissionPolicies?.[0]?.id || null,
                    saleAmount: Math.abs(newAmt),
                    commissionType: 'PERCENTAGE',
                    commissionPercent: rate,
                    commissionAmount: Math.abs(newComm),
                    billId: resolvedBillId || null,
                    invoiceNumber: resolvedInvoiceNumber ? `${resolvedInvoiceNumber}-NEW` : null,
                    status: 'APPROVED',
                    notes: notes || `Sales Exchange New Sale: ₹${newAmt} (IsOld: 0)`,
                  }
                });
                results.push({ success: true, transactionId: newTxn.id, endpoint });
                syncedCount++;
              }
            }
          }
        }
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
          id: (defaultEmployee?.id || req.user.id).toString()
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

