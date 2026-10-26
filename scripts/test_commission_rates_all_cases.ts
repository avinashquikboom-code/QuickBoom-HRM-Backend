import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/utils/db';
import { processInvoiceCreated, processInvoiceUpdated } from '../src/controllers/webhookController';
import { fetchCommissionWallet } from '../src/controllers/employeeCommissionController';
import { hasUnresolvedInvoiceItems } from '../src/services/invoiceCommissionCompleteness';
import { mobileInvoiceDetail } from '../src/services/invoiceCommissionService';

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`❌ FAIL: ${name}`, err);
    throw err;
  }
}

async function run() {
  console.log('--- Starting Comprehensive Commission Rates & Webhook Tests ---');
  const runKey = randomUUID().slice(0, 8);

  // Setup common entities
  const store = await prisma.store.create({
    data: { name: `Test Store ${runKey}` },
  });

  const adminUser = await prisma.user.create({
    data: {
      email: `admin-${runKey}@test.com`,
      password: 'hashed_password',
      role: 'ADMIN',
    },
  });

  // Employee with 0% configured rate
  const user0 = await prisma.user.create({
    data: { email: `emp0-${runKey}@test.com`, password: 'pw', role: 'EMPLOYEE' },
  });
  const emp0 = await prisma.employee.create({
    data: {
      userId: user0.id,
      employeeCode: `EMP0-${runKey}`,
      firstName: 'Zero',
      lastName: 'Rate',
      storeId: store.id,
      commissionPercentage: 0,
      status: 'active',
    },
  });

  // Employee with 1% configured rate
  const user1 = await prisma.user.create({
    data: { email: `emp1-${runKey}@test.com`, password: 'pw', role: 'EMPLOYEE' },
  });
  const emp1 = await prisma.employee.create({
    data: {
      userId: user1.id,
      employeeCode: `EMP1-${runKey}`,
      firstName: 'One',
      lastName: 'Percent',
      storeId: store.id,
      commissionPercentage: 1,
      status: 'active',
    },
  });

  // Employee with 2% configured rate
  const user2 = await prisma.user.create({
    data: { email: `emp2-${runKey}@test.com`, password: 'pw', role: 'EMPLOYEE' },
  });
  const emp2 = await prisma.employee.create({
    data: {
      userId: user2.id,
      employeeCode: `EMP2-${runKey}`,
      firstName: 'Two',
      lastName: 'Percent',
      storeId: store.id,
      commissionPercentage: 2,
      status: 'active',
    },
  });

  // Employee with NO rate configured (null)
  const userNull = await prisma.user.create({
    data: { email: `empnull-${runKey}@test.com`, password: 'pw', role: 'EMPLOYEE' },
  });
  const empNull = await prisma.employee.create({
    data: {
      userId: userNull.id,
      employeeCode: `EMPNULL-${runKey}`,
      firstName: 'No',
      lastName: 'Config',
      storeId: store.id,
      commissionPercentage: null,
      status: 'active',
    },
  });

  // Subcategories with 1% and 2% rates
  const sub1 = await prisma.hrmCommissionSubcategory.create({
    data: { externalId: `sub1-${runKey}`, name: `Sub 1% ${runKey}` },
  });
  await prisma.hrmCommissionRate.create({
    data: {
      subcategoryId: sub1.id,
      rate: 1,
      type: 'PERCENTAGE',
      basis: 'NET_EX_TAX',
      fixedBasis: 'UNIT',
      effectiveFrom: new Date('2026-01-01T00:00:00+05:30'),
      createdBy: adminUser.id,
    },
  });

  const sub2 = await prisma.hrmCommissionSubcategory.create({
    data: { externalId: `sub2-${runKey}`, name: `Sub 2% ${runKey}` },
  });
  await prisma.hrmCommissionRate.create({
    data: {
      subcategoryId: sub2.id,
      rate: 2,
      type: 'PERCENTAGE',
      basis: 'NET_EX_TAX',
      fixedBasis: 'UNIT',
      effectiveFrom: new Date('2026-01-01T00:00:00+05:30'),
      createdBy: adminUser.id,
    },
  });

  const sub0 = await prisma.hrmCommissionSubcategory.create({
    data: { externalId: `sub0-${runKey}`, name: `Sub 0% ${runKey}` },
  });
  await prisma.hrmCommissionRate.create({
    data: {
      subcategoryId: sub0.id,
      rate: 0,
      type: 'PERCENTAGE',
      basis: 'NET_EX_TAX',
      fixedBasis: 'UNIT',
      effectiveFrom: new Date('2026-01-01T00:00:00+05:30'),
      createdBy: adminUser.id,
    },
  });

  // Helper for mock webhook payload
  const makePayload = (billId: string, empCode: string, lineItems: any[], netAmount = 1000) => ({
    eventType: 'INVOICE_CREATED',
    data: {
      invoice: {
        billId,
        invoiceId: billId,
        billNumber: billId,
        invoiceNumber: billId,
        invoiceNo: billId,
        invoiceDate: '2026-10-26T10:00:00.000Z',
        storeId: store.id,
        netAmount,
        lineItems,
      },
    },
  });

  const findTx = (billId: string, employeeId: number) =>
    prisma.commissionTransaction.findFirst({
      where: {
        employeeId,
        OR: [{ billId }, { billId: `HWM-${billId}` }, { invoiceNumber: `HWM-${billId}` }, { invoiceNumber: billId }],
      },
    });

  const countTx = (billId: string, employeeId: number) =>
    prisma.commissionTransaction.count({
      where: {
        employeeId,
        OR: [{ billId }, { billId: `HWM-${billId}` }, { invoiceNumber: `HWM-${billId}` }, { invoiceNumber: billId }],
      },
    });

  // TEST 1: Configured 1% commission rate via employee
  await test('1% commission rate via employee fallback applies correctly', async () => {
    const billId = `101-${runKey}`;
    const payload = makePayload(billId, emp1.employeeCode, [
      {
        lineItemId: 'item-1',
        productID: 'unknown-prod-1',
        productName: 'T-Shirt',
        quantity: 1,
        productNetAmount: 5000,
        employeeCode: emp1.employeeCode,
      },
    ], 5000);

    await processInvoiceCreated(payload, `evt-101-${runKey}`);

    const tx = await findTx(billId, emp1.id);
    assert.ok(tx, 'CommissionTransaction should be created');
    assert.equal(tx.status, 'APPROVED');
    assert.equal(tx.commissionPercent, 1, 'Commission rate should be 1%');
    assert.equal(tx.commissionAmount, 50, 'Commission amount should be 50 (1% of 5000)');
    assert.equal(hasUnresolvedInvoiceItems(tx), false);
  });

  // TEST 2: Configured 2% commission rate via subcategory
  await test('2% commission rate via verified subcategory applies correctly', async () => {
    const billId = `102-${runKey}`;
    const payload = makePayload(billId, empNull.employeeCode, [
      {
        lineItemId: 'item-2',
        productID: 'prod-sub2',
        productName: 'Shoes',
        subcategoryId: sub2.externalId,
        quantity: 1,
        netAmountExTax: 10000,
        productNetAmount: 10000,
        employeeCode: empNull.employeeCode,
      },
    ], 10000);

    await processInvoiceCreated(payload, `evt-102-${runKey}`);

    const tx = await findTx(billId, empNull.id);
    assert.ok(tx, 'CommissionTransaction should be created');
    assert.equal(tx.status, 'APPROVED');
    assert.equal(tx.commissionPercent, 2, 'Commission rate should be 2%');
    assert.equal(tx.commissionAmount, 200, 'Commission amount should be 200 (2% of 10000)');
    assert.equal(hasUnresolvedInvoiceItems(tx), false);
  });

  // TEST 3: Configured 0% commission rate (verified 0% configuration)
  await test('Verified configured 0% rate is preserved and not marked unresolved', async () => {
    const billId = `100-${runKey}`;
    const payload = makePayload(billId, emp0.employeeCode, [
      {
        lineItemId: 'item-0',
        productID: 'prod-sub0',
        productName: 'Cap',
        subcategoryId: sub0.externalId,
        quantity: 1,
        netAmountExTax: 2000,
        productNetAmount: 2000,
        employeeCode: emp0.employeeCode,
      },
    ], 2000);

    await processInvoiceCreated(payload, `evt-100-${runKey}`);

    const tx = await findTx(billId, emp0.id);
    assert.ok(tx, 'CommissionTransaction should be created');
    assert.equal(tx.status, 'APPROVED');
    assert.equal(tx.commissionPercent, 0, 'Commission rate should be 0%');
    assert.equal(tx.commissionAmount, 0, 'Commission amount should be 0');
    assert.equal(hasUnresolvedInvoiceItems(tx), false, 'Verified 0% should NOT be considered unresolved');
  });

  // TEST 4: Missing product mapping and missing employee/policy configuration
  await test('Missing configuration does NOT silently become 0%, remains null and PENDING', async () => {
    const billId = `104-${runKey}`;
    const payload = makePayload(billId, empNull.employeeCode, [
      {
        lineItemId: 'item-missing',
        productID: 'unknown-prod-missing',
        productName: 'Unmapped Item',
        quantity: 1,
        productNetAmount: 3000,
        employeeCode: empNull.employeeCode,
      },
    ], 3000);

    await processInvoiceCreated(payload, `evt-104-${runKey}`);

    const tx = await findTx(billId, empNull.id);
    assert.ok(tx, 'CommissionTransaction should be created');
    assert.equal(tx.status, 'PENDING', 'Status should be PENDING when configuration is missing');
    assert.equal(tx.commissionPercent, null, 'Commission rate should be null, NOT 0%');
    assert.equal(tx.commissionAmount, 0, 'Commission amount should be 0 pending review');
    assert.equal(hasUnresolvedInvoiceItems(tx), true, 'Should be flagged as hasUnresolvedInvoiceItems');
  });

  // TEST 5: Webhook retry / idempotency
  await test('Webhook retry is idempotent, produces no duplicate transactions or extra wallet adjustments', async () => {
    const billId = `105-${runKey}`;
    const payload = makePayload(billId, emp1.employeeCode, [
      {
        lineItemId: 'item-retry',
        productID: 'prod-sub1',
        productName: 'Jacket',
        subcategoryId: sub1.externalId,
        quantity: 1,
        netAmountExTax: 4000,
        productNetAmount: 4000,
        employeeCode: emp1.employeeCode,
      },
    ], 4000);

    // Initial creation
    await processInvoiceCreated(payload, `evt-105-1-${runKey}`);
    const txCountBefore = await countTx(billId, emp1.id);
    assert.equal(txCountBefore, 1);

    const initialWallet = await prisma.wallet.findFirst({
      where: { employeeId: emp1.id },
    });
    const balanceBefore = Number(initialWallet?.availableBalance || 0);

    // Retrying with same payload
    await processInvoiceCreated(payload, `evt-105-2-${runKey}`);

    const txCountAfter = await countTx(billId, emp1.id);
    assert.equal(txCountAfter, 1, 'Duplicate webhook must NOT create duplicate CommissionTransaction');

    const walletAfter = await prisma.wallet.findFirst({
      where: { employeeId: emp1.id },
    });
    const balanceAfter = Number(walletAfter?.availableBalance || 0);
    assert.equal(balanceAfter, balanceBefore, 'Retry must NOT issue extra commission balance');
  });

  // TEST 6: Preserving approved / paid records on webhook updates
  await test('Webhook update does not overwrite approved transactions with zero', async () => {
    const billId = `106-${runKey}`;
    const payload = makePayload(billId, emp2.employeeCode, [
      {
        lineItemId: 'item-appr',
        productID: 'prod-sub2',
        productName: 'Watch',
        subcategoryId: sub2.externalId,
        quantity: 1,
        netAmountExTax: 8000,
        productNetAmount: 8000,
        employeeCode: emp2.employeeCode,
      },
    ], 8000);

    await processInvoiceCreated(payload, `evt-106-1-${runKey}`);

    const tx = await findTx(billId, emp2.id);
    assert.ok(tx, 'Transaction should exist');
    assert.equal(tx.status, 'APPROVED');
    assert.equal(tx.commissionPercent, 2);
    assert.equal(tx.commissionAmount, 160);

    // Now send an update event with missing subcategory or missing mappings
    const updatePayload = makePayload(billId, emp2.employeeCode, [
      {
        lineItemId: 'item-appr',
        productID: 'unknown-after-edit',
        productName: 'Watch Edited',
        quantity: 1,
        netAmountExTax: 8000,
        productNetAmount: 8000,
        employeeCode: emp2.employeeCode,
      },
    ], 8000);
    updatePayload.eventType = 'INVOICE_UPDATED';

    await processInvoiceUpdated(updatePayload, `evt-106-2-${runKey}`);

    const txAfter = await prisma.commissionTransaction.findUniqueOrThrow({
      where: { id: tx.id },
    });
    assert.equal(txAfter.status, 'APPROVED', 'Approved transaction must retain status');
    assert.equal(txAfter.commissionPercent, 2, 'Approved rate must NOT be overwritten with zero or null');
    assert.equal(txAfter.commissionAmount, 160, 'Approved commission must NOT be overwritten');
  });

  // TEST 7: fetchCommissionWallet API returns null and not 0 for unconfigured transactions
  await test('fetchCommissionWallet reports null and hasUnresolvedInvoiceItems for missing config, actual rate for configured', async () => {
    let walletRes: any = null;
    const req: any = { user: { id: userNull.id, role: 'EMPLOYEE' } };
    const res: any = {
      status: (code: number) => res,
      json: (data: any) => { walletRes = data; },
    };

    await fetchCommissionWallet(req, res);
    assert.ok(walletRes && walletRes.success);
    const recent = walletRes.data.recentTransactions;
    assert.ok(recent.length > 0);

    const unconfiguredTx = recent.find((t: any) => t.hasUnresolvedInvoiceItems === true);
    assert.ok(unconfiguredTx, 'Should find unconfigured transaction in recent transactions');
    assert.equal(unconfiguredTx.commissionPercentage, null, 'Unconfigured commissionPercentage should be null, NOT 0');
    assert.equal(unconfiguredTx.commissionEarned, null, 'Unconfigured commissionEarned should be null');
    assert.equal(unconfiguredTx.rateDisplay, 'Configuration required');

    // Also check configured transaction for emp1
    let walletRes1: any = null;
    const req1: any = { user: { id: user1.id, role: 'EMPLOYEE' } };
    const res1: any = {
      status: (code: number) => res1,
      json: (data: any) => { walletRes1 = data; },
    };
    await fetchCommissionWallet(req1, res1);
    assert.ok(walletRes1 && walletRes1.success);
    const tx1 = walletRes1.data.recentTransactions.find((t: any) => t.billAmount === 5000);
    assert.ok(tx1, 'Should find 5000 bill transaction');
    assert.equal(tx1.commissionPercentage, 1, 'Configured commissionPercentage should be 1');
    assert.equal(tx1.commissionEarned, 50, 'Configured commissionEarned should be 50');
    assert.equal(tx1.hasUnresolvedInvoiceItems, false);
  });

  console.log(`\n========================================`);
  console.log(`All ${passed} Commission Tests Passed Successfully!`);
  console.log(`========================================\n`);
}

run()
  .catch((e) => {
    console.error('Test suite failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
