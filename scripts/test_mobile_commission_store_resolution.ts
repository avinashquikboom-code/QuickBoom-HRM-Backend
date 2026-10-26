import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/utils/db';
import { mobileInvoiceDetail, resolveInvoiceStore } from '../src/services/invoiceCommissionService';

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`PASS: ${name}`);
  passed++;
}

async function main() {
  console.log('--- Testing Mobile Commission Bill Details & Store Resolution ---');

  const testBills = ['97', 'HWM-97', '12162', 'HWM-12162', '99991', 'HWM-99991', '99992', 'HWM-99992', '88881', 'HWM-88881'];
  await prisma.commissionTransaction.deleteMany({ where: { OR: [{ billId: { in: testBills } }, { invoiceNumber: { in: testBills } }] } });
  await prisma.hopkidWebhookLog.deleteMany({ where: { billId: { in: testBills } } });

  const suffix = randomUUID().slice(0, 8);

  // Setup test stores
  const storeA = await prisma.store.create({
    data: { name: `Store Alpha ${suffix}`, code: `ALPHA-${suffix}` }
  });
  const storeB = await prisma.store.create({
    data: { name: `Store Beta ${suffix}`, code: `BETA-${suffix}` }
  });

  // Setup test users & employees
  const userSeller = await prisma.user.create({
    data: { email: `seller-${suffix}@test.invalid`, password: 'test', role: 'EMPLOYEE' }
  });
  const empSeller = await prisma.employee.create({
    data: {
      userId: userSeller.id,
      employeeCode: `EMP-S-${suffix}`,
      firstName: 'Seller',
      lastName: 'One',
      status: 'active',
      source: 'HOPKID',
      storeId: storeA.id,
      commissionPercentage: 2
    }
  });

  const userSellerNoStore = await prisma.user.create({
    data: { email: `seller-nostore-${suffix}@test.invalid`, password: 'test', role: 'EMPLOYEE' }
  });
  const empSellerNoStore = await prisma.employee.create({
    data: {
      userId: userSellerNoStore.id,
      employeeCode: `EMP-NS-${suffix}`,
      firstName: 'Seller',
      lastName: 'NoStore',
      status: 'active',
      source: 'HOPKID',
      storeId: null,
      branchId: null,
      commissionPercentage: 1
    }
  });

  const userManagerA = await prisma.user.create({
    data: { email: `managerA-${suffix}@test.invalid`, password: 'test', role: 'STORE_MANAGER' }
  });
  const empManagerA = await prisma.employee.create({
    data: {
      userId: userManagerA.id,
      employeeCode: `EMP-MA-${suffix}`,
      firstName: 'Manager',
      lastName: 'Alpha',
      status: 'active',
      source: 'HOPKID',
      storeId: storeA.id
    }
  });

  const userManagerB = await prisma.user.create({
    data: { email: `managerB-${suffix}@test.invalid`, password: 'test', role: 'STORE_MANAGER' }
  });
  const empManagerB = await prisma.employee.create({
    data: {
      userId: userManagerB.id,
      employeeCode: `EMP-MB-${suffix}`,
      firstName: 'Manager',
      lastName: 'Beta',
      status: 'active',
      source: 'HOPKID',
      storeId: storeB.id
    }
  });

  const userAdmin = await prisma.user.create({
    data: { email: `admin-${suffix}@test.invalid`, password: 'test', role: 'ADMIN' }
  });
  const empAdmin = await prisma.employee.create({
    data: {
      userId: userAdmin.id,
      employeeCode: `EMP-ADM-${suffix}`,
      firstName: 'Admin',
      lastName: 'User',
      status: 'active',
      source: 'HOPKID',
      storeId: storeA.id
    }
  });

  // Setup subcategory and rate
  const sub = await prisma.hrmCommissionSubcategory.create({
    data: { externalId: `sub-${suffix}`, name: `Apparel ${suffix}` }
  });
  await prisma.hrmCommissionRate.create({
    data: {
      subcategoryId: sub.id,
      storeKey: 0,
      rate: 2,
      type: 'PERCENTAGE',
      basis: 'NET_EX_TAX',
      fixedBasis: 'UNIT',
      effectiveFrom: new Date('2026-01-01'),
      createdBy: userAdmin.id
    }
  });

  // TEST 1: Bill 97 with null storeId resolves from employee and backfills
  await test('Bill 97 with null storeId resolves store from employee and loads cleanly', async () => {
    const rawPayload = {
      eventType: 'INVOICE_CREATED',
      data: {
        invoice: {
          invoiceId: '97',
          invoiceNo: 'HWM-97',
          invoiceDate: '2026-10-26',
          netAmount: 8000,
          grandTotal: 8000,
          lineItems: [
            {
              lineItemId: 'item-97',
              productID: `prod-97-${suffix}`,
              productName: 'Watch',
              subcategoryId: sub.externalId,
              quantity: 1,
              netAmountExTax: '8000',
              productPrice: 8000,
              employeeCode: empSeller.employeeCode
            }
          ]
        }
      }
    };

    await prisma.hopkidWebhookLog.create({
      data: {
        billId: '97',
        employeeCode: empSeller.employeeCode,
        amount: 8000,
        rawPayload: JSON.stringify(rawPayload)
      }
    });

    const ct97 = await prisma.commissionTransaction.create({
      data: {
        employeeId: empSeller.id,
        storeId: null, // intentionally null
        billId: '97',
        invoiceNumber: 'HWM-97',
        saleAmount: 8000,
        commissionType: 'PERCENTAGE',
        commissionPercent: 2,
        commissionAmount: 160,
        status: 'PENDING',
        eventType: 'INVOICE_CREATED',
        notes: 'HopKid Invoice #97 - Products: Watch'
      }
    });

    // Call mobileInvoiceDetail with userSeller.id and '97'
    const detail = await mobileInvoiceDetail(userSeller.id, '97', 'EMPLOYEE');
    assert(detail, 'Detail should be returned for bill 97');
    assert.equal(detail.billId, 97);
    assert.equal(detail.invoiceNumber, 'HWM-97');
    assert.equal(detail.storeName, storeA.name);
    assert.equal(detail.saleAmount, 8000);
    assert.equal(detail.totalCommission, 160);
    assert.equal(detail.status, 'PENDING');
    assert(detail.products.length > 0, 'Products should be present');
    assert.equal(detail.employee.name, `${empSeller.firstName} ${empSeller.lastName}`.trim());

    // Verify backfill in database
    const updated = await prisma.commissionTransaction.findUniqueOrThrow({ where: { id: ct97.id } });
    assert.equal(updated.storeId, storeA.id, 'Transaction 97 storeId must be safely backfilled to Store A');
  });

  // TEST 2: Bill 12162 with storeId: null resolved from employee's assigned store
  await test('Bill 12162 with null storeId resolves store from employee and backfills transaction', async () => {
    const rawPayload = {
      eventType: 'INVOICE_CREATED',
      data: {
        invoice: {
          invoiceId: '12162',
          invoiceNo: 'HWM-12162',
          invoiceDate: '2026-10-26',
          netAmount: 5000,
          grandTotal: 5000,
          lineItems: [
            {
              lineItemId: 'item-1',
              productID: `prod-${suffix}`,
              productName: 'T-Shirt',
              subcategoryId: sub.externalId,
              quantity: 1,
              netAmountExTax: '5000',
              productPrice: 5000,
              employeeCode: empSeller.employeeCode
            }
          ]
        }
      }
    };

    await prisma.hopkidWebhookLog.create({
      data: {
        billId: '12162',
        employeeCode: empSeller.employeeCode,
        amount: 5000,
        rawPayload: JSON.stringify(rawPayload)
      }
    });

    // Transaction initially created with storeId: null (legacy/webhook without store)
    const ct12162 = await prisma.commissionTransaction.create({
      data: {
        employeeId: empSeller.id,
        storeId: null, // intentionally null
        billId: '12162',
        invoiceNumber: 'HWM-12162',
        saleAmount: 5000,
        commissionType: 'PERCENTAGE',
        commissionPercent: 2,
        commissionAmount: 100,
        status: 'PENDING',
        eventType: 'INVOICE_CREATED',
        notes: 'HopKid Invoice #12162 - Products: T-Shirt'
      }
    });

    // Request mobile invoice details for 12162
    const detail = await mobileInvoiceDetail(userSeller.id, '12162', 'EMPLOYEE');
    assert(detail, 'Detail should be returned for 12162');
    assert.equal(detail.billId, 12162);
    assert.equal(detail.invoiceNumber, 'HWM-12162');
    assert.equal(detail.saleAmount, 5000);
    assert.equal(detail.totalCommission, 100);
    assert.equal(detail.storeName, storeA.name);

    // Verify backfill in database
    const updated = await prisma.commissionTransaction.findUniqueOrThrow({ where: { id: ct12162.id } });
    assert.equal(updated.storeId, storeA.id, 'Transaction storeId must be safely backfilled to Store A');
  });

  // TEST 3: Invoice with valid store explicitly present
  await test('Invoice with explicit valid store loads cleanly', async () => {
    const rawPayload = {
      eventType: 'INVOICE_CREATED',
      data: {
        invoice: {
          invoiceId: '99991',
          invoiceNo: 'HWM-99991',
          storeId: storeA.id,
          netAmount: 2000,
          grandTotal: 2000,
          lineItems: [
            {
              lineItemId: 'item-2',
              productID: `prod-2-${suffix}`,
              productName: 'Cap',
              subcategoryId: sub.externalId,
              quantity: 1,
              netAmountExTax: '2000',
              productPrice: 2000,
              employeeCode: empSeller.employeeCode
            }
          ]
        }
      }
    };
    await prisma.hopkidWebhookLog.create({
      data: {
        billId: '99991',
        storeId: storeA.id,
        employeeCode: empSeller.employeeCode,
        amount: 2000,
        rawPayload: JSON.stringify(rawPayload)
      }
    });
    await prisma.commissionTransaction.create({
      data: {
        employeeId: empSeller.id,
        storeId: storeA.id,
        billId: '99991',
        invoiceNumber: 'HWM-99991',
        saleAmount: 2000,
        commissionType: 'PERCENTAGE',
        commissionPercent: 2,
        commissionAmount: 40,
        status: 'PENDING',
        eventType: 'INVOICE_CREATED'
      }
    });

    const detail = await mobileInvoiceDetail(userSeller.id, '99991', 'EMPLOYEE');
    assert.equal(detail.billId, 99991);
    assert.equal(detail.totalCommission, 40);
    assert.equal(detail.storeName, storeA.name);
  });

  // TEST 4: Store resolution via branch mapping
  await test('Store resolves through branch reference', async () => {
    const branch = await prisma.branch.create({
      data: {
        name: storeB.name, // matching store B name
        latitude: 19.0,
        longitude: 72.8,
        radiusMeters: 100
      }
    });

    const rawPayload = {
      eventType: 'INVOICE_CREATED',
      data: {
        invoice: {
          invoiceId: '99992',
          invoiceNo: 'HWM-99992',
          branchId: branch.id, // branch ID in payload
          netAmount: 1000,
          lineItems: []
        }
      }
    };
    await prisma.hopkidWebhookLog.create({
      data: {
        billId: '99992',
        employeeCode: empSeller.employeeCode,
        amount: 1000,
        rawPayload: JSON.stringify(rawPayload)
      }
    });
    const sale = await prisma.commissionTransaction.create({
      data: {
        employeeId: empSeller.id,
        storeId: null,
        billId: '99992',
        invoiceNumber: 'HWM-99992',
        saleAmount: 1000,
        commissionType: 'PERCENTAGE',
        commissionPercent: 2,
        commissionAmount: 20,
        status: 'APPROVED',
        eventType: 'INVOICE_CREATED'
      }
    });

    const resolved = await resolveInvoiceStore(prisma as any, {
      sale,
      meta: { branchId: branch.id }
    });
    assert.equal(resolved, storeB.id, 'Store should resolve to Store B via branch name matching');
  });

  // TEST 5: Invoice that genuinely has NO store returns 409 Conflict - Invoice store is missing
  await test('Invoice genuinely missing store returns 409 Conflict', async () => {
    const saleNoStore = await prisma.commissionTransaction.create({
      data: {
        employeeId: empSellerNoStore.id,
        storeId: null,
        billId: '88881',
        invoiceNumber: 'HWM-88881',
        saleAmount: 1000,
        commissionType: 'PERCENTAGE',
        commissionPercent: 1,
        commissionAmount: 10,
        status: 'PENDING',
        eventType: 'INVOICE_CREATED'
      }
    });

    let err: any;
    try {
      await mobileInvoiceDetail(userSellerNoStore.id, '88881', 'EMPLOYEE');
    } catch (e) {
      err = e;
    }
    assert(err, 'Should throw an error');
    assert.equal(err.status, 409, 'Status must be 409 Conflict');
    assert.equal(err.message, 'Invoice store is missing');
  });

  // TEST 6: Tenant / Store isolation
  await test('Store Manager of Store B cannot access Store A invoice', async () => {
    let err: any;
    try {
      // Store Manager B tries to open bill 12162 which belongs to Store A
      await mobileInvoiceDetail(userManagerB.id, '12162', 'STORE_MANAGER');
    } catch (e) {
      err = e;
    }
    assert(err, 'Should reject cross-store manager access');
    assert.equal(err.status, 404, 'Must return 404');
  });

  // TEST 7: Store Manager of Store A can view invoice in Store A
  await test('Store Manager of Store A can view Store A invoice', async () => {
    const detail = await mobileInvoiceDetail(userManagerA.id, '12162', 'STORE_MANAGER');
    assert(detail, 'Manager A should be authorized to view Store A invoice');
    assert.equal(detail.billId, 12162);
    assert.equal(detail.storeName, storeA.name);
  });

  // TEST 8: Admin can view invoices across stores
  await test('Admin can view invoices across stores', async () => {
    const detail = await mobileInvoiceDetail(userAdmin.id, '12162', 'ADMIN');
    assert(detail, 'Admin should be authorized to view invoice');
    assert.equal(detail.billId, 12162);
  });

  // Cleanup test data
  console.log(`\nAll ${passed} store resolution tests passed!`);
}

main()
  .catch(e => {
    console.error('Test failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
