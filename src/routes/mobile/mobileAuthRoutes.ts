import { Router } from 'express';
import {
  mobileLogin,
  mobileLogout,
  mobileRefreshToken,
  getMobileProfile
} from '../../controllers/mobile/mobileAuthController';

const router = Router();

// Refresh endpoint does not require auth middleware (allows refresh with expired token)
router.post('/refresh', mobileRefreshToken);

// Apply auth middleware to protected routes
import { authMiddleware } from '../../middlewares/authMiddleware';
router.use(authMiddleware);

/**
 * @swagger
 * /api/mobile/auth/login:
 *   post:
 *     summary: Mobile user login - simplified (email & password only)
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
 *                 format: email
 *                 description: User email address
 *                 example: "employee@hrm.com"
 *               password:
 *                 type: string
 *                 description: User password
 *                 example: "employee123"
 *               fcmToken:
 *                 type: string
 *                 description: Firebase Cloud Messaging token (optional)
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
 *                   example: true
 *                 token:
 *                   type: string
 *                   description: JWT authentication token
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     email:
 *                       type: string
 *                     role:
 *                       type: string
 *                       enum: [EMPLOYEE, HR, ADMIN, SUPER_ADMIN]
 *                     profile:
 *                       type: object
 *                     employee:
 *                       type: object
 *                 fcmToken:
 *                   type: string
 *                   description: FCM token returned for client use
 *                   nullable: true
 *                 loginInfo:
 *                   type: object
 *                   properties:
 *                     loginTime:
 *                       type: string
 *                       format: date-time
 *                     loginLocation:
 *                       type: string
 *                       example: "Mobile App"
 *                 permissions:
 *                   type: object
 *                   properties:
 *                     canCheckIn:
 *                       type: boolean
 *                     canApproveLeaves:
 *                       type: boolean
 *                     canManageEmployees:
 *                       type: boolean
 *                     canViewReports:
 *                       type: boolean
 *       400:
 *         description: Bad request (missing email or password)
 *       401:
 *         description: Invalid credentials or inactive account
 *       403:
 *         description: Mobile access denied (role mismatch) or Office/branch not allotted
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
