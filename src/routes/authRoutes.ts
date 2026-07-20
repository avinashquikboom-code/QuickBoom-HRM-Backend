import { Router } from 'express';
import {
  login,
  register,
  registerFcmToken,
  employeeLogin,
  hrLogin,
  superAdminLogin,
  refreshToken,
  logout,
  logoutAll
} from '../controllers/authController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();

// Unified login route (for backward compatibility)
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Authenticate user and return JWT token (Unified login)
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
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
 *                 currentLoginLocation:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid credentials or inactive account
 *       403:
 *         description: Office or branch not allotted for employee
 *       500:
 *         description: Server error
 */
router.post('/login', login);

// Role-specific login routes
/**
 * @swagger
 * /api/auth/employee/login:
 *   post:
 *     summary: Authenticate Employee user and return JWT token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Employee login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 currentLoginLocation:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid credentials or inactive account
 *       403:
 *         description: Restricted to EMPLOYEE role only, or office not allotted
 *       500:
 *         description: Server error
 */
router.post('/employee/login', employeeLogin);

/**
 * @swagger
 * /api/auth/hr/login:
 *   post:
 *     summary: Authenticate HR/Admin user and return JWT token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: HR/Admin login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 currentLoginLocation:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid credentials or inactive account
 *       403:
 *         description: Restricted to HR/PLATFORM_ADMIN roles only
 *       500:
 *         description: Server error
 */
router.post('/hr/login', hrLogin);

/**
 * @swagger
 * /api/auth/super-admin/login:
 *   post:
 *     summary: Authenticate Super Admin user and return JWT token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Super Admin login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 currentLoginLocation:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid credentials or inactive account
 *       403:
 *         description: Restricted to SUPER_ADMIN/ADMIN roles only
 *       500:
 *         description: Server error
 */
router.post('/super-admin/login', superAdminLogin);



/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user (HR and Employee only)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Insufficient permissions
 *       500:
 *         description: Server error
 */
// Registration route restricted to HR and EMPLOYEE roles only
router.post(
  '/register',
  authMiddleware,
  roleMiddleware(['HR', 'EMPLOYEE']),
  register
);

/**
 * @swagger
 * /api/auth/fcm-token:
 *   post:
 *     summary: Register FCM token for push notifications
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: FCM token from Firebase
 *     responses:
 *       200:
 *         description: FCM token registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/fcm-token', authMiddleware, registerFcmToken);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh authentication token
 *     tags: [Authentication]
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
router.post('/refresh', refreshToken);
router.post('/logout', authMiddleware, logout);
router.post('/logout-all', authMiddleware, logoutAll);

// ─── TEMPORARY: One-time admin password reset (remove after use) ─────────────
import { Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import { prisma } from '../utils/db';
router.post('/admin-reset-all-passwords', async (req: Request, res: Response) => {
  const { secretKey, newPassword } = req.body;
  if (secretKey !== 'RESET_QUICKBOOM_2026') { res.status(403).json({ success: false, message: 'Forbidden' }); return; }
  if (!newPassword || newPassword.length < 6) { res.status(400).json({ success: false, message: 'newPassword min 6 chars' }); return; }
  try {
    const hash = await bcryptjs.hash(newPassword, 10);
    const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
    for (const u of users) await prisma.user.update({ where: { id: u.id }, data: { password: hash } });
    res.json({ success: true, message: `Reset ${users.length} users`, users: users.map(u => `${u.email} (${u.role})`), newPassword });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});
// ─── END TEMPORARY ────────────────────────────────────────────────────────────

export default router;
