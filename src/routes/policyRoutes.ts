import { Router } from 'express';
import { authMiddleware as authenticate } from '../middlewares/authMiddleware';
import {
  createDeductionPolicy,
  getAllDeductionPolicies,
  getDeductionPolicyById,
  updateDeductionPolicy,
  deleteDeductionPolicy,
  getApplicablePoliciesForEmployee,
} from '../controllers/policyController';

const router = Router();

// ─── Deduction Policy Routes ─────────────────────────────────────────────────

router.post('/policies', authenticate, createDeductionPolicy);
router.get('/policies', authenticate, getAllDeductionPolicies);
router.get('/policies/:id', authenticate, getDeductionPolicyById);
router.put('/policies/:id', authenticate, updateDeductionPolicy);
router.delete('/policies/:id', authenticate, deleteDeductionPolicy);
router.get('/policies/employee/:employeeId/applicable', authenticate, getApplicablePoliciesForEmployee);

export default router;
