import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  createShiftRule,
  getHrShiftRules,
  updateShiftRule,
  deleteShiftRule,
  getMobileShiftRules
} from '../controllers/shiftRuleController';

const router = Router();

// Employee route
router.get('/mobile/shift-rules', authMiddleware, getMobileShiftRules);

// HR routes
router.post('/hr/shift-rules', authMiddleware, createShiftRule);
router.get('/hr/shift-rules', authMiddleware, getHrShiftRules);
router.patch('/hr/shift-rules/:id', authMiddleware, updateShiftRule);
router.delete('/hr/shift-rules/:id', authMiddleware, deleteShiftRule);

export default router;
