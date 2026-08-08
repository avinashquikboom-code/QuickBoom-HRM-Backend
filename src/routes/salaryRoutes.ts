import { Router } from 'express';
import { 
  getSalarySlip, 
  getSalaryStructureList, 
  getSalaryStructureByEmployeeId,
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

// GET /api/salary/structure/:employeeId
router.get('/structure/:employeeId', authenticateToken, roleMiddleware(hrRoles), getSalaryStructureByEmployeeId);

// PATCH /api/salary/structure/:employeeId or :id (HR only)
router.patch('/structure/:id', authenticateToken, roleMiddleware(hrRoles), updateSalaryStructureById);

export default router;
