import express from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { Role } from '@prisma/client';

const router = express.Router();

// SUPER_ADMIN, PLATFORM_ADMIN, and ADMIN can manage settings
router.use(authMiddleware);
router.use(roleMiddleware([Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN]));

router.get('/', getSettings);
router.put('/', updateSettings);

export default router;
