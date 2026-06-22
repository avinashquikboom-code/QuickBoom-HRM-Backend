import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import { getUpcomingWidgetData } from '../../controllers/mobile/upcomingController';

const router = Router();

// Apply auth middleware to protect all mobile upcoming routes
router.use(authMiddleware);

// Restrict access to employees, HR, and admins
const allowedRoles = ['EMPLOYEE', 'HR', 'SUPER_ADMIN', 'ADMIN'];
router.use(roleMiddleware(allowedRoles));

/**
 * @swagger
 * /api/mobile/dashboard/upcoming:
 *   get:
 *     summary: Fetch upcoming shift, holiday, leave, salary date, and latest announcement for logged-in employee (Mobile)
 *     tags: [Mobile - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Upcoming events retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/upcoming', getUpcomingWidgetData);

export default router;
