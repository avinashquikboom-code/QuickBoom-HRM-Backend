import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import {
  fetchMyLeaves,
  applyLeave,
  downloadMyLeaveReport,
  downloadLeaveReport,
} from '../../controllers/mobile/mobileLeaveController';

const router = Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// GET /api/mobile/leave/my-leaves - Fetch employee's leave requests and balances
router.get('/my-leaves', fetchMyLeaves);

// POST /api/mobile/leave/apply - Apply for leave
router.post('/apply', applyLeave);

// GET /api/mobile/leave/my-report/download - Download employee's own leave report
router.get('/my-report/download', downloadMyLeaveReport);

// GET /api/mobile/leave/report/download - Download HR leave report (HR/Admin only)
// Query params: employeeId (optional), startDate (optional), endDate (optional)
router.get('/report/download', downloadLeaveReport);

export default router;
