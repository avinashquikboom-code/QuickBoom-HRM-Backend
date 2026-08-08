import { Router } from 'express';
import { 
  getSalarySlip, 
  getSalaryStructureList, 
  updateSalaryStructureById 
} from '../controllers/salaryController';
import { authenticateToken } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();
const hrRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN', 'STORE_MANAGER'];

// GET /api/salary/slip
router.get('/slip', authenticateToken, getSalarySlip);

// GET /api/salary/structure?employeeId=
router.get('/structure', authenticateToken, roleMiddleware(hrRoles), getSalaryStructureList);

// PATCH /api/salary/structure/:id (HR only)
router.patch('/structure/:id', authenticateToken, roleMiddleware(hrRoles), updateSalaryStructureById);

export default router;
