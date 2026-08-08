import { Router } from 'express';
import {
  applyCorrectionRequest,
  getMyCorrections,
  getHRAttendanceCorrections,
  getHRAttendanceCorrectionDetail,
  reviewHRAttendanceCorrection,
  bulkReviewHRAttendanceCorrections,
  exportHRAttendanceCorrections,
  getHRAttendanceCorrectionReports,
} from '../controllers/attendanceCorrectionController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();
const hrRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN', 'STORE_MANAGER'];

// Employee routes
router.post('/mobile/attendance/correction-request', authMiddleware, applyCorrectionRequest);
router.get('/mobile/attendance/my-corrections', authMiddleware, getMyCorrections);

// HR routes
router.get('/hr/attendance/correction-requests', authMiddleware, roleMiddleware(hrRoles), getHRAttendanceCorrections);
router.get('/hr/attendance/correction-reports', authMiddleware, roleMiddleware(hrRoles), getHRAttendanceCorrectionReports);
router.get('/hr/attendance/correction-requests/export', authMiddleware, roleMiddleware(hrRoles), exportHRAttendanceCorrections);
router.post('/hr/attendance/correction-requests/bulk-review', authMiddleware, roleMiddleware(hrRoles), bulkReviewHRAttendanceCorrections);
router.get('/hr/attendance/correction-requests/:id', authMiddleware, roleMiddleware(hrRoles), getHRAttendanceCorrectionDetail);
router.patch('/hr/attendance/correction-requests/:id', authMiddleware, roleMiddleware(hrRoles), reviewHRAttendanceCorrection);

export default router;
