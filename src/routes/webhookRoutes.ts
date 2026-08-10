import { Router } from 'express';
import { handleHopkidWebhook, getHopkidLogs } from '../controllers/webhookController';
import webhookLogsRouter from '../controllers/webhookLogsController';

const router = Router();

// Handle incoming HopKid sales data webhooks
router.post('/', handleHopkidWebhook);
router.post('/hopkid', handleHopkidWebhook);
router.post('/sales', handleHopkidWebhook);
router.post('/commission', handleHopkidWebhook);

// Dedicated raw logs endpoint
router.get('/raw-logs', getHopkidLogs);
router.get('/hopkid/raw-logs', getHopkidLogs);

// Mount logs, stats, delete, clear router
router.use('/', webhookLogsRouter);

export default router;

