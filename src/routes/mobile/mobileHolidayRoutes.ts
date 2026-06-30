import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import {
  getMobileHolidays
} from '../../controllers/mobile/mobileHolidayController';

const router = Router();

// Apply auth middleware to protect all mobile holiday routes
router.use(authMiddleware);

// Restrict access to mobile roles only (Store Manager, Salesman, Helper)
const mobileRoles = ['STORE_MANAGER', 'SALESMAN', 'HELPER'];
router.use(roleMiddleware(mobileRoles));

/**
 * @swagger
 * /api/mobile/holidays:
 *   get:
 *     summary: Get holiday calendar (Mobile)
 *     tags: [Mobile - Holidays]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Filter by year (defaults to current year)
 *     responses:
 *       200:
 *         description: Holidays retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', getMobileHolidays);

export default router;
