import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import { Role } from '@prisma/client';
import {
  getMobileTasks,
  getMobileTaskById,
  createMobileTask,
  updateMobileTask,
  deleteMobileTask
} from '../../controllers/mobile/mobileTaskController';

const router = Router();

// Apply auth middleware to protect all mobile task routes
router.use(authMiddleware);

// Restrict access to mobile roles (Store Manager, Salesman, Helper, Employee, HR, Admins)
const mobileRoles = ['STORE_MANAGER', 'SALESMAN', 'HELPER', 'EMPLOYEE', 'HR', 'SUPER_ADMIN', 'ADMIN'];
router.use(roleMiddleware(mobileRoles));

/**
 * @swagger
 * /api/mobile/tasks:
 *   get:
 *     summary: Get tasks assigned to logged-in user (Mobile)
 *     tags: [Mobile - Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status (TODO, IN_PROGRESS, DONE)
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *         description: Filter by priority (HIGH, MEDIUM, LOW)
 *     responses:
 *       200:
 *         description: Tasks retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', getMobileTasks);

/**
 * @swagger
 * /api/mobile/tasks/{id}:
 *   get:
 *     summary: Get task details by ID (Mobile)
 *     tags: [Mobile - Tasks]
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
 *         description: Task retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.get('/:id', getMobileTaskById);

/**
 * @swagger
 * /api/mobile/tasks:
 *   post:
 *     summary: Create a new task (Store Manager only) (Mobile)
 *     tags: [Mobile - Tasks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - assignedToId
 *               - dueDate
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               projectName:
 *                 type: string
 *               assignedToId:
 *                 type: integer
 *               dueDate:
 *                 type: string
 *                 format: date-time
 *               priority:
 *                 type: string
 *                 enum: [HIGH, MEDIUM, LOW]
 *     responses:
 *       201:
 *         description: Task created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Store Manager only)
 *       500:
 *         description: Server error
 */
router.post('/', createMobileTask);

/**
 * @swagger
 * /api/mobile/tasks/{id}:
 *   put:
 *     summary: Update task status or details (Mobile)
 *     tags: [Mobile - Tasks]
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
 *               status:
 *                 type: string
 *                 enum: [TODO, IN_PROGRESS, DONE]
 *               priority:
 *                 type: string
 *                 enum: [HIGH, MEDIUM, LOW]
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Task updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.put('/:id', updateMobileTask);

/**
 * @swagger
 * /api/mobile/tasks/{id}:
 *   delete:
 *     summary: Delete task (Store Manager only) (Mobile)
 *     tags: [Mobile - Tasks]
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
 *         description: Task deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Store Manager only)
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', deleteMobileTask);

export default router;
