import { prisma } from '../utils/db';

export class CommissionService {
  /**
   * Get DAILY net sales and commission for an employee
   * Used for "Today's Performance"
   */
  static async getDailyMetrics(employeeId: number, date?: Date): Promise<any> {
    const targetDate = date || new Date();
    const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0);
    const dayEnd   = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);

    console.log(`[Daily Metrics] Employee: ${employeeId}, Date: ${dayStart.toISOString().split('T')[0]}`);

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
      date: dayStart.toISOString().split('T')[0],
      netSales: totalNetSales,
      commission: totalCommission,
      billCount: sales.length
    });

    return {
      date: dayStart.toISOString().split('T')[0],
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
    const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    console.log(`[Monthly Metrics] Employee: ${employeeId}, Month: ${targetMonth}`);

    const [year, monthNum] = targetMonth.split('-').map(Number);
    const monthStart = new Date(year, monthNum - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(year, monthNum, 0, 23, 59, 59, 999);

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
