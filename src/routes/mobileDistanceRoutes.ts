import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  getCurrentDistance,
  getDistanceHistory,
  getOfficeInfo
} from '../controllers/distanceTrackingController';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * @route GET /api/mobile/distance/current
 * @desc Get current distance from office
 * @access Private (Employee)
 */
router.get('/current', getCurrentDistance);

/**
 * @route GET /api/mobile/distance/history
 * @desc Get distance tracking history
 * @access Private (Employee)
 */
router.get('/history', getDistanceHistory);

/**
 * @route GET /api/mobile/distance/office-info
 * @desc Get office information for distance tracking
 * @access Private (Employee)
 */
router.get('/office-info', getOfficeInfo);

export default router;
