import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { Role } from '@prisma/client';
import {
  getPendingLeaveRequests,
  getRecentLeaveActivity,
  getLeaveRequestStats,
  getLeaveNotifications,
  markLeaveNotificationsRead,
} from '../controllers/realtimeLeaveController';

const router = Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Apply HR/Admin role middleware to all routes
router.use(roleMiddleware([Role.HR, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN]));

// GET /api/realtime/leave/pending - Get pending leave requests
router.get('/pending', getPendingLeaveRequests);

// GET /api/realtime/leave/activity - Get recent leave activity
router.get('/activity', getRecentLeaveActivity);

// GET /api/realtime/leave/stats - Get leave request statistics
router.get('/stats', getLeaveRequestStats);

// GET /api/realtime/leave/notifications - Get leave notifications
router.get('/notifications', getLeaveNotifications);

// PUT /api/realtime/leave/notifications/read - Mark notifications as read
router.put('/notifications/read', markLeaveNotificationsRead);

export default router;
