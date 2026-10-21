import { createHash } from 'crypto';

export const tokenFingerprint = (token: string): string =>
  createHash('sha256').update(token).digest('hex').slice(0, 16);

/** Only provider-confirmed permanent registration failures may retire a token. */
export function isPermanentFcmTokenError(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null;
  return ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(value?.code || '') ||
    (value?.code === 'messaging/invalid-argument' && typeof value.message === 'string' &&
      /^The registration token is not a valid FCM registration token\.?$/i.test(value.message.trim()));
}

export function classifyFcmError(code: string): 'token' | 'credentials' | 'permission' | 'configuration' | 'transient' | 'unknown' {
  if (['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(code)) return 'token';
  if (['app/invalid-credential', 'app/invalid-app-options', 'messaging/authentication-error', 'messaging/mismatched-credential', 'messaging/third-party-auth-error'].includes(code)) return 'credentials';
  if (['messaging/insufficient-permission', 'PERMISSION_DENIED'].includes(code)) return 'permission';
  if (code.startsWith('firebase/') || ['messaging/not-configured', 'messaging/invalid-argument', 'messaging/invalid-payload', 'messaging/invalid-options'].includes(code)) return 'configuration';
  if (['messaging/server-unavailable', 'messaging/internal-error', 'messaging/message-rate-exceeded', 'messaging/device-message-rate-exceeded', 'messaging/topics-message-rate-exceeded', 'app/network-error', 'app/network-timeout', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'transient';
  return 'unknown';
}

/** Preserve useful provider diagnostics while removing secrets and device identifiers. */
export function safeFcmError(error: unknown, tokens: string[] = []) {
  const value = error as { code?: unknown; message?: unknown } | null;
  const code = typeof value?.code === 'string' && /^[\w/-]+$/.test(value.code) ? value.code : 'messaging/unknown-outcome';
  let message = typeof value?.message === 'string' ? value.message : 'No provider message available';
  for (const token of tokens) if (token) message = message.split(token).join('[redacted-token]');
  message = message
    .replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g, '[redacted-key]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9_.~+:/=-]{80,}\b/g, '[redacted-secret]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 700);
  return { code, category: isPermanentFcmTokenError(error) ? 'token' as const : classifyFcmError(code), message };
}
