import cron from 'node-cron';
import payrollService from './payrollService';

/**
 * Initializes the automated payroll cron job.
 * Runs daily at midnight IST to check if the current date is past the payroll cutoff/end-of-month,
 * and automatically triggers idempotent payroll generation for all active employees.
 */
export function initPayrollCron() {
  console.log('⏰ [Payroll Cron] Initializing automatic monthly payroll scheduler...');

  // Daily check at Midnight (00:00 IST)
  cron.schedule('0 0 * * *', async () => {
    try {
      const now = new Date();
      const currentDay = now.getDate();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      // Automatically generate for the previous month on the 1st of the month,
      // or for the current month if day is 28th or later.
      let targetMonth = currentMonth;
      let targetYear = currentYear;

      if (currentDay === 1) {
        // Run for previous month on 1st day of month
        targetMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        targetYear = currentMonth === 1 ? currentYear - 1 : currentYear;
      }

      console.log(`🔄 [Payroll Cron] Running automated payroll check for ${targetMonth}/${targetYear}...`);
      const result = await payrollService.autoGenerateMonthlyPayroll(targetMonth, targetYear);
      console.log(`✅ [Payroll Cron] Automated run completed: ${result.processed} processed, ${result.skipped} skipped.`);
    } catch (error) {
      console.error('❌ [Payroll Cron] Automated payroll generation error:', error);
    }
  });
}
