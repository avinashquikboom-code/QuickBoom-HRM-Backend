import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import { getMyPayslips, downloadPayslip } from '../../controllers/mobile/mobilePayrollController';

const router = Router();

// Apply auth middleware to protect all mobile payroll routes
router.use(authMiddleware);

// Restrict access to mobile roles only (Store Manager, Salesman, Helper)
const allowedRoles = ['STORE_MANAGER', 'SALESMAN', 'HELPER'];
router.use(roleMiddleware(allowedRoles));

/**
 * @swagger
 * /api/mobile/payroll/slips:
 *   get:
 *     summary: Fetch employee's own salary slips (Mobile)
 *     tags: [Mobile - Payroll]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payslips list retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/slips', getMyPayslips);

/**
 * @swagger
 * /api/mobile/payroll/slips/{id}/download:
 *   get:
 *     summary: Download a specific payslip as PDF (Mobile)
 *     tags: [Mobile - Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: Optional query parameter token for browser download trigger
 *     responses:
 *       200:
 *         description: PDF file stream
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Payslip not found
 *       500:
 *         description: Server error
 */
router.get('/slips/:id/download', downloadPayslip);

export default router;
