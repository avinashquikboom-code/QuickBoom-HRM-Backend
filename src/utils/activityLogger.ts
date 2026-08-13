import { prisma } from './db';

export interface LogActivityInput {
  actorId?: string | number | null;
  actorName?: string | null;
  actorRole?: string | null;
  source: 'ADMIN_PANEL' | 'SUPER_ADMIN' | 'HR_ADMIN' | 'MOBILE' | 'HOPKID_WEBHOOK' | 'SYSTEM' | string;
  action: string;
  entityType?: string | null;
  entityId?: string | number | null;
  description?: string | null;
  metadata?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
  status?: 'SUCCESS' | 'FAILED' | 'PENDING' | string;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'pass',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'otp',
  'pin',
  'cvv',
  'authorization'
]);

function sanitizeMetadata(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeMetadata);

  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      clean[key] = sanitizeMetadata(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Non-blocking central activity logger.
 * Writes immutable activity audit records into the ActivityLog database table.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const sanitizedMeta = input.metadata ? sanitizeMetadata(input.metadata) : null;
    const metadataStr = sanitizedMeta
      ? typeof sanitizedMeta === 'string'
        ? sanitizedMeta
        : JSON.stringify(sanitizedMeta)
      : null;

    const log = await prisma.activityLog.create({
      data: {
        actorId: input.actorId !== undefined && input.actorId !== null ? String(input.actorId) : null,
        actorName: input.actorName ? String(input.actorName).trim() : null,
        actorRole: input.actorRole ? String(input.actorRole).toUpperCase().trim() : null,
        source: input.source || 'SYSTEM',
        action: input.action ? String(input.action).toUpperCase().trim() : 'ACTION',
        entityType: input.entityType ? String(input.entityType).trim() : null,
        entityId: input.entityId !== undefined && input.entityId !== null ? String(input.entityId) : null,
        description: input.description ? String(input.description).trim() : null,
        metadata: metadataStr,
        ipAddress: input.ipAddress ? String(input.ipAddress) : null,
        userAgent: input.userAgent ? String(input.userAgent) : null,
        status: input.status ? String(input.status).toUpperCase() : 'SUCCESS'
      }
    });

    console.log(`[ACTIVITY LOG] ✅ Recorded ${log.source} | ${log.action} | Actor: ${log.actorName || 'N/A'}`);
  } catch (err: any) {
    console.error('[ACTIVITY LOG ERROR] Failed to record activity log:', err.message);
  }
}
