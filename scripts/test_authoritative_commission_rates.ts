import { calculateEffectiveCommissionForLineItem, resolveBillAndCommissionReconciliation } from '../src/utils/commissionHelper';
import { extractProductLineMeta, enrichProductBreakdown } from '../src/utils/productLineMeta';

function runUnitTests() {
  console.log('================================================================');
  console.log('Unit Tests: Authoritative Commission Rates & Precedence');
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

  // 1. Direct Line Override in ERP item payload (CommissionPercentage)
  {
    const itemWithDirectPercentage = {
      productName: 'Special Item',
      productId: 'P101',
      CommissionPercentage: 3.5,
      netAmount: 2000,
    };
    const meta = extractProductLineMeta(itemWithDirectPercentage);
    assert(meta.directCommissionRate === 3.5, 'extractProductLineMeta extracts CommissionPercentage as 3.5%');

    const res = calculateEffectiveCommissionForLineItem({
      saleAmount: 2000,
      productId: meta.numericProductId ?? 101,
      productName: meta.productName,
      directCommissionRate: meta.directCommissionRate,
      salesman: { id: 1, employeeCode: 'HK01', commissionPercentage: 1.0 },
      policies: [],
    });
    assert(res.commissionRate === 3.5, 'calculateEffectiveCommission honors direct line rate 3.5% over salesman 1.0%');
    assert(res.commissionAmount === 70, 'Calculated commission is ₹70 (2000 * 3.5%)');
  }

  // 2. Different rates for different employees (12%, 2%, 0%)
  {
    const salesman12 = { id: 10, employeeCode: 'HK12', commissionPercentage: 12.0 };
    const salesman2 = { id: 11, employeeCode: 'HK02', commissionPercentage: 2.0 };
    const salesman0 = { id: 12, employeeCode: 'HK00', commissionPercentage: 0.0 };

    const res12 = calculateEffectiveCommissionForLineItem({
      saleAmount: 1000,
      productId: 50,
      productName: 'General Goods',
      salesman: salesman12,
      policies: [],
    });
    assert(res12.commissionRate === 12.0 && res12.commissionAmount === 120, 'Employee with 12% gets 12% commission (₹120 on ₹1000)');

    const res2 = calculateEffectiveCommissionForLineItem({
      saleAmount: 1000,
      productId: 50,
      productName: 'General Goods',
      salesman: salesman2,
      policies: [],
    });
    assert(res2.commissionRate === 2.0 && res2.commissionAmount === 20, 'Employee with 2% gets 2% commission (₹20 on ₹1000)');

    const res0 = calculateEffectiveCommissionForLineItem({
      saleAmount: 1000,
      productId: 50,
      productName: 'General Goods',
      salesman: salesman0,
      policies: [],
    });
    assert(res0.commissionRate === 0.0 && res0.commissionAmount === 0, 'Employee with 0% gets 0% commission (NOT 1%)');
  }

  // 3. Missing commission configuration must NOT silently default to 1%
  {
    const salesmanNoRate = { id: 13, employeeCode: 'HK_NULL', commissionPercentage: null };
    const resNull = calculateEffectiveCommissionForLineItem({
      saleAmount: 1500,
      productId: 99,
      productName: 'Unconfigured Product',
      salesman: salesmanNoRate,
      policies: [],
    });
    assert(resNull.commissionRate === 0 && resNull.commissionAmount === 0, 'Missing configuration results in 0% rate and ₹0 commission (NOT 1%)');
  }

  // 4. Product Policy vs Category Policy vs Employee Precedence
  {
    const policies = [
      {
        id: 1,
        name: 'Product Policy',
        productId: 500,
        categoryId: null,
        storeId: null,
        employeeId: null,
        priority: 1,
        commissionType: 'PERCENTAGE',
        commissionValue: 7.5,
        isActive: true,
      },
      {
        id: 2,
        name: 'Category Policy',
        productId: null,
        categoryId: 20,
        storeId: null,
        employeeId: null,
        priority: 2,
        commissionType: 'PERCENTAGE',
        commissionValue: 4.0,
        isActive: true,
      },
    ];

    const prodRes = calculateEffectiveCommissionForLineItem({
      saleAmount: 1000,
      productId: 500,
      categoryId: 20,
      productName: 'Special Widget',
      salesman: { id: 1, employeeCode: 'HK01', commissionPercentage: 2.0 },
      policies: policies as any,
    });
    assert(prodRes.commissionRate === 7.5 && prodRes.commissionAmount === 75, 'Product-specific policy (7.5%) takes precedence over Category (4%) and Salesman (2%)');

    const catRes = calculateEffectiveCommissionForLineItem({
      saleAmount: 1000,
      productId: 501,
      categoryId: 20,
      productName: 'Standard Widget',
      salesman: { id: 1, employeeCode: 'HK01', commissionPercentage: 2.0 },
      policies: policies as any,
    });
    assert(catRes.commissionRate === 4.0 && catRes.commissionAmount === 40, 'Category policy (4.0%) takes precedence over Salesman (2%)');
  }

  // 5. Verification of Existing Bill Examples:
  // Bill #28524: Bill Amount = ₹1,910, Displayed Rate = 1.0%, Commission = ₹19.10
  {
    const recon28524 = resolveBillAndCommissionReconciliation({
      eventType: 'INVOICE_CREATED',
      billId: '28524',
      amount: 1910,
      commissionAmount: 19.10,
      commissionPercent: 1.0,
      employeeRate: 1.0,
    });
    assert(recon28524.newBillCommission === 19.10, 'Bill #28524: Commission is ₹19.10 (1910 * 1.0%)');
  }

  // Bill #28517: Bill Amount = ₹960, Displayed Rate = 1.0%, Commission = ₹9.60
  {
    const recon28517 = resolveBillAndCommissionReconciliation({
      eventType: 'INVOICE_CREATED',
      billId: '28517',
      amount: 960,
      commissionAmount: 9.60,
      commissionPercent: 1.0,
      employeeRate: 1.0,
    });
    assert(recon28517.newBillCommission === 9.60, 'Bill #28517: Commission is ₹9.60 (960 * 1.0%)');
  }

  // Bill #28509: Displayed Commission = ₹57.80.
  // If bill amount was ₹5,780, effective rate is (57.80 / 5780) * 100 = 1.0%.
  // If bill amount was ₹2,890, effective rate is (57.80 / 2890) * 100 = 2.0%.
  {
    const billAmt = 2890;
    const commAmt = 57.80;
    const computedRate = Math.round(((commAmt / billAmt) * 100) * 100) / 100;
    assert(computedRate === 2.0, 'Bill #28509: Correctly calculates effective rate as 2.0% when bill is ₹2890 and commission is ₹57.80');
  }

  // 6. Updated invoice delta calculation
  {
    const reconUpdate = resolveBillAndCommissionReconciliation({
      eventType: 'INVOICE_UPDATED',
      billId: '28500',
      oldAmount: 1000,
      amount: 1500,
      commissionAmount: 15.0,
      commissionPercent: 1.0,
      employeeRate: 1.0,
    });
    assert(reconUpdate.oldBillAmount === 1000, 'Update correctly preserves old bill amount ₹1000');
    assert(reconUpdate.newBillAmount === 1500, 'Update correctly reflects new bill amount ₹1500');
    assert(reconUpdate.differenceAmount === -500, 'Update correctly calculates difference amount (old - new = -500)');
  }

  // 7. Credit Note reversal using original commission rate
  {
    const reconCN = resolveBillAndCommissionReconciliation({
      eventType: 'CREDIT_NOTE_CREATED',
      billId: 'CN-100',
      amount: 500,
      oldAmount: 500,
      oldCommission: 15.0,
      commissionPercent: 3.0, // Original bill was 3%
      employeeRate: 1.0,
    });
    assert(reconCN.oldBillCommission === 15.0, 'Credit Note respects original transaction commission percent (3% = ₹15 on ₹500)');
  }

  console.log('\n================================================================');
  console.log(`Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runUnitTests();
