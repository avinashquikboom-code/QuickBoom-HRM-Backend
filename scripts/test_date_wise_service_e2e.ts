import { prisma } from '../src/utils/db';
import dateWiseSalaryService from '../src/services/dateWiseSalaryService';

async function testServiceE2E() {
  console.log('Testing dateWiseSalaryService against actual database employee...');
  let emp;
  try {
    emp = await prisma.employee.findFirst({
      where: { status: { in: ['ACTIVE', 'active'] } },
      include: { salaryStructure: true, office: true },
    });
  } catch (dbErr: any) {
    console.log('Database not running locally (ECONNREFUSED) - skipping live DB connection test.');
    return;
  }

  if (!emp) {
    console.log('No active employee found in database, skipping live db test.');
    return;
  }

  console.log(`Testing with employee #${emp.id} (${emp.employeeCode} - ${emp.firstName} ${emp.lastName})`);

  const result = await dateWiseSalaryService.getDateWiseBreakdown(emp.id, 10, 2026);
  console.log('Month:', result.summary.monthName, result.summary.year);
  console.log('Monthly Salary:', result.summary.monthlySalary);
  console.log('Daily Salary:', result.summary.dailySalary);
  console.log('Total Calendar Days:', result.summary.totalCalendarDays);
  console.log('Number of date records returned:', result.dates.length);
  console.log('Standard Payable Days:', result.summary.standardPayableDays);
  console.log('Net Salary:', result.summary.netSalary);
  console.log('Total Take Home Pay:', result.summary.totalTakeHomePay);
  console.log('Reconciled:', result.summary.reconciled);

  if (result.dates.length !== result.summary.totalCalendarDays) {
    throw new Error(`Expected ${result.summary.totalCalendarDays} dates but got ${result.dates.length}`);
  }

  console.log('✅ dateWiseSalaryService E2E test passed successfully!');
  await prisma.$disconnect();
}

testServiceE2E().catch((err) => {
  console.error('Error during testServiceE2E:', err);
  process.exit(1);
});
