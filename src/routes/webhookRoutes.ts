import { Router } from 'express';
import {
  handleInvoiceCreated,
  handleInvoiceUpdated,
  handleCreditNoteCreated,
  handleCreditNoteUpdated,
  handleSalesExchangeCreated,
  handleSalesExchangeUpdated,
  handleEmployeeCreated,
  handleEmployeeUpdated,
  handleEmployeeDeleted,
  handleUnifiedWebhook,
  getHopkidLogs
} from '../controllers/webhookController';
import webhookLogsRouter from '../controllers/webhookLogsController';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════════
// 1️⃣ INVOICE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/invoice/created', handleInvoiceCreated);
router.post('/invoice/updated', handleInvoiceUpdated);
router.post('/commission', handleInvoiceCreated);
router.post('/commission/updated', handleInvoiceUpdated);

// ═══════════════════════════════════════════════════════════════════════════════
// 2️⃣ CREDIT NOTE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/creditNote/created', handleCreditNoteCreated);
router.post('/creditNote/updated', handleCreditNoteUpdated);
router.post('/credit-note/created', handleCreditNoteCreated);
router.post('/credit-note/updated', handleCreditNoteUpdated);

// ═══════════════════════════════════════════════════════════════════════════════
// 3️⃣ SALES EXCHANGE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/salesExchange/created', handleSalesExchangeCreated);
router.post('/salesExchange/updated', handleSalesExchangeUpdated);
router.post('/sales-exchange/created', handleSalesExchangeCreated);
router.post('/sales-exchange/updated', handleSalesExchangeUpdated);

// ═══════════════════════════════════════════════════════════════════════════════
// 4️⃣ EMPLOYEE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/employee/created', handleEmployeeCreated);
router.post('/employee/updated', handleEmployeeUpdated);
router.post('/employee/deleted', handleEmployeeDeleted);

// ═══════════════════════════════════════════════════════════════════════════════
// 5️⃣ UNIFIED INGRESS / CATCH-ALL
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/', handleUnifiedWebhook);
router.post('/hopkid', handleUnifiedWebhook);
router.post('/sales', handleUnifiedWebhook);

// ═══════════════════════════════════════════════════════════════════════════════
// 6️⃣ LOGS & MONITORING
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/raw-logs', getHopkidLogs);
router.get('/hopkid/raw-logs', getHopkidLogs);
router.use('/', webhookLogsRouter);

export default router;
