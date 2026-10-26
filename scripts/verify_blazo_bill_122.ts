import assert from 'node:assert/strict';
import express from 'express';
import { prisma } from '../src/utils/db';
import { mobileInvoiceDetail } from '../src/services/invoiceCommissionService';
import { getMobileCommissionBillDetail } from '../src/controllers/mobile/mobileCommissionController';

async function main() {
  console.log('=== Verifying Bill #122 BLAZO Commission ===');

  const salesmanUser = await prisma.user.findFirstOrThrow({
    where: { email: 'salesman123@hopkid.test' },
  });

  // Test 1: mobileInvoiceDetail with "122"
  const result122 = await mobileInvoiceDetail(salesmanUser.id, '122', 'EMPLOYEE');
  console.log('\n--- Result for bill "122" ---');
  console.log(JSON.stringify({
    billId: result122.billId,
    invoiceNumber: result122.invoiceNumber,
    saleAmount: result122.saleAmount,
    eligibleSaleAmount: result122.eligibleSaleAmount,
    commissionRate: result122.commissionRate,
    rateDisplay: result122.rateDisplay,
    commissionAmount: result122.commissionAmount,
    commissionSource: result122.commissionSource,
    commissionState: result122.commissionState,
    hasMissingConfiguration: result122.hasMissingConfiguration,
    productBreakdown: result122.productCommissionBreakdown,
  }, null, 2));

  assert.equal(result122.commissionAmount, 94.75, 'Commission amount must be 94.75');
  assert.equal(result122.commissionRate, 5, 'Commission rate must be 5');
  assert.equal(result122.rateDisplay, '5%', 'Rate display must be 5%');
  assert.equal(result122.eligibleSaleAmount, 1895, 'Eligible sale amount must be 1895');
  assert.equal(result122.hasMissingConfiguration, false, 'hasMissingConfiguration must be false');
  assert.equal(result122.productCommissionBreakdown.length, 1, 'Must have 1 product breakdown line');
  assert.equal(result122.productCommissionBreakdown[0].productName, 'BLAZO', 'Product name must be BLAZO');
  assert.equal(result122.productCommissionBreakdown[0].subcategoryName, 'Designer Denim', 'Subcategory must be Designer Denim');
  assert.equal(result122.productCommissionBreakdown[0].commissionRate, 5, 'Line rate must be 5');
  assert.equal(result122.productCommissionBreakdown[0].commissionAmount, 94.75, 'Line commission must be 94.75');
  assert.equal(result122.productCommissionBreakdown[0].configurationMessage, null, 'Warning must be null');
  console.log('PASS: Bill "122" assertions passed');

  // Test 2: mobileInvoiceDetail with "HWM-122"
  const resultHwm122 = await mobileInvoiceDetail(salesmanUser.id, 'HWM-122', 'EMPLOYEE');
  assert.equal(resultHwm122.commissionAmount, 94.75);
  assert.equal(resultHwm122.productCommissionBreakdown[0].subcategoryName, 'Designer Denim');
  console.log('PASS: Bill "HWM-122" assertions passed');

  // Test 3: Express API GET /api/mobile/commission/bill/122
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: salesmanUser.id, role: 'EMPLOYEE' };
    next();
  });
  app.get('/api/mobile/commission/bill/:billId', getMobileCommissionBillDetail);

  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/mobile/commission/bill/122`);
    assert.equal(resp.status, 200);
    const body: any = await resp.json();
    assert.equal(body.success, true);
    assert.equal(body.data.commissionAmount, 94.75);
    assert.equal(body.data.productCommissionBreakdown[0].subcategoryName, 'Designer Denim');
    assert.equal(body.data.productCommissionBreakdown[0].commissionAmount, 94.75);
    assert.equal(body.data.productCommissionBreakdown[0].commissionRate, 5);
    console.log('PASS: Express API GET /api/mobile/commission/bill/122 passed');

    // Test 4: Unmapped product behavior
    const unmappedResp = await fetch(`http://127.0.0.1:${port}/api/mobile/commission/bill/HWM-999-UNMAPPED`);
    if (unmappedResp.status === 200) {
      const unmappedBody: any = await unmappedResp.json();
      console.log('\n--- Unmapped product result ---');
      console.log(JSON.stringify({
        commissionAmount: unmappedBody.data.commissionAmount,
        commissionRate: unmappedBody.data.commissionRate,
        hasMissingConfiguration: unmappedBody.data.hasMissingConfiguration,
        configurationMessage: unmappedBody.data.productCommissionBreakdown?.[0]?.configurationMessage,
      }, null, 2));
      assert.equal(unmappedBody.data.commissionAmount, null, 'Unmapped product must not invent commission');
      assert.equal(unmappedBody.data.hasMissingConfiguration, true, 'hasMissingConfiguration must be true');
      console.log('PASS: Unmapped product correctly returns MISSING_CONFIGURATION without inventing commission');
    }
  } finally {
    server.close();
  }

  console.log('\n=== All BLAZO Bill #122 Verification Checks Passed! ===');
}

main()
  .catch((e) => {
    console.error('Verification failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
