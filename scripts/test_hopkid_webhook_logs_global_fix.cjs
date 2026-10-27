// Global HopKid Webhook Activity & Invoice Details Regression Test
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');

const { Prisma } = require('@prisma/client');

const mockHopkidRaw = {
  eventType: 'INVOICE_CREATED',
  eventId: 'evt-hopkid-test-101',
  data: {
    invoice: {
      invoiceId: '130',
      invoiceNo: '130',
      invoiceNumber: 'HWM-130',
      generatedDate: '2026-10-15 14:30:00', // Naive date/time without offset -> resolves to Asia/Kolkata
      storeId: 1,
      netAmount: 1499,
      lineItems: [
        {
          saleItemId: 'item-1',
          productId: 'prod-toys-1',
          name: 'Action Figure',
          productNetAmount: 1499,
          quantity: 1,
          employeeCode: 'HK_SELLER_01',
          subcategoryName: 'Toys',
        }
      ]
    }
  }
};

const mockSubcategory = {
  id: 'a0000000-0000-0000-0000-000000000001',
  externalId: 'sub-toys',
  name: 'Toys',
  categoryExternalId: 'cat-toys'
};

const mockRate = {
  id: 'r0000000-0000-0000-0000-000000000001',
  subcategoryId: 'a0000000-0000-0000-0000-000000000001',
  storeKey: 0,
  type: 'PERCENTAGE',
  rate: new Prisma.Decimal('1'),
  basis: 'NET_EX_TAX',
  fixedBasis: 'UNIT',
  isActive: true,
  effectiveFrom: new Date('2026-01-01T00:00:00Z')
};

const mockEmployee = {
  id: 42,
  employeeCode: 'HK_SELLER_01',
  mobileNumber: '9876543210',
  firstName: 'Arun',
  lastName: 'Kumar',
  storeId: 1,
  branchId: 1,
};

const db = {
  employee: {
    findFirst: async () => mockEmployee,
    findUnique: async () => mockEmployee,
  },
  creditNoteLine: { findMany: async () => [] },
  commissionTransaction: {
    findMany: async () => [],
    findFirst: async () => null,
  },
  webhookLog: { findMany: async () => [] },
  hopkidWebhookLog: {
    findMany: async () => [
      {
        id: 'hlog-130',
        billId: '130',
        storeId: 1,
        amount: 1499,
        rawPayload: JSON.stringify(mockHopkidRaw),
        createdAt: new Date('2026-10-15T09:00:00Z')
      }
    ]
  },
  store: {
    findUnique: async () => ({ id: 1, name: 'HopKid Main Store' }),
    findMany: async () => [{ id: 1, name: 'HopKid Main Store' }]
  },
  branch: {
    findUnique: async () => ({ id: 1, name: 'HopKid Main Store' }),
    findFirst: async () => ({ id: 1, name: 'HopKid Main Store' })
  },
  hrmCommissionSubcategory: {
    findFirst: async () => mockSubcategory,
    findUnique: async () => mockSubcategory,
    findMany: async () => [mockSubcategory]
  },
  hrmCommissionRate: {
    findMany: async () => [mockRate]
  },
  hrmCommissionMapping: {
    findFirst: async () => null
  },
  pOSProduct: {
    findUnique: async () => null,
    findMany: async () => []
  },
  hrmCommissionSettings: {
    findUnique: async () => ({ id: 1, netField: 'productNetAmount', netBasis: 'NET_EX_TAX', discounted: false })
  },
  hrmCommissionDocument: {
    findMany: async () => []
  },
  hrmCommissionLine: {
    findMany: async () => []
  },
  systemSetting: {
    findUnique: async () => null
  }
};

require.cache[require.resolve('../src/utils/db')] = { exports: { prisma: db } };
const { getMobileWebhookLogs } = require('../src/controllers/mobile/mobileCommissionController');

(async () => {
  console.log('--- Test: Webhook Activity Logs on-the-fly subcategory calculation ---');
  let result;
  await getMobileWebhookLogs(
    { user: { id: 42 }, query: { limit: '10' } },
    {
      json: data => { result = data; },
      status: code => { throw new Error(`HTTP ${code}`); }
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.length, 1);
  const item = result.data[0];
  console.log('Result item from getMobileWebhookLogs:', item);

  // 1. Delivery status and status must be SUCCESS
  assert.equal(item.deliveryStatus, 'SUCCESS', 'deliveryStatus should be SUCCESS');
  assert.equal(item.status, 'SUCCESS', 'status should be SUCCESS');

  // 2. Approval status must be PENDING (not conflated with delivery status)
  assert.equal(item.approvalStatus, 'PENDING', 'approvalStatus should be PENDING');

  // 3. Commission status must be COMPLETE (genuine calculation)
  assert.equal(item.commissionState, 'COMPLETE', 'commissionState should be COMPLETE');
  assert.equal(item.commissionStatus, 'COMPLETE', 'commissionStatus should be COMPLETE');

  // 4. Commission amount must be calculated from 1% of 1499 = 14.99
  assert.equal(item.commissionAmount, 14.99, 'commissionAmount should be 14.99');
  assert.equal(item.commissionEarned, 14.99, 'commissionEarned should be 14.99');
  assert.equal(item.totalCommission, 14.99, 'totalCommission should be 14.99');

  // 5. Commission rate must be 1%
  assert.equal(item.commissionRate, 1, 'commissionRate should be 1');
  assert.equal(item.commissionPercent, 1, 'commissionPercent should be 1');
  assert.equal(item.commissionPercentage, 1, 'commissionPercentage should be 1');
  assert.equal(item.rateDisplay, '1%', 'rateDisplay should be 1%');

  // 6. Missing flags must be false
  assert.equal(item.hasMissingInvoiceData, false, 'hasMissingInvoiceData should be false');
  assert.equal(item.hasMissingConfiguration, false, 'hasMissingConfiguration should be false');
  assert.equal(item.hasUnresolvedInvoiceItems, false, 'hasUnresolvedInvoiceItems should be false');

  console.log('✅ Webhook activity on-the-fly subcategory commission calculation PASSED!');
  console.log('Response item:', JSON.stringify({
    billId: item.billId,
    invoiceNo: item.invoiceNo,
    deliveryStatus: item.deliveryStatus,
    approvalStatus: item.approvalStatus,
    commissionStatus: item.commissionStatus,
    commissionAmount: item.commissionAmount,
    commissionRate: item.commissionRate,
    rateDisplay: item.rateDisplay
  }, null, 2));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
