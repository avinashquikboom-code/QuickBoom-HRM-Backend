// Read-only verification against the configured database; never print records or tokens.
process.env.NODE_ENV = 'production';
require('ts-node/register/transpile-only');
const express = require('express');
const assert = require('node:assert/strict');
const { prisma } = require('../src/utils/db');
const { signAccessToken } = require('../src/utils/jwt');
const router = require('../src/routes/notificationManagementRoutes').default;
(async () => {
  let server;
  try {
    const admin = await prisma.user.findFirst({ where: { isActive: true, role: { in: ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN'] } }, select: { id: true, role: true } });
    if (!admin) throw new Error('No active administrator available for read-only verification');
    const before = await prisma.notificationRule.count();
    const app = express(); app.use('/api/admin/notification-management', router);
    server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.on('error', reject); });
    const base = `http://127.0.0.1:${server.address().port}/api/admin/notification-management`;
    const auth = { Authorization: `Bearer ${signAccessToken(admin)}` };
    for (const path of ['/rules', '/templates', '/devices']) {
      const response = await fetch(base + path, { headers: auth }); const body = await response.json();
      assert.equal(response.status, 200); assert(Array.isArray(body));
      if (path === '/rules') { assert.equal(body.length, before); for (const rule of body) assert(Array.isArray(rule.recipients) && typeof rule.title === 'string' && typeof rule.message === 'string'); }
      console.log(`PASS authenticated local GET ${path}: HTTP ${response.status}, array length ${body.length}`);
    }
    assert.equal(await prisma.notificationRule.count(), before);
    console.log('PASS rule count unchanged. No seeding, database repair or push delivery performed.');
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
})().then(() => process.exit(0)).catch(error => { console.error('Verification failed:', error.code || error.name); process.exit(1); });
