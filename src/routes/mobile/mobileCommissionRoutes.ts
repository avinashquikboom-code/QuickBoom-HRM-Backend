import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import { requirePermission } from '../../middlewares/permissionCheckMiddleware';
import {
  getMobileCommissionDashboard,
  getMobileCommissionTransactions,
  getMobileCommissionDaily,
  getMobileCommissionTargets,
  getMobileCommissionSettlements,
  getMobileWebhookLogs,
  getMobileCommissionSummary,
  getMobileCommissionBills,
  getMobileCommissionBillDetail,
} from '../../controllers/mobile/mobileCommissionController';

const router = Router();

// Apply auth middleware and permission guard to protect all mobile commission routes
router.use(authMiddleware);
router.use(requirePermission('canViewCommission'));

// Allow all employee roles (EMPLOYEE, STORE_MANAGER, SALESMAN, HELPER, etc.)
const mobileRoles = ['EMPLOYEE', 'STORE_MANAGER', 'SALESMAN', 'HELPER', 'ADMIN', 'SUPERADMIN'];
router.use(roleMiddleware(mobileRoles));

router.get('/summary', getMobileCommissionSummary);
router.get('/bills', getMobileCommissionBills);
router.get('/bill/:billId', getMobileCommissionBillDetail);

/**
 * @swagger
 * /api/mobile/commission/dashboard:
 *   get:
 *     summary: Get commission dashboard stats for logged-in user (Mobile)
 *     tags: [Mobile - Commission]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Commission dashboard retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/dashboard', getMobileCommissionDashboard);

/**
 * @swagger
 * /api/mobile/commission/transactions:
 *   get:
 *     summary: Get commission transactions for logged-in user (Mobile)
 *     tags: [Mobile - Commission]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status (PENDING, APPROVED, REJECTED, PAID)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of records to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of records to skip
 *     responses:
 *       200:
 *         description: Commission transactions retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/transactions', getMobileCommissionTransactions);

/**
 * GET /api/mobile/commission/daily
 * Get daily commission breakdown for logged-in user (Mobile)
 */
router.get('/daily', getMobileCommissionDaily);

/**
 * @swagger
 * /api/mobile/commission/targets:
 *   get:
 *     summary: Get commission targets for logged-in user (Mobile)
 *     tags: [Mobile - Commission]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status (ACTIVE, ACHIEVED, MISSED, CANCELLED)
 *     responses:
 *       200:
 *         description: Commission targets retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/targets', getMobileCommissionTargets);

/**
 * @swagger
 * /api/mobile/commission/settlements:
 *   get:
 *     summary: Get commission settlements for logged-in user (Mobile)
 *     tags: [Mobile - Commission]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status (PENDING, PROCESSED, PAID)
 *     responses:
 *       200:
 *         description: Commission settlements retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/settlements', getMobileCommissionSettlements);

/**
 * GET /api/mobile/commission/webhook-logs
 * Recent webhook events scoped to the logged-in employee.
 * Auth + role guard applied by router.use() above.
 */
router.get('/webhook-logs', getMobileWebhookLogs);

export default router;
