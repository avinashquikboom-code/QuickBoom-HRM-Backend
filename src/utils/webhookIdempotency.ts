import crypto from 'crypto';
import { prisma } from './db';
import { extractWebhookMeta, normalizeEventType } from './commissionHelper';

export interface IdempotencyResult {
  isDuplicate: boolean;
  dedupKey: string;
  existingLogId?: number | string | null;
  eventId?: string | null;
}

/**
 * Computes a deterministic payload hash for idempotency comparison
 */
export function computePayloadHash(payload: any): string {
  if (!payload) return 'empty';
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Checks whether an incoming HopKid webhook event is a duplicate delivery.
 */
export async function checkWebhookIdempotency(payload: any, rawEventType?: string): Promise<IdempotencyResult> {
  const meta = extractWebhookMeta(payload);
  const eventType = normalizeEventType(rawEventType || meta.eventType || 'INVOICE_CREATED', 'INVOICE_CREATED', payload);
  const eventId = meta.eventId || payload?.eventId || payload?.id || payload?.data?.eventId || payload?.data?.id || null;
  const billId = meta.billId || meta.invoiceNumber || null;
  const hash = computePayloadHash(payload);

  const dedupKey = eventId
    ? `${eventType}_EVT_${eventId}`
    : billId
    ? `${eventType}_BILL_${billId}_${hash}`
    : `${eventType}_HASH_${hash}`;

  // 1. If explicit eventId exists, check WebhookLog by eventId or payload match
  if (eventId) {
    const existingLog = await prisma.webhookLog.findFirst({
      where: {
        eventType: { equals: eventType, mode: 'insensitive' },
        OR: [
          { payload: { contains: String(eventId) } },
          { billId: billId ? { equals: String(billId) } : undefined },
        ].filter(Boolean) as any,
      },
    });

    if (existingLog) {
      const logPayloadHash = computePayloadHash(existingLog.payload);
      if (logPayloadHash === hash || existingLog.payload.includes(String(eventId))) {
        return {
          isDuplicate: true,
          dedupKey,
          existingLogId: existingLog.id,
          eventId: String(eventId),
        };
      }
    }
  }

  // 2. Check by exact billId + eventType + payload hash in recent WebhookLogs
  if (billId) {
    const matchingLogs = await prisma.webhookLog.findMany({
      where: {
        billId: String(billId),
        eventType: { equals: eventType, mode: 'insensitive' },
      },
      take: 10,
      orderBy: { id: 'desc' },
    });

    for (const log of matchingLogs) {
      if (computePayloadHash(log.payload) === hash) {
        return {
          isDuplicate: true,
          dedupKey,
          existingLogId: log.id,
          eventId: eventId ? String(eventId) : null,
        };
      }
    }
  } else {
    // 3. Fallback: check recent logs with exact payload hash
    const matchingLog = await prisma.webhookLog.findFirst({
      where: {
        eventType: { equals: eventType, mode: 'insensitive' },
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      },
    });

    if (matchingLog) {
      return {
        isDuplicate: true,
        dedupKey,
        existingLogId: matchingLog.id,
        eventId: eventId ? String(eventId) : null,
      };
    }
  }

  return {
    isDuplicate: false,
    dedupKey,
    eventId: eventId ? String(eventId) : null,
  };
}
