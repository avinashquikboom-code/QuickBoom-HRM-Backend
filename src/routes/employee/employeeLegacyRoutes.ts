import { Router } from 'express';
import { getEmployeeList } from '../../controllers/employeeLegacyController';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { apiKeyMiddleware } from '../../middlewares/apiKeyMiddleware';

const router = Router();

// Apply auth and apiKey middlewares to all routes
router.use(authMiddleware);
router.use(apiKeyMiddleware);

/**
 * @swagger
 * /api/Employee/GetEmployeeList:
 *   get:
 *     summary: Get all employees (Legacy endpoint)
 *     tags: [Legacy - Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: x-api-key
 *         schema:
 *           type: string
 *         required: true
 *         description: API Key for security
 *     responses:
 *       200:
 *         description: List of employees retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 employees:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       employeeCode:
 *                         type: string
 *                       firstName:
 *                         type: string
 *                       lastName:
 *                         type: string
 *                       designation:
 *                         type: string
 *                       status:
 *                         type: string
 *                       mobileNumber:
 *                         type: string
 *                       joiningDate:
 *                         type: string
 *                         format: date-time
 *                       role:
 *                         type: string
 *                       email:
 *                         type: string
 *                       storeId:
 *                         type: integer
 *                       storeName:
 *                         type: string
 *                       departmentId:
 *                         type: integer
 *                       departmentName:
 *                         type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Invalid API Key
 *       500:
 *         description: Server error
 */
router.get('/GetEmployeeList', getEmployeeList);

export default router;
