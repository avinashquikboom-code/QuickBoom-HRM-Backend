import { prisma } from '../utils/db';

export class CommissionService {
  /**
   * Get DAILY net sales and commission for an employee
   * Used for "Today's Performance"
   */
  static async getDailyMetrics(employeeId: number, date?: Date): Promise<any> {
    const targetDate = date || new Date();
    // Convert target UTC time to IST (UTC+5:30)
    const istTime = targetDate.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istTime);

    const year = istDate.getUTCFullYear();
    const month = istDate.getUTCMonth();
    const dateVal = istDate.getUTCDate();

    // dayStart in UTC corresponding to 00:00:00.000 IST
    const dayStart = new Date(Date.UTC(year, month, dateVal) - 5.5 * 60 * 60 * 1000);
    // dayEnd in UTC corresponding to 23:59:59.999 IST
    const dayEnd = new Date(Date.UTC(year, month, dateVal, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);

    const displayDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dateVal).padStart(2, '0')}`;
    console.log(`[Daily Metrics] Employee: ${employeeId}, IST Date: ${displayDateStr}`);

    const sales = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employeeId,
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
        createdAt: {
          gte: dayStart,
          lte: dayEnd
        }
      }
    });

    const totalNetSales = sales.reduce((sum, s) => sum + s.saleAmount, 0);
    const totalCommission = sales.reduce((sum, s) => sum + s.commissionAmount, 0);

    console.log(`[Daily Metrics] ✅ Results:`, {
      date: displayDateStr,
      netSales: totalNetSales,
      commission: totalCommission,
      billCount: sales.length
    });

    return {
      date: displayDateStr,
      netSales: totalNetSales,
      commission: totalCommission,
      billCount: sales.length
    };
  }

  /**
   * Get MONTHLY net sales and commission for an employee
   * Used for "This Month's Performance"
   */
  static async getMonthlyMetrics(employeeId: number, month?: string): Promise<any> {
    const now = new Date();
    // Convert target UTC time to IST (UTC+5:30)
    const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istTime);

    const targetMonth = month || `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth() + 1).padStart(2, '0')}`;

    console.log(`[Monthly Metrics] Employee: ${employeeId}, Month: ${targetMonth}`);

    const [year, monthNum] = targetMonth.split('-').map(Number);
    // monthStart in UTC corresponding to 00:00:00.000 IST
    const monthStart = new Date(Date.UTC(year, monthNum - 1, 1) - 5.5 * 60 * 60 * 1000);
    // monthEnd in UTC corresponding to 23:59:59.999 IST
    const monthEnd = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);

    const sales = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employeeId,
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
        createdAt: {
          gte: monthStart,
          lte: monthEnd
        }
      }
    });

    const totalNetSales = sales.reduce((sum, s) => sum + s.saleAmount, 0);
    const totalCommission = sales.reduce((sum, s) => sum + s.commissionAmount, 0);

    console.log(`[Monthly Metrics] ✅ Results:`, {
      month: targetMonth,
      netSales: totalNetSales,
      commission: totalCommission,
      billCount: sales.length
    });

    return {
      month: targetMonth,
      netSales: totalNetSales,
      commission: totalCommission,
      billCount: sales.length
    };
  }

  /**
   * Get LATEST sale for this employee
   * Used for "Latest Transaction"
   */
  static async getLatestSale(employeeId: number): Promise<any> {
    console.log(`[Latest Sale] Employee: ${employeeId}`);

    const latestSale = await prisma.commissionTransaction.findFirst({
      where: {
        employeeId: employeeId,
        status: { in: ['PENDING', 'APPROVED', 'PAID'] }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!latestSale) {
      console.log(`[Latest Sale] ⚠️ No sales found`);
      return null;
    }

    console.log(`[Latest Sale] ✅ Found:`, {
      billId: latestSale.billId || latestSale.invoiceNumber,
      date: latestSale.createdAt.toISOString().split('T')[0],
      amount: latestSale.saleAmount
    });

    return {
      billId: latestSale.billId || latestSale.invoiceNumber || `TXN-${latestSale.id}`,
      date: latestSale.createdAt,
      netAmount: latestSale.saleAmount,
      commission: latestSale.commissionAmount,
      commissionRate: latestSale.commissionPercent || 0,
      description: latestSale.notes
    };
  }

  /**
   * Get COMPLETE metrics summary for both mobile and admin dashboard
   */
  static async getCompleteSummary(employeeId: number): Promise<any> {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [COMPLETE SUMMARY] Getting all metrics                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    try {
      const today = await this.getDailyMetrics(employeeId);
      const month = await this.getMonthlyMetrics(employeeId);
      const latest = await this.getLatestSale(employeeId);

      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║ [SUMMARY] ✅ All metrics collected                         ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');

      return {
        today: today,
        thisMonth: month,
        latestSale: latest
      };
    } catch (error: any) {
      console.error('[Summary] ❌ Error:', error.message);
      throw error;
    }
  }
}
