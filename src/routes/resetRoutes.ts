import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  superAdminResetDryRun,
  superAdminResetExecute,
  hrResetDryRun,
  hrResetExecute,
  employeeResetMyData,
  fetchResetLogs,
  fetchBackupStatus,
} from '../controllers/resetController';

const router = Router();

// All reset endpoints require authentication
router.use(authMiddleware);

// SuperAdmin Endpoints
router.post('/superadmin/reset/dry-run', superAdminResetDryRun);
router.post('/superadmin/reset/execute', superAdminResetExecute);
router.get('/superadmin/reset/logs', fetchResetLogs);
router.get('/superadmin/backup-status', fetchBackupStatus);

// HR Endpoints
router.post('/hr/reset/dry-run', hrResetDryRun);
router.post('/hr/reset/execute', hrResetExecute);

// Mobile Employee Endpoint
router.post('/mobile/reset/my-data', employeeResetMyData);

export default router;
