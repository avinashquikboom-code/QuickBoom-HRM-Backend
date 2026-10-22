import { requireRequestApprover } from '../utils/requestApprovalPermissions';
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
router.get('/hr/features/access-requests', authenticateToken, requireRequestApprover('pa-access-requests'), getPendingAccessRequests);
router.patch('/hr/features/access-requests/:requestId', authenticateToken, requireRequestApprover('pa-access-requests'), processAccessRequest);
router.get('/hr/features/access/:employeeId', authenticateToken, requireRequestApprover('pa-access-requests'), getAllEmployeeFeatures);
router.patch('/hr/features/access/:employeeId/:featureName', authenticateToken, requireRequestApprover('pa-access-requests'), updateFeatureAccess);

export default router;
