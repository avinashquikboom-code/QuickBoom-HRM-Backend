import { Router } from 'express';
import { handleHopkidWebhook, getHopkidLogs } from '../controllers/webhookController';

const router = Router();

// Handle incoming HopKid sales data webhooks
router.post('/', handleHopkidWebhook);
router.post('/hopkid', handleHopkidWebhook);
router.post('/sales', handleHopkidWebhook);
router.post('/commission', handleHopkidWebhook);

// Fetch raw webhook logs
router.get('/logs', getHopkidLogs);
router.get('/hopkid/logs', getHopkidLogs);

export default router;
