// Comprehensive isolated contract test for HopKid commission rate mapping and calculation
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');

// Simulated database fixtures
const stores = [
  { id: 10, name: 'HopKid Main Store', code: 'HK-MAIN' },
  { id: 20, name: 'HopKid Second Branch', code: 'HK-BRANCH2' }
];
const branches = [
  { id: 101, name: 'HopKid Main Store' },
  { id: 102, name: 'HopKid Second Branch' }
];
const subcategories = [
  { id: '11111111-1111-4111-a111-111111111111', externalId: 'ext-toys', name: 'Toys', categoryExternalId: 'cat-toys' },
  { id: '22222222-2222-4222-a222-222222222222', externalId: 'ext-apparel', name: 'Apparel', categoryExternalId: 'cat-apparel' },
  { id: '33333333-3333-4333-a333-333333333333', externalId: 'ext-footwear', name: 'Footwear', categoryExternalId: 'cat-footwear' }
];
const rates = [
  // Sub-toys: 1% commission (dynamic configured rate)
  { id: 'rate-toys', subcategoryId: '11111111-1111-4111-a111-111111111111', storeKey: 0, type: 'PERCENTAGE', rate: new Prisma.Decimal('1'), basis: 'NET_EX_TAX', fixedBasis: 'UNIT', effectiveFrom: new Date('2025-01-01'), isActive: true },
  // Sub-apparel: 2.5% commission
  { id: 'rate-apparel', subcategoryId: '22222222-2222-4222-a222-222222222222', storeKey: 0, type: 'PERCENTAGE', rate: new Prisma.Decimal('2.5'), basis: 'NET_EX_TAX', fixedBasis: 'UNIT', effectiveFrom: new Date('2025-01-01'), isActive: true },
  // Sub-footwear: 5% commission
  { id: 'rate-footwear', subcategoryId: '33333333-3333-4333-a333-333333333333', storeKey: 0, type: 'PERCENTAGE', rate: new Prisma.Decimal('5'), basis: 'NET_EX_TAX', fixedBasis: 'UNIT', effectiveFrom: new Date('2025-01-01'), isActive: true }
];
const mappings = [
  { id: 'map-p1', productId: 'prod-action-figure', variantId: '', subcategoryId: '11111111-1111-4111-a111-111111111111', effectiveFrom: new Date('2025-01-01') }
];
const posProducts = [
  { id: 'c78b3294-8134-4a27-a006-25f05353164a', code: 'PROD-SHOES-01', name: 'Kids Sneakers', categoryId: '33333333-3333-4333-a333-333333333333', category: { id: '33333333-3333-4333-a333-333333333333', name: 'Footwear', externalCommissionCategoryId: 'ext-footwear' }, updatedAt: new Date('2025-01-01'), createdAt: new Date('2026-10-01') }
];

let txUpdateWrites = 0;
const tx = {
  store: {
    findUnique: async ({ where }) => stores.find(s => s.id === where.id) || null,
    findMany: async ({ where }) => stores.filter(s => where.code ? s.code === where.code : s.name.toLowerCase() === where.name.equals.toLowerCase())
  },
  branch: {
    findUnique: async ({ where }) => branches.find(b => b.id === where.id) || null,
    findFirst: async ({ where }) => branches.find(b => b.name.toLowerCase() === where.name.equals.toLowerCase()) || null
  },
  employee: {
    findUnique: async () => ({ id: 50, employeeCode: 'HK_EMP', firstName: 'Seller', lastName: 'One', storeId: null, branchId: 101, commissionPolicies: [] }),
    findFirst: async () => ({ id: 50, userId: 1, employeeCode: 'HK_EMP', firstName: 'Seller', lastName: 'One', storeId: null, branchId: 101, store: null, branch: { id: 101, name: 'HopKid Main Store' }, commissionPolicies: [] })
  },
  commissionTransaction: {
    count: async () => 0,
    findMany: async () => [],
    findFirst: async () => null,
    update: async () => { txUpdateWrites++; }
  },
  webhookLog: { findMany: async () => [], findFirst: async () => null },
  hopkidWebhookLog: { findMany: async () => [], findFirst: async () => null },
  pOSSale: { findMany: async () => [] },
  pOSProduct: {
    findUnique: async ({ where }) => posProducts.find(p => (where.id && p.id === where.id) || (where.code && p.code === where.code)) || null,
    findMany: async ({ where }) => {
      if (where?.id?.in) return posProducts.filter(p => where.id.in.includes(p.id));
      if (where?.externalCommissionProductId) return posProducts.filter(p => p.externalCommissionProductId === where.externalCommissionProductId);
      return posProducts;
    }
  },
  pOSProductVariant: { findMany: async () => [] },
  hrmCommissionDocument: { findFirst: async () => null, findMany: async () => [] },
  hrmCommissionSettings: { findUnique: async () => null },
  hrmCommissionSubcategory: {
    findUnique: async ({ where }) => subcategories.find(s => (where.externalId && s.externalId === where.externalId) || (where.id && s.id === where.id)) || null,
    findFirst: async ({ where }) => subcategories.find(s => where.name && s.name.toLowerCase() === where.name.equals.toLowerCase()) || null,
    findMany: async ({ where }) => {
      if (where.OR) {
        return subcategories.filter(s => {
          const extIn = where.OR.find(o => o.externalId)?.externalId?.in || [];
          const idIn = where.OR.find(o => o.id)?.id?.in || [];
          return extIn.includes(s.externalId) || idIn.includes(s.id);
        });
      }
      if (where.externalId?.in) return subcategories.filter(s => where.externalId.in.includes(s.externalId));
      if (where.name?.equals) return subcategories.filter(s => s.name.toLowerCase() === where.name.equals.toLowerCase());
      return subcategories;
    }
  },
  hrmCommissionMapping: {
    findFirst: async ({ where }) => mappings.find(m => m.productId === where.productId && m.variantId === where.variantId) || null
  },
  hrmCommissionRate: {
    findMany: async ({ where }) => rates.filter(r => r.subcategoryId === where.subcategoryId && [0, where.storeKey?.in?.[1]].includes(r.storeKey))
  }
};

require.cache[require.resolve('../src/utils/db')] = { exports: { prisma: tx } };
const { resolveInvoiceStore, calculateInvoiceCommission } = require('../src/services/invoiceCommissionService');
const { recordedInvoiceCommission } = require('../src/services/recordedInvoiceCommission');

async function runTests() {
  console.log('--- Test 1: Resolve STORE_ID_MISSING using HopKid branch/store mapping ---');
  // 1a: branchId 101 maps to Store 'HopKid Main Store' (id: 10)
  const resolvedFromBranch = await resolveInvoiceStore(tx, { meta: { branchId: 101 } });
  assert.equal(resolvedFromBranch, 10, 'branchId 101 must resolve to Store 10 via branch name');

  // 1b: storeId 101 (when HopKid sends branchId as storeId) maps via branch -> store
  const resolvedFromStoreAsBranch = await resolveInvoiceStore(tx, { meta: { storeId: 101 } });
  assert.equal(resolvedFromStoreAsBranch, 10, 'storeId 101 (branch id) must resolve to Store 10');

  // 1c: branchName 'HopKid Main Store' maps to Store 10
  const resolvedFromName = await resolveInvoiceStore(tx, { meta: { branchName: 'HopKid Main Store' } });
  assert.equal(resolvedFromName, 10, 'branchName must resolve to Store 10');

  // 1d: employee's branch maps to Store 10 when invoice metadata is empty
  const sellerEmployee = { id: 50, branchId: 101 };
  const resolvedFromEmp = await resolveInvoiceStore(tx, { meta: {}, employee: sellerEmployee });
  assert.equal(resolvedFromEmp, 10, 'Employee branch must resolve to Store 10');

  console.log('--- Test 2: Identify each invoice product actual subcategory and configured rate ---');
  // Single product invoice with 1% rate (Toys)
  const linesToys = [
    {
      productID: 'prod-action-figure',
      subcategoryId: 'ext-toys',
      subcategoryName: 'Toys',
      quantity: 2,
      netAmountExTax: 1000,
      employeeCode: 'HK_EMP'
    }
  ];
  const invoicePayloadToys = {
    eventType: 'INVOICE_CREATED',
    data: {
      invoice: {
        invoiceId: 'INV-1001',
        invoiceNo: 'HWM-1001',
        invoiceDate: '2026-10-01',
        storeId: 10,
        netAmount: 1000,
        lineItems: linesToys
      }
    }
  };

  const calcToys = await calculateInvoiceCommission(tx, null, invoicePayloadToys, {
    storeId: 10,
    at: new Date('2026-10-01'),
    reference: 'HWM-1001'
  });

  assert.equal(calcToys.commissionState, 'COMPLETE');
  assert.equal(calcToys.commissionRate, 1, 'Dynamic commissionRate must be 1 (from configured 1% rate)');
  assert.equal(calcToys.commissionPercent, 1, 'Dynamic commissionPercent must be 1');
  assert.equal(calcToys.commissionPercentage, 1, 'Dynamic commissionPercentage must be 1');
  assert.equal(calcToys.rateDisplay, '1%', 'rateDisplay must be 1%');
  assert.equal(calcToys.commissionAmount, 10, 'commissionAmount for 1000 at 1% must be 10');
  assert.equal(calcToys.commissionEarned, 10, 'commissionEarned must be 10');
  assert.equal(calcToys.productCommissionBreakdown[0].subcategoryId, '11111111-1111-4111-a111-111111111111');
  assert.equal(calcToys.productCommissionBreakdown[0].subcategoryName, 'Toys');
  assert.equal(calcToys.productCommissionBreakdown[0].commissionRate, 1);
  assert.equal(calcToys.productCommissionBreakdown[0].commissionAmount, 10);

  console.log('--- Test 3: Subcategory identified via POSProduct Category link (Sneakers -> Footwear 5%) ---');
  const linesFootwear = [
    {
      productID: 'c78b3294-8134-4a27-a006-25f05353164a',
      quantity: 1,
      netAmountExTax: 2000,
      employeeCode: 'HK_EMP'
    }
  ];
  const invoicePayloadFootwear = {
    eventType: 'INVOICE_CREATED',
    data: {
      invoice: {
        invoiceId: 'INV-1002',
        invoiceNo: 'HWM-1002',
        invoiceDate: '2026-10-01',
        storeId: 10,
        netAmount: 2000,
        lineItems: linesFootwear
      }
    }
  };

  const calcFootwear = await calculateInvoiceCommission(tx, null, invoicePayloadFootwear, {
    storeId: 10,
    at: new Date('2026-10-01'),
    reference: 'HWM-1002'
  });

  console.log('DEBUG calcFootwear:', JSON.stringify(calcFootwear, null, 2));
  assert.equal(calcFootwear.commissionState, 'COMPLETE');
  assert.equal(calcFootwear.commissionRate, 5, 'Footwear rate must dynamically resolve to 5%');
  assert.equal(calcFootwear.rateDisplay, '5%');
  assert.equal(calcFootwear.commissionAmount, 100, '5% of 2000 = 100');

  console.log('--- Test 4: Mixed subcategories with different rates (1% and 2.5%) ---');
  const mixedLines = [
    {
      productID: 'prod-action-figure',
      subcategoryId: 'ext-toys',
      subcategoryName: 'Toys',
      quantity: 1,
      netAmountExTax: 1000,
      employeeCode: 'HK_EMP'
    },
    {
      productID: 'prod-apparel-shirt',
      subcategoryName: 'Apparel',
      quantity: 1,
      netAmountExTax: 2000,
      employeeCode: 'HK_EMP'
    }
  ];
  const invoicePayloadMixed = {
    eventType: 'INVOICE_CREATED',
    data: {
      invoice: {
        invoiceId: 'INV-1003',
        invoiceNo: 'HWM-1003',
        invoiceDate: '2026-10-01',
        storeId: 10,
        netAmount: 3000,
        lineItems: mixedLines
      }
    }
  };

  const calcMixed = await calculateInvoiceCommission(tx, null, invoicePayloadMixed, {
    storeId: 10,
    at: new Date('2026-10-01'),
    reference: 'HWM-1003'
  });

  assert.equal(calcMixed.commissionState, 'COMPLETE');
  assert.equal(calcMixed.commissionRate, null, 'Invoice-level rate must be null for mixed rates');
  assert.equal(calcMixed.commissionPercent, null, 'Invoice-level percent must be null for mixed rates');
  assert.equal(calcMixed.commissionPercentage, null, 'Invoice-level percentage must be null for mixed rates');
  assert.equal(calcMixed.rateDisplay, 'Multiple subcategory rates', 'rateDisplay must indicate multiple rates');
  // Line 1: 1% of 1000 = 10
  assert.equal(calcMixed.productCommissionBreakdown[0].commissionRate, 1);
  assert.equal(calcMixed.productCommissionBreakdown[0].commissionAmount, 10);
  // Line 2: 2.5% of 2000 = 50
  assert.equal(calcMixed.productCommissionBreakdown[1].commissionRate, 2.5);
  assert.equal(calcMixed.productCommissionBreakdown[1].commissionAmount, 50);
  // Total commission: 10 + 50 = 60
  assert.equal(calcMixed.commissionAmount, 60);
  assert.equal(calcMixed.commissionEarned, 60);

  console.log('--- Test 5: recordedInvoiceCommission projections ---');
  // Uniform 1% transaction
  const projToys = recordedInvoiceCommission({
    commissionAmount: 10,
    status: 'PENDING',
    productBreakdown: calcToys.productCommissionBreakdown
  });
  assert.equal(projToys.commissionRate, 1);
  assert.equal(projToys.commissionAmount, 10);
  assert.equal(projToys.rateDisplay, '1%');
  assert.equal(projToys.commissionState, 'COMPLETE');

  // Mixed rates transaction
  const projMixed = recordedInvoiceCommission({
    commissionAmount: 60,
    status: 'PENDING',
    productBreakdown: calcMixed.productCommissionBreakdown
  });
  assert.equal(projMixed.commissionRate, null);
  assert.equal(projMixed.commissionAmount, 60);
  assert.equal(projMixed.rateDisplay, 'Multiple subcategory rates');
  assert.equal(projMixed.commissionState, 'COMPLETE');

  console.log('--- Test 6: Bill #133 SALE_DATE_TIMEZONE_REQUIRED resolution ---');
  // Bill #133 sent a generatedDate / invoiceDate without timezone offset
  const bill133Payload = {
    eventType: 'INVOICE_CREATED',
    data: {
      invoice: {
        invoiceId: '133',
        generatedDate: '2026-10-15 14:30:00',
        storeId: 10,
        lineItems: [
          {
            productID: 'prod-action-figure',
            quantity: 1,
            netAmountExTax: 1000
          }
        ]
      }
    }
  };
  const calc133 = await calculateInvoiceCommission(tx, null, bill133Payload, {
    storeId: 10,
    at: new Date('2026-10-15T14:30:00+05:30'),
    reference: '133'
  });
  assert.equal(calc133.commissionState, 'COMPLETE');
  assert.equal(calc133.commissionAmount, 10);
  assert.equal(calc133.rateDisplay, '1%');
  assert.equal(calc133.hasMissingInvoiceData, false);

  console.log('--- Test 7: Bills #130, #131, #132 STORE_ID_MISSING resolution ---');
  // Invoices 130, 131, 132 where store is mapped via branch or HopKid log
  const storeResolved130 = await resolveInvoiceStore(tx, {
    meta: { branchId: 101 },
    aliases: ['130', 'HWM-130'],
    persist: false
  });
  assert.equal(storeResolved130, 10, 'Branch 101 must resolve to Store 10 (HopKid Main Store)');

  const bill130Payload = {
    eventType: 'INVOICE_CREATED',
    data: {
      invoice: {
        invoiceId: '130',
        invoiceDate: '2026-10-15T10:00:00+05:30',
        branchId: 101,
        lineItems: [
          {
            productID: 'prod-action-figure',
            quantity: 2,
            netAmountExTax: 2000
          }
        ]
      }
    }
  };
  const calc130 = await calculateInvoiceCommission(tx, null, bill130Payload, {
    storeId: 0, // Unresolved context storeId triggers resolveInvoiceStore from payload branch
    at: new Date('2026-10-15T10:00:00+05:30'),
    reference: '130'
  });
  assert.equal(calc130.commissionState, 'COMPLETE');
  assert.equal(calc130.commissionAmount, 20); // 1% of 2000 = 20
  assert.equal(calc130.rateDisplay, '1%');
  assert.equal(calc130.hasMissingInvoiceData, false);

  console.log('--- Test 8: Bill #116 Rate Consistency (Fixed Commission vs 0%) ---');
  // Bill #116 returns ₹24.90 commission. It must NOT display 0% for a positive commission!
  const bill116 = recordedInvoiceCommission({
    status: 'APPROVED',
    eventType: 'INVOICE_CREATED',
    commissionType: 'FIXED',
    commissionPercent: 0,
    commissionAmount: 24.9,
    fixedBasis: 'UNIT',
    productBreakdown: [
      {
        productID: 'prod-unit-item',
        quantity: 1,
        commissionState: 'CONFIGURED',
        commissionType: 'FIXED',
        commissionRate: 0,
        fixedBasis: 'UNIT',
        commissionAmount: 24.9
      }
    ]
  });
  assert.equal(bill116.commissionAmount, 24.9);
  assert.equal(bill116.commissionType, 'FIXED');
  assert.equal(bill116.commissionRate, 24.9, 'Fixed commission rate must equal 24.90, not 0');
  assert.notEqual(bill116.rateDisplay, '0%', 'Must never display 0% for a positive fixed commission');
  assert.equal(bill116.rateDisplay, '₹24.9 / unit');

  console.log('✅ ALL HopKid subcategory rate mapping, Bill 133, Bills 130-132, and Bill 116 tests PASSED!');
}

runTests().catch(err => {
  console.error('❌ Test FAILED:', err);
  process.exit(1);
});
