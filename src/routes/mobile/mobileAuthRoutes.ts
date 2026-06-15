import { Router } from 'express';
import {
  mobileLogin,
  mobileLogout,
  mobileRefreshToken,
  getMobileProfile,
  changeMobilePassword
} from '../../controllers/mobile/mobileAuthController';
import { forgotPassword } from '../../controllers/adminController';

const router = Router();

// Login and refresh endpoints do not require auth middleware
router.post('/login', mobileLogin);
router.post('/refresh', mobileRefreshToken);
router.post('/forgot-password', forgotPassword);

// Apply auth middleware to protected routes
import { authMiddleware } from '../../middlewares/authMiddleware';
router.use(authMiddleware);

/**
 * @swagger
 * /api/mobile/auth/forgot-password:
 *   post:
 *     summary: Request password reset link
 *     tags: [Mobile - Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User email address
 *                 example: "employee@hrm.com"
 *     responses:
 *       200:
 *         description: Password reset link sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "If an account with this email exists, a password reset link will be sent."
 *       400:
 *         description: Bad request (missing email)
 *       500:
 *         description: Server error
 */

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
router.put('/change-password', changeMobilePassword);

/**
 * @swagger
 * /api/mobile/auth/change-password:
 *   put:
 *     summary: Change mobile user password
 *     tags: [Mobile - Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 description: Current password
 *               newPassword:
 *                 type: string
 *                 description: New password (minimum 6 characters)
 *     responses:
 *       200:
 *         description: Password changed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Password changed successfully."
 *       400:
 *         description: Bad request (invalid password)
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */

export default router;
