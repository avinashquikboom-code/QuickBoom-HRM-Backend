import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { fetchCommissionReport } from '../controllers/commissionController';
import { syncHopkidSales } from '../utils/salesSync';

const router = Router();

// Apply authorization middleware
router.use(authMiddleware);

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

