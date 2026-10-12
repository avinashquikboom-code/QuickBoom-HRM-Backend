import { prisma } from '../src/utils/db';
import { calculateEffectiveCommissionForLineItem } from '../src/utils/commissionHelper';
import { groupAndCalculateCommissionBySalesman } from '../src/controllers/webhookController';

async function runTests() {
  console.log('================================================================');
  console.log('HopKid Commission Mismatch Verification - 10 Test Scenarios');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`, details ? details : '');
      failed++;
    }
  }

  try {
    // 0. Ensure a test employee exists
    let employee = await prisma.employee.findFirst({
      where: { employeeCode: 'TEST_SALESMAN' },
    });
    if (!employee) {
      employee = await prisma.employee.create({
        data: {
          employeeCode: 'TEST_SALESMAN',
          firstName: 'HopKid',
          lastName: 'Salesman',
          commissionPercentage: 1.0, // Default 1%
          status: 'active',
          source: 'HOPKID',
        },
      });
    } else {
      employee = await prisma.employee.update({
        where: { id: employee.id },
        data: { commissionPercentage: 1.0, status: 'active' },
      });
    }

    // Clean up any old test policies
    await prisma.commissionPolicy.deleteMany({
      where: { name: { startsWith: 'TEST_POLICY_' } },
    });

    // Setup Test Policies:
    // Policy A: Category 101 (Toys) -> 5%
    const catPolicy101 = await prisma.commissionPolicy.create({
      data: {
        name: 'TEST_POLICY_CAT_101',
        categoryId: 101,
        commissionType: 'PERCENTAGE',
        commissionValue: 5.0,
        priority: 0,
        isActive: true,
      },
    });

    // Policy B: Category 102 (Clothing) -> 10%
    const catPolicy102 = await prisma.commissionPolicy.create({
      data: {
        name: 'TEST_POLICY_CAT_102',
        categoryId: 102,
        commissionType: 'PERCENTAGE',
        commissionValue: 10.0,
        priority: 0,
        isActive: true,
      },
    });

    // Policy C: Product Override (Product 999) -> 15%
    const prodOverridePolicy = await prisma.commissionPolicy.create({
      data: {
        name: 'TEST_POLICY_PROD_OVERRIDE_999',
        categoryId: 101,
        productId: 999,
        commissionType: 'PERCENTAGE',
        commissionValue: 15.0,
        priority: 1, // Higher priority than category policy
        isActive: true,
      },
    });

    const allPolicies = await prisma.commissionPolicy.findMany({
      where: { isActive: true },
      orderBy: { priority: 'asc' },
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 1: Two products belonging to different categories with different commission percentages
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 1: Two products in different categories (Cat 101: 5%, Cat 102: 10%) ---');
    const resProdA = calculateEffectiveCommissionForLineItem({
      saleAmount: 1000,
      productId: 1,
      categoryId: 101,
      policies: allPolicies,
      salesman: { id: employee.id, commissionPercentage: employee.commissionPercentage },
    });
    const resProdB = calculateEffectiveCommissionForLineItem({
      saleAmount: 2000,
      productId: 2,
      categoryId: 102,
      policies: allPolicies,
      salesman: { id: employee.id, commissionPercentage: employee.commissionPercentage },
    });

    assert(
      resProdA.commissionRate === 5.0 && resProdA.commissionAmount === 50.0,
      'Product A in Category 101 gets 5% rate and ₹50 commission on ₹1000',
      resProdA
    );
    assert(
      resProdB.commissionRate === 10.0 && resProdB.commissionAmount === 200.0,
      'Product B in Category 102 gets 10% rate and ₹200 commission on ₹2000',
      resProdB
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 2: Two products belonging to the same category
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 2: Two products in the same category (Cat 101: 5%) ---');
    const resSameCat1 = calculateEffectiveCommissionForLineItem({
      saleAmount: 500,
      productId: 10,
      categoryId: 101,
      policies: allPolicies,
      salesman: { id: employee.id, commissionPercentage: employee.commissionPercentage },
    });
    const resSameCat2 = calculateEffectiveCommissionForLineItem({
      saleAmount: 1500,
      productId: 11,
      categoryId: 101,
      policies: allPolicies,
      salesman: { id: employee.id, commissionPercentage: employee.commissionPercentage },
    });

    assert(
      resSameCat1.commissionRate === 5.0 && resSameCat1.commissionAmount === 25.0,
      'Product 10 in Category 101 receives 5% commission (₹25 on ₹500)',
      resSameCat1
    );
    assert(
      resSameCat2.commissionRate === 5.0 && resSameCat2.commissionAmount === 75.0,
      'Product 11 in Category 101 receives 5% commission (₹75 on ₹1500)',
      resSameCat2
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 3: A product with its own commission override
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 3: Product override (Product 999 @ 15% vs Category 101 @ 5%) ---');
    const resOverride = calculateEffectiveCommissionForLineItem({
      saleAmount: 1000,
      productId: 999,
      categoryId: 101,
      policies: allPolicies,
      salesman: { id: employee.id, commissionPercentage: employee.commissionPercentage },
    });

    assert(
      resOverride.commissionRate === 15.0 &&
      resOverride.commissionAmount === 150.0 &&
      resOverride.appliedLevel === 'PRODUCT',
      'Product override of 15% takes priority over category policy of 5%',
      resOverride
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 4: A product with a missing category or commission configuration
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 4: Missing category or commission policy fallback ---');
    const resMissingCat = calculateEffectiveCommissionForLineItem({
      saleAmount: 1000,
      productId: 888,
      categoryId: null, // No category
      policies: allPolicies,
      salesman: { id: employee.id, commissionPercentage: employee.commissionPercentage },
    });

    assert(
      resMissingCat.commissionRate === 1.0 &&
      resMissingCat.commissionAmount === 10.0 &&
      (resMissingCat.appliedLevel === 'FALLBACK' || resMissingCat.appliedLevel === 'EMPLOYEE'),
      'Falls back to salesperson default commission percentage (1.0% = ₹10 on ₹1000)',
      resMissingCat
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 5: A category whose commission is changed on the HopKid website
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 5: Category commission changed on website/admin panel ---');
    // Update Category 101 from 5% to 8%
    await prisma.commissionPolicy.update({
      where: { id: catPolicy101.id },
      data: { commissionValue: 8.0 },
    });

    const updatedPolicies = await prisma.commissionPolicy.findMany({
      where: { isActive: true },
      orderBy: { priority: 'asc' },
    });

    const resUpdatedCat = calculateEffectiveCommissionForLineItem({
      saleAmount: 1000,
      productId: 1,
      categoryId: 101,
      policies: updatedPolicies,
      salesman: { id: employee.id, commissionPercentage: employee.commissionPercentage },
    });

    assert(
      resUpdatedCat.commissionRate === 8.0 && resUpdatedCat.commissionAmount === 80.0,
      'Recalculated with updated website category commission of 8% (₹80 on ₹1000)',
      resUpdatedCat
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 6: Mobile app refresh / webhook calculation after commission change
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 6: Webhook / Batch multi-product blended commission calculation ---');
    const multiItemInvoice = [
      {
        productID: 1,
        productName: 'Toy Car',
        CategoryID: 101, // 8%
        price: 1000,
        qty: 1,
        Total: 1000,
        employeeCode: employee.employeeCode,
        SalesMan: employee.employeeCode,
      },
      {
        productID: 2,
        productName: 'T-Shirt',
        CategoryID: 102, // 10%
        price: 2000,
        qty: 1,
        Total: 2000,
        employeeCode: employee.employeeCode,
        SalesMan: employee.employeeCode,
      },
    ];

    const groupResult = await groupAndCalculateCommissionBySalesman(multiItemInvoice, {
      invoiceNo: 'TEST-1001',
      invoiceDate: new Date(),
      netAmount: 3000,
      metaStoreId: employee.storeId || 1,
      defaultIdentifier: employee.employeeCode,
    });

    const empCommission = groupResult.get(employee.id);
    assert(empCommission !== undefined, 'Salesman found in grouped webhook calculation');
    if (empCommission) {
      // Total sale = 3000, commission = (1000 * 8%) + (2000 * 10%) = 80 + 200 = 280
      // Blended rate = (280 / 3000) * 100 = 9.333% -> 9.33%
      const expectedBlended = Math.round(((280 / 3000) * 100) * 100) / 100;
      assert(
        empCommission.totalCommission === 280.0,
        `Total commission ₹${empCommission.totalCommission} matches expected ₹280.00`
      );
      assert(
        empCommission.effectiveRate === expectedBlended,
        `Effective blended rate ${empCommission.effectiveRate}% matches expected ${expectedBlended}%`
      );
      assert(
        empCommission.products.length === 2 &&
        empCommission.products[0].commissionRate === 8.0 &&
        empCommission.products[1].commissionRate === 10.0,
        'Product breakdown contains correct category rates (8% for Cat 101, 10% for Cat 102)',
        empCommission.products
      );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 7: Sale created and stored in DB with product breakdown & blended rate
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 7: Sale created and stored in DB ---');
    const createdTx = await prisma.commissionTransaction.create({
      data: {
        billId: 'TEST-BILL-1001',
        invoiceNumber: 'INV-TEST-1001',
        employeeId: employee.id,
        saleAmount: 3000,
        commissionType: 'PERCENTAGE',
        commissionPercent: empCommission ? empCommission.effectiveRate : 9.33,
        commissionAmount: 280,
        productBreakdown: empCommission?.products as any,
        status: 'PENDING',
      },
    });

    assert(
      createdTx.id > 0 &&
      createdTx.commissionAmount === 280 &&
      createdTx.commissionPercent === 9.33,
      'Transaction correctly stored with blended rate 9.33% and commission ₹280',
      createdTx
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 8: Sales return / credit note adjustment
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 8: Credit Note reversal at original effective rate ---');
    const creditReturnAmount = 1000;
    const reducedCommission = Math.round(((creditReturnAmount * createdTx.commissionPercent!) / 100) * 100) / 100;

    const creditTx = await prisma.commissionTransaction.create({
      data: {
        billId: 'TEST-CN-1001',
        invoiceNumber: 'INV-TEST-1001-CN',
        employeeId: employee.id,
        saleAmount: -creditReturnAmount,
        commissionType: 'PERCENTAGE',
        commissionPercent: createdTx.commissionPercent,
        commissionAmount: -reducedCommission,
        status: 'PENDING',
      },
    });

    assert(
      creditTx.saleAmount === -1000 &&
      creditTx.commissionAmount === -93.3,
      'Credit note correctly reversed proportional commission ₹-93.30 (-1000 * 9.33%)',
      creditTx
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 9: Commission summary and net total
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 9: Commission summary and net adjustment ---');
    const netSale = createdTx.saleAmount + creditTx.saleAmount; // 3000 - 1000 = 2000
    const netCommission = Math.round((createdTx.commissionAmount + creditTx.commissionAmount) * 100) / 100; // 280 - 93.3 = 186.7

    assert(
      netSale === 2000 && netCommission === 186.7,
      `Net sale ₹${netSale} and net commission ₹${netCommission} accurately reflect adjustment`
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Scenario 10: Percentage conversion & currency rounding
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario 10: Percentage conversion & currency rounding ---');
    const testDecimalRate = calculateEffectiveCommissionForLineItem({
      saleAmount: 333.33,
      productId: 1,
      categoryId: 101, // 8%
      policies: updatedPolicies,
      salesman: { id: employee.id, commissionPercentage: employee.commissionPercentage },
    });

    // 333.33 * 8% = 26.6664 -> rounds to 26.67
    assert(
      testDecimalRate.commissionRate === 8.0 &&
      testDecimalRate.commissionAmount === 26.67,
      '8% is represented as 8.0 (not 0.08 or 800) and ₹333.33 * 8% rounds to ₹26.67',
      testDecimalRate
    );

    // Clean up created test transactions and policies
    await prisma.commissionTransaction.deleteMany({
      where: { id: { in: [createdTx.id, creditTx.id] } },
    });
    await prisma.commissionPolicy.deleteMany({
      where: { name: { startsWith: 'TEST_POLICY_' } },
    });

    console.log('\n================================================================');
    console.log(`Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
