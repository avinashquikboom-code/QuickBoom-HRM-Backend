import { Router } from 'express';
import { getSalarySlip } from '../controllers/salaryController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// GET /api/salary/slip
router.get('/slip', authenticateToken, getSalarySlip);

export default router;
