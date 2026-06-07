import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  getComprehensiveAttendanceReport,
  getAttendanceTrends,
  getLocationTrackingReport,
  downloadComprehensiveAttendanceReport
} from '../controllers/comprehensiveAttendanceController';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Get comprehensive attendance report
router.get('/comprehensive-report', getComprehensiveAttendanceReport);

// Download comprehensive attendance report as PDF
router.get('/comprehensive-report/download', downloadComprehensiveAttendanceReport);

// Get attendance trends
router.get('/trends', getAttendanceTrends);

// Get location tracking report
router.get('/location-tracking', getLocationTrackingReport);

export default router;
