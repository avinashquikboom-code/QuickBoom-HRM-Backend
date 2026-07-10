import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  calculateEmployeePayroll,
  processPayrollRun,
  getSalaryStructure,
  updateSalaryStructure,
  getPayrollStatistics,
  getPayrollRuns,
  bulkUpdateSalaryStructures,
  getEmployeePayrollHistory,
  generatePayslipPDF,
  approvePayslip,
  rejectPayslip,
  getPayrollDashboard,
  getAdminPayrollStats,
  getAdminPayrollRuns,
  getAdminPayrollSlips,
  approveAdminPayslip,
  bulkDisbursePayroll,
} from '../controllers/payrollController';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Payroll calculation and processing
router.post('/calculate', calculateEmployeePayroll);
router.post('/process-run', processPayrollRun);

// Salary structure management
router.get('/salary-structure/:employeeId', getSalaryStructure);
router.put('/salary-structure/:employeeId', updateSalaryStructure);
router.post('/salary-structure/bulk-update', bulkUpdateSalaryStructures);

// Payroll statistics and reports
router.get('/stats', getPayrollStatistics);
router.get('/runs', getPayrollRuns);
router.get('/dashboard', getPayrollDashboard);

// Employee payroll history
router.get('/history/:employeeId', getEmployeePayrollHistory);

// Payslip management
router.get('/payslip/:employeeId/:month/:year/pdf', generatePayslipPDF);
router.put('/payslip/:payslipId/approve', approvePayslip);
router.put('/payslip/:payslipId/reject', rejectPayslip);

// Admin-specific endpoints for frontend
router.get('/admin/stats', getAdminPayrollStats);
router.get('/admin/runs', getAdminPayrollRuns);
router.get('/admin/slips', getAdminPayrollSlips);
router.post('/admin/slips/approve', approveAdminPayslip);
router.post('/admin/disburse', bulkDisbursePayroll);

export default router;