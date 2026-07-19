import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import { pingLocation } from '../controllers/locationTrackingController';

const router = Router();

router.use(authenticateToken);
router.post('/ping', pingLocation);

export default router;
