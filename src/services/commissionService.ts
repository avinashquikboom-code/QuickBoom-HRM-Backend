import { prisma } from '../utils/db';
import { getTransactionNetContribution, getNumericInvoiceNumber } from '../utils/commissionHelper';

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

    let creditLines: any[] = [];
    try {
      creditLines = await prisma.creditNoteLine.findMany({
        where: {
          employeeId: employeeId,
          createdAt: {
            gte: dayStart,
            lte: dayEnd
          }
        }
      });
    } catch (_) {}

    const rawNetSales = sales.reduce((sum, s) => sum + getTransactionNetContribution(s).netSales, 0);
    const rawCommission = sales.reduce((sum, s) => sum + getTransactionNetContribution(s).netCommission, 0);

    const creditSalesDeduction = creditLines.reduce((sum, cl) => sum + Number(cl.creditAmount || 0), 0);
    const creditCommDeduction = creditLines.reduce((sum, cl) => sum + Number(cl.commissionAdjustment || 0), 0);

    const totalNetSales = Math.max(0, rawNetSales - creditSalesDeduction);
    const totalCommission = Math.max(0, rawCommission - creditCommDeduction);

    console.log(`[Daily Metrics] ✅ Results:`, {
      date: displayDateStr,
      netSales: totalNetSales,
      commission: totalCommission,
      billCount: sales.length
    });

    return {
      date: displayDateStr,
      totalSales: totalNetSales,
      netSales: totalNetSales,
      totalSalesAmount: totalNetSales,
      totalCommission: totalCommission,
      commission: totalCommission,
      totalCommissionEarned: totalCommission,
      commissionAmount: totalCommission,
      billCount: sales.length,
      label: "Today's Performance"
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

    let creditLines: any[] = [];
    try {
      creditLines = await prisma.creditNoteLine.findMany({
        where: {
          employeeId: employeeId,
          createdAt: {
            gte: monthStart,
            lte: monthEnd
          }
        }
      });
    } catch (_) {}

    const rawNetSales = sales.reduce((sum, s) => sum + getTransactionNetContribution(s).netSales, 0);
    const rawCommission = sales.reduce((sum, s) => sum + getTransactionNetContribution(s).netCommission, 0);

    const creditSalesDeduction = creditLines.reduce((sum, cl) => sum + Number(cl.creditAmount || 0), 0);
    const creditCommDeduction = creditLines.reduce((sum, cl) => sum + Number(cl.commissionAdjustment || 0), 0);

    const totalNetSales = Math.max(0, rawNetSales - creditSalesDeduction);
    const totalCommission = Math.max(0, rawCommission - creditCommDeduction);

    console.log(`[Monthly Metrics] ✅ Results:`, {
      month: targetMonth,
      netSales: totalNetSales,
      commission: totalCommission,
      billCount: sales.length
    });

    return {
      month: targetMonth,
      monthName: targetMonth,
      year: String(year),
      totalSales: totalNetSales,
      netSales: totalNetSales,
      totalSalesAmount: totalNetSales,
      totalCommission: totalCommission,
      commission: totalCommission,
      totalCommissionEarned: totalCommission,
      commissionAmount: totalCommission,
      billCount: sales.length,
      label: "This Month's Performance"
    };
  }

  /**
   * Get WEEKLY net sales and commission for an employee
   * Used for "This Week's Performance"
   */
  static async getWeeklyMetrics(employeeId: number): Promise<any> {
    const now = new Date();
    // Convert target UTC time to IST (UTC+5:30)
    const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istTime);

    const year = istDate.getUTCFullYear();
    const month = istDate.getUTCMonth();
    const dateVal = istDate.getUTCDate();

    // Start of 7 days ago in UTC corresponding to 00:00:00.000 IST
    const weekStart = new Date(Date.UTC(year, month, dateVal - 6, 0, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
    // End of today in UTC corresponding to 23:59:59.999 IST
    const weekEnd = new Date(Date.UTC(year, month, dateVal, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);

    console.log(`[Weekly Metrics] Employee: ${employeeId}, IST 7 Days: ${weekStart.toISOString()} to ${weekEnd.toISOString()}`);

    const sales = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employeeId,
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
        createdAt: {
          gte: weekStart,
          lte: weekEnd
        }
      }
    });

    let creditLines: any[] = [];
    try {
      creditLines = await prisma.creditNoteLine.findMany({
        where: {
          employeeId: employeeId,
          createdAt: {
            gte: weekStart,
            lte: weekEnd
          }
        }
      });
    } catch (_) {}

    const rawNetSales = sales.reduce((sum, s) => sum + getTransactionNetContribution(s).netSales, 0);
    const rawCommission = sales.reduce((sum, s) => sum + getTransactionNetContribution(s).netCommission, 0);

    const creditSalesDeduction = creditLines.reduce((sum, cl) => sum + Number(cl.creditAmount || 0), 0);
    const creditCommDeduction = creditLines.reduce((sum, cl) => sum + Number(cl.commissionAdjustment || 0), 0);

    const totalNetSales = Math.max(0, rawNetSales - creditSalesDeduction);
    const totalCommission = Math.max(0, rawCommission - creditCommDeduction);

    return {
      start: weekStart.toISOString().split('T')[0],
      end: weekEnd.toISOString().split('T')[0],
      from: weekStart.toISOString().split('T')[0],
      to: weekEnd.toISOString().split('T')[0],
      totalSales: totalNetSales,
      netSales: totalNetSales,
      totalSalesAmount: totalNetSales,
      totalCommission: totalCommission,
      commission: totalCommission,
      totalCommissionEarned: totalCommission,
      commissionAmount: totalCommission,
      billCount: sales.length,
      label: "This Week's Performance"
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
      orderBy: { id: 'desc' }
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

    const numInv = getNumericInvoiceNumber(latestSale);
    return {
      billId: numInv,
      invoiceNumber: latestSale.invoiceNumber || `HWM-${numInv}`,
      billNumber: numInv,
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
      const weekly = await this.getWeeklyMetrics(employeeId);
      const month = await this.getMonthlyMetrics(employeeId);
      const latest = await this.getLatestSale(employeeId);

      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║ [SUMMARY] ✅ All metrics collected                         ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');

      return {
        today: today,
        weekly: weekly,
        thisMonth: month,
        latestSale: latest
      };
    } catch (error: any) {
      console.error('[Summary] ❌ Error:', error.message);
      throw error;
    }
  }

  /**
   * Calculate monthly commission for an employee including adjustments
   */
  static async calculateMonthlyCommission(employeeId: number, month: string): Promise<any> {
    const [year, monthNum] = month.split('-').map(Number);
    const monthStart = new Date(Date.UTC(year, monthNum - 1, 1) - 5.5 * 60 * 60 * 1000);
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

    const creditLines = await prisma.creditNoteLine.findMany({
      where: {
        employeeId: employeeId,
        createdAt: {
          gte: monthStart,
          lte: monthEnd
        }
      }
    });

    const totalSalesAmount = sales.reduce((sum, s) => sum + Number(s.saleAmount), 0);
    const totalTransactionCommission = sales.reduce((sum, s) => sum + Number(s.commissionAmount), 0);
    const totalCreditAdjustments = creditLines.reduce((sum, cl) => sum + Number(cl.commissionAdjustment), 0);

    const finalCommission = Math.max(0, totalTransactionCommission - totalCreditAdjustments);

    return {
      employeeId,
      month,
      totalNetSales: totalSalesAmount,
      totalTransactionCommission,
      totalCreditAdjustments,
      totalCommissionAmount: finalCommission,
      billCount: sales.length
    };
  }

  /**
   * Upsert monthly commission settlement record
   */
  static async upsertMonthlyCommission(employeeId: number, month: string, calculation: any): Promise<any> {
    const [year, monthNum] = month.split('-').map(Number);
    const settlementDate = new Date(Date.UTC(year, monthNum - 1, 1));

    const existingSettlement = await prisma.commissionSettlement.findFirst({
      where: {
        employeeId: employeeId,
        settlementDate: settlementDate,
      }
    });

    if (existingSettlement) {
      return await prisma.commissionSettlement.update({
        where: { id: existingSettlement.id },
        data: {
          totalCommission: calculation.totalTransactionCommission || calculation.totalCommissionAmount,
          totalDeduction: calculation.totalCreditAdjustments || 0,
          netAmount: calculation.totalCommissionAmount,
          updatedAt: new Date()
        }
      });
    } else {
      return await prisma.commissionSettlement.create({
        data: {
          employeeId: employeeId,
          settlementDate: settlementDate,
          totalCommission: calculation.totalTransactionCommission || calculation.totalCommissionAmount,
          totalBonus: 0,
          totalDeduction: calculation.totalCreditAdjustments || 0,
          netAmount: calculation.totalCommissionAmount,
          status: 'PENDING',
          notes: `Monthly commission calculated for ${month}`
        }
      });
    }
  }
}

