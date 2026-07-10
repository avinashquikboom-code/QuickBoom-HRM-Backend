import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  getAttendanceSettings,
  updateAttendanceSettings,
  getTodayAttendance,
  markAttendance,
  getAttendanceReport,
} from '../controllers/attendanceController';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Attendance settings
router.get('/settings', getAttendanceSettings);
router.put('/settings', updateAttendanceSettings);

// Attendance management
router.get('/today', getTodayAttendance);
router.post('/mark', markAttendance);
router.get('/report', getAttendanceReport);

export default router;