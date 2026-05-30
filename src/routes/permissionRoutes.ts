import { Router } from 'express';
import { 
  getGlobalPermissions, 
  updateGlobalPermissions, 
  getUserPermissions, 
  updateUserPermissions,
  getMyPermissions
} from '../controllers/permissionController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();

// Endpoint for current authenticated user to fetch their effective permissions
router.get('/me', authMiddleware, getMyPermissions);

// Endpoints for SUPER_ADMIN to manage global role permissions
router.get('/global', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN']), getGlobalPermissions);
router.put('/global', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN']), updateGlobalPermissions);

// Endpoints for managing specific user overrides
router.get('/user/:userId', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN']), getUserPermissions);
router.put('/user/:userId', authMiddleware, roleMiddleware(['SUPER_ADMIN', 'ADMIN']), updateUserPermissions);

export default router;
