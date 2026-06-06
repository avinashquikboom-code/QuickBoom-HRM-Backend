import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import {
  startTrackingSession,
  stopTrackingSession,
  updateLocation,
  getActiveSessions,
  getLocationHistory,
  getLiveLocations
} from '../../controllers/liveTrackingController';

const router = Router();

// Apply auth middleware to protect all mobile tracking routes
router.use(authMiddleware);

// Restrict access to employees and HR managers
const employeeRoles = ['EMPLOYEE', 'HR', 'SUPER_ADMIN', 'ADMIN'];
router.use(roleMiddleware(employeeRoles));

/**
 * @swagger
 * /api/mobile/tracking/start:
 *   post:
 *     summary: Start a tracking session (Mobile)
 *     tags: [Mobile Tracking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - purpose
 *             properties:
 *               purpose:
 *                 type: string
 *                 description: Purpose of tracking session
 *               notes:
 *                 type: string
 *                 description: Additional notes for the session
 *     responses:
 *       200:
 *         description: Tracking session started successfully
 *       400:
 *         description: Bad request - missing required fields
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Server error
 */
router.post('/start', startTrackingSession);

/**
 * @swagger
 * /api/mobile/tracking/stop:
 *   post:
 *     summary: Stop a tracking session (Mobile)
 *     tags: [Mobile Tracking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: ID of the tracking session to stop
 *     responses:
 *       200:
 *         description: Tracking session stopped successfully
 *       400:
 *         description: Bad request - missing session ID
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/stop', stopTrackingSession);

/**
 * @swagger
 * /api/mobile/tracking/location:
 *   post:
 *     summary: Update current location (Mobile)
 *     tags: [Mobile Tracking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - latitude
 *               - longitude
 *             properties:
 *               latitude:
 *                 type: number
 *                 description: Current latitude
 *               longitude:
 *                 type: number
 *                 description: Current longitude
 *               accuracy:
 *                 type: number
 *                 description: GPS accuracy in meters
 *               speed:
 *                 type: number
 *                 description: Current speed in m/s
 *               heading:
 *                 type: number
 *                 description: Current heading in degrees
 *               altitude:
 *                 type: number
 *                 description: Current altitude in meters
 *     responses:
 *       200:
 *         description: Location updated successfully
 *       400:
 *         description: Bad request - missing coordinates
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/location', updateLocation);

/**
 * @swagger
 * /api/mobile/tracking/sessions:
 *   get:
 *     summary: Get active tracking sessions (Mobile)
 *     tags: [Mobile Tracking]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active sessions retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/sessions', getActiveSessions);

/**
 * @swagger
 * /api/mobile/tracking/history:
 *   get:
 *     summary: Get location history (Mobile)
 *     tags: [Mobile Tracking]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         schema:
 *           type: string
 *         description: Session ID to get history for (optional)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of records to return
 *     responses:
 *       200:
 *         description: Location history retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/history', getLocationHistory);

/**
 * @swagger
 * /api/mobile/tracking/live:
 *   get:
 *     summary: Get live locations of all employees (HR/Admin only)
 *     tags: [Mobile Tracking]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Live locations retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - HR/Admin access required
 *       500:
 *         description: Server error
 */
router.get('/live', getLiveLocations);

export default router;
