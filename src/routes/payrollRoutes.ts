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
  disburseAdminPayslip,
  getExtraAttendancePayRule,
  updateExtraAttendancePayRule,
} from '../controllers/payrollController';

import {
  getAdminSalaryAdvances,
  reviewSalaryAdvance,
} from '../controllers/salaryAdvanceController';
import { exportPayrollGovernance } from '../controllers/payrollGovernanceExportController';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { PAYROLL_EXPORT_ROLES } from '../utils/payrollGovernanceExport';

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
router.get('/admin/export', roleMiddleware([...PAYROLL_EXPORT_ROLES]), exportPayrollGovernance);
router.get('/admin/stats', getAdminPayrollStats);
router.get('/admin/runs', getAdminPayrollRuns);
router.get('/admin/slips', getAdminPayrollSlips);
router.post('/admin/slips/approve', approveAdminPayslip);
router.post('/admin/slips/disburse', disburseAdminPayslip);
router.post('/admin/disburse', bulkDisbursePayroll);
router.get('/admin/extra-pay-rule', getExtraAttendancePayRule);
router.put('/admin/extra-pay-rule', updateExtraAttendancePayRule);

// Salary Advance management endpoints
router.get('/admin/advances', getAdminSalaryAdvances);
router.put('/admin/advances/:id/review', reviewSalaryAdvance);

export default router;