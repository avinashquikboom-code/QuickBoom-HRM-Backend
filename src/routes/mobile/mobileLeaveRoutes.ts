import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import {
  fetchMyLeaves,
  applyLeave,
  downloadMyLeaveReport,
  downloadLeaveReport,
} from '../../controllers/mobile/mobileLeaveController';

const router = Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// GET /api/mobile/leave/my-leaves - Fetch employee's leave requests and balances
router.get('/my-leaves', fetchMyLeaves);

// POST /api/mobile/leave/apply - Apply for leave
router.post('/apply', applyLeave);

/**
 * @swagger
 * /api/mobile/leave/my-report/download:
 *   get:
 *     summary: Download the logged-in employee's own leave report as PDF (Mobile)
 *     tags: [Mobile - Leave]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: PDF file stream of the employee's leave report
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Failed to generate leave report
 */
router.get('/my-report/download', downloadMyLeaveReport);

/**
 * @swagger
 * /api/mobile/leave/report/download:
 *   get:
 *     summary: Download a leave report as PDF for HR/Admin (all or specific employee)
 *     tags: [Mobile - Leave]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Filter the report to a single employee
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Start of the applied-on date range (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: End of the applied-on date range (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: PDF file stream of the leave report
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied (HR/Admin only)
 *       500:
 *         description: Failed to generate leave report
 */
router.get('/report/download', downloadLeaveReport);

export default router;
