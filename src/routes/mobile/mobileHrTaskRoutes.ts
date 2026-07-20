import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import { getHrTasksMobile, createHrTaskMobile } from '../../controllers/mobile/mobileHrTaskController';

const router = Router();

// Store Managers and other admin-level roles can assign/view all store tasks
router.use(authMiddleware);
router.use(roleMiddleware(['STORE_MANAGER', 'HR', 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN']));

/**
 * GET /api/hr/tasks
 * Mobile view of all tasks (optionally filtered by employee)
 */
router.get('/', getHrTasksMobile);

/**
 * POST /api/hr/tasks
 * Mobile assign new task
 */
router.post('/', createHrTaskMobile);

export default router;
