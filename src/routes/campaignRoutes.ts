import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { Prisma, Role } from '@prisma/client';
import { AuthenticatedRequest, authenticateToken, requireRole } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { actorScope, campaignAccess, campaignSummary, queueCampaign, resolveRecipients } from '../services/campaignService';
import { Audience, birthdayMatches, CampaignError, localDate, validateCampaign } from '../services/campaignPolicy';
const router = Router();
router.use(authenticateToken, requireRole(['SUPER_ADMIN', 'ADMIN', 'PLATFORM_ADMIN', 'HR']));
const handle = (fn: (req: AuthenticatedRequest, res: Response) => Promise<void>) => async (req: AuthenticatedRequest, res: Response) => {
  try { await actorScope(req.user!.id); await fn(req, res); }
  catch (e) { res.status(e instanceof CampaignError ? e.status : 500).json({ success: false, message: e instanceof CampaignError ? e.message : 'Notification campaign operation failed' }); }
};
const id = (req: AuthenticatedRequest) => String(req.params.id);
function page(req: AuthenticatedRequest) {
  const number = Number(req.query.page || 1), limit = Number(req.query.limit || 20);
  if (!Number.isInteger(number) || number < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new CampaignError(400, 'Invalid pagination');
  return { number, limit, skip: (number - 1) * limit };
}
async function timezone() {
  const settings = await prisma.systemSetting.findFirst();
  const company = settings?.company as Record<string, unknown> | null;
  return typeof company?.timezone === 'string' ? company.timezone : 'Asia/Kolkata';
}
router.get('/options', handle(async (req, res) => {
  const scope = await actorScope(req.user!.id);
  const owner = await prisma.employee.findUnique({ where: { userId: req.user!.id } });
  const restricted = Object.keys(scope).length > 0;
  const [stores, branches, departments] = await Promise.all([
    prisma.store.findMany({ where: { isActive: true, ...(restricted ? { id: owner?.storeId || -1 } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.branch.findMany({ where: restricted ? { id: owner?.branchId || -1 } : {}, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    restricted ? Promise.resolve([]) : prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  res.json({ success: true, data: { stores, branches, departments, roles: Object.values(Role), canTargetAll: !restricted, timezone: await timezone() } });
}));
router.get('/employees', handle(async (req, res) => {
  const { number, limit, skip } = page(req);
  const scope = await actorScope(req.user!.id);
  const q = String(req.query.q || '').slice(0, 200);
  const where: Prisma.EmployeeWhereInput = { AND: [scope, { status: { equals: 'active', mode: 'insensitive' }, user: { isActive: true }, OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { employeeCode: { contains: q, mode: 'insensitive' } }] }] };
  const [data, total] = await Promise.all([prisma.employee.findMany({ where, select: { id: true, firstName: true, lastName: true, employeeCode: true, storeId: true, branchId: true }, take: limit, skip, orderBy: { id: 'asc' } }), prisma.employee.count({ where })]);
  res.json({ success: true, data, total, page: number, limit });
}));
router.get('/birthdays/today', handle(async (req, res) => {
  const tz = await timezone();
  const date = localDate(new Date(), tz);
  const employees = await prisma.employee.findMany({ where: { AND: [await actorScope(req.user!.id), { status: { equals: 'active', mode: 'insensitive' }, user: { isActive: true }, dateOfBirth: { not: null } }] }, select: { id: true, firstName: true, lastName: true, dateOfBirth: true } });
  res.json({ success: true, date, timezone: tz, data: employees.filter(e => birthdayMatches(e.dateOfBirth, date)).map(({ dateOfBirth, ...e }) => e) });
}));
router.post('/image', handle(async (req, res) => {
  const input = req.body?.imageBase64;
  const match = typeof input === 'string' && input.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new CampaignError(400, 'Upload a PNG, JPEG or WebP image');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid || bytes.length > 2 * 1024 * 1024) throw new CampaignError(400, 'Valid image of at most 2 MB required');
  const base = process.env.PUBLIC_API_URL;
  if (!base || !base.startsWith('https://')) throw new CampaignError(503, 'Configure PUBLIC_API_URL for public notification images');
  const folder = path.join(process.cwd(), 'uploads', 'campaigns');
  await mkdir(folder, { recursive: true });
  const name = `${randomUUID()}.${match[1]}`;
  await writeFile(path.join(folder, name), bytes, { flag: 'wx' });
  res.status(201).json({ success: true, data: { imageUrl: `${base.replace(/\/$/, '')}/uploads/campaigns/${name}` } });
}));
router.get('/', handle(async (req, res) => {
  const { number, limit, skip } = page(req);
  const scope = await actorScope(req.user!.id);
  const where: Prisma.CampaignWhereInput = { companyId: null, ...(Object.keys(scope).length ? { createdById: req.user!.id } : {}), title: { contains: String(req.query.q || '').slice(0, 200), mode: 'insensitive' }, ...(req.query.status ? { status: String(req.query.status) } : {}) };
  const [data, total] = await Promise.all([prisma.campaign.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip, omit: { dedupeKey: true } }), prisma.campaign.count({ where })]);
  res.json({ success: true, data, total, page: number, limit });
}));
router.post('/', handle(async (req, res) => {
  const data = validateCampaign(req.body, await timezone());
  await resolveRecipients(req.user!.id, data.audienceType, data.audienceCriteria, data.scheduledAt ? localDate(data.scheduledAt, data.audienceCriteria.timezone) : undefined, data.audienceCriteria.automaticBirthday);
  const c = await prisma.campaign.create({ data: { ...data, audienceCriteria: data.audienceCriteria as unknown as Prisma.InputJsonValue, createdById: req.user!.id, status: data.audienceCriteria.automaticBirthday ? 'AUTOMATIC' : data.scheduledAt ? 'SCHEDULED' : 'DRAFT' } });
  res.status(201).json({ success: true, data: c });
}));
router.get('/:id', handle(async (req, res) => {
  const c = await campaignAccess(id(req), req.user!.id);
  res.json({ success: true, data: { ...c, summary: await campaignSummary(c.id) } });
}));
router.get('/:id/recipients', handle(async (req, res) => {
  await campaignAccess(id(req), req.user!.id);
  const { number, limit, skip } = page(req);
  const where = { campaignId: id(req), employee: await actorScope(req.user!.id) };
  const [rows, total] = await Promise.all([prisma.campaignRecipient.findMany({ where, take: limit, skip, orderBy: { id: 'asc' }, select: { id: true, employeeId: true, deliveryStatus: true, failureReason: true, employee: { select: { firstName: true, lastName: true } } } }), prisma.campaignRecipient.count({ where })]);
  const notifications = await prisma.notification.findMany({ where: { campaignId: id(req), employeeId: { in: rows.map(r => r.employeeId) } }, select: { employeeId: true, isRead: true, readAt: true } });
  res.json({ success: true, data: rows.map(r => ({ ...r, isRead: notifications.find(n => n.employeeId === r.employeeId)?.isRead || false, readAt: notifications.find(n => n.employeeId === r.employeeId)?.readAt || null })), total, page: number, limit });
}));
router.put('/:id', handle(async (req, res) => {
  const c = await campaignAccess(id(req), req.user!.id);
  const data = validateCampaign(req.body, await timezone());
  await resolveRecipients(req.user!.id, data.audienceType, data.audienceCriteria, data.scheduledAt ? localDate(data.scheduledAt, data.audienceCriteria.timezone) : undefined, data.audienceCriteria.automaticBirthday);
  const result = await prisma.campaign.updateMany({ where: { id: c.id, status: { in: ['DRAFT', 'SCHEDULED'] }, updatedAt: c.updatedAt }, data: { ...data, audienceCriteria: data.audienceCriteria as unknown as Prisma.InputJsonValue, status: data.audienceCriteria.automaticBirthday ? 'AUTOMATIC' : data.scheduledAt ? 'SCHEDULED' : 'DRAFT' } });
  if (!result.count) throw new CampaignError(409, 'Only unchanged draft or scheduled campaigns can be edited');
  res.json({ success: true, data: await prisma.campaign.findUnique({ where: { id: c.id } }) });
}));
router.patch('/:id', handle(async (req, res) => {
  const c = await campaignAccess(id(req), req.user!.id);
  const data = validateCampaign(req.body, await timezone());
  await resolveRecipients(req.user!.id, data.audienceType, data.audienceCriteria, data.scheduledAt ? localDate(data.scheduledAt, data.audienceCriteria.timezone) : undefined, data.audienceCriteria.automaticBirthday);
  const result = await prisma.campaign.updateMany({ where: { id: c.id, status: { in: ['DRAFT', 'SCHEDULED'] }, updatedAt: c.updatedAt }, data: { ...data, audienceCriteria: data.audienceCriteria as unknown as Prisma.InputJsonValue, status: data.audienceCriteria.automaticBirthday ? 'AUTOMATIC' : data.scheduledAt ? 'SCHEDULED' : 'DRAFT' } });
  if (!result.count) throw new CampaignError(409, 'Only unchanged draft or scheduled campaigns can be edited');
  res.json({ success: true, data: await prisma.campaign.findUnique({ where: { id: c.id } }) });
}));
router.post('/:id/send', handle(async (req, res) => {
  res.status(202).json({ success: true, message: 'Campaign queued; delivery has not completed', data: await queueCampaign(id(req), req.user!.id) });
}));
router.post('/:id/schedule', handle(async (req, res) => {
  const c = await campaignAccess(id(req), req.user!.id);
  const scheduledAt = new Date(req.body?.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date()) throw new CampaignError(400, 'Future scheduledAt required');
  const a = c.audienceCriteria as unknown as Audience;
  if (a.automaticBirthday) throw new CampaignError(400, 'Automatic birthdays use daily occurrences');
  await resolveRecipients(req.user!.id, c.audienceType, a, undefined, a.birthdayOnly);
  const updated = await prisma.campaign.updateMany({ where: { id: c.id, status: { in: ['DRAFT', 'SCHEDULED'] }, updatedAt: c.updatedAt }, data: { scheduledAt, status: 'SCHEDULED' } });
  if (!updated.count) throw new CampaignError(409, 'Campaign cannot be scheduled');
  res.json({ success: true });
}));
router.post('/:id/cancel', handle(async (req, res) => {
  const c = await campaignAccess(id(req), req.user!.id);
  const result = await prisma.campaign.updateMany({ where: { id: c.id, status: { in: ['DRAFT', 'SCHEDULED', 'AUTOMATIC', 'BLOCKED'] } }, data: { status: 'CANCELLED' } });
  if (!result.count) throw new CampaignError(409, 'Campaign already queued or completed');
  res.json({ success: true });
}));

// Compatibility endpoints for Admin Panel & mobile integrations
router.get('/target-options', handle(async (req, res) => {
  const scope = await actorScope(req.user!.id);
  const owner = await prisma.employee.findUnique({ where: { userId: req.user!.id } });
  const restricted = Object.keys(scope).length > 0;
  const [stores, branches, departments, designations, employees] = await Promise.all([
    prisma.store.findMany({ where: { isActive: true, ...(restricted ? { id: owner?.storeId || -1 } : {}) }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    prisma.branch.findMany({ where: restricted ? { id: owner?.branchId || -1 } : {}, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    restricted ? Promise.resolve([]) : prisma.department.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    prisma.designation.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.employee.findMany({
      where: { AND: [scope, { status: { equals: 'active', mode: 'insensitive' }, user: { isActive: true } }] },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, storeId: true, branchId: true, departmentId: true, designationId: true },
      orderBy: { firstName: 'asc' },
    }),
  ]);
  res.json({
    success: true,
    data: {
      stores,
      branches,
      departments,
      designations,
      roles: Object.values(Role),
      canTargetAll: !restricted,
      timezone: await timezone(),
      employees: employees.map(e => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        employeeCode: e.employeeCode,
        storeId: e.storeId,
        branchId: e.branchId,
        departmentId: e.departmentId,
        designationId: e.designationId,
      })),
    },
  });
}));

router.get('/recipients/preview', handle(async (req, res) => {
  const { audienceType = 'ALL_EMPLOYEES', storeId, storeIds, branchId, branchIds, departmentId, departmentIds, employeeIds, roles, birthdayOnly } = req.query;
  const toNums = (v: any) => v ? (Array.isArray(v) ? v : String(v).split(',')).map(x => parseInt(String(x), 10)).filter(Number.isFinite) : [];
  const parsedStoreIds = toNums(storeIds || storeId);
  const parsedBranchIds = toNums(branchIds || branchId);
  const parsedDepartmentIds = toNums(departmentIds || departmentId);
  const parsedEmployeeIds = toNums(employeeIds);
  const parsedRoles = roles ? (Array.isArray(roles) ? roles : String(roles).split(',')).map(r => String(r).trim()).filter(r => Object.values(Role).includes(r as any)) as Role[] : [];

  let effectiveMode = String(audienceType).toUpperCase();
  if (effectiveMode === 'SPECIFIC_STORE' || effectiveMode === 'MULTIPLE_STORES') effectiveMode = 'STORES';
  if (effectiveMode === 'SELECTED_EMPLOYEES') effectiveMode = 'EMPLOYEES';
  if (effectiveMode === 'DEPARTMENT') effectiveMode = 'DEPARTMENTS';
  if (effectiveMode === 'ROLE_DESIGNATION') effectiveMode = 'ROLES';

  const audienceCriteria: Audience = {
    storeIds: parsedStoreIds,
    branchIds: parsedBranchIds,
    departmentIds: parsedDepartmentIds,
    employeeIds: parsedEmployeeIds,
    roles: parsedRoles,
    birthdayOnly: String(birthdayOnly) === 'true',
    automaticBirthday: false,
    timezone: await timezone(),
  };

  const recipients = await resolveRecipients(req.user!.id, effectiveMode, audienceCriteria, undefined, true);
  const details = await prisma.employee.findMany({
    where: { id: { in: recipients.map(r => r.id) } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      store: { select: { name: true } },
      branch: { select: { name: true } },
      department: { select: { name: true } },
      user: { select: { fcmTokens: { where: { isActive: true }, select: { token: true } } } },
    },
    take: 50,
  });

  const formatted = details.map(d => ({
    id: d.id,
    name: `${d.firstName} ${d.lastName}`.trim(),
    employeeCode: d.employeeCode,
    store: d.store?.name || d.branch?.name || 'Headquarters',
    department: d.department?.name || 'General',
    hasPushToken: (d.user?.fcmTokens?.length || 0) > 0,
  }));

  res.json({
    success: true,
    data: {
      totalCount: recipients.length,
      reachableByPush: formatted.filter(e => e.hasPushToken).length,
      preview: formatted,
    },
  });
}));

router.post('/upload-image', handle(async (req, res) => {
  const input = req.body?.imageBase64;
  const match = typeof input === 'string' && input.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new CampaignError(400, 'Upload a PNG, JPEG or WebP image');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid || bytes.length > 2 * 1024 * 1024) throw new CampaignError(400, 'Valid image of at most 2 MB required');
  const base = process.env.PUBLIC_API_URL || '';
  const folder = path.join(process.cwd(), 'uploads', 'campaigns');
  await mkdir(folder, { recursive: true });
  const name = `${randomUUID()}.${match[1]}`;
  await writeFile(path.join(folder, name), bytes, { flag: 'wx' });
  const finalUrl = base.startsWith('https://') ? `${base.replace(/\/$/, '')}/uploads/campaigns/${name}` : `/uploads/campaigns/${name}`;
  res.status(201).json({ success: true, data: { imageUrl: finalUrl } });
}));

router.get('/:id/analytics', handle(async (req, res) => {
  const c = await campaignAccess(id(req), req.user!.id);
  const summary = await campaignSummary(c.id);
  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: c.id, employee: await actorScope(req.user!.id) },
    take: 100,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      employeeId: true,
      deliveryStatus: true,
      isRead: true,
      readAt: true,
      failureReason: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          store: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
  });

  const total = c.totalRecipients || summary.total;
  const sent = c.sentCount || (summary.states.SENT || 0);
  const failed = c.failedCount || (summary.states.FAILED || 0);
  const read = summary.readCount;

  res.json({
    success: true,
    data: {
      campaignId: c.id,
      title: c.title,
      status: c.status,
      notificationType: c.notificationType,
      sentAt: c.sentAt,
      scheduledAt: c.scheduledAt,
      totalRecipients: total,
      sentCount: sent,
      failedCount: failed,
      readCount: read,
      deliveryRate: total > 0 ? Math.round((sent / total) * 100) : 0,
      readRate: sent > 0 ? Math.round((read / sent) * 100) : 0,
      recipients,
    },
  });
}));

router.post('/birthdays/send-wishes', handle(async (req, res) => {
  const { employeeIds, customTitle, customMessage, imageUrl, broadcastToAll } = req.body;
  const tz = await timezone();
  const date = localDate(new Date(), tz);
  const scope = await actorScope(req.user!.id);

  const celebrating = await prisma.employee.findMany({
    where: {
      AND: [
        scope,
        { status: { equals: 'active', mode: 'insensitive' }, user: { isActive: true }, dateOfBirth: { not: null } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, dateOfBirth: true, userId: true },
  });

  const matchingToday = celebrating.filter(e => birthdayMatches(e.dateOfBirth, date));
  const targetEmployees = employeeIds && Array.isArray(employeeIds) && employeeIds.length > 0
    ? matchingToday.filter(e => employeeIds.includes(e.id))
    : matchingToday;

  if (targetEmployees.length === 0) {
    res.json({ success: true, message: 'No eligible birthday employees found for today', count: 0 });
    return;
  }

  const results = [];
  for (const emp of targetEmployees) {
    const key = `birthday-wish:${emp.id}:${date}`;
    const already = await prisma.campaign.findFirst({ where: { dedupeKey: key } });
    if (already) {
      results.push({ employeeId: emp.id, status: 'SKIPPED_ALREADY_SENT' });
      continue;
    }

    const title = customTitle || `🎂 Happy Birthday, ${emp.firstName}!`;
    const message = customMessage || `Warmest birthday wishes to ${emp.firstName} ${emp.lastName}! May your special day bring you immense joy and success! 🎉`;

    const c = await prisma.campaign.create({
      data: {
        title,
        message,
        notificationType: 'BIRTHDAY',
        imageUrl: imageUrl || null,
        audienceType: broadcastToAll ? 'ALL_EMPLOYEES' : 'EMPLOYEES',
        audienceCriteria: broadcastToAll
          ? { storeIds: [], branchIds: [], employeeIds: [], departmentIds: [], roles: [], birthdayOnly: false, automaticBirthday: false, timezone: tz }
          : { storeIds: [], branchIds: [], employeeIds: [emp.id], departmentIds: [], roles: [], birthdayOnly: false, automaticBirthday: false, timezone: tz },
        createdById: req.user!.id,
        status: 'DRAFT',
        dedupeKey: key,
      },
    });

    await queueCampaign(c.id, req.user!.id);
    results.push({ employeeId: emp.id, campaignId: c.id, status: 'QUEUED' });
  }

  res.json({ success: true, message: `Dispatched birthday wishes for ${results.length} employee(s)`, count: results.length, details: results });
}));
export default router;
