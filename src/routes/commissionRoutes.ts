import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { fetchCommissionReport } from '../controllers/commissionController';

const router = Router();

// Apply authorization middleware
router.use(authMiddleware);

// GET /api/commission/report
router.get('/report', fetchCommissionReport);

export default router;
