import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
  startBreak,
  endBreak,
  getTodayBreaks
} from '../controllers/breakController';

const router = Router();

// Apply auth middleware to protect all break routes
router.use(authenticateToken);

router.post('/start', startBreak);
router.post('/end', endBreak);
router.get('/today', getTodayBreaks);

export default router;
