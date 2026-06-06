import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { Role } from '@prisma/client';
import {
  createEmployeeLeaveBalance,
  getEmployeeLeaveBalance,
  getAllLeaveBalances,
  bulkAllocateLeaves,
  getLeaveBalanceStats,
  updateUsedLeave,
  setDepartmentLeavePolicy,
  getDepartmentLeavePolicy,
} from '../controllers/leaveBalanceController';

const router = Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// POST /api/leave-balance - Create or update employee leave balance
router.post('/', createEmployeeLeaveBalance);

// GET /api/leave-balance/employee/:employeeId - Get specific employee leave balance
router.get('/employee/:employeeId', getEmployeeLeaveBalance);

// GET /api/leave-balance/me - Get own leave balance (for employees)
router.get('/me', getEmployeeLeaveBalance);

// GET /api/leave-balance/all - Get all leave balances (Admin/HR only)
router.get('/all', roleMiddleware([Role.HR, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN]), getAllLeaveBalances);

// POST /api/leave-balance/bulk-allocate - Bulk allocate leaves (Admin/HR only)
router.post('/bulk-allocate', roleMiddleware([Role.HR, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN]), bulkAllocateLeaves);

// GET /api/leave-balance/stats - Get leave balance statistics (Admin/HR only)
router.get('/stats', roleMiddleware([Role.HR, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN]), getLeaveBalanceStats);

// POST /api/leave-balance/update-used - Update used leave count (Admin/HR only)
router.post('/update-used', roleMiddleware([Role.HR, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN]), updateUsedLeave);

// POST /api/leave-balance/department-policy - Set department leave policy (Admin/HR only)
router.post('/department-policy', roleMiddleware([Role.HR, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN]), setDepartmentLeavePolicy);

// GET /api/leave-balance/department-policy/:departmentId - Get department leave policy
router.get('/department-policy/:departmentId', getDepartmentLeavePolicy);

export default router;
