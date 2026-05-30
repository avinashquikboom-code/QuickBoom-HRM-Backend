import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { Role } from '@prisma/client';
import {
  fetchHRStats,
  fetchDepartmentOverview,
  fetchLeaveOverview,
  fetchHREmployees,
  fetchAttendanceTrend,
  fetchHRActivity,
} from '../controllers/hrController';

const router = express.Router();

// Only platform admins and HR roles can access HR management data
router.use(authMiddleware);
router.use(roleMiddleware([Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.HR, Role.ADMIN]));

router.get('/stats', fetchHRStats);
router.get('/departments', fetchDepartmentOverview);
router.get('/leaves', fetchLeaveOverview);
router.get('/employees', fetchHREmployees);
router.get('/attendance-trend', fetchAttendanceTrend);
router.get('/activity', fetchHRActivity);

export default router;
