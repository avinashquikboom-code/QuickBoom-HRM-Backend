import { Router } from 'express';
import {
  mobileLogin,
  mobileLogout,
  mobileRefreshToken,
  getMobileProfile
} from '../../controllers/mobile/mobileAuthController';

const router = Router();

/**
 * @swagger
 * /api/mobile/auth/login:
 *   post:
 *     summary: Mobile user login with enhanced features
 *     tags: [Mobile - Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 description: User email or employee code
 *               password:
 *                 type: string
 *                 description: User password
 *               deviceInfo:
 *                 type: object
 *                 properties:
 *                   deviceType:
 *                     type: string
 *                   deviceId:
 *                     type: string
 *                   platform:
 *                     type: string
 *               appVersion:
 *                 type: string
 *               fcmToken:
 *                 type: string
 *                 description: Firebase Cloud Messaging token
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     email:
 *                       type: string
 *                     role:
 *                       type: string
 *                     profile:
 *                       type: object
 *                     employee:
 *                       type: object
 *                 deviceInfo:
 *                   type: object
 *                 permissions:
 *                   type: object
 *       400:
 *         description: Bad request (missing credentials)
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Mobile access denied
 *       500:
 *         description: Server error
 */
router.post('/login', mobileLogin);

/**
 * @swagger
 * /api/mobile/auth/logout:
 *   post:
 *     summary: Mobile user logout
 *     tags: [Mobile - Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fcmToken:
 *                 type: string
 *                 description: FCM token to remove
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/logout', mobileLogout);

/**
 * @swagger
 * /api/mobile/auth/refresh:
 *   post:
 *     summary: Refresh mobile authentication token
 *     tags: [Mobile - Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/refresh', mobileRefreshToken);

/**
 * @swagger
 * /api/mobile/auth/profile:
 *   get:
 *     summary: Get mobile user profile with complete data
 *     tags: [Mobile - Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     email:
 *                       type: string
 *                     role:
 *                       type: string
 *                     profile:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         fullName:
 *                           type: string
 *                         phone:
 *                           type: string
 *                         avatarUrl:
 *                           type: string
 *                         timezone:
 *                           type: string
 *                         timezoneLabel:
 *                           type: string
 *                         bio:
 *                           type: string
 *                     employee:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         employeeCode:
 *                           type: string
 *                         firstName:
 *                           type: string
 *                         lastName:
 *                           type: string
 *                         designation:
 *                           type: string
 *                         status:
 *                           type: string
 *                         office:
 *                           type: object
 *                         department:
 *                           type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.get('/profile', getMobileProfile);

export default router;
