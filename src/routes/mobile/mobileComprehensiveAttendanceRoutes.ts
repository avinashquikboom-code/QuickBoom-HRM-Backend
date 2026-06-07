import { Router } from 'express';
import { authenticateToken } from '../../middlewares/authMiddleware';
import { getMobileComprehensiveReport } from '../../controllers/mobile/mobileComprehensiveAttendanceController';

const router = Router();

router.use(authenticateToken);

router.get('/comprehensive-report', getMobileComprehensiveReport);

export default router;
