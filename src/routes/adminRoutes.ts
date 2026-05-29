import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import {
  fetchPlatformUsers,
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
} from '../controllers/adminController';

const router = Router();

// Apply auth middleware to all admin routes
router.use(authMiddleware);

// Apply administrative role check to all admin routes
const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'];
router.use(roleMiddleware(adminRoles));

// Users
router.get('/users', fetchPlatformUsers);

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

// Telemetry Location Tracking
router.get('/location/live', fetchLiveLocations);

export default router;
