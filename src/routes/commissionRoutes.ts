import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { fetchCommissionReport } from '../controllers/commissionController';
import { syncHopkidSales } from '../utils/salesSync';

const router = Router();

// Apply authorization middleware
router.use(authMiddleware);

// GET /api/commission/report
router.get('/report', fetchCommissionReport);

// POST /api/commission/sync-sales  (Admin: manually pull HopKid sales into commission transactions)
router.post('/sync-sales', async (req: Request, res: Response): Promise<void> => {
  try {
    const { fromDate, toDate } = req.body;
    const result = await syncHopkidSales({
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      force: true,
    });
    res.json({
      success: true,
      message: `Sync complete. ${result.synced} new transactions created, ${result.skipped} already existed, ${result.errors} errors.`,
      result,
    });
  } catch (error: any) {
    console.error('Manual sales sync error:', error);
    // Return 400 with the descriptive error so the frontend shows it clearly
    res.status(400).json({
      success: false,
      message: error?.message || 'Sales sync failed. Check HopKid API configuration in Admin Settings.',
    });
  }
});

export default router;

