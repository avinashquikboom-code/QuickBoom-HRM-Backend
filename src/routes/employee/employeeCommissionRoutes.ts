import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import {
  fetchCommissionWallet,
  fetchCommissionHistory,
  fetchCommissionDetails,
  fetchCommissionDashboardWidget,
  fetchSalarySlipCommission
} from '../../controllers/employeeCommissionController';

const router = Router();

// Protect all endpoints with JWT auth middleware
router.use(authMiddleware);

router.get('/wallet', fetchCommissionWallet);
router.get('/history', fetchCommissionHistory);
router.get('/details', fetchCommissionDetails);
router.get('/dashboard-widget', fetchCommissionDashboardWidget);
router.get('/salary-slip/:payrollId', fetchSalarySlipCommission);

export default router;
