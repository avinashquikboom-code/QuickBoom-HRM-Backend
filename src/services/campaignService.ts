import { Prisma, Campaign } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from '../utils/db';
import { firebaseNotificationService } from './firebaseNotificationService';
import { Audience, CampaignError, audienceWhere, birthdayMatches, localDate, TokenState, pushSummary } from './campaignPolicy';

export async function actorScope(userId: number): Promise<Prisma.EmployeeWhereInput> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { employee: true } });
  if (!user?.isActive) throw new CampaignError(403, 'Active administrator required');
  if (['SUPER_ADMIN', 'ADMIN', 'PLATFORM_ADMIN'].includes(user.role)) return {};
  if (user.role !== 'HR') throw new CampaignError(403, 'Campaign management is restricted to administrators and HR');
  // HR is limited to its actual store/branch. Missing assignments never grant global access.
  const e = user.employee;
  if (!e || e.status.toLowerCase() !== 'active' || (!e.storeId && !e.branchId)) throw new CampaignError(403, 'HR requires an active store or branch assignment');
  return { OR: [...(e.storeId ? [{ storeId: e.storeId }] : []), ...(e.branchId ? [{ branchId: e.branchId }] : [])] };
}
export async function campaignAccess(id: string, actorId: number) {
  const scope = await actorScope(actorId);
  const c = await prisma.campaign.findFirst({ where: { id, companyId: null, ...(Object.keys(scope).length ? { createdById: actorId } : {}) } });
  if (!c) throw new CampaignError(404, 'Campaign not found');
  return c;
}
export async function resolveRecipients(actorId: number, mode: string, a: Audience, date = localDate(new Date(), a.timezone), allowEmpty = false) {
  const scope = await actorScope(actorId);
  const restricted = Object.keys(scope).length > 0;
  if (restricted && mode === 'ALL_EMPLOYEES') throw new CampaignError(403, 'HR must select recipients within its assigned store or branch');
  // Validate every supplied identifier, including fields hidden by the selected mode.
  for (const [model, values] of [['store', a.storeIds], ['branch', a.branchIds], ['department', a.departmentIds]] as const) {
    if (!values.length) continue;
    const count = model === 'store' ? await prisma.store.count({ where: { id: { in: values }, isActive: true } }) : model === 'branch' ? await prisma.branch.count({ where: { id: { in: values } } }) : await prisma.department.count({ where: { id: { in: values } } });
    if (count !== values.length) throw new CampaignError(400, 'Unknown or inactive recipient group');
    if (restricted) {
      const owner = await prisma.employee.findUnique({ where: { userId: actorId } });
      if (model === 'department' || values.some(id => id !== (model === 'store' ? owner?.storeId : owner?.branchId))) throw new CampaignError(403, 'Recipient group outside your assigned scope');
    }
  }
  if (a.employeeIds.length) {
    const count = await prisma.employee.count({ where: { AND: [scope, { id: { in: a.employeeIds }, status: { equals: 'active', mode: 'insensitive' }, user: { isActive: true } }] } });
    if (count !== a.employeeIds.length) throw new CampaignError(400, 'Employee selection contains unavailable recipients');
  }
  const found = await prisma.employee.findMany({ where: { AND: [scope, audienceWhere(mode, a), { status: { equals: 'active', mode: 'insensitive' }, user: { isActive: true } }] }, select: { id: true, userId: true, dateOfBirth: true }, orderBy: { id: 'asc' } });
  const recipients = a.birthdayOnly ? found.filter(e => birthdayMatches(e.dateOfBirth, date)) : found;
  if (!recipients.length && !allowEmpty) throw new CampaignError(400, 'No eligible employees match this audience');
  return recipients;
}
export async function queueCampaign(id: string, actorId: number, scheduled = false) {
  const c = await campaignAccess(id, actorId);
  if (!['DRAFT', 'SCHEDULED'].includes(c.status)) throw new CampaignError(409, 'Campaign can no longer be sent');
  const audience = c.audienceCriteria as unknown as Audience;
  const date = scheduled && c.scheduledAt ? localDate(c.scheduledAt, audience.timezone) : undefined;
  const recipients = await resolveRecipients(actorId, c.audienceType, audience, date);
  await prisma.$transaction(async tx => {
    const claimed = await tx.campaign.updateMany({ where: { id, updatedAt: c.updatedAt, status: { in: ['DRAFT', 'SCHEDULED'] } }, data: { status: 'QUEUED', totalRecipients: recipients.length } });
    if (!claimed.count) throw new CampaignError(409, 'Campaign can no longer be sent');
    for (let i = 0; i < recipients.length; i += 1000) {
      await tx.campaignRecipient.createMany({ data: recipients.slice(i, i + 1000).map(e => ({ campaignId: id, employeeId: e.id, userId: e.userId })), skipDuplicates: true });
    }
  });
  return prisma.campaign.findUnique({ where: { id } });
}
const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex');
export async function deliverRecipient(c: Campaign, r: { id: string; employeeId: number; userId: number | null; tokenStates: Prisma.JsonValue | null }) {
  const employee = await prisma.employee.findUnique({ where: { id: r.employeeId }, include: { user: true } });
  const scope = await actorScope(c.createdById!);
  const allowed = await prisma.employee.count({ where: { AND: [scope, { id: r.employeeId }] } });
  if (!allowed || employee?.status.toLowerCase() !== 'active' || !employee.user?.isActive || employee.userId !== r.userId) {
    await prisma.campaignRecipient.update({ where: { id: r.id }, data: { deliveryStatus: 'SKIPPED', failureReason: 'Recipient no longer eligible' } }); return;
  }
  // Persist once before push. The campaign/employee recipient is claimed by a single worker.
  const notification = await prisma.notification.upsert({ where: { campaignId_employeeId: { campaignId: c.id, employeeId: r.employeeId } }, update: {}, create: { campaignId: c.id, employeeId: r.employeeId, userId: r.userId, title: c.title, body: c.message, category: c.notificationType, actionType: 'CAMPAIGN', actionId: c.id, imageUrl: c.imageUrl, actionUrl: c.actionUrl, deliveryStatus: 'PENDING' } });
  const registered = await prisma.fCMToken.findMany({ where: { userId: r.userId!, isActive: true }, select: { token: true } });
  const devices = await prisma.device.findMany({ where: { userId: r.userId! }, select: { fcmToken: true } });
  const tokens = [...new Set([...registered.map(t => t.token), ...devices.map(t => t.fcmToken)].filter((t): t is string => !!t?.trim()))];
  const states = (r.tokenStates || []) as unknown as TokenState[];
  // A persisted SENDING state means the outcome was lost: do not resend it.
  states.forEach(s => { if (s.state === 'SENDING') s.state = 'UNKNOWN'; });
  const targets = tokens.filter(t => !states.some(s => s.key === tokenKey(t) && s.state !== 'RETRY'));
  for (let i = 0; i < targets.length; i += 500) {
    const batch = targets.slice(i, i + 500);
    for (const t of batch) {
      const old = states.find(s => s.key === tokenKey(t));
      if (old) { old.state = 'SENDING'; old.attempts++; } else states.push({ key: tokenKey(t), state: 'SENDING', attempts: 1 });
    }
    await prisma.campaignRecipient.update({ where: { id: r.id }, data: { tokenStates: states as unknown as Prisma.InputJsonValue } });
    try {
      const result = await firebaseNotificationService.sendNotificationToTokens(batch, c.title, c.message, { id: String(notification.id), campaignId: c.id, category: c.notificationType, type: 'CAMPAIGN', actionUrl: c.actionUrl || '', click_action: 'FLUTTER_NOTIFICATION_CLICK', ...(c.actionUrl ? { web_url: c.actionUrl } : {}) }, { imageUrl: c.imageUrl || undefined });
      batch.forEach((t, index) => {
        const state = states.find(s => s.key === tokenKey(t))!;
        const response = result.responses[index];
        state.state = response?.success ? 'SENT' : response && ['messaging/server-unavailable', 'messaging/internal-error', 'messaging/quota-exceeded'].includes(response.error?.code || '') && state.attempts < 3 ? 'RETRY' : response ? 'FAILED' : 'UNKNOWN';
        if (response?.messageId) state.messageId = response.messageId;
      });
    } catch { batch.forEach(t => { states.find(s => s.key === tokenKey(t))!.state = 'UNKNOWN'; }); }
    await prisma.campaignRecipient.update({ where: { id: r.id }, data: { tokenStates: states as unknown as Prisma.InputJsonValue } });
  }
  // A retryable token removed from the active token set is a terminal failure.
  states.forEach(s => { if (s.state === 'RETRY' && !tokens.some(t => tokenKey(t) === s.key)) s.state = 'FAILED'; });
  const status = pushSummary(states);
  const failureReason = ['FAILED', 'PARTIAL', 'UNKNOWN'].includes(status) ? 'Push was rejected or its outcome is unverified; in-app history is available' : null;
  await prisma.$transaction([
    prisma.campaignRecipient.update({ where: { id: r.id }, data: { deliveryStatus: status, tokenStates: states as unknown as Prisma.InputJsonValue, failureReason } }),
    prisma.notification.update({ where: { id: notification.id }, data: { deliveryStatus: status, failureReason } }),
  ]);
}
export async function campaignSummary(id: string) {
  const groups = await prisma.campaignRecipient.groupBy({ by: ['deliveryStatus'], where: { campaignId: id }, _count: true });
  const states = Object.fromEntries(groups.map(g => [g.deliveryStatus, g._count]));
  const readCount = await prisma.notification.count({ where: { campaignId: id, isRead: true } });
  return { states, readCount, total: groups.reduce((n, g) => n + g._count, 0) };
}
