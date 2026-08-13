import { Router } from 'express';
import { authMiddleware, requireRole } from '../middlewares/authMiddleware';
import { getActivityLogs } from '../controllers/activityLogsController';

const router = Router();

// Restrict Activity Logs viewing to authorized Super Admin & HR Admin roles
const adminOnlyRoles = ['super_admin', 'platform_admin', 'hr_admin', 'admin', 'superadmin', 'hr'];

router.get('/', authMiddleware, requireRole(adminOnlyRoles), getActivityLogs);

export default router;
