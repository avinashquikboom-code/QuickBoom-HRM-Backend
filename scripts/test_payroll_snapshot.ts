import assert from 'assert';
import payroll from '../src/services/payrollService';
import { prisma } from '../src/utils/db';

async function main() {
  let writes = 0;
  (prisma.payslip as any).update = async () => { writes++; throw new Error('Read must not write finalized payroll'); };
  (prisma.salaryAdvance as any).findMany = async () => { throw new Error('Historical payroll must not read live advances'); };
  (prisma.expense as any).findMany = async () => [];
  (payroll as any).getAttendanceSnapshot = async () => { throw new Error('No attendance fixture'); };
  (payroll as any).getSalaryStructure = async () => ({ id: 1, baseSalary: 99999, hra: 9999 });
  const employee = { firstName: 'Fixture', salaryStructure: { basicSalary: 99999, hra: 9999 }, office: { workingDays: ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY'] } };
  let cases = 0;
  for (const status of ['APPROVED', 'PAID', 'DISBURSED', 'COMPLETED']) {
    for (const month of [2, 10, 12]) {
      for (const deductions of [0, 681.82, 9111.16]) {
        for (const reimbursement of [0, 1, 175.25]) {
          const ps = { id: 123, employeeId: 42, month, year: 2026, status,
            baseSalary: 7500, allowance: 7500, hra: 3000, travelAllowance: 1500,
            medicalAllowance: 1350, specialAllowance: 1650, bonus: 0, incentive: 0,
            extraHolidayPayout: 1363.64, extraWeeklyOffPayout: 0,
            deductions, advanceDeduction: 0, netSalary: Math.round((16363.64-deductions)*100)/100,
            expenseReimbursement: reimbursement };
          const wallet = await payroll.resolveFullPayslipView(ps, employee);
          const slip = await payroll.resolveFullPayslipView(ps, employee);
          for (const key of ['totalEarnings','totalDeductions','expenseReimbursement','netSalary','totalTakeHomePay']) {
            assert.strictEqual((wallet as any)[key], (slip as any)[key], key);
          }
          assert.strictEqual(wallet.fixedGrossSalary, 15000);
          assert.strictEqual(wallet.totalDeductions, deductions);
          assert.strictEqual(wallet.netSalary, ps.netSalary);
          assert.strictEqual(wallet.totalTakeHomePay, Math.round((ps.netSalary+reimbursement)*100)/100);
          cases++;
        }
      }
    }
  }
  assert.strictEqual(writes, 0);
  console.log(`PASS ${cases} immutable payroll snapshot cases, matching wallet/payslip totals`);
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
