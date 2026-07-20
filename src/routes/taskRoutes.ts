import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import {
  createTask,
  listTasks,
  getTask,
  getTaskHistory,
  updateTask,
  getTaskStats,
} from '../controllers/taskController';

const router = Router();

// All task management routes require authentication + HR-level role
router.use(authMiddleware);
router.use(roleMiddleware(['HR', 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN']));

/**
 * @swagger
 * /api/tasks/stats:
 *   get:
 *     summary: Get task statistics (HR)
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: assignedTo
 *         schema: { type: string }
 *         description: Filter stats to a specific employee (employeeID)
 *     responses:
 *       200: { description: Stats returned }
 */
router.get('/stats', getTaskStats);

/**
 * @swagger
 * /api/tasks:
 *   get:
 *     summary: List HR tasks with filters & pagination (HR)
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: assignedTo
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, IN_PROGRESS, COMPLETED, CANCELLED] }
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [LOW, MEDIUM, HIGH] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Tasks list }
 */
router.get('/', listTasks);

/**
 * @swagger
 * /api/tasks:
 *   post:
 *     summary: Create a new HR task (HR)
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, assignedTo]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               assignedTo: { type: string, description: "Employee.employeeID" }
 *               priority: { type: string, enum: [LOW, MEDIUM, HIGH] }
 *               dueDate: { type: string, format: date-time }
 *     responses:
 *       201: { description: Task created }
 */
router.post('/', createTask);

/**
 * @swagger
 * /api/tasks/{id}:
 *   get:
 *     summary: Get a single HR task by ID (HR)
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Task detail }
 *       404: { description: Not found }
 */
router.get('/:id', getTask);

/**
 * @swagger
 * /api/tasks/{id}/history:
 *   get:
 *     summary: Get status change history for a task (HR)
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: History array }
 */
router.get('/:id/history', getTaskHistory);

/**
 * @swagger
 * /api/tasks/{id}:
 *   patch:
 *     summary: Update an HR task (HR)
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               assignedTo: { type: string }
 *               priority: { type: string, enum: [LOW, MEDIUM, HIGH] }
 *               dueDate: { type: string, format: date-time, nullable: true }
 *               status: { type: string, enum: [PENDING, IN_PROGRESS, COMPLETED, CANCELLED] }
 *               comment: { type: string }
 *     responses:
 *       200: { description: Updated task }
 *       404: { description: Not found }
 */
router.patch('/:id', updateTask);

export default router;
