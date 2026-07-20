import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  getShifts,
  createShiftRequest,
  getMyShiftRequests
} from '../controllers/shiftRequestController';

const router = Router();

// Apply auth middleware to protect routes individually to prevent global interception on /api mount
router.get('/shifts', authenticateToken, getShifts);
router.post('/shift-requests', authenticateToken, createShiftRequest);
router.get('/shift-requests/my', authenticateToken, getMyShiftRequests);

export default router;
