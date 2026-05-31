import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import {
  fetchPlatformUsers,
  updateUserStatus,
  fetchEmployees,
  fetchOffices,
  fetchOfficeById,
  createOffice,
  updateOffice,
  deleteOffice,
  assignEmployeeToOffice,
  fetchTodayAttendance,
  fetchAttendanceHistory,
  fetchComments,
  createComment,
  deleteComment,
  fetchDashboardStats,
  fetchCompanyStats,
  fetchAdminProfile,
  updateAdminProfile,
  uploadAdminAvatar,
  removeAdminAvatar,
  fetchLiveLocations,
  fetchLiveLocationLogs,
  clearLiveLocationLogs,
  fetchAdminLeaves,
  updateAdminLeaveStatus,
  fetchAdminLeaveBalances,
  createAdminLeaveRequest,
  fetchAdminTasks,
  createAdminTask,
  updateAdminTask,
  deleteAdminTask,
  fetchSubscriptions,
  updateSubscription,
  fetchPricingPlans,
  updatePricingPlan,
  fetchPayrollStats,
  fetchPayrollRuns,
  executePayrollDisbursement,
  fetchSalarySlips,
  approveSalarySlip,
  fetchAnalyticsOverview,
  fetchAdminReports,
  generateAdminReport,
} from '../controllers/adminController';

const router = Router();

// Apply auth middleware to all admin routes
router.use(authMiddleware);

// Apply administrative role check to all admin routes
const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'];
router.use(roleMiddleware(adminRoles));

// Users
router.get('/users', fetchPlatformUsers);
router.put('/users/:id/status', updateUserStatus);

// Employees
router.get('/employees', fetchEmployees);

// Offices CRUD
router.get('/offices', fetchOffices);
router.get('/offices/:id', fetchOfficeById);
router.post('/offices', createOffice);
router.put('/offices/:id', updateOffice);
router.delete('/offices/:id', deleteOffice);

// Employee Geofence Assignment
router.put('/offices/assign-employee/:employeeId', assignEmployeeToOffice);

// Attendance
router.get('/attendance/today', fetchTodayAttendance);
router.get('/attendance/history', fetchAttendanceHistory);

// Comments
router.get('/comments', fetchComments);
router.post('/comments', createComment);
router.delete('/comments/:id', deleteComment);

// Profile
router.get('/profile', fetchAdminProfile);
router.put('/profile', updateAdminProfile);
router.post('/profile/avatar', uploadAdminAvatar);
router.delete('/profile/avatar', removeAdminAvatar);

// Dashboards & Stats
router.get('/dashboard/stats', fetchDashboardStats);
router.get('/companies/stats', fetchCompanyStats); // Super Admin specific info

// Subscriptions
router.get('/subscriptions', fetchSubscriptions);
router.put('/subscriptions/:officeId', updateSubscription);

// Pricing Plans (Super Admin)
router.get('/pricing-plans', fetchPricingPlans);
router.put('/pricing-plans/:id', updatePricingPlan);

// Telemetry Location Tracking
router.get('/location/live', fetchLiveLocations);
router.get('/location/logs', fetchLiveLocationLogs);
router.post('/location/logs/clear', clearLiveLocationLogs);

// Leave Management
router.get('/leaves', fetchAdminLeaves);
router.get('/leaves/balances', fetchAdminLeaveBalances);
router.post('/leaves', createAdminLeaveRequest);
router.put('/leaves/:id', updateAdminLeaveStatus);

// Task Management
router.get('/tasks', fetchAdminTasks);
router.post('/tasks', createAdminTask);
router.put('/tasks/:id', updateAdminTask);
router.delete('/tasks/:id', deleteAdminTask);

// Payroll Operations
router.get('/payroll/stats', fetchPayrollStats);
router.get('/payroll/runs', fetchPayrollRuns);
router.post('/payroll/disburse', executePayrollDisbursement);
router.get('/payroll/slips', fetchSalarySlips);
router.post('/payroll/slips/approve', approveSalarySlip);

// Analytics Operations
router.get('/analytics/overview', fetchAnalyticsOverview);

// Reports Operations
router.get('/reports', fetchAdminReports);
router.post('/reports/generate', generateAdminReport);

export default router;
