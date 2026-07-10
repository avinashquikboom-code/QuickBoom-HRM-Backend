import { Router } from 'express';
import { addSales, updateSales, addCreditNote, addSalesExchange } from '../../controllers/salesLegacyController';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { apiKeyMiddleware } from '../../middlewares/apiKeyMiddleware';

const router = Router();

// Apply auth and apiKey middlewares to all routes
router.use(authMiddleware);
router.use(apiKeyMiddleware);

router.post('/AddSales', addSales);
router.post('/UpdateSales', updateSales);
router.post('/AddCreditNote', addCreditNote);
router.post('/AddSalesExchange', addSalesExchange);

export default router;
