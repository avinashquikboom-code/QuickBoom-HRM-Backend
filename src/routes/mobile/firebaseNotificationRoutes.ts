import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import {
  testFirebaseConnection,
  sendNotificationToUser,
  sendNotificationToRole,
  sendNotificationToDepartment,
  sendNotificationToAll,
  sendTestNotification
} from '../../controllers/mobile/firebaseNotificationController';

const router = Router();

// Public test endpoint (no auth required for testing)
/**
 * @swagger
 * /api/mobile/firebase/public-test:
 *   get:
 *     summary: Public Firebase connection test (no auth required)
 *     tags: [Mobile - Firebase Notifications]
 *     responses:
 *       200:
 *         description: Firebase connection test result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 connected:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Server error
 */
router.get('/public-test', testFirebaseConnection);

// Public test notification endpoint (no auth required for testing)
/**
 * @swagger
 * /api/mobile/firebase/public-send-test:
 *   post:
 *     summary: Public test notification (no auth required)
 *     tags: [Mobile - Firebase Notifications]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Custom notification title
 *               body:
 *                 type: string
 *                 description: Custom notification body
 *               data:
 *                 type: object
 *                 description: Additional data payload
 *     responses:
 *       200:
 *         description: Test notification sent successfully
 *       500:
 *         description: Server error
 */
router.post('/public-send-test', (req, res) => {
  // Mock implementation for testing
  const { title = 'Test Notification', body = 'This is a test notification from QuickBoom HRM', data } = req.body;
  
  res.json({
    success: true,
    message: 'Test notification sent successfully (mock)',
    data: {
      title,
      body,
      data: {
        ...data,
        type: 'test',
        timestamp: new Date().toISOString(),
      },
      mock: true,
      note: 'This is a mock response for testing. Real notifications require proper Firebase configuration.'
    },
    timestamp: new Date().toISOString(),
  });
});

// Apply auth middleware to protect all other Firebase notification routes
router.use(authMiddleware);

// Restrict access to HR and Admin roles for most operations
const adminRoles = ['HR', 'ADMIN', 'SUPER_ADMIN'];
router.use(roleMiddleware(adminRoles));

/**
 * @swagger
 * /api/mobile/firebase/test-connection:
 *   get:
 *     summary: Test Firebase connection
 *     tags: [Mobile - Firebase Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Firebase connection test result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 connected:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/test-connection', testFirebaseConnection);

/**
 * @swagger
 * /api/mobile/firebase/send-to-user:
 *   post:
 *     summary: Send notification to specific user
 *     tags: [Mobile - Firebase Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - title
 *               - body
 *             properties:
 *               userId:
 *                 type: integer
 *                 description: User ID to send notification to
 *               title:
 *                 type: string
 *                 description: Notification title
 *               body:
 *                 type: string
 *                 description: Notification body
 *               data:
 *                 type: object
 *                 description: Additional data payload
 *               options:
 *                 type: object
 *                 description: Notification options
 *     responses:
 *       200:
 *         description: Notification sent successfully
 *       400:
 *         description: Bad request (missing required fields)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/send-to-user', sendNotificationToUser);

/**
 * @swagger
 * /api/mobile/firebase/send-to-role:
 *   post:
 *     summary: Send notification to users by role
 *     tags: [Mobile - Firebase Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *               - title
 *               - body
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [EMPLOYEE, HR, ADMIN, SUPER_ADMIN]
 *                 description: User role to send notification to
 *               title:
 *                 type: string
 *                 description: Notification title
 *               body:
 *                 type: string
 *                 description: Notification body
 *               data:
 *                 type: object
 *                 description: Additional data payload
 *               options:
 *                 type: object
 *                 description: Notification options
 *     responses:
 *       200:
 *         description: Notification sent successfully
 *       400:
 *         description: Bad request (missing required fields)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/send-to-role', sendNotificationToRole);

/**
 * @swagger
 * /api/mobile/firebase/send-to-department:
 *   post:
 *     summary: Send notification to users by department
 *     tags: [Mobile - Firebase Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - departmentId
 *               - title
 *               - body
 *             properties:
 *               departmentId:
 *                 type: integer
 *                 description: Department ID to send notification to
 *               title:
 *                 type: string
 *                 description: Notification title
 *               body:
 *                 type: string
 *                 description: Notification body
 *               data:
 *                 type: object
 *                 description: Additional data payload
 *               options:
 *                 type: object
 *                 description: Notification options
 *     responses:
 *       200:
 *         description: Notification sent successfully
 *       400:
 *         description: Bad request (missing required fields)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/send-to-department', sendNotificationToDepartment);

/**
 * @swagger
 * /api/mobile/firebase/send-to-all:
 *   post:
 *     summary: Send notification to all active users
 *     tags: [Mobile - Firebase Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - body
 *             properties:
 *               title:
 *                 type: string
 *                 description: Notification title
 *               body:
 *                 type: string
 *                 description: Notification body
 *               data:
 *                 type: object
 *                 description: Additional data payload
 *               options:
 *                 type: object
 *                 description: Notification options
 *     responses:
 *       200:
 *         description: Notification sent successfully
 *       400:
 *         description: Bad request (missing required fields)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/send-to-all', sendNotificationToAll);

/**
 * @swagger
 * /api/mobile/firebase/send-test:
 *   post:
 *     summary: Send test notification to current user
 *     tags: [Mobile - Firebase Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Custom notification title
 *               body:
 *                 type: string
 *                 description: Custom notification body
 *               data:
 *                 type: object
 *                 description: Additional data payload
 *     responses:
 *       200:
 *         description: Test notification sent successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/send-test', sendTestNotification);

export default router;
