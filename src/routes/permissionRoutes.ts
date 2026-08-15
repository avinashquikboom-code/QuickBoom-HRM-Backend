import { Router } from 'express';
import { 
  getGlobalPermissions, 
  updateGlobalPermissions, 
  getUserPermissions, 
  updateUserPermissions,
  getMyPermissions,
  getHREmployeePermissions,
  patchHREmployeePermissions,
  requestPermissionAccess
} from '../controllers/permissionController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();

// Endpoint for current authenticated user to fetch their effective permissions or request access
router.get('/me', authMiddleware, getMyPermissions);
router.get('/my-permissions', authMiddleware, getMyPermissions);
router.post('/request', authMiddleware, requestPermissionAccess);
router.post('/access-request', authMiddleware, requestPermissionAccess);

// Endpoints for HR to view and patch employee permissions
router.get('/employee-permissions/:employeeId', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), getHREmployeePermissions);
router.patch('/employee-permissions/:employeeId', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), patchHREmployeePermissions);
router.get('/employee/:employeeId', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), getHREmployeePermissions);
router.patch('/employee/:employeeId', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), patchHREmployeePermissions);

// Endpoints for SUPER_ADMIN to manage global role permissions
router.get('/global', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN']), getGlobalPermissions);
router.put('/global', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN']), updateGlobalPermissions);

// Endpoints for managing specific user overrides
router.get('/user/:userId', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), getUserPermissions);
router.put('/user/:userId', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), updateUserPermissions);

export default router;
