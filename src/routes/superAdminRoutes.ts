import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { requireSuperAdmin } from '../middlewares/superAdminMiddleware';
import {
  fetchAdminTasks,
  createAdminTask,
  updateAdminTask,
  deleteAdminTask,
} from '../controllers/adminController';

const router = Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Apply super admin middleware to all routes
router.use(requireSuperAdmin);

// ==========================================
// Super Admin Task Management
// ==========================================

// Get all tasks
router.get('/tasks', fetchAdminTasks);

// Create a new task
router.post('/tasks', createAdminTask);

// Update a task
router.put('/tasks/:id', updateAdminTask);

// Delete a task
router.delete('/tasks/:id', deleteAdminTask);

export default router;
