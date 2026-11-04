/**
 * Admin Overtime Routes
 * Guarded routes for managing and approving employee overtime records.
 */

import { Router } from 'express';
import { AdminOvertimeController } from '../../controllers/admin/adminOvertimeController';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';

const router = Router();

// Require admin authentication
router.use(authMiddleware);

// Permitted roles
const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN', 'STORE_MANAGER'];
router.use(roleMiddleware(adminRoles));

router.get('/', AdminOvertimeController.listOvertime);
router.get('/stats', AdminOvertimeController.getOvertimeStats);
router.patch('/:id/approve', AdminOvertimeController.approve);
router.patch('/:id/reject', AdminOvertimeController.reject);
router.post('/bulk-approve', AdminOvertimeController.bulkApprove);
router.post('/recalculate', AdminOvertimeController.recalculate);

export default router;

