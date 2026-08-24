import { Router, Request, Response } from 'express';
import { processHopkidSales } from './webhookController';
import { checkWebhookIdempotency } from '../utils/webhookIdempotency';

const router = Router();

console.log('[Commission Webhook Controller] ✅ Loaded');

/**
 * POST /api/webhook/commission
 * HopKid sends: invoice.created event
 */
router.post('/', async (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [INVOICE CREATED] Webhook received                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    const idempotency = await checkWebhookIdempotency(rawPayload, 'INVOICE_CREATED');
    if (idempotency.isDuplicate) {
      console.log(`[Invoice Created] ℹ️ Duplicate event safely ignored (Key: ${idempotency.dedupKey})`);
      res.status(200).json({
        success: true,
        message: 'Webhook already processed',
        duplicate: true,
        dedupKey: idempotency.dedupKey,
      });
      return;
    }

    await processHopkidSales(rawPayload);

    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      duplicate: false,
    });
  } catch (err: any) {
    console.error('[Invoice Created] ❌ Error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to process webhook.',
      error: err.message,
    });
  }
});

export async function processInvoiceCreated(payload: any): Promise<void> {
  await processHopkidSales(payload);
}

/**
 * POST /api/webhook/commission/updated
 * HopKid sends: invoice.updated event
 */
router.post('/updated', async (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [INVOICE UPDATED] Webhook received                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    const idempotency = await checkWebhookIdempotency(rawPayload, 'INVOICE_UPDATED');
    if (idempotency.isDuplicate) {
      console.log(`[Invoice Updated] ℹ️ Duplicate event safely ignored (Key: ${idempotency.dedupKey})`);
      res.status(200).json({
        success: true,
        message: 'Webhook already processed',
        duplicate: true,
        dedupKey: idempotency.dedupKey,
      });
      return;
    }

    // Ensure eventType is INVOICE_UPDATED if not explicitly provided
    const payloadToProcess = typeof rawPayload === 'object' && rawPayload !== null
      ? { ...rawPayload, eventType: rawPayload.eventType || 'INVOICE_UPDATED' }
      : rawPayload;

    await processHopkidSales(payloadToProcess);

    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      duplicate: false,
    });
  } catch (err: any) {
    console.error('[Invoice Updated] ❌ Error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to process webhook.',
      error: err.message,
    });
  }
});

export async function processInvoiceUpdated(payload: any): Promise<void> {
  const payloadToProcess = typeof payload === 'object' && payload !== null
    ? { ...payload, eventType: payload.eventType || 'INVOICE_UPDATED' }
    : payload;
  await processHopkidSales(payloadToProcess);
}

export default router;
