import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Client } from 'pg';
// Guard before importing the app DB module. Never use the configured production DB.
if (process.env.CAMPAIGN_TEST_DATABASE !== 'true' || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/campaign_test$/.test(process.env.DATABASE_URL || '')) throw new Error('Disposable test database required');
const { prisma } = require('../src/utils/db');
const { firebaseNotificationService } = require('../src/services/firebaseNotificationService');
const policy = require('../src/services/campaignPolicy');
const service = require('../src/services/campaignService');
const { runCampaignTick } = require('../src/services/campaignScheduler');
const router = require('../src/routes/campaignRoutes').default;
const mobile = require('../src/controllers/mobile/mobileNotificationController');
let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log(`PASS ${name}`); }
const response = () => ({ code: 200, body: undefined as any, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } });
async function api(method: string, path: string, actor: number, body: any = {}, params: any = {}, query: any = {}) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  assert(layer, `Route ${method} ${path} exists`);
  const res = response();
  await layer.route.stack.at(-1).handle({ user: { id: actor }, body, params, query }, res);
  return res;
}
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  await client.query(fs.readFileSync('prisma/migrations/0_init/migration.sql', 'utf8'));
  await client.query(`INSERT INTO "Notification" (title, body, "updatedAt") VALUES ('Preserved history','Legacy message',NOW())`);
  await client.query(`INSERT INTO "WorkMode" (id,name,"updatedAt") VALUES ('OFFICE','Office',NOW())`);
  await client.query(`INSERT INTO "Employee" ("employeeCode","firstName","lastName","updatedAt") VALUES ('LEGACY','Legacy','Employee',NOW())`);
  for (const migration of ['20261013120000_add_campaign_notification_management', '20261019120000_campaign_delivery_safety']) await client.query(fs.readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
  await test('migrations preserve existing history and employee data', async () => {
    assert.equal(await prisma.notification.count({ where: { title: 'Preserved history' } }), 1);
    assert.equal((await prisma.employee.findUnique({ where: { employeeCode: 'LEGACY' } })).dateOfBirth, null);
    const columns = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='Campaign'`);
    assert(columns.rows.some((r: any) => r.column_name === 'lockedAt'));
  });
  const admin = await prisma.user.create({ data: { role: 'ADMIN', password: 'test-only' } });
  const hr = await prisma.user.create({ data: { role: 'HR', password: 'test-only' } });
  const store1 = await prisma.store.create({ data: { name: 'Store 1' } });
  const store2 = await prisma.store.create({ data: { name: 'Store 2' } });
  const branch = await prisma.branch.create({ data: { name: 'Branch', latitude: 0, longitude: 0, radiusMeters: 50 } });
  const department = await prisma.department.create({ data: { name: 'Sales' } });
  const today = policy.localDate(new Date(), 'Asia/Kolkata');
  const makeEmployee = async (code: string, storeId: number, status = 'active', role = 'EMPLOYEE', userId?: number) => {
    const user = userId ? { id: userId } : await prisma.user.create({ data: { role, password: 'test-only' } });
    return prisma.employee.create({ data: { employeeCode: code, firstName: code, lastName: 'Test', storeId, branchId: storeId === store1.id ? branch.id : null, departmentId: department.id, userId: user.id, status, dateOfBirth: new Date(`1995-${today.slice(5)}T00:00:00Z`) } });
  };
  const e1 = await makeEmployee('ONE', store1.id);
  const e2 = await makeEmployee('TWO', store2.id);
  const e3 = await makeEmployee('THREE', store1.id);
  await makeEmployee('INACTIVE', store1.id, 'inactive');
  const hrEmployee = await makeEmployee('HR', store1.id, 'active', 'HR', hr.id);
  const audience = (extra: any = {}) => ({ storeIds: [], branchIds: [], employeeIds: [], departmentIds: [], roles: [], birthdayOnly: false, automaticBirthday: false, timezone: 'Asia/Kolkata', ...extra });
  const payload = (extra: any = {}) => ({ title: 'Greeting', message: 'Hello team', notificationType: 'FESTIVAL', audienceType: 'EMPLOYEES', audienceCriteria: audience({ employeeIds: [e1.id] }), ...extra });
  const resolved = async (mode: string, criteria: any, actor = admin.id) => (await service.resolveRecipients(actor, mode, audience(criteria))).map((e: any) => e.id).sort((a: number, b: number) => a - b);
  await test('all active employees, excluding inactive and unlinked legacy employee', async () => assert.deepEqual(await resolved('ALL_EMPLOYEES', {}), [e1.id, e2.id, e3.id, hrEmployee.id]));
  await test('one and multiple stores use actual store membership', async () => { assert.deepEqual(await resolved('STORES', { storeIds: [store1.id] }), [e1.id, e3.id, hrEmployee.id]); assert.equal((await resolved('STORES', { storeIds: [store1.id, store2.id] })).length, 4); });
  await test('one and multiple employees', async () => { assert.deepEqual(await resolved('EMPLOYEES', { employeeIds: [e1.id] }), [e1.id]); assert.deepEqual(await resolved('EMPLOYEES', { employeeIds: [e1.id, e2.id] }), [e1.id, e2.id]); });
  await test('branches, departments and roles', async () => { assert.equal((await resolved('BRANCHES', { branchIds: [branch.id] })).length, 3); assert.equal((await resolved('DEPARTMENTS', { departmentIds: [department.id] })).length, 4); assert.equal((await resolved('ROLES', { roles: ['EMPLOYEE'] })).length, 3); });
  await test('overlapping combined groups deduplicate recipients', async () => assert.deepEqual(await resolved('COMBINED', { storeIds: [store1.id], employeeIds: [e1.id] }), [e1.id, e3.id, hrEmployee.id]));
  await test('ordinary employees cannot manage campaigns', async () => { assert.equal((await api('post', '/', e1.userId, payload())).code, 403); });
  await test('HR cannot target all employees or another store or employee', async () => { await assert.rejects(() => resolved('ALL_EMPLOYEES', {}, hr.id)); await assert.rejects(() => resolved('STORES', { storeIds: [store2.id] }, hr.id)); await assert.rejects(() => resolved('EMPLOYEES', { employeeIds: [e2.id] }, hr.id)); assert.deepEqual(await resolved('EMPLOYEES', { employeeIds: [e1.id] }, hr.id), [e1.id]); });
  await test('invalid IDs, empty sets, category, URL and timezone rejected', async () => {
    assert.throws(() => policy.validateCampaign(payload({ audienceCriteria: audience({ employeeIds: ['1'] }) })));
    assert.throws(() => policy.validateCampaign(payload({ audienceCriteria: audience() })));
    assert.throws(() => policy.validateCampaign(payload({ imageUrl: 'javascript:alert(1)' })));
    assert.throws(() => policy.validateCampaign(payload({ notificationType: 'INVALID' })));
    assert.throws(() => policy.validateCampaign(payload({ audienceCriteria: audience({ timezone: 'INVALID', employeeIds: [e1.id] }) })));
    await assert.rejects(() => resolved('EMPLOYEES', { employeeIds: [999999] }));
    await assert.rejects(() => resolved('STORES', { storeIds: [999999] }));
  });
  await test('birthday date uses local today and exact month/day including leap day', () => { assert.equal(policy.localDate(new Date('2026-10-18T20:00:00Z'), 'Asia/Kolkata'), '2026-10-19'); assert(policy.birthdayMatches(new Date('2000-02-29T00:00:00Z'), '2028-02-29')); assert(!policy.birthdayMatches(new Date('2000-02-29T00:00:00Z'), '2027-02-28')); assert(!policy.birthdayMatches(null, today)); });
  let c: any;
  await test('festival draft without image persists and creation does not send', async () => { const r = await api('post', '/', admin.id, payload()); assert.equal(r.code, 201); c = r.body.data; assert.equal(c.imageUrl, null); assert.equal(c.status, 'DRAFT'); assert.equal(await prisma.notification.count({ where: { campaignId: c.id } }), 0); });
  await test('holiday campaign with image, future schedule, edit and cancellation', async () => {
    const input = payload({ notificationType: 'HOLIDAY', imageUrl: 'https://example.com/greeting.png', scheduledAt: new Date(Date.now() + 86400000).toISOString() });
    const r = await api('post', '/', admin.id, input); assert.equal(r.code, 201); assert.equal(r.body.data.status, 'SCHEDULED');
    const updated = await api('put', '/:id', admin.id, { ...input, title: 'Updated holiday' }, { id: r.body.data.id }); assert.equal(updated.code, 200);
    assert.equal((await api('post', '/:id/cancel', admin.id, {}, { id: r.body.data.id })).code, 200);
    assert.equal((await api('post', '/:id/send', admin.id, {}, { id: r.body.data.id })).code, 409);
  });
  await test('unknown IDs, ownership and pagination use safe HTTP errors', async () => { assert.equal((await api('get', '/:id', admin.id, {}, { id: 'missing' })).code, 404); assert.equal((await api('get', '/:id', hr.id, {}, { id: c.id })).code, 404); assert.equal((await api('get', '/', admin.id, {}, {}, { limit: 1000 })).code, 400); });
  let calls: string[][] = [];
  firebaseNotificationService.sendNotificationToTokens = async (tokens: string[]) => { calls.push(tokens); return { responses: tokens.map(t => t === 'retry-token' && calls.length === 1 ? { success: false, error: { code: 'messaging/server-unavailable' } } : { success: true, messageId: 'mock-accepted' }), successCount: 1, failureCount: 1 }; };
  await prisma.fCMToken.createMany({ data: ['accepted-token', 'retry-token'].map(token => ({ userId: e1.userId, token, platform: 'android' })) });
  await test('send returns queued and duplicate send requests are rejected', async () => { assert.equal((await api('post', '/:id/send', admin.id, {}, { id: c.id })).code, 202); assert.equal((await api('post', '/:id/send', admin.id, {}, { id: c.id })).code, 409); });
  await test('partial FCM failure retries only rejected token; history remains unique', async () => {
    await runCampaignTick(); assert.equal((await prisma.campaignRecipient.findFirst({ where: { campaignId: c.id } })).deliveryStatus, 'RETRY');
    await runCampaignTick(); assert.deepEqual(calls, [['accepted-token', 'retry-token'], ['retry-token']]); assert.equal(await prisma.notification.count({ where: { campaignId: c.id } }), 1); assert.equal((await prisma.campaign.findUnique({ where: { id: c.id } })).status, 'COMPLETED');
    await runCampaignTick(); assert.equal(calls.length, 2);
  });
  await test('read/unread APIs preserve ownership and campaign summary reflects state', async () => {
    const n = await prisma.notification.findFirst({ where: { campaignId: c.id } });
    let r = response(); await mobile.markNotificationAsRead({ user: { id: e1.userId }, params: { notificationId: String(n.id) } }, r); assert.equal(r.code, 200); assert.equal((await service.campaignSummary(c.id)).readCount, 1);
    r = response(); await mobile.markNotificationAsUnread({ user: { id: e2.userId }, params: { notificationId: String(n.id) } }, r); assert.equal(r.code, 404);
    r = response(); await mobile.markNotificationAsUnread({ user: { id: e1.userId }, params: { notificationId: String(n.id) } }, r); assert.equal(r.code, 200); assert.equal((await service.campaignSummary(c.id)).readCount, 0);
    r = response(); await mobile.fetchMyNotifications({ user: { id: e1.userId } }, r); assert.equal(r.body.data.notifications[0].campaignId, c.id);
  });
  await test('transport exception becomes UNKNOWN and is never retried', async () => {
    firebaseNotificationService.sendNotificationToTokens = async () => { throw new Error('mock timeout'); };
    const r = await api('post', '/', admin.id, payload()); await service.queueCampaign(r.body.data.id, admin.id); await runCampaignTick();
    const recipient = await prisma.campaignRecipient.findFirst({ where: { campaignId: r.body.data.id } }); assert.equal(recipient.deliveryStatus, 'UNKNOWN'); await runCampaignTick(); assert.equal((await prisma.campaign.findUnique({ where: { id: r.body.data.id } })).status, 'COMPLETED_WITH_ERRORS');
  });
  await test('automatic birthdays create only one local-date occurrence', async () => {
    const r = await api('post', '/', admin.id, payload({ notificationType: 'BIRTHDAY', audienceCriteria: audience({ employeeIds: [e2.id], birthdayOnly: true, automaticBirthday: true }) })); assert.equal(r.code, 201); assert.equal(r.body.data.status, 'AUTOMATIC');
    await runCampaignTick(); await runCampaignTick();
    const occurrences = await prisma.campaign.findMany({ where: { dedupeKey: `birthday:${r.body.data.id}:${today}` } }); assert.equal(occurrences.length, 1); assert.equal(await prisma.campaignRecipient.count({ where: { campaignId: occurrences[0].id } }), 1);
    assert.equal((await prisma.campaignRecipient.findFirst({ where: { campaignId: occurrences[0].id } })).deliveryStatus, 'IN_APP_ONLY');
  });
  await test('due scheduled campaigns resolve recipients and dispatch through the worker', async () => {
    const r = await api('post', '/', admin.id, payload({ scheduledAt: new Date(Date.now() + 86400000).toISOString(), audienceCriteria: audience({ employeeIds: [e2.id] }) }));
    await prisma.campaign.update({ where: { id: r.body.data.id }, data: { scheduledAt: new Date(Date.now() - 1000) } }); await runCampaignTick();
    assert.equal((await prisma.campaign.findUnique({ where: { id: r.body.data.id } })).status, 'COMPLETED');
  });
  await test('image upload rejects invalid bytes and accepts a validated PNG', async () => {
    process.env.PUBLIC_API_URL = 'https://example.com';
    assert.equal((await api('post', '/image', admin.id, { imageBase64: 'data:image/png;base64,aGVsbG8=' })).code, 400);
    const r = await api('post', '/image', admin.id, { imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=' }); assert.equal(r.code, 201); assert(r.body.data.imageUrl.startsWith('https://example.com/uploads/campaigns/'));
    fs.unlinkSync(`uploads/campaigns/${r.body.data.imageUrl.split('/').at(-1)}`);
  });
  await client.end();
  console.log(`${passed} integration tests passed; FCM was mocked and only a disposable local database was used.`);
}
main().then(async () => { await prisma.$disconnect(); process.exit(0); }).catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
