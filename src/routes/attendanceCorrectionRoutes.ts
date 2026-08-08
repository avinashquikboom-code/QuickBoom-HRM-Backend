import { Router } from 'express';
import {
  applyCorrectionRequest,
  getMyCorrections,
  getHRAttendanceCorrections,
  getHRAttendanceCorrectionDetail,
  reviewHRAttendanceCorrection,
  getHRAttendanceCorrectionReports,
} from '../controllers/attendanceCorrectionController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();

// Employee routes
router.post('/mobile/attendance/correction-request', authMiddleware, applyCorrectionRequest);
router.get('/mobile/attendance/my-corrections', authMiddleware, getMyCorrections);

// HR routes
router.get('/hr/attendance/correction-requests', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), getHRAttendanceCorrections);
router.get('/hr/attendance/correction-reports', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), getHRAttendanceCorrectionReports);
router.get('/hr/attendance/correction-requests/:id', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), getHRAttendanceCorrectionDetail);
router.patch('/hr/attendance/correction-requests/:id', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), reviewHRAttendanceCorrection);

export default router;
