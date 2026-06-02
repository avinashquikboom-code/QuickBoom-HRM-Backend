import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import {
  fetchEmployeeProfile,
  updateEmployeeProfile,
  uploadEmployeeAvatar,
  removeEmployeeAvatar,
  fetchEmployeeTodayAttendance,
  fetchEmployeeAttendanceHistory,
  employeeCheckIn,
  employeeCheckOut,
  startEmployeeBreak,
  endEmployeeBreak,
  fetchLeavesAndBalances,
  applyEmployeeLeave,
  fetchEmployeeShift,
  fetchEmployeeExpenses,
  createEmployeeExpense,
  fetchEmployeeTasks,
  updateEmployeeTaskStatus,
  fetchEmployeeNotifications,
  markEmployeeNotificationRead,
  markAllEmployeeNotificationsRead,
  fetchEmployeeDashboardStats,
} from '../../controllers/employee/employeeController';

const router = Router();

// Apply auth middleware to protect all employee routes
router.use(authMiddleware);

// Restrict access to employees and HR managers
const employeeRoles = ['EMPLOYEE', 'HR', 'SUPER_ADMIN', 'ADMIN'];
router.use(roleMiddleware(employeeRoles));

/**
 * @swagger
 * /api/employee/dashboard/stats:
 *   get:
 *     summary: Fetch employee dashboard statistics
 *     tags: [Employee - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard stats retrieved successfully
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
 *                     totalAttendance:
 *                       type: number
 *                     leaveBalance:
 *                       type: number
 *                     pendingTasks:
 *                       type: number
 *                     recentNotifications:
 *                       type: number
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// Dashboard stats
router.get('/dashboard/stats', fetchEmployeeDashboardStats);

/**
 * @swagger
 * /api/employee/profile:
 *   get:
 *     summary: Fetch employee profile
 *     tags: [Employee - Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Employee'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Profile not found
 *       500:
 *         description: Server error
 */
router.get('/profile', fetchEmployeeProfile);

/**
 * @swagger
 * /api/employee/profile:
 *   put:
 *     summary: Update employee profile
 *     tags: [Employee - Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put('/profile', updateEmployeeProfile);
router.post('/profile/avatar', uploadEmployeeAvatar);
router.delete('/profile/avatar', removeEmployeeAvatar);

/**
 * @swagger
 * /api/employee/attendance/today:
 *   get:
 *     summary: Fetch today's attendance for employee
 *     tags: [Employee - Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Today's attendance retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Attendance'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/attendance/today', fetchEmployeeTodayAttendance);

/**
 * @swagger
 * /api/employee/attendance/history:
 *   get:
 *     summary: Fetch attendance history for employee
 *     tags: [Employee - Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Attendance history retrieved successfully
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
 *                     $ref: '#/components/schemas/Attendance'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/attendance/history', fetchEmployeeAttendanceHistory);

/**
 * @swagger
 * /api/employee/attendance/check-in:
 *   post:
 *     summary: Check in for work
 *     tags: [Employee - Attendance]
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
 *               longitude:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Check in successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Bad request (already checked in, outside geofence)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/attendance/check-in', employeeCheckIn);
router.post('/attendance/check-out', employeeCheckOut);
router.post('/attendance/break/start', startEmployeeBreak);
router.post('/attendance/break/end', endEmployeeBreak);

// Leaves Management
router.get('/leaves', fetchLeavesAndBalances);
router.post('/leaves', applyEmployeeLeave);

// Shift Timings
router.get('/shifts', fetchEmployeeShift);

// Expense Claims
router.get('/expenses', fetchEmployeeExpenses);
router.post('/expenses', createEmployeeExpense);

// Task Tracking
router.get('/tasks', fetchEmployeeTasks);
router.put('/tasks/:id', updateEmployeeTaskStatus);

// Notifications History
router.get('/notifications', fetchEmployeeNotifications);
router.put('/notifications/:id/read', markEmployeeNotificationRead);
router.put('/notifications/read-all', markAllEmployeeNotificationsRead);

export default router;
