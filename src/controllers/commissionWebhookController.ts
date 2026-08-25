/**
 * DEPRECATED: Consolidating all Webhook Handlers into src/controllers/webhookController.ts
 * This file re-exports centralized handlers for backward compatibility.
 */
export {
  handleInvoiceCreated,
  handleInvoiceUpdated,
  processInvoiceCreated,
  processInvoiceUpdated,
} from './webhookController';

import webhookRoutes from '../routes/webhookRoutes';
export default webhookRoutes;
