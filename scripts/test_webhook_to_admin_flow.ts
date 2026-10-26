import { prisma } from '../src/utils/db';
import { processInvoiceCreated } from '../src/controllers/webhookController';
import { getCommissionTransactions, getCommissionDashboard } from '../src/controllers/commissionController';
import { mobileInvoiceDetail } from '../src/services/invoiceCommissionService';
import assert from 'assert';

async function runEndToEndTest() {
  console.log('🚀 [Test] Starting End-to-End Webhook to Admin Panel Flow Test...\n');

  const testBillId = '888';
  const testInvoiceNo = `HWM-${testBillId}`;

  // Clean up any previous test leftovers
  await prisma.commissionTransaction.deleteMany({ where: { OR: [{ billId: testBillId }, { billId: testInvoiceNo }, { invoiceNumber: testInvoiceNo }] } }).catch(() => {});
  await prisma.webhookLog.deleteMany({ where: { OR: [{ billId: testBillId }, { billId: testInvoiceNo }] } }).catch(() => {});
  await prisma.hopkidWebhookLog.deleteMany({ where: { OR: [{ billId: testBillId }, { billId: testInvoiceNo }] } }).catch(() => {});

  // 1. Prepare webhook payload for Bill HWM-888 with BLAZO (5% = ₹94.75)
  const webhookPayload = {
    eventId: `evt-test-wb-${Date.now()}`,
    eventType: 'INVOICE_CREATED',
    billId: testBillId,
    invoiceNumber: testInvoiceNo,
    amount: 1895,
    date: new Date().toISOString(),
    storeId: 142,
    branchName: 'HOPKID-AMD-CG-ROAD',
    employeeIdentifier: 'EMP-123',
    lineItems: [
      {
        saleItemId: `line-${Date.now()}`,
        productID: 'bebc71a3-a939-4669-b03d-a058ea3c6732',
        productName: 'BLAZO',
        variant: '10/D.BLUE',
        sku: '10/D.BLUE',
        quantity: 1,
        netAmount: 1895,
        saleAmount: 1895,
        productNetAmount: 1895,
        netAmountExTax: 1895,
        employeeCode: 'EMP-123',
        employeeName: 'Hemanshi Rana',
      }
    ]
  };

  console.log('1️⃣ Submitting Webhook Payload for Bill:', testInvoiceNo);
  await processInvoiceCreated(webhookPayload, webhookPayload.eventId);

  // 2. Verify database persistence in CommissionTransaction
  const savedTx = await prisma.commissionTransaction.findFirst({
    where: { billId: testInvoiceNo },
    include: { employee: true, store: true }
  });

  assert(savedTx, '❌ CommissionTransaction record was not created!');
  console.log('✅ CommissionTransaction created successfully:');
  console.log({
    id: savedTx.id,
    billId: savedTx.billId,
    invoiceNumber: savedTx.invoiceNumber,
    employeeId: savedTx.employeeId,
    employeeName: `${savedTx.employee.firstName} ${savedTx.employee.lastName}`,
    saleAmount: savedTx.saleAmount,
    commissionAmount: savedTx.commissionAmount,
    status: savedTx.status,
    productBreakdown: savedTx.productBreakdown
  });

  assert.strictEqual(savedTx.saleAmount, 1895, 'Sale amount mismatch');
  assert.strictEqual(savedTx.commissionAmount, 94.75, 'Commission amount mismatch');
  assert.strictEqual(savedTx.status, 'APPROVED', 'Status should be APPROVED');
  assert.strictEqual(savedTx.employeeId, 121, 'Employee should be 121 (Hemanshi Rana)');

  // 3. Test Admin Commission Transactions API
  console.log('\n2️⃣ Testing Admin Commission Transactions API...');
  let adminTxResponse: any = null;
  const mockReqAdmin: any = {
    user: { id: 89, role: 'ADMIN' },
    query: { billId: testBillId, page: 1, pageSize: 20 }
  };
  const mockResAdmin: any = {
    json: (data: any) => { adminTxResponse = data; }
  };

  await getCommissionTransactions(mockReqAdmin, mockResAdmin);

  assert(adminTxResponse?.success, 'Admin transactions API failed');
  assert(adminTxResponse.transactions?.length > 0, 'Test bill not found in admin transactions');
  const adminTx = adminTxResponse.transactions[0];

  console.log('✅ Found bill in Admin API response:');
  console.log({
    billId: adminTx.billId,
    invoiceNumber: adminTx.invoiceNumber,
    employeeName: `${adminTx.employee?.firstName} ${adminTx.employee?.lastName}`,
    storeName: adminTx.storeName,
    subcategoryName: adminTx.subcategoryName,
    rate: adminTx.rate,
    saleAmount: adminTx.saleAmount,
    commissionAmount: adminTx.commissionAmount,
    status: adminTx.status,
  });

  assert.strictEqual(adminTx.commissionAmount, 94.75, 'Admin API commission amount mismatch');
  assert.strictEqual(adminTx.subcategoryName, 'Designer Denim', 'Subcategory should be Designer Denim');
  assert(adminTxResponse.pagination?.total >= 1, 'Pagination total should be >= 1');
  assert(adminTxResponse.totals?.commissionAmount > 0, 'Totals commission should be > 0');

  // 4. Test Admin Commission Dashboard API
  console.log('\n3️⃣ Testing Admin Commission Dashboard API...');
  let adminDashResponse: any = null;
  const mockDashReq: any = {
    user: { id: 89, role: 'ADMIN' },
    query: { dateRange: 'today' }
  };
  const mockDashRes: any = {
    json: (data: any) => { adminDashResponse = data; }
  };

  await getCommissionDashboard(mockDashReq, mockDashRes);

  assert(adminDashResponse?.success, 'Admin dashboard API failed');
  assert(adminDashResponse.stats, 'Dashboard stats missing');
  console.log('✅ Admin Dashboard stats verified:');
  console.log('Today Stats:', adminDashResponse.stats.today);
  console.log('Month Stats:', adminDashResponse.stats.month);
  console.log('Top Subcategories:', adminDashResponse.stats.topSubcategories);

  assert(adminDashResponse.stats.today.commission > 0, 'Today commission should be > 0');
  assert(adminDashResponse.stats.topSubcategories.length > 0, 'Top subcategories should not be empty');

  // 5. Test Mobile Commission API Parity
  console.log('\n4️⃣ Testing Mobile Commission API Parity...');
  const mobileRes = await mobileInvoiceDetail(150, testBillId, 'EMPLOYEE');

  console.log('✅ Mobile API response:');
  console.log({
    invoiceNumber: mobileRes.invoiceNumber,
    saleAmount: mobileRes.saleAmount,
    commissionAmount: mobileRes.commissionAmount,
    commissionRate: mobileRes.commissionRate,
    rateDisplay: mobileRes.rateDisplay,
    status: mobileRes.status,
    hasMissingConfiguration: mobileRes.hasMissingConfiguration,
    productBreakdown: mobileRes.productCommissionBreakdown
  });

  assert.strictEqual(mobileRes.commissionAmount, adminTx.commissionAmount, 'Mobile and Admin commission amounts must match');
  assert.strictEqual(mobileRes.status, adminTx.status, 'Mobile and Admin statuses must match');
  assert.strictEqual(mobileRes.hasMissingConfiguration, false, 'hasMissingConfiguration should be false');

  // 6. Test Webhook Idempotency (re-processing should not create duplicate or change amounts)
  console.log('\n5️⃣ Testing Webhook Idempotency...');
  const initialCount = await prisma.commissionTransaction.count({ where: { billId: testInvoiceNo } });
  await processInvoiceCreated(webhookPayload, webhookPayload.eventId);
  const afterRetryCount = await prisma.commissionTransaction.count({ where: { billId: testInvoiceNo } });

  assert.strictEqual(initialCount, afterRetryCount, 'Duplicate CommissionTransaction was created on retry!');
  const txAfterRetry = await prisma.commissionTransaction.findFirst({ where: { billId: testInvoiceNo } });
  assert.strictEqual(txAfterRetry?.commissionAmount, 94.75, 'Commission amount changed on retry!');
  console.log('✅ Idempotency verified: 1 record exists, amounts unchanged.');

  // Clean up test records
  await prisma.commissionTransaction.deleteMany({ where: { billId: testInvoiceNo } }).catch(() => {});
  await prisma.webhookLog.deleteMany({ where: { billId: testInvoiceNo } }).catch(() => {});
  await prisma.hopkidWebhookLog.deleteMany({ where: { billId: testInvoiceNo } }).catch(() => {});

  console.log('\n🎉 ALL 5 STEPS PASSED SUCCESSFULLY! End-to-end webhook to admin flow is fully functional.\n');
}

runEndToEndTest()
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
