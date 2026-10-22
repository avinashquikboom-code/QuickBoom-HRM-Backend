import { requireRequestApprover } from '../utils/requestApprovalPermissions';
import { Router } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import {
  createRkdRequest,
  getEmployeeRkdRequests,
  getEmployeeRkdDetails,
  calculateRkdCommissionPreview,
  getHrRkdRequests,
  getHrRkdDetails,
  approveHrRkdRequest,
  rejectHrRkdRequest,
  adjustRkdPayrollPeriod,
} from '../controllers/rkdController';

// ─── Employee RKD Router ───────────────────────────────────────
export const employeeRkdRouter = Router();

// Require authentication for all employee RKD routes
employeeRkdRouter.use(authMiddleware);

employeeRkdRouter.post('/', createRkdRequest);
employeeRkdRouter.get('/', getEmployeeRkdRequests);
employeeRkdRouter.get('/:id', getEmployeeRkdDetails);
employeeRkdRouter.post('/calculate', calculateRkdCommissionPreview);

// ─── HR RKD Router ─────────────────────────────────────────────
export const hrRkdRouter = Router();

// Require authentication and HR/Admin role for all HR RKD routes
hrRkdRouter.use(authMiddleware);
hrRkdRouter.use(roleMiddleware([Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.HR, Role.ADMIN]));
hrRkdRouter.use(requireRequestApprover('pa-commission'));

hrRkdRouter.get('/', getHrRkdRequests);
hrRkdRouter.get('/:id', getHrRkdDetails);
hrRkdRouter.post('/:id/approve', approveHrRkdRequest);
hrRkdRouter.post('/:id/accept', approveHrRkdRequest);
hrRkdRouter.post('/:id/reject', rejectHrRkdRequest);
hrRkdRouter.post('/:id/adjust', adjustRkdPayrollPeriod);
