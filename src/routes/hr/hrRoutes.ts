import express from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import { Role } from '@prisma/client';
import {
  fetchHRStats,
  fetchDepartmentOverview,
  fetchLeaveOverview,
  fetchHREmployees,
  fetchAttendanceTrend,
  fetchHRActivity,
  fetchHRExpenses,
  approveExpense,
  rejectExpense,
  approveLeave,
  rejectLeave,
  fetchHRTasks,
  createHRTask,
  fetchHRPayrollStats,
  fetchHRPayrollRuns,
  fetchAttendanceCorrections,
  approveAttendanceCorrection,
  rejectAttendanceCorrection,
} from '../../controllers/hr/hrController';
import {
  sendNotification,
  broadcastAnnouncement,
} from '../../controllers/hr/hrNotificationController';

const router = express.Router();

// Only platform admins and HR roles can access HR management data
router.use(authMiddleware);
router.use(roleMiddleware([Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.HR, Role.ADMIN]));

/**
 * @swagger
 * /api/hr/stats:
 *   get:
 *     summary: Fetch HR dashboard statistics
 *     tags: [HR - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: HR stats retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalEmployees:
 *                       type: number
 *                     presentToday:
 *                       type: number
 *                     onLeaveToday:
 *                       type: number
 *                     pendingLeaveRequests:
 *                       type: number
 *                     pendingExpenseClaims:
 *                       type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.get('/stats', fetchHRStats);
router.get('/departments', fetchDepartmentOverview);
router.get('/leaves', fetchLeaveOverview);
/**
 * @swagger
 * /api/hr/employees:
 *   get:
 *     summary: Fetch all employees for HR management
 *     tags: [HR - Employees]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Employees retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Employee'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.get('/employees', fetchHREmployees);
router.get('/attendance-trend', fetchAttendanceTrend);
router.get('/activity', fetchHRActivity);

/**
 * @swagger
 * /api/hr/expenses:
 *   get:
 *     summary: Fetch all expense claims for review
 *     tags: [HR - Expenses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Expenses retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Expense'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.get('/expenses', fetchHRExpenses);

/**
 * @swagger
 * /api/hr/expenses/{id}/approve:
 *   post:
 *     summary: Approve an expense claim
 *     tags: [HR - Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Expense approved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       404:
 *         description: Expense not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/expenses/:id/approve', approveExpense);

/**
 * @swagger
 * /api/hr/expenses/{id}/reject:
 *   post:
 *     summary: Reject an expense claim
 *     tags: [HR - Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Expense rejected successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       404:
 *         description: Expense not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/expenses/:id/reject', rejectExpense);

// Leave Review
router.post('/leaves/:id/approve', approveLeave);
router.post('/leaves/:id/reject', rejectLeave);

// Task Management
router.get('/tasks', fetchHRTasks);
router.post('/tasks', createHRTask);

// Payroll Management
router.get('/payroll/stats', fetchHRPayrollStats);
router.get('/payroll/runs', fetchHRPayrollRuns);

// Attendance Correction Management
router.get('/attendance-corrections', fetchAttendanceCorrections);
router.post('/attendance-corrections/:id/approve', approveAttendanceCorrection);
router.post('/attendance-corrections/:id/reject', rejectAttendanceCorrection);

// Notifications & Announcements
router.post('/notifications/send', sendNotification);
router.post('/announcements/broadcast', broadcastAnnouncement);

export default router;
