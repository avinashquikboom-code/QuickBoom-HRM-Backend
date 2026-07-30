import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import { Role } from '@prisma/client';
import {
  getAllMobileStores,
  getMobileStoreDetails,
  getMobileStoreEmployees,
  getMobileStoreReports,
  getMobileStoreDashboard
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
// GET /api/mobile/store/all — all active stores (any authenticated role)
router.get('/all', getAllMobileStores);

const ALLOWED_STORE_ROLES = [
  Role.STORE_MANAGER,
  Role.HR,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.PLATFORM_ADMIN,
];

router.get('/', roleMiddleware(ALLOWED_STORE_ROLES), getMobileStoreDetails);
router.get('/dashboard', roleMiddleware(ALLOWED_STORE_ROLES), getMobileStoreDashboard);

/**
 * @swagger
 * /api/mobile/store/employees:
 *   get:
 *     summary: Get employees of assigned store (Store Manager & HR) (Mobile)
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
 *         description: Forbidden (Store Manager / HR only)
 *       404:
 *         description: Store not found
 *       500:
 *         description: Server error
 */
router.get('/employees', roleMiddleware(ALLOWED_STORE_ROLES), getMobileStoreEmployees);

/**
 * @swagger
 * /api/mobile/store/reports:
 *   get:
 *     summary: Get store reports (Store Manager & HR) (Mobile)
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
 *         description: Forbidden (Store Manager / HR only)
 *       404:
 *         description: Store not found
 *       500:
 *         description: Server error
 */
router.get('/reports', roleMiddleware(ALLOWED_STORE_ROLES), getMobileStoreReports);

export default router;
