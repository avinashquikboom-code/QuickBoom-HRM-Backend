import { protectLegacyPOSReview } from '../pos/commissions';
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  createCommissionTransaction,
  approveCommissionTransaction,
  rejectCommissionTransaction,
  getCommissionPolicies,
  getCommissionPolicyById,
  getCommissionTargets,
  searchSalesByBillId,
} from '../controllers/commissionController';
import {
  retailCommissionReport,
  retailCommissionTransactions,
  retailCommissionDashboard,
  listSubcategories,
  syncRetailCommissionsFromSales,
  resolveActorFromRequest,
} from '../pos/retailCommissions';

const router = Router();

// Apply authorization middleware
router.use(authMiddleware);

// GET /api/commission/transactions (Subcategory-wise with database pagination)
router.get('/transactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = await resolveActorFromRequest(req);
    const result = await retailCommissionTransactions(actor, req.query);
    res.json(result);
  } catch (error: any) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to fetch transactions',
      transactions: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
      totals: { netSales: 0, commissionAmount: 0, totalTransactions: 0 },
    });
  }
});

// POST /api/commission/transactions
router.post('/transactions', createCommissionTransaction);

// PUT /api/commission/transactions/:id/approve
router.put('/transactions/:id/approve', protectLegacyPOSReview('APPROVED'), approveCommissionTransaction);

// PUT /api/commission/transactions/:id/reject
router.put('/transactions/:id/reject', protectLegacyPOSReview('REJECTED'), rejectCommissionTransaction);

// GET /api/commission/dashboard (Subcategory-wise metrics)
router.get('/dashboard', async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = await resolveActorFromRequest(req);
    const dashboard = await retailCommissionDashboard(actor, req.query);
    res.json(dashboard);
  } catch (error: any) {
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
});

// GET /api/commission/subcategories
router.get('/subcategories', async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = await resolveActorFromRequest(req);
    const result = await listSubcategories(actor);
    res.json(result);
  } catch (error: any) {
    res.status(error.status || 500).json({ success: false, message: error.message, subcategories: [] });
  }
});

// GET /api/commission/policies
router.get('/policies', getCommissionPolicies);

// GET /api/commission/policies/:id
router.get('/policies/:id', getCommissionPolicyById);

// GET /api/commission/targets
router.get('/targets', getCommissionTargets);

// GET /api/commission/search/:billId
router.get('/search/:billId', searchSalesByBillId);

// GET /api/commission/report (Subcategory-wise report)
router.get('/report', async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = await resolveActorFromRequest(req);
    const report = await retailCommissionReport(actor, req.query);
    res.json({ success: true, data: report });
  } catch (error: any) {
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
});

// POST /api/commission/sync-sales
router.post('/sync-sales', async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = await resolveActorFromRequest(req);
    const result = await syncRetailCommissionsFromSales(actor, req.body);
    res.json(result);
  } catch (error: any) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

export default router;
