import express from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { Role } from '@prisma/client';

const router = express.Router();

// Only SUPER_ADMIN can manage settings
router.use(authMiddleware);
router.use(roleMiddleware([Role.SUPER_ADMIN, Role.PLATFORM_ADMIN]));

router.get('/', getSettings);
router.put('/', updateSettings);

export default router;
