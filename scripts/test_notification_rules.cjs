// HTTP regression tests with real auth/role middleware and an isolated database double.
const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');
let rules = [], templates = [], failure = null, writes = 0, templateReads = 0;
const prisma = {
  user: { findUnique: async ({ where }) => ({ id: where.id, role: where.id === 2 ? 'EMPLOYEE' : 'ADMIN', isActive: true, employee: null }) },
  notificationRule: {
    findMany: async () => { if (failure) throw failure; return rules; },
    count: async () => { throw new Error('GET must not seed defaults'); },
    upsert: async ({ where, create, update }) => { writes++; let rule = rules.find(r => r.event === where.event); if (rule) Object.assign(rule, update); else { rule = { id: rules.length + 1, ...create }; rules.push(rule); } return rule; },
    update: async ({ where, data }) => { writes++; const rule = rules.find(r => r.id === where.id); if (!rule) throw new Error('Not found'); Object.assign(rule, data); return rule; },
  },
  notificationTemplate: { findMany: async () => { templateReads++; return templates; } },
  fCMToken: { findMany: async () => [] },
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (/\/utils\/db$/.test(request)) return { prisma };
  if (request === '../services/notificationRuleScheduler') return { executeRuleManually: async () => { throw new Error('Push delivery forbidden in tests'); } };
  return originalLoad.call(this, request, parent, isMain);
};
const express = require('express');
const router = require('../src/routes/notificationManagementRoutes').default;
const { signAccessToken } = require('../src/utils/jwt');
const app = express(); app.use(express.json()); app.use('/api/admin/notification-management', router);
let passed = 0;
async function main() {
  const server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.on('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}/api/admin/notification-management`;
  async function request(path, method = 'GET', body, role = 'ADMIN') {
    const headers = { 'Content-Type': 'application/json' };
    if (role) headers.Authorization = `Bearer ${signAccessToken({ id: role === 'EMPLOYEE' ? 2 : 1, role })}`;
    const response = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  async function test(name, fn) { await fn(); passed++; console.log('PASS', name); }
  try {
    await test('missing authentication is denied', async () => { assert.equal((await request('/rules', 'GET', null, null)).status, 401); });
    await test('ordinary employee is denied', async () => { assert.equal((await request('/rules', 'GET', null, 'EMPLOYEE')).status, 403); });
    await test('empty rules are returned without writes or template dependency', async () => { const r = await request('/rules'); assert.equal(r.status, 200); assert.deepEqual(r.body, []); assert.equal(writes, 0); assert.equal(templateReads, 0); });
    await test('create existing rule API remains compatible', async () => { const r = await request('/rules', 'POST', { event: 'test_event', category: 'GENERAL', recipients: ['EMPLOYEE'], inApp: true, push: false }); assert.equal(r.status, 201); assert.equal(r.body.event, 'TEST_EVENT'); });
    await test('existing rules retain joined template fields', async () => { templates = [{ id: 1, event: 'TEST_EVENT', title: 'Stored title', message: 'Stored message' }]; const r = await request('/rules'); assert.equal(r.status, 200); assert.equal(r.body[0].title, 'Stored title'); assert.equal(r.body[0].template.id, 1); });
    await test('rule without a template retains existing fallback format', async () => { templates = []; const r = await request('/rules'); assert.equal(r.body[0].template, null); assert.equal(r.body[0].message, ''); assert.equal(r.body[0].title, 'TEST_EVENT'); });
    await test('update existing rule API remains compatible', async () => { const r = await request('/rules/1', 'PUT', { status: 'INACTIVE' }); assert.equal(r.status, 200); assert.equal(r.body.status, 'INACTIVE'); });
    await test('database schema failure remains a logged HTTP 500', async () => {
      failure = Object.assign(new Error('private database error'), { code: 'P2022', meta: { modelName: 'NotificationRule', column: 'createdAt' } });
      const old = console.error; const logs = []; console.error = (...args) => logs.push(args);
      let r; try { r = await request('/rules'); } finally { console.error = old; failure = null; }
      assert.equal(r.status, 500); assert.equal(r.body.success, false); assert(r.body.message.includes('notification rules')); assert(!JSON.stringify(r.body).includes('private')); assert.equal(logs[0][1].code, 'P2022');
    });
    await test('templates and devices still return successful arrays without GET writes', async () => { assert.deepEqual((await request('/templates')).body, []); assert.deepEqual((await request('/devices')).body, []); assert.equal(writes, 2); });
    console.log(`${passed} HTTP tests passed. No real database, notifications or production credentials used.`);
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
