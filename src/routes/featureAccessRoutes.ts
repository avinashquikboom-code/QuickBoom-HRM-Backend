import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  getEmployeeFeatureAccess,
  requestFeatureAccess,
  getPendingAccessRequests,
  updateFeatureAccess,
  processAccessRequest,
  getAllEmployeeFeatures
} from '../controllers/featureAccessController';

const router = Router();

// Mobile Endpoints (Employee)
router.get('/mobile/features/access', authenticateToken, getEmployeeFeatureAccess);
router.post('/mobile/features/access-request', authenticateToken, requestFeatureAccess);

// HR Endpoints
router.get('/hr/features/access-requests', authenticateToken, getPendingAccessRequests);
router.patch('/hr/features/access-requests/:requestId', authenticateToken, processAccessRequest);
router.get('/hr/features/access/:employeeId', authenticateToken, getAllEmployeeFeatures);
router.patch('/hr/features/access/:employeeId/:featureName', authenticateToken, updateFeatureAccess);

export default router;
