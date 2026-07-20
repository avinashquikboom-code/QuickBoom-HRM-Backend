import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { getMyHrTasks, updateMyHrTask } from '../../controllers/mobile/mobileHrTaskController';

const router = Router();

// All routes require a valid mobile JWT
router.use(authMiddleware);

/**
 * GET /api/employee/tasks
 * Employee sees their own HrTasks (filtered by Employee.employeeID derived from JWT)
 */
router.get('/', getMyHrTasks);

/**
 * PUT /api/employee/tasks/:id
 * Employee updates the status of one of their own tasks
 */
router.put('/:id', updateMyHrTask);

export default router;
