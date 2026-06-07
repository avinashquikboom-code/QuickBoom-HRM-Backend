import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  getComprehensiveAttendanceReport,
  getAttendanceTrends,
  getLocationTrackingReport
} from '../controllers/comprehensiveAttendanceController';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Get comprehensive attendance report
router.get('/comprehensive-report', getComprehensiveAttendanceReport);

// Get attendance trends
router.get('/trends', getAttendanceTrends);

// Get location tracking report
router.get('/location-tracking', getLocationTrackingReport);

export default router;
