import { Router } from 'express';
import { getEmployeeList } from '../../controllers/employeeLegacyController';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { apiKeyMiddleware } from '../../middlewares/apiKeyMiddleware';

const router = Router();

// Apply auth and apiKey middlewares to all routes
router.use(authMiddleware);
router.use(apiKeyMiddleware);

router.get('/GetEmployeeList', getEmployeeList);

export default router;
