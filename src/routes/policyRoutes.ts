import { Router } from 'express';
import { getCompanyPolicies } from '../controllers/policyController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// GET /api/mobile/policies
router.get('/mobile/policies', authenticateToken, getCompanyPolicies);
router.get('/policies', authenticateToken, getCompanyPolicies);

export default router;
