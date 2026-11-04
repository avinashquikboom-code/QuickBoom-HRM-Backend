/**
 * Mobile Overtime Routes
 * Endpoints for employees to view their own overtime.
 */

import { Router } from 'express';
import { MobileOvertimeController } from '../../controllers/mobile/mobileOvertimeController';
import { authMiddleware } from '../../middlewares/authMiddleware';

const router = Router();

// Secure employee authentication required
router.use(authMiddleware);

router.get('/today', MobileOvertimeController.getTodayOvertime);
router.get('/summary', MobileOvertimeController.getMonthlySummary);
router.get('/history', MobileOvertimeController.getHistory);
router.post('/request', MobileOvertimeController.requestOvertime);

export default router;

