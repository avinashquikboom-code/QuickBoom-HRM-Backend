import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import { Role } from '@prisma/client';
import {
  getMobileStoreDetails,
  getMobileStoreEmployees,
  getMobileStoreReports
} from '../../controllers/mobile/mobileStoreController';

const router = Router();

// Apply auth middleware to protect all mobile store routes
router.use(authMiddleware);

/**
 * @swagger
 * /api/mobile/store:
 *   get:
 *     summary: Get store details for logged-in Store Manager (Mobile)
 *     tags: [Mobile - Store]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Store details retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Store Manager only)
 *       404:
 *         description: Store not found
 *       500:
 *         description: Server error
 */
router.get('/', roleMiddleware([Role.STORE_MANAGER]), getMobileStoreDetails);

/**
 * @swagger
 * /api/mobile/store/employees:
 *   get:
 *     summary: Get employees of assigned store (Store Manager only) (Mobile)
 *     tags: [Mobile - Store]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by employee status (active, inactive)
 *     responses:
 *       200:
 *         description: Store employees retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Store Manager only)
 *       404:
 *         description: Store not found
 *       500:
 *         description: Server error
 */
router.get('/employees', roleMiddleware([Role.STORE_MANAGER]), getMobileStoreEmployees);

/**
 * @swagger
 * /api/mobile/store/reports:
 *   get:
 *     summary: Get store reports (Store Manager only) (Mobile)
 *     tags: [Mobile - Store]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for report period (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for report period (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Store reports retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Store Manager only)
 *       404:
 *         description: Store not found
 *       500:
 *         description: Server error
 */
router.get('/reports', roleMiddleware([Role.STORE_MANAGER]), getMobileStoreReports);

export default router;
