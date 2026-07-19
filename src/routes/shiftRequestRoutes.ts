import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  getShifts,
  createShiftRequest,
  getMyShiftRequests
} from '../controllers/shiftRequestController';

const router = Router();

// Apply auth middleware to protect all routes
router.use(authenticateToken);

router.get('/shifts', getShifts);
router.post('/shift-requests', createShiftRequest);
router.get('/shift-requests/my', getMyShiftRequests);

export default router;
