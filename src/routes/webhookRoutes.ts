import { Router, Request, Response } from 'express';
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
// 🩺 HEALTH CHECK / TEST PING HANDLER (Responds 200 to GET/HEAD test deliveries)
// ═══════════════════════════════════════════════════════════════════════════════
const webhookPingHandler = (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    status: 'ACTIVE',
    message: 'HopKid HRM Webhook endpoint is active and listening for POST deliveries.',
    timestamp: new Date().toISOString(),
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1️⃣ INVOICE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
const invoiceCreatedPaths = [
  '/invoice/created',
  '/invoice/create',
  '/invoice-created',
  '/invoice_created',
  '/invoiceCreated',
  '/invoice',
  '/commission',
];

const invoiceUpdatedPaths = [
  '/invoice/updated',
  '/invoice/update',
  '/invoice-updated',
  '/invoice_updated',
  '/invoiceUpdated',
  '/commission/updated',
];

invoiceCreatedPaths.forEach((path) => {
  router.post(path, handleInvoiceCreated);
  router.get(path, webhookPingHandler);
  router.head(path, webhookPingHandler);
});

invoiceUpdatedPaths.forEach((path) => {
  router.post(path, handleInvoiceUpdated);
  router.get(path, webhookPingHandler);
  router.head(path, webhookPingHandler);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2️⃣ CREDIT NOTE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
const creditNoteCreatedPaths = [
  '/creditNote/created',
  '/creditNote/create',
  '/credit-note/created',
  '/credit-note/create',
  '/credit_note/created',
  '/creditnote/created',
  '/creditNote',
  '/credit-note',
];

const creditNoteUpdatedPaths = [
  '/creditNote/updated',
  '/creditNote/update',
  '/credit-note/updated',
  '/credit-note/update',
  '/credit_note/updated',
  '/creditnote/updated',
];

creditNoteCreatedPaths.forEach((path) => {
  router.post(path, handleCreditNoteCreated);
  router.get(path, webhookPingHandler);
  router.head(path, webhookPingHandler);
});

creditNoteUpdatedPaths.forEach((path) => {
  router.post(path, handleCreditNoteUpdated);
  router.get(path, webhookPingHandler);
  router.head(path, webhookPingHandler);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3️⃣ SALES EXCHANGE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
const salesExchangeCreatedPaths = [
  '/salesExchange/created',
  '/salesExchange/create',
  '/sales-exchange/created',
  '/sales-exchange/create',
  '/sales_exchange/created',
  '/salesexchange/created',
  '/salesExchange',
  '/sales-exchange',
];

const salesExchangeUpdatedPaths = [
  '/salesExchange/updated',
  '/salesExchange/update',
  '/sales-exchange/updated',
  '/sales-exchange/update',
  '/sales_exchange/updated',
  '/salesexchange/updated',
];

salesExchangeCreatedPaths.forEach((path) => {
  router.post(path, handleSalesExchangeCreated);
  router.get(path, webhookPingHandler);
  router.head(path, webhookPingHandler);
});

salesExchangeUpdatedPaths.forEach((path) => {
  router.post(path, handleSalesExchangeUpdated);
  router.get(path, webhookPingHandler);
  router.head(path, webhookPingHandler);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4️⃣ EMPLOYEE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
const employeeCreatedPaths = ['/employee/created', '/employee/create', '/employee-created'];
const employeeUpdatedPaths = ['/employee/updated', '/employee/update', '/employee-updated'];
const employeeDeletedPaths = ['/employee/deleted', '/employee/delete', '/employee-deleted'];

employeeCreatedPaths.forEach((p) => {
  router.post(p, handleEmployeeCreated);
  router.get(p, webhookPingHandler);
});
employeeUpdatedPaths.forEach((p) => {
  router.post(p, handleEmployeeUpdated);
  router.get(p, webhookPingHandler);
});
employeeDeletedPaths.forEach((p) => {
  router.post(p, handleEmployeeDeleted);
  router.get(p, webhookPingHandler);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5️⃣ UNIFIED INGRESS / CATCH-ALL
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/', handleUnifiedWebhook);
router.get('/', webhookPingHandler);
router.head('/', webhookPingHandler);

router.post('/hopkid', handleUnifiedWebhook);
router.get('/hopkid', webhookPingHandler);

router.post('/sales', handleUnifiedWebhook);
router.get('/sales', webhookPingHandler);

// ═══════════════════════════════════════════════════════════════════════════════
// 6️⃣ LOGS & MONITORING
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/raw-logs', getHopkidLogs);
router.get('/hopkid/raw-logs', getHopkidLogs);
router.use('/', webhookLogsRouter);

export default router;

