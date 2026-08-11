import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { prisma } from '../utils/db';

const router = Router();

/**
 * Helper to format date as DD/MM/YYYY in IST/Local time
 */
function formatDisplayDate(date: Date): string {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * GET /api/admin/commission/report
 * Comprehensive commission report with correct dates
 */
router.get('/report', authenticateToken, roleMiddleware(['ADMIN', 'SUPERADMIN', 'STORE_MANAGER']), async (req: Request, res: Response) => {
  try {
    const { from, to, period = 'current_month' } = req.query;

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [COMMISSION REPORT] Generating...                         ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    let fromDate: Date;
    let toDate: Date = new Date();

    switch (period) {
      case 'today':
        fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 0, 0, 0, 0);
        toDate   = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999);
        break;

      case 'yesterday': {
        const yesterday = new Date(toDate);
        yesterday.setDate(yesterday.getDate() - 1);
        fromDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0, 0);
        toDate   = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
        break;
      }

      case 'previous_month': {
        const prevMonth = new Date(toDate.getFullYear(), toDate.getMonth() - 1, 1);
        fromDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1, 0, 0, 0, 0);
        toDate   = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      }

      case 'custom_range':
        if (!from || !to) {
          return res.status(400).json({
            success: false,
            message: 'from and to dates required for custom range',
          });
        }
        fromDate = new Date(from as string);
        toDate   = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        break;

      case 'current_month':
      default:
        fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), 1, 0, 0, 0, 0);
        toDate   = new Date(toDate.getFullYear(), toDate.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
    }

    console.log('[Report] Date range:', {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      periodLabel: period,
    });

    const transactions = await prisma.commissionTransaction.findMany({
      where: {
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            commissionPercentage: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log('[Report] ✅ Sales transactions found:', transactions.length);

    if (transactions.length === 0) {
      return res.json({
        success: true,
        data: {
          report: [],
          summary: {
            totalSalesAmount: 0,
            totalCommission: 0,
            employeeCount: 0,
            billCount: 0,
            period: {
              from: fromDate.toISOString().split('T')[0],
              to: toDate.toISOString().split('T')[0],
              displayFrom: formatDisplayDate(fromDate),
              displayTo: formatDisplayDate(toDate),
            },
          },
        },
      });
    }

    const employeeMap = new Map<number, any>();
    let totalSalesAmount = 0;
    let totalCommission = 0;

    for (const tx of transactions) {
      const empId = tx.employeeId;
      const empName = tx.employee ? `${tx.employee.firstName} ${tx.employee.lastName}`.trim() : 'Unknown';
      const rate = tx.commissionPercent ?? tx.employee?.commissionPercentage ?? 0;
      const commission = tx.commissionAmount;

      if (!employeeMap.has(empId)) {
        employeeMap.set(empId, {
          employee: {
            id: empId,
            name: empName,
            code: tx.employee?.employeeCode || `EMP_${empId}`,
            commissionRate: rate,
          },
          totalSalesAmount: 0,
          totalCommission: 0,
          billCount: 0,
          bills: [],
        });
      }

      const empData = employeeMap.get(empId);
      empData.totalSalesAmount += tx.saleAmount;
      empData.totalCommission += commission;
      empData.billCount += 1;
      empData.bills.push({
        billId: tx.billId || tx.invoiceNumber || `TXN-${tx.id}`,
        date: tx.createdAt.toISOString().split('T')[0],
        displayDate: formatDisplayDate(tx.createdAt),
        saleAmount: tx.saleAmount,
        commission: commission,
        description: tx.notes,
      });

      totalSalesAmount += tx.saleAmount;
      totalCommission += commission;
    }

    const reportData = Array.from(employeeMap.values())
      .map((empData) => ({
        employee: empData.employee,
        totalSalesAmount: Math.round(empData.totalSalesAmount * 100) / 100,
        totalCommission: Math.round(empData.totalCommission * 100) / 100,
        billCount: empData.billCount,
        bills: empData.bills,
      }))
      .sort((a, b) => b.totalCommission - a.totalCommission);

    res.json({
      success: true,
      data: {
        report: reportData,
        summary: {
          totalSalesAmount: Math.round(totalSalesAmount * 100) / 100,
          totalCommission: Math.round(totalCommission * 100) / 100,
          employeeCount: employeeMap.size,
          billCount: transactions.length,
          period: {
            from: fromDate.toISOString().split('T')[0],
            to: toDate.toISOString().split('T')[0],
            periodLabel: period,
            displayFrom: formatDisplayDate(fromDate),
            displayTo: formatDisplayDate(toDate),
          },
        },
      },
    });
  } catch (error: any) {
    console.error('[Report] ❌ Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/admin/commission/report/export
 * Export commission report as CSV
 */
router.get('/report/export', authenticateToken, roleMiddleware(['ADMIN', 'SUPERADMIN', 'STORE_MANAGER']), async (req: Request, res: Response) => {
  try {
    const { from, to, period = 'current_month' } = req.query;

    let fromDate: Date;
    let toDate: Date = new Date();

    switch (period) {
      case 'today':
        fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 0, 0, 0, 0);
        toDate   = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999);
        break;
      case 'yesterday': {
        const yesterday = new Date(toDate);
        yesterday.setDate(yesterday.getDate() - 1);
        fromDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0, 0);
        toDate   = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
        break;
      }
      case 'previous_month': {
        const prevMonth = new Date(toDate.getFullYear(), toDate.getMonth() - 1, 1);
        fromDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1, 0, 0, 0, 0);
        toDate   = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      }
      case 'custom_range':
        fromDate = from ? new Date(from as string) : new Date(toDate.getFullYear(), toDate.getMonth(), 1);
        toDate   = to ? new Date(to as string) : toDate;
        toDate.setHours(23, 59, 59, 999);
        break;
      case 'current_month':
      default:
        fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), 1, 0, 0, 0, 0);
        toDate   = new Date(toDate.getFullYear(), toDate.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
    }

    const transactions = await prisma.commissionTransaction.findMany({
      where: {
        createdAt: { gte: fromDate, lte: toDate },
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
      },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });

    let csv = 'Bill ID,Date,Display Date,Employee,Sale Amount,Commission Rate,Commission Amount\n';

    for (const tx of transactions) {
      const rate = tx.commissionPercent ?? tx.employee?.commissionPercentage ?? 0;
      const empName = tx.employee ? `${tx.employee.firstName} ${tx.employee.lastName}`.trim() : 'N/A';
      const bId = tx.billId || tx.invoiceNumber || `TXN-${tx.id}`;
      const isoDate = tx.createdAt.toISOString().split('T')[0];
      const dispDate = formatDisplayDate(tx.createdAt);
      csv += `"${bId}","${isoDate}","${dispDate}","${empName}",${tx.saleAmount},${rate}%,${tx.commissionAmount}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="commission-report-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error: any) {
    console.error('[Export] ❌ Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
