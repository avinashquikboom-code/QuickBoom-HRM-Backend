import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import {
  getMobileCommissionDashboard,
  getMobileCommissionTransactions,
  getMobileCommissionTargets,
  getMobileCommissionSettlements
} from '../../controllers/mobile/mobileCommissionController';

const router = Router();

// Apply auth middleware to protect all mobile commission routes
router.use(authMiddleware);

// Restrict access to mobile roles only (Store Manager, Salesman, Helper)
const mobileRoles = ['STORE_MANAGER', 'SALESMAN', 'HELPER'];
router.use(roleMiddleware(mobileRoles));

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

export default router;
