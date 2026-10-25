import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import {
  retailCommissionReport,
  retailCommissionTransactions,
  retailCommissionDashboard,
  listSubcategories,
  syncRetailCommissionsFromSales,
  resolveActorFromRequest,
} from '../pos/retailCommissions';

const router = Router();

const allowedRoles = [
  'SUPER_ADMIN',
  'SUPERADMIN',
  'ADMIN',
  'HR',
  'PLATFORM_ADMIN',
  'STORE_MANAGER',
];

/**
 * GET /api/admin/commission/dashboard
 * Subcategory-wise commission dashboard stats and top subcategories
 */
router.get(
  '/dashboard',
  authenticateToken,
  roleMiddleware(allowedRoles),
  async (req: Request, res: Response) => {
    try {
      const actor = await resolveActorFromRequest(req);
      const dashboard = await retailCommissionDashboard(actor, req.query);
      res.json(dashboard);
    } catch (error: any) {
      console.error('[Commission Dashboard] Error:', error.message);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Failed to fetch commission dashboard stats',
        stats: {
          today: { commission: 0, sales: 0, transactions: 0 },
          month: { commission: 0, sales: 0, transactions: 0 },
          period: { commission: 0, sales: 0, transactions: 0 },
          topSubcategories: [],
          recentTransactions: [],
        },
      });
    }
  }
);

/**
 * GET /api/admin/commission/transactions
 * Subcategory commission transactions with database-side pagination & filtering
 */
router.get(
  '/transactions',
  authenticateToken,
  roleMiddleware(allowedRoles),
  async (req: Request, res: Response) => {
    try {
      const actor = await resolveActorFromRequest(req);
      const result = await retailCommissionTransactions(actor, req.query);
      res.json(result);
    } catch (error: any) {
      console.error('[Commission Transactions] Error:', error.message);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Failed to fetch commission transactions',
        transactions: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
        totals: { netSales: 0, commissionAmount: 0, totalTransactions: 0 },
      });
    }
  }
);

/**
 * GET /api/admin/commission/report
 * Subcategory-wise commission report
 */
router.get(
  '/report',
  authenticateToken,
  roleMiddleware(allowedRoles),
  async (req: Request, res: Response) => {
    try {
      const actor = await resolveActorFromRequest(req);
      const report = await retailCommissionReport(actor, req.query);
      res.json({
        success: true,
        data: report,
      });
    } catch (error: any) {
      console.error('[Commission Report] Error:', error.message);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Failed to generate commission report',
        data: {
          items: [],
          total: 0,
          totals: { eligibleRevenue: 0, commissionAmount: 0, eligibleItems: 0, transactions: 0 },
          storeTotals: [],
        },
      });
    }
  }
);

/**
 * GET /api/admin/commission/subcategories
 * List active subcategories with configured commission rates
 */
router.get(
  '/subcategories',
  authenticateToken,
  roleMiddleware(allowedRoles),
  async (req: Request, res: Response) => {
    try {
      const actor = await resolveActorFromRequest(req);
      const result = await listSubcategories(actor);
      res.json(result);
    } catch (error: any) {
      console.error('[Commission Subcategories] Error:', error.message);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Failed to list subcategories',
        subcategories: [],
      });
    }
  }
);

/**
 * POST /api/admin/commission/sync-sales
 * Manually synchronize completed POS sales into retail commission snapshots
 */
router.post(
  '/sync-sales',
  authenticateToken,
  roleMiddleware(allowedRoles),
  async (req: Request, res: Response) => {
    try {
      const actor = await resolveActorFromRequest(req);
      const result = await syncRetailCommissionsFromSales(actor, req.body);
      res.json(result);
    } catch (error: any) {
      console.error('[Commission Sync] Error:', error.message);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Failed to synchronize POS retail commissions',
      });
    }
  }
);

/**
 * GET /api/admin/commission/report/export
 * Export subcategory commission report as CSV
 */
router.get(
  '/report/export',
  authenticateToken,
  roleMiddleware(allowedRoles),
  async (req: Request, res: Response) => {
    try {
      const actor = await resolveActorFromRequest(req);
      const report = await retailCommissionReport(actor, req.query);

      let csv = 'Store,Product Subcategory,Commission Type,Rate (%),Basis,Eligible Net Sales (₹),Commission Amount (₹),Completed Bills,Eligible Items\n';

      for (const row of report.items) {
        const store = (row.store || 'All Stores').replace(/"/g, '""');
        const subcat = (row.subcategoryName || 'Uncategorized').replace(/"/g, '""');
        const type = row.commissionType || 'PERCENTAGE';
        const rate = row.rate !== null && row.rate !== undefined ? `${row.rate}%` : '0%';
        const basis = row.basis || 'NET_EX_TAX';
        const sales = Number(row.eligibleRevenue || 0).toFixed(2);
        const comm = Number(row.commissionAmount || 0).toFixed(2);
        const txns = row.transactions || 0;
        const items = row.eligibleItems || 0;

        csv += `"${store}","${subcat}","${type}","${rate}","${basis}",${sales},${comm},${txns},${items}\n`;
      }

      // Add summary totals row
      const totSales = Number(report.totals?.eligibleRevenue || 0).toFixed(2);
      const totComm = Number(report.totals?.commissionAmount || 0).toFixed(2);
      const totTxns = report.totals?.transactions || 0;
      const totItems = report.totals?.eligibleItems || 0;
      csv += `\n"TOTAL","","","","",${totSales},${totComm},${totTxns},${totItems}\n`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="subcategory-commission-report-${Date.now()}.csv"`
      );
      res.send(csv);
    } catch (error: any) {
      console.error('[Commission Export] Error:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

export default router;
