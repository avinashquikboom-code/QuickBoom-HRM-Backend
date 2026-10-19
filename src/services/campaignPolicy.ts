import { Prisma, Role } from '@prisma/client';

export class CampaignError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const categories = ['BIRTHDAY', 'PROMOTION', 'HOLIDAY', 'FESTIVAL', 'ANNOUNCEMENT', 'CUSTOM'];
export const modes = ['ALL_EMPLOYEES', 'STORES', 'BRANCHES', 'EMPLOYEES', 'DEPARTMENTS', 'ROLES', 'COMBINED'];
export type Audience = { storeIds: number[]; branchIds: number[]; employeeIds: number[]; departmentIds: number[]; roles: Role[]; birthdayOnly: boolean; timezone: string; automaticBirthday: boolean };
export function ids(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5000 || value.some(v => !Number.isSafeInteger(v) || v <= 0)) throw new CampaignError(400, 'IDs must be positive integers');
  return [...new Set(value)];
}
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k)!.value).join('-');
}
// DOB is a calendar date stored as a timestamp without timezone: never shift its month/day.
export function birthdayMatches(dob: Date | null, date: string): boolean {
  return !!dob && dob.toISOString().slice(5, 10) === date.slice(5, 10);
}
export function safeUrl(value: unknown, image = false): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new CampaignError(400, 'Invalid URL');
  try { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password) throw new Error(); return u.href; }
  catch { throw new CampaignError(400, image ? 'Image URL must use HTTPS' : 'Action URL must use HTTPS'); }
}
export function validateCampaign(body: any, defaultTimezone = 'Asia/Kolkata') {
  if (!body || typeof body !== 'object') throw new CampaignError(400, 'Campaign payload required');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!title || title.length > 200 || !message || message.length > 4000) throw new CampaignError(400, 'Title (1–200) and message (1–4000) are required');
  if (!categories.includes(body.notificationType) || !modes.includes(body.audienceType)) throw new CampaignError(400, 'Invalid category or audience mode');
  const a = body.audienceCriteria || {};
  const roles = a.roles === undefined ? [] : a.roles;
  if (!Array.isArray(roles) || roles.some(r => !Object.values(Role).includes(r))) throw new CampaignError(400, 'Invalid roles');
  for (const key of ['birthdayOnly', 'automaticBirthday']) if (a[key] !== undefined && typeof a[key] !== 'boolean') throw new CampaignError(400, `Invalid ${key}`);
  const timezone = a.timezone || defaultTimezone;
  try { localDate(new Date(), timezone); } catch { throw new CampaignError(400, 'Invalid timezone'); }
  const criteria: Audience = { storeIds: ids(a.storeIds), branchIds: ids(a.branchIds), employeeIds: ids(a.employeeIds), departmentIds: ids(a.departmentIds), roles, birthdayOnly: a.birthdayOnly === true, automaticBirthday: a.automaticBirthday === true, timezone };
  const keys: Record<string, keyof Audience> = { STORES: 'storeIds', BRANCHES: 'branchIds', EMPLOYEES: 'employeeIds', DEPARTMENTS: 'departmentIds', ROLES: 'roles' };
  if (keys[body.audienceType] && !(criteria[keys[body.audienceType]] as unknown[]).length) throw new CampaignError(400, 'Select at least one recipient group');
  if (body.audienceType === 'COMBINED' && ![criteria.storeIds, criteria.branchIds, criteria.employeeIds, criteria.departmentIds, criteria.roles].some(v => v.length)) throw new CampaignError(400, 'Select at least one recipient group');
  if (criteria.automaticBirthday && (!criteria.birthdayOnly || body.notificationType !== 'BIRTHDAY')) throw new CampaignError(400, 'Automatic birthdays require Birthday category and birthday filter');
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (scheduledAt && (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date())) throw new CampaignError(400, 'Schedule must be in the future');
  if (criteria.automaticBirthday && scheduledAt) throw new CampaignError(400, 'Automatic birthdays run daily; do not specify a schedule');
  return { title, message, notificationType: body.notificationType as string, audienceType: body.audienceType as string, audienceCriteria: criteria, imageUrl: safeUrl(body.imageUrl, true), actionUrl: safeUrl(body.actionUrl), scheduledAt };
}
export function audienceWhere(mode: string, a: Audience): Prisma.EmployeeWhereInput {
  const groups: Record<string, Prisma.EmployeeWhereInput> = {
    STORES: { storeId: { in: a.storeIds } }, BRANCHES: { branchId: { in: a.branchIds } }, EMPLOYEES: { id: { in: a.employeeIds } }, DEPARTMENTS: { departmentId: { in: a.departmentIds } }, ROLES: { user: { role: { in: a.roles } } },
  };
  if (mode === 'ALL_EMPLOYEES') return {};
  if (mode === 'COMBINED') return { OR: Object.values(groups) };
  if (!groups[mode]) throw new CampaignError(400, 'Invalid audience mode');
  return groups[mode];
}
export type TokenState = { key: string; state: 'SENDING' | 'SENT' | 'FAILED' | 'RETRY' | 'UNKNOWN'; attempts: number; messageId?: string };
export function pushSummary(states: TokenState[]): string {
  if (!states.length) return 'IN_APP_ONLY';
  if (states.some(s => s.state === 'SENDING' || s.state === 'UNKNOWN')) return 'UNKNOWN';
  if (states.some(s => s.state === 'RETRY')) return 'RETRY';
  if (states.every(s => s.state === 'SENT')) return 'SENT';
  return states.some(s => s.state === 'SENT') ? 'PARTIAL' : 'FAILED';
}
