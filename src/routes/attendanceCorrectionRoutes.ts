import { Router } from 'express';
import { authMiddleware as authenticate } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import {
  submitCorrectionRequest,
  getMyCorrectionRequests,
  getHRCorrectionRequests,
  reviewCorrectionRequest,
} from '../controllers/attendanceCorrectionController';

const router = Router();

const hrRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN', 'STORE_MANAGER'];

// Employee endpoints
router.post('/mobile/attendance/correction-request', authenticate, submitCorrectionRequest);
router.get('/mobile/attendance/correction-requests', authenticate, getMyCorrectionRequests);

// HR endpoints
router.get('/hr/attendance/correction-requests', authenticate, roleMiddleware(hrRoles), getHRCorrectionRequests);
router.patch('/hr/attendance/correction-requests/:id', authenticate, roleMiddleware(hrRoles), reviewCorrectionRequest);

export default router;
