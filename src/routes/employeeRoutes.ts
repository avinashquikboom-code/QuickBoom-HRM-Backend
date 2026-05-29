import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
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
} from '../controllers/employeeController';

const router = Router();

// Apply auth middleware to protect all employee routes
router.use(authMiddleware);

// Restrict access to employees and HR managers
const employeeRoles = ['EMPLOYEE', 'HR', 'SUPER_ADMIN', 'ADMIN'];
router.use(roleMiddleware(employeeRoles));

// Dashboard stats
router.get('/dashboard/stats', fetchEmployeeDashboardStats);

// Profile Management
router.get('/profile', fetchEmployeeProfile);
router.put('/profile', updateEmployeeProfile);
router.post('/profile/avatar', uploadEmployeeAvatar);
router.delete('/profile/avatar', removeEmployeeAvatar);

// Attendance Tracking
router.get('/attendance/today', fetchEmployeeTodayAttendance);
router.get('/attendance/history', fetchEmployeeAttendanceHistory);
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
