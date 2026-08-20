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
 * Computes a deterministic payload hash for idempotency comparison,
 * stripping volatile timestamp or request-specific metadata.
 */
export function computePayloadHash(payload: any): string {
  if (!payload) return 'empty';
  let obj = payload;
  if (typeof payload === 'string') {
    try {
      obj = JSON.parse(payload);
    } catch (_) {
      return crypto.createHash('md5').update(payload).digest('hex');
    }
  }

  // Strip dynamic timestamp fields if present to ensure static payload matching
  const clone = { ...obj };
  delete clone.timestamp;
  delete clone.requestTime;
  delete clone._t;

  const str = JSON.stringify(clone);
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
    ? `${eventType}_BILL_${billId}_AMT_${meta.amount || 0}`
    : `${eventType}_HASH_${hash}`;

  // 1. Check by explicit eventId in WebhookLog
  if (eventId) {
    const existingLog = await prisma.webhookLog.findFirst({
      where: {
        eventType: { equals: eventType, mode: 'insensitive' },
        status: { in: ['SUCCESS', 'PROCESSING'] },
        payload: { contains: String(eventId) },
      },
    });

    if (existingLog) {
      return {
        isDuplicate: true,
        dedupKey,
        existingLogId: existingLog.id,
        eventId: String(eventId),
      };
    }
  }

  // 2. Check by exact billId + eventType in recent WebhookLogs
  if (billId) {
    const matchingLogs = await prisma.webhookLog.findMany({
      where: {
        billId: String(billId),
        eventType: { equals: eventType, mode: 'insensitive' },
        status: { in: ['SUCCESS', 'PROCESSING'] },
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });

    for (const log of matchingLogs) {
      const logHash = computePayloadHash(log.payload);
      if (logHash === hash || !eventId || log.payload.includes(String(eventId || billId))) {
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
        status: { in: ['SUCCESS', 'PROCESSING'] },
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
