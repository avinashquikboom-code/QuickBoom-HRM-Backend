import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { prisma } from '../utils/db';
import { getNumericInvoiceNumber } from '../utils/commissionHelper';

const router = Router();

function formatDisplayDate(date: Date): string {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * GET /api/admin/dashboard
 * Admin dashboard with commission overview
 */
router.get('/', authenticateToken, roleMiddleware(['ADMIN', 'SUPERADMIN', 'STORE_MANAGER']), async (req: Request, res: Response) => {
  try {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [DASHBOARD] Loading...                                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    const today = new Date();
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const dayEnd   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    console.log('[Dashboard] Fetching today\'s stats:', {
      from: dayStart.toISOString(),
      to: dayEnd.toISOString(),
    });

    const todayTransactions = await prisma.commissionTransaction.findMany({
      where: {
        createdAt: { gte: dayStart, lte: dayEnd },
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
      },
      include: { employee: true },
    });

    const todayTotalSales = todayTransactions.reduce((sum, s) => sum + s.saleAmount, 0);
    const todayTotalCommission = todayTransactions.reduce((sum, s) => sum + s.commissionAmount, 0);

    console.log('[Dashboard] Today stats:', {
      sales: todayTotalSales,
      commission: todayTotalCommission,
      billCount: todayTransactions.length,
    });

    // ─── THIS MONTH STATS ──────────────────────────────────────────────────
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

    console.log('[Dashboard] Fetching month stats:', {
      from: monthStart.toISOString(),
      to: monthEnd.toISOString(),
    });

    const monthTransactions = await prisma.commissionTransaction.findMany({
      where: {
        createdAt: { gte: monthStart, lte: monthEnd },
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
      },
      include: { employee: true },
    });

    const monthTotalSales = monthTransactions.reduce((sum, s) => sum + s.saleAmount, 0);
    const monthTotalCommission = monthTransactions.reduce((sum, s) => sum + s.commissionAmount, 0);

    console.log('[Dashboard] Month stats:', {
      sales: monthTotalSales,
      commission: monthTotalCommission,
      billCount: monthTransactions.length,
    });

    // ─── TOP PERFORMERS ────────────────────────────────────────────────────
    const employeeCommission = new Map<number, any>();

    for (const tx of monthTransactions) {
      const empId = tx.employeeId;
      const empName = tx.employee ? `${tx.employee.firstName} ${tx.employee.lastName}`.trim() : `Employee ${empId}`;
      const empCode = tx.employee?.employeeCode || `EMP_${empId}`;

      if (!employeeCommission.has(empId)) {
        employeeCommission.set(empId, {
          employeeName: empName,
          employeeCode: empCode,
          totalCommission: 0,
          totalSales: 0,
        });
      }

      const data = employeeCommission.get(empId);
      data.totalCommission += tx.commissionAmount;
      data.totalSales += tx.saleAmount;
    }

    const topPerformers = Array.from(employeeCommission.values())
      .sort((a, b) => b.totalCommission - a.totalCommission)
      .slice(0, 5)
      .map((data, index) => ({
        rank: index + 1,
        employeeName: data.employeeName,
        employeeCode: data.employeeCode,
        totalCommission: Math.round(data.totalCommission * 100) / 100,
        totalSales: Math.round(data.totalSales * 100) / 100,
      }));

    // ─── LATEST BILLS ──────────────────────────────────────────────────────
    const latestBills = await prisma.commissionTransaction.findMany({
      take: 10,
      orderBy: [{ id: 'desc' }, { createdAt: 'desc' }],
      where: { status: { in: ['PENDING', 'APPROVED', 'PAID', 'SUCCESS', 'ACTIVE', 'COMPLETED'] } },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    });

    const latestBillsFormatted = latestBills.map((bill) => {
      const empName = bill.employee ? `${bill.employee.firstName} ${bill.employee.lastName}`.trim() : 'N/A';
      const numInv = getNumericInvoiceNumber(bill);
      return {
        billId: bill.billId || bill.invoiceNumber || `TXN-${bill.id}`,
        invoiceNumber: numInv,
        billNumber: numInv,
        invoiceNo: numInv,
        date: bill.createdAt.toISOString().split('T')[0],
        displayDate: formatDisplayDate(bill.createdAt),
        employeeName: empName,
        saleAmount: bill.saleAmount,
        commission: Math.round(bill.commissionAmount * 100) / 100,
      };
    });

    console.log('[Dashboard] Latest bills:', latestBillsFormatted.length);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    res.json({
      success: true,
      data: {
        today: {
          totalSales: Math.round(todayTotalSales * 100) / 100,
          totalCommission: Math.round(todayTotalCommission * 100) / 100,
          billCount: todayTransactions.length,
          date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
        },
        thisMonth: {
          totalSales: Math.round(monthTotalSales * 100) / 100,
          totalCommission: Math.round(monthTotalCommission * 100) / 100,
          billCount: monthTransactions.length,
          month: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
        },
        topPerformers,
        latestBills: latestBillsFormatted,
      },
    });
  } catch (error: any) {
    console.error('[Dashboard] ❌ Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
