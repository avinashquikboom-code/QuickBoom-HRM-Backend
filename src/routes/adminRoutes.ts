import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import {
  fetchPlatformUsers,
  updateUserStatus,
  fetchEmployees,
  createEmployee,
  createAndAssignEmployee,
  fetchDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
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
  downloadLeaveReport,
    fetchSubscriptions,
  updateSubscription,
  fetchPricingPlans,
  updatePricingPlan,
  downloadSubscriptionReport,
  fetchPayrollStats,
  fetchPayrollRuns,
  executePayrollDisbursement,
  fetchSalarySlips,
  approveSalarySlip,
  fetchAnalyticsOverview,
  fetchAdminReports,
  generateAdminReport,
  fetchPayrollReportDetails,
  fetchAttendanceReportDetails,
  downloadAttendanceReport,
  fetchAdminNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  fetchAdminSettings,
  updateAdminSettings,
  fetchAdminLeaveBalancesDetailed,
  updateAdminEmployeeLeaveBalance,
  getAdminLeaveBalanceStats,
  bulkUpdateAdminLeaveBalances,
  resetEmployeePassword,
  changeOwnPassword,
  sendNotificationToDepartment,
  sendNotificationToRole,
  fetchShifts,
  createShift,
  updateShift,
  deleteShift,
  assignShiftToEmployee,
} from '../controllers/adminController';

const router = Router();

// Apply auth middleware to all admin routes
router.use(authMiddleware);

// Apply administrative role check to all admin routes
const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'];
router.use(roleMiddleware(adminRoles));

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Fetch all platform users (Super Admin only)
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Users retrieved successfully
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
 *                     $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
// Users
router.get('/users', fetchPlatformUsers);
router.put('/users/:id/status', updateUserStatus);

/**
 * @swagger
 * /api/admin/employees:
 *   get:
 *     summary: Fetch all employees
 *     tags: [Admin - Employees]
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
 *       500:
 *         description: Server error
 */
router.get('/employees', fetchEmployees);

/**
 * @swagger
 * /api/admin/employees:
 *   post:
 *     summary: Create a new employee
 *     tags: [Admin - Employees]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateEmployeeRequest'
 *     responses:
 *       201:
 *         description: Employee created successfully
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
router.post('/employees', createEmployee);

// Department Management
router.get('/departments', fetchDepartments);
router.post('/departments', createDepartment);
router.put('/departments/:id', updateDepartment);
router.delete('/departments/:id', deleteDepartment);

/**
 * @swagger
 * /api/admin/offices:
 *   get:
 *     summary: Fetch all offices
 *     tags: [Admin - Offices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Offices retrieved successfully
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
 *                     $ref: '#/components/schemas/Office'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/offices', fetchOffices);

/**
 * @swagger
 * /api/admin/offices/{id}:
 *   get:
 *     summary: Fetch office by ID
 *     tags: [Admin - Offices]
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
 *         description: Office retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Office'
 *       404:
 *         description: Office not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/offices/:id', fetchOfficeById);

/**
 * @swagger
 * /api/admin/offices:
 *   post:
 *     summary: Create a new office
 *     tags: [Admin - Offices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOfficeRequest'
 *     responses:
 *       201:
 *         description: Office created successfully
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
router.post('/offices', createOffice);
router.put('/offices/:id', updateOffice);
router.delete('/offices/:id', deleteOffice);

// Employee Geofence Assignment
router.put('/offices/assign-employee/:employeeId', assignEmployeeToOffice);
router.post('/employees/assign', createAndAssignEmployee);

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
router.get('/subscriptions/report', downloadSubscriptionReport);

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

/**
 * @swagger
 * /api/admin/leaves/report/download:
 *   get:
 *     summary: Download a leave report as PDF (Admin, HR only)
 *     tags: [Admin - Leave]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Filter the report to a single employee
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Start of the applied-on date range (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: End of the applied-on date range (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: PDF file stream of the leave report
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied (HR/Admin only)
 *       500:
 *         description: Failed to generate leave report
 */
router.get('/leaves/report/download', downloadLeaveReport);


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
router.get('/reports/payroll-details', fetchPayrollReportDetails);
router.get('/reports/attendance-details', fetchAttendanceReportDetails);
router.get('/reports/attendance/download', downloadAttendanceReport);

// Notifications Management
router.get('/notifications', fetchAdminNotifications);
router.put('/notifications/:id/read', markAdminNotificationRead);
router.put('/notifications/read-all', markAllAdminNotificationsRead);

// Settings Management
router.get('/settings', fetchAdminSettings);
router.put('/settings', updateAdminSettings);

// Leave Balance Management
router.get('/leave-balances', fetchAdminLeaveBalancesDetailed);
router.put('/leave-balances/:employeeId', updateAdminEmployeeLeaveBalance);
router.get('/leave-balances/stats', getAdminLeaveBalanceStats);
router.post('/leave-balances/bulk-update', bulkUpdateAdminLeaveBalances);

// Password Management
router.put('/users/:userId/reset-password', resetEmployeePassword);
router.put('/change-password', changeOwnPassword);

/**
 * @swagger
 * /api/admin/change-password:
 *   put:
 *     summary: Change own password (authenticated user)
 *     tags: [Admin - Users]
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
 *       400:
 *         description: Bad request (invalid password)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/users/{userId}/reset-password:
 *   put:
 *     summary: Reset employee password (Admin/HR only)
 *     tags: [Admin - Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *                 description: New password (minimum 6 characters)
 *               isTemporary:
 *                 type: boolean
 *                 description: Whether the password is temporary
 *                 default: false
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Bad request
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */

// Notification Management - Send by Department/Role
router.post('/notifications/send-department', sendNotificationToDepartment);
router.post('/notifications/send-role', sendNotificationToRole);

// Shift Management
router.get('/shifts', fetchShifts);
router.post('/shifts', createShift);
router.put('/shifts/:id', updateShift);
router.delete('/shifts/:id', deleteShift);
router.post('/shifts/assign', assignShiftToEmployee);

/**
 * @swagger
 * /api/admin/shifts:
 *   get:
 *     summary: Fetch all shifts
 *     tags: [Admin - Shift Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Shifts retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 *   post:
 *     summary: Create a new shift
 *     tags: [Admin - Shift Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - startTime
 *               - endTime
 *               - workingDays
 *             properties:
 *               name:
 *                 type: string
 *               startTime:
 *                 type: string
 *                 example: "09:00"
 *               endTime:
 *                 type: string
 *                 example: "18:00"
 *               workingDays:
 *                 type: array
 *                 items:
 *                   type: string
 *               graceMinutes:
 *                 type: integer
 *                 default: 15
 *               breakMinutes:
 *                 type: integer
 *                 default: 60
 *     responses:
 *       200:
 *         description: Shift created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/shifts/{id}:
 *   put:
 *     summary: Update a shift
 *     tags: [Admin - Shift Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               startTime:
 *                 type: string
 *               endTime:
 *                 type: string
 *               workingDays:
 *                 type: array
 *                 items:
 *                   type: string
 *               graceMinutes:
 *                 type: integer
 *               breakMinutes:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Shift updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Shift not found
 *       500:
 *         description: Server error
 *   delete:
 *     summary: Delete a shift
 *     tags: [Admin - Shift Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Shift deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Shift not found
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/shifts/assign:
 *   post:
 *     summary: Assign shift to employee
 *     tags: [Admin - Shift Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - employeeId
 *               - shiftId
 *               - effectiveFrom
 *             properties:
 *               employeeId:
 *                 type: integer
 *               shiftId:
 *                 type: integer
 *               effectiveFrom:
 *                 type: string
 *                 format: date
 *               effectiveTo:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Shift assigned successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */

export default router;
