import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import {
  checkGeofence,
  getOfficeGeofences,
  getGeofenceStatus,
  getNearbyOffices
} from '../../controllers/geofenceController';

const router = Router();

// Apply auth middleware to protect all mobile geofence routes
router.use(authMiddleware);

// Restrict access to employees and HR managers
const employeeRoles = ['EMPLOYEE', 'HR', 'SUPER_ADMIN', 'ADMIN'];
router.use(roleMiddleware(employeeRoles));

/**
 * @swagger
 * /api/mobile/geofence/check:
 *   post:
 *     summary: Check if current location is within geofence (Mobile)
 *     tags: [Mobile Geofence]
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
 *               officeId:
 *                 type: integer
 *                 description: Specific office ID to check (optional)
 *     responses:
 *       200:
 *         description: Geofence check completed successfully
 *       400:
 *         description: Bad request - missing coordinates
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/check', checkGeofence);

/**
 * @swagger
 * /api/mobile/geofence/offices:
 *   get:
 *     summary: Get all office geofences (Mobile)
 *     tags: [Mobile Geofence]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Office geofences retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/offices', getOfficeGeofences);

/**
 * @swagger
 * /api/mobile/geofence/status:
 *   get:
 *     summary: Get current geofence status (Mobile)
 *     tags: [Mobile Geofence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: latitude
 *         schema:
 *           type: number
 *         required: true
 *         description: Current latitude
 *       - in: query
 *         name: longitude
 *         schema:
 *           type: number
 *         required: true
 *         description: Current longitude
 *     responses:
 *       200:
 *         description: Geofence status retrieved successfully
 *       400:
 *         description: Bad request - missing coordinates
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/status', getGeofenceStatus);

/**
 * @swagger
 * /api/mobile/geofence/nearby:
 *   get:
 *     summary: Get nearby offices within radius (Mobile)
 *     tags: [Mobile Geofence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: latitude
 *         schema:
 *           type: number
 *         required: true
 *         description: Current latitude
 *       - in: query
 *         name: longitude
 *         schema:
 *           type: number
 *         required: true
 *         description: Current longitude
 *       - in: query
 *         name: radius
 *         schema:
 *           type: integer
 *           default: 5000
 *         description: Search radius in meters
 *     responses:
 *       200:
 *         description: Nearby offices retrieved successfully
 *       400:
 *         description: Bad request - missing coordinates
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/nearby', getNearbyOffices);

export default router;
