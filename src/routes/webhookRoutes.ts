import { Router } from 'express';
import { handleHopkidWebhook } from '../controllers/webhookController';

const router = Router();

// Handle incoming HopKid sales data webhooks
router.post('/', handleHopkidWebhook);
router.post('/hopkid', handleHopkidWebhook);
router.post('/sales', handleHopkidWebhook);
router.post('/commission', handleHopkidWebhook);

export default router;
