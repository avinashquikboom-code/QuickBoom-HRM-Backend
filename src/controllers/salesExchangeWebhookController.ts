/**
 * DEPRECATED: Consolidating all Webhook Handlers into src/controllers/webhookController.ts
 * This file re-exports centralized handlers for backward compatibility.
 */
export {
  handleSalesExchangeCreated,
  handleSalesExchangeUpdated,
  processSalesExchangeCreated,
  processSalesExchangeUpdated,
} from './webhookController';

import webhookRoutes from '../routes/webhookRoutes';
export default webhookRoutes;
