import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  fetchCommissionReport,
  getCommissionTransactions,
  createCommissionTransaction,
  approveCommissionTransaction,
  rejectCommissionTransaction,
  getCommissionDashboard,
  getCommissionPolicies,
  getCommissionPolicyById,
  getCommissionTargets,
  searchSalesByBillId,
} from '../controllers/commissionController';

const router = Router();

// Apply authorization middleware
router.use(authMiddleware);

// GET /api/commission/transactions
router.get('/transactions', getCommissionTransactions);

// POST /api/commission/transactions
router.post('/transactions', createCommissionTransaction);

// PUT /api/commission/transactions/:id/approve
router.put('/transactions/:id/approve', approveCommissionTransaction);

// PUT /api/commission/transactions/:id/reject
router.put('/transactions/:id/reject', rejectCommissionTransaction);

// GET /api/commission/dashboard
router.get('/dashboard', getCommissionDashboard);

// GET /api/commission/policies
router.get('/policies', getCommissionPolicies);

// GET /api/commission/policies/:id
router.get('/policies/:id', getCommissionPolicyById);

// GET /api/commission/targets
router.get('/targets', getCommissionTargets);

// GET /api/commission/search/:billId
router.get('/search/:billId', searchSalesByBillId);

// GET /api/commission/report
router.get('/report', fetchCommissionReport);

// POST /api/commission/sync-sales
router.post('/sync-sales', async (req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    message: 'Local sales tracking active. Sales and commissions are recorded in real-time when logged via the mobile app.',
    result: { synced: 0, skipped: 0, errors: 0 },
  });
});

export default router;

