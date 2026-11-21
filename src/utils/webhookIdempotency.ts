import crypto from 'crypto';
import { prisma } from './db';
import { extractWebhookMeta, normalizeEventType } from './commissionHelper';

export interface IdempotencyResult {
  isDuplicate: boolean;
  dedupKey: string;
  existingLogId?: number | string | null;
  retryLogId?: string | null;
  eventId?: string | null;
}

// A delivery that has been PROCESSING for this long without a completion
// timestamp is assumed to have died with its worker and may be reclaimed.
const STALE_PROCESSING_MS = 15 * 60 * 1000;

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

  // Strip dynamic/volatile fields to ensure deterministic payload matching
  const clone = { ...obj };
  delete clone.timestamp;
  delete clone.requestTime;
  delete clone._t;
  delete clone.updatedAt;
  delete clone.modifiedAt;
  delete clone.modifiedTime;
  delete clone.receivedAt;
  delete clone.sentAt;
  delete clone.webhookTimestamp;
  delete clone.deliveryId;
  delete clone.retryCount;
  delete clone.attempt;

  const str = JSON.stringify(clone);
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Checks whether an incoming HopKid webhook event is a duplicate delivery.
 */
export async function checkWebhookIdempotency(payload: any, rawEventType?: string): Promise<IdempotencyResult> {
  const meta = extractWebhookMeta(payload);
  const eventType = normalizeEventType(rawEventType || meta.eventType || 'INVOICE_CREATED', 'INVOICE_CREATED', payload);
  const eventId = meta.eventId || payload?.eventId || payload?.event_id || payload?.id || payload?.data?.eventId || payload?.data?.event_id || payload?.data?.id || null;
  const billId = meta.billId || meta.invoiceNumber || null;
  const hash = computePayloadHash(payload);

  const dedupKey = eventId
    ? `${eventType}_EVT_${eventId}`
    : billId
    ? `${eventType}_BILL_${billId}_HASH_${hash.slice(0, 8)}`
    : `${eventType}_HASH_${hash}`;

  // 1. Check by explicit eventId in WebhookLog
  if (eventId) {
    const existingLog = await prisma.webhookLog.findFirst({
      where: { eventId: String(eventId) },
    });

    if (existingLog) {
      if (existingLog.status === 'FAILED' || (
        existingLog.status === 'PROCESSING' &&
        !existingLog.processedAt &&
        existingLog.createdAt.getTime() < Date.now() - STALE_PROCESSING_MS
      )) {
        return {
          isDuplicate: false,
          dedupKey,
          existingLogId: existingLog.id,
          retryLogId: existingLog.id,
          eventId: String(eventId),
        };
      }
      console.log(`[Webhook Idempotency] Duplicate detected by eventId: ${eventId}`);
      return {
        isDuplicate: true,
        dedupKey,
        existingLogId: existingLog.id,
        eventId: String(eventId),
      };
    }

    // Older integrations sometimes put the event ID in the serialized payload
    // but did not populate WebhookLog.eventId.
    const legacyLog = await prisma.webhookLog.findFirst({
      where: {
        eventType: { equals: eventType, mode: 'insensitive' },
        status: { in: ['SUCCESS', 'PROCESSING'] },
        payload: { contains: String(eventId) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (legacyLog) {
      const stale = legacyLog.status === 'PROCESSING' && !legacyLog.processedAt &&
        legacyLog.createdAt.getTime() < Date.now() - STALE_PROCESSING_MS;
      if (stale) {
        return { isDuplicate: false, dedupKey, existingLogId: legacyLog.id, retryLogId: legacyLog.id, eventId: String(eventId) };
      }
      return { isDuplicate: true, dedupKey, existingLogId: legacyLog.id, eventId: String(eventId) };
    }
  }

  // 2. Check by exact billId + eventType in recent WebhookLogs with identical payload hash
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
      if (logHash === hash) {
        const stale = log.status === 'PROCESSING' && !log.processedAt &&
          log.createdAt.getTime() < Date.now() - STALE_PROCESSING_MS;
        if (stale) {
          return { isDuplicate: false, dedupKey, existingLogId: log.id, retryLogId: log.id, eventId: eventId ? String(eventId) : null };
        }
        console.log(`[Webhook Idempotency] Duplicate detected by payload hash for billId: ${billId}`);
        return {
          isDuplicate: true,
          dedupKey,
          existingLogId: log.id,
          eventId: eventId ? String(eventId) : null,
        };
      }
    }

    // 2b. Time-window guard: If the same billId + eventType was SUCCESSFULLY processed
    // within the last 30 seconds, treat as duplicate even if payload hash differs slightly.
    // This catches rapid re-deliveries with minor payload variations (e.g., different retry metadata).
    const recentCutoff = new Date(Date.now() - 30_000);
    const recentSameEvent = await prisma.webhookLog.findFirst({
      where: {
        billId: String(billId),
        eventType: { equals: eventType, mode: 'insensitive' },
        status: 'SUCCESS',
        createdAt: { gte: recentCutoff },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentSameEvent) {
      console.log(`[Webhook Idempotency] Duplicate detected by time-window guard for billId: ${billId} (processed ${Math.round((Date.now() - recentSameEvent.createdAt.getTime()) / 1000)}s ago)`);
      return {
        isDuplicate: true,
        dedupKey: `${dedupKey}_TIMEWINDOW`,
        existingLogId: recentSameEvent.id,
        eventId: eventId ? String(eventId) : null,
      };
    }
  } else {
    // 3. Fallback: check recent logs with exact payload hash
    const matchingLogs = await prisma.webhookLog.findMany({
      where: {
        eventType: { equals: eventType, mode: 'insensitive' },
        status: { in: ['SUCCESS', 'PROCESSING'] },
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });

    for (const log of matchingLogs) {
      if (computePayloadHash(log.payload) === hash) {
        const stale = log.status === 'PROCESSING' && !log.processedAt &&
          log.createdAt.getTime() < Date.now() - STALE_PROCESSING_MS;
        if (stale) {
          return { isDuplicate: false, dedupKey, existingLogId: log.id, retryLogId: log.id, eventId: eventId ? String(eventId) : null };
        }
        console.log(`[Webhook Idempotency] Duplicate detected by fallback payload hash`);
        return {
          isDuplicate: true,
          dedupKey,
          existingLogId: log.id,
          eventId: eventId ? String(eventId) : null,
        };
      }
    }
  }

  return {
    isDuplicate: false,
    dedupKey,
    eventId: eventId ? String(eventId) : null,
  };
}

