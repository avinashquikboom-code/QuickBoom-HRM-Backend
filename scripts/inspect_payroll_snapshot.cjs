// Read-only investigation. Does not invoke application bootstrap or payroll generation.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000 });
(async () => {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const result = await client.query(`SELECT p.id, p."employeeId", p.month, p.year, p.status,
    p."baseSalary", p.allowance, p.deductions, p."advanceDeduction", p."netSalary",
    p."expenseReimbursement", p."extraHolidayPayout", p."extraWeeklyOffPayout", p."dailySalary",
    p."absentDays", p."halfDays", p."unpaidLeaveDays"
    FROM "Payslip" p JOIN "Employee" e ON e.id=p."employeeId"
    WHERE e."employeeCode"=$1 AND p.month=$2 AND p.year=$3`,
    [process.argv[2] || '086', Number(process.argv[3] || 10), Number(process.argv[4] || 2026)]);
  console.log(JSON.stringify(result.rows, null, 2));
  await client.query('ROLLBACK');
})().catch(e => { console.error(e.code || e.message); process.exitCode=1; }).finally(() => client.end());
