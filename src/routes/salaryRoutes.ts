import { Router } from 'express';
import { 
  getSalarySlip, 
  getSalaryStructureList, 
  getSalaryStructureByEmployeeId,
  getMySalaryStructure,
  updateSalaryStructureById 
} from '../controllers/salaryController';
import { authenticateToken } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();
const hrRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN', 'STORE_MANAGER'];

// GET /api/salary/slip
router.get('/slip', authenticateToken, getSalarySlip);

// GET /api/salary/structure/me
router.get('/structure/me', authenticateToken, getMySalaryStructure);

// GET /api/salary/structure?employeeId=
router.get('/structure', authenticateToken, roleMiddleware(hrRoles), getSalaryStructureList);

// GET /api/salary/structure/:employeeId
router.get('/structure/:employeeId', authenticateToken, getSalaryStructureByEmployeeId);

// PATCH /api/salary/structure/:employeeId or :id (HR only)
router.patch('/structure/:id', authenticateToken, roleMiddleware(hrRoles), updateSalaryStructureById);

export default router;
