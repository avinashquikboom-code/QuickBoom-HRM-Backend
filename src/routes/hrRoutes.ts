import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
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
} from '../controllers/hrController';

const router = express.Router();

// Only platform admins and HR roles can access HR management data
router.use(authMiddleware);
router.use(roleMiddleware([Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.HR, Role.ADMIN]));

router.get('/stats', fetchHRStats);
router.get('/departments', fetchDepartmentOverview);
router.get('/leaves', fetchLeaveOverview);
router.get('/employees', fetchHREmployees);
router.get('/attendance-trend', fetchAttendanceTrend);
router.get('/activity', fetchHRActivity);

// Expense Review
router.get('/expenses', fetchHRExpenses);
router.post('/expenses/:id/approve', approveExpense);
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

export default router;
