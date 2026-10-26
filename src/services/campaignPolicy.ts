import { Role } from '@prisma/client';

export class CampaignError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'CampaignError';
  }
}

export const validCategories = [
  'BIRTHDAY',
  'BIRTHDAY_WISHES',
  'PROMOTION',
  'HOLIDAY',
  'FESTIVAL',
  'ANNOUNCEMENT',
  'GENERAL_ANNOUNCEMENT',
  'CUSTOM',
];

export const validModes = [
  'ALL_EMPLOYEES',
  'STORES',
  'SPECIFIC_STORE',
  'MULTIPLE_STORES',
  'BRANCHES',
  'EMPLOYEES',
  'SELECTED_EMPLOYEES',
  'DEPARTMENTS',
  'DEPARTMENT',
  'ROLES',
  'ROLE_DESIGNATION',
  'COMBINED',
];

export interface Audience {
  storeId?: number;
  storeIds: number[];
  branchId?: number;
  branchIds: number[];
  employeeIds: number[];
  departmentId?: number;
  departmentIds: number[];
  designationId?: number;
  role?: string;
  roles: Role[];
  birthdayOnly: boolean;
  timezone: string;
  automaticBirthday: boolean;
}

export function normalizeAudienceMode(mode: string): string {
  const upper = String(mode || 'ALL_EMPLOYEES').toUpperCase().trim();
  if (upper === 'SPECIFIC_STORE' || upper === 'MULTIPLE_STORES') return 'STORES';
  if (upper === 'SELECTED_EMPLOYEES') return 'EMPLOYEES';
  if (upper === 'DEPARTMENT') return 'DEPARTMENTS';
  if (upper === 'ROLE_DESIGNATION') return 'ROLES';
  return upper;
}

export function ids(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isSafeInteger(n) && n > 0);
  }
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .map(v => (typeof v === 'number' ? v : parseInt(String(v), 10)))
          .filter(n => Number.isSafeInteger(n) && n > 0)
      ),
    ];
  }
  return [];
}

export function localDate(now: Date = new Date(), timezone: string = 'Asia/Kolkata'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const year = parts.find(p => p.type === 'year')?.value || String(now.getFullYear());
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const day = parts.find(p => p.type === 'day')?.value || '01';
    return `${year}-${month}-${day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function birthdayMatches(dob: Date | null, targetDateStr: string): boolean {
  if (!dob) return false;
  try {
    const dobIso = dob.toISOString().slice(5, 10); // MM-DD
    const targetIso = targetDateStr.slice(5, 10); // MM-DD
    if (dobIso === targetIso) return true;

    // Handle leap day (Feb 29) on non-leap years
    if (dobIso === '02-29' && targetIso === '02-28') {
      const year = parseInt(targetDateStr.slice(0, 4), 10);
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      if (!isLeap) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function safeUrl(value: unknown, image = false): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) {
    throw new CampaignError(400, 'Invalid URL format');
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('data:image/')) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
      throw new Error();
    }
    return u.href;
  } catch {
    throw new CampaignError(400, image ? 'Image URL must be valid HTTP/HTTPS or local path' : 'Action URL must be valid HTTP/HTTPS or local path');
  }
}

export function validateCampaign(body: any, defaultTimezone = 'Asia/Kolkata') {
  if (!body || typeof body !== 'object') {
    throw new CampaignError(400, 'Campaign payload required');
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : (typeof body.body === 'string' ? body.body.trim() : '');
  if (!title || title.length > 200) {
    throw new CampaignError(400, 'Title is required (1–200 characters)');
  }
  if (!message || message.length > 4000) {
    throw new CampaignError(400, 'Message is required (1–4000 characters)');
  }

  const rawNotificationType = String(body.notificationType || 'GENERAL_ANNOUNCEMENT').toUpperCase();
  const notificationType = validCategories.includes(rawNotificationType)
    ? rawNotificationType
    : 'GENERAL_ANNOUNCEMENT';

  const rawAudienceType = String(body.audienceType || 'ALL_EMPLOYEES').toUpperCase();
  const audienceType = validModes.includes(rawAudienceType) ? rawAudienceType : 'ALL_EMPLOYEES';

  const a = body.audienceCriteria || {};
  const storeIds = ids(a.storeIds || a.storeId);
  const branchIds = ids(a.branchIds || a.branchId);
  const departmentIds = ids(a.departmentIds || a.departmentId);
  const employeeIds = ids(a.employeeIds || a.employeeId);

  const rawRoles = a.roles || (a.role ? [a.role] : []);
  const validRoleValues = Object.values(Role);
  const roles = (Array.isArray(rawRoles) ? rawRoles : [rawRoles])
    .map(r => String(r).toUpperCase().trim())
    .filter(r => validRoleValues.includes(r as any)) as Role[];

  let timezone = a.timezone || defaultTimezone;
  try {
    localDate(new Date(), timezone);
  } catch {
    timezone = defaultTimezone;
  }

  const criteria: Audience = {
    storeId: storeIds[0],
    storeIds,
    branchId: branchIds[0],
    branchIds,
    departmentId: departmentIds[0],
    departmentIds,
    employeeIds,
    designationId: a.designationId ? parseInt(String(a.designationId), 10) : undefined,
    role: roles[0],
    roles,
    birthdayOnly: a.birthdayOnly === true,
    automaticBirthday: a.automaticBirthday === true,
    timezone,
  };

  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (scheduledAt && !Number.isFinite(scheduledAt.getTime())) {
    throw new CampaignError(400, 'Invalid schedule date');
  }

  return {
    title,
    message,
    description: typeof body.description === 'string' ? body.description.trim() : null,
    notificationType,
    audienceType,
    audienceCriteria: criteria,
    imageUrl: safeUrl(body.imageUrl, true),
    actionUrl: safeUrl(body.actionUrl),
    scheduledAt,
  };
}

export type TokenState = {
  key: string;
  state: 'SENDING' | 'SENT' | 'FAILED' | 'RETRY' | 'UNKNOWN';
  attempts: number;
  messageId?: string;
  error?: string;
};

export function pushSummary(states: TokenState[]): string {
  if (!states.length) return 'IN_APP_ONLY';
  if (states.some(s => s.state === 'SENDING' || s.state === 'UNKNOWN')) return 'UNKNOWN';
  if (states.some(s => s.state === 'RETRY')) return 'RETRY';
  if (states.every(s => s.state === 'SENT')) return 'SENT';
  return states.some(s => s.state === 'SENT') ? 'PARTIAL' : 'FAILED';
}
