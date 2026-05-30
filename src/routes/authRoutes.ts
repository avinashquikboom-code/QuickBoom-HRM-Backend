import { Router } from 'express';
import { login, register, registerFcmToken } from '../controllers/authController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();

// Public login route
router.post('/login', login);

// Admin-only registration route
router.post(
  '/register',
  authMiddleware,
  roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']),
  register
);

router.post('/fcm-token', authMiddleware, registerFcmToken);

export default router;
