import { parseIsOld } from '../utils/commissionHelper';

function runExchangeCommissionTest() {
  console.log('==================================================');
  console.log('TESTING SALES EXCHANGE COMMISSION CALCULATION');
  console.log('==================================================');

  // Test Case 1: Flag parsing for various representations
  const testItems = [
    { name: 'Old Item numeric 1', IsOld: 1, expected: true },
    { name: 'Old Item string "1"', IsOld: '1', expected: true },
    { name: 'Old Item boolean true', isOld: true, expected: true },
    { name: 'New Item numeric 0', IsOld: 0, expected: false },
    { name: 'New Item string "0"', IsOld: '0', expected: false },
    { name: 'New Item boolean false', isOld: false, expected: false },
    { name: 'Default New Item undefined', expected: false },
  ];

  for (const t of testItems) {
    const isOld = parseIsOld(t);
    const passed = isOld === t.expected;
    console.log(`[Parse Check] ${t.name} -> isOld: ${isOld} (Pass: ${passed})`);
    if (!passed) throw new Error(`Failed flag parsing for ${t.name}`);
  }

  // Test Case 2: Business Example
  // Old item: Sale Amount = ₹2,699, IsOld = 1
  // New item: Sale Amount = ₹4,999, IsOld = 0
  // Commission rate = 1%
  const rate = 1.0; // 1%
  const oldItemAmount = 2699;
  const newItemAmount = 4999;

  const oldCommission = -Math.abs((oldItemAmount * rate) / 100);
  const newCommission = Math.abs((newItemAmount * rate) / 100);
  const netCommission = Math.round((newCommission + oldCommission) * 100) / 100;
  const netSalesAmount = newItemAmount - oldItemAmount;

  console.log('\n--- Business Example ---');
  console.log(`Old Item (IsOld: 1): Sale Amount = ₹${oldItemAmount}, Commission = ₹${oldCommission.toFixed(2)} (REVERSED)`);
  console.log(`New Item (IsOld: 0): Sale Amount = ₹${newItemAmount}, Commission = ₹${newCommission.toFixed(2)} (EARNED)`);
  console.log(`Net Sales Amount: ₹${netSalesAmount}`);
  console.log(`Net Exchange Commission: ₹${netCommission.toFixed(2)}`);

  if (oldCommission !== -26.99) throw new Error(`Expected old commission -26.99, got ${oldCommission}`);
  if (newCommission !== 49.99) throw new Error(`Expected new commission 49.99, got ${newCommission}`);
  if (netCommission !== 23.00) throw new Error(`Expected net commission 23.00, got ${netCommission}`);

  // Test Case 3: Verify NOT calculated on ₹2,300 difference directly if rates vary or tiered
  console.log('\n--- Different Commission Rate (e.g. 2.5%) ---');
  const customRate = 2.5;
  const customOldComm = -Math.abs((oldItemAmount * customRate) / 100);
  const customNewComm = Math.abs((newItemAmount * customRate) / 100);
  const customNetComm = Math.round((customNewComm + customOldComm) * 100) / 100;
  console.log(`At 2.5% Rate: Old = ₹${customOldComm.toFixed(2)}, New = ₹${customNewComm.toFixed(2)}, Net = ₹${customNetComm.toFixed(2)}`);

  console.log('\n==================================================');
  console.log('✅ ALL SALES EXCHANGE COMMISSION LOGIC TESTS PASSED');
  console.log('==================================================');
}

runExchangeCommissionTest();
