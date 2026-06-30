import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import { Role } from '@prisma/client';
import {
  getMyLeaveBalance,
  getAllEmployeesLeaveBalances,
  updateEmployeeLeaveBalance,
  getLeaveBalanceStatistics,
  getDepartmentLeavePolicyMobile,
  bulkAllocateLeavesMobile,
} from '../../controllers/mobile/mobileLeaveBalanceController';

const router = Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// GET /api/mobile/leave-balance/me - Get own leave balance (mobile roles)
router.get('/me', roleMiddleware([Role.STORE_MANAGER, Role.SALESMAN, Role.HELPER]), getMyLeaveBalance);

// Management routes - require Store Manager or HR role
router.use(roleMiddleware([Role.STORE_MANAGER, Role.HR, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN]));

// GET /api/mobile/leave-balance/all - Get all employees' leave balances
router.get('/all', getAllEmployeesLeaveBalances);

// PUT /api/mobile/leave-balance/:employeeId - Update employee leave balance
router.put('/:employeeId', updateEmployeeLeaveBalance);

// GET /api/mobile/leave-balance/statistics - Get leave balance statistics
router.get('/statistics', getLeaveBalanceStatistics);

// GET /api/mobile/leave-balance/department/:departmentId/policy - Get department leave policy
router.get('/department/:departmentId/policy', getDepartmentLeavePolicyMobile);

// POST /api/mobile/leave-balance/bulk-allocate - Bulk allocate leaves
router.post('/bulk-allocate', bulkAllocateLeavesMobile);

export default router;
