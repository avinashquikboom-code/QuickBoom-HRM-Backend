import { server, app } from '../src/index';
import { prisma } from '../src/utils/db';
import { signAccessToken } from '../src/utils/jwt';
import assert from 'node:assert/strict';

async function verifyAll() {
  console.log('=== VERIFYING ADMIN ENDPOINTS AND 502 FIXES ===');

  // Find or use admin user
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
  });
  assert(admin, 'Active ADMIN user must exist in database');
  const token = signAccessToken({
    id: admin.id,
    email: admin.email,
    role: admin.role,
  });

  const baseUrl = 'http://127.0.0.1:5004';

  console.log(`Using Admin User: id=${admin.id}, email=${admin.email}`);

  // 1. Health check
  console.log('\n--- 1. Testing /api/health ---');
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200, `Health check returned ${healthRes.status}`);
  const healthJson: any = await healthRes.json();
  console.log('Health Status:', healthJson.status, 'Message:', healthJson.message);
  assert.equal(healthJson.status, 'healthy');

  // 2. Health ready probe
  console.log('\n--- 2. Testing /api/health/ready ---');
  const readyRes = await fetch(`${baseUrl}/api/health/ready`);
  assert.equal(readyRes.status, 200, `Readiness check returned ${readyRes.status}`);
  const readyJson: any = await readyRes.json();
  console.log('Readiness Status:', readyJson.status);
  assert.equal(readyJson.status, 'ready');

  // 3. GET /api/v1/admin/campaigns?page=1&limit=15
  console.log('\n--- 3. Testing GET /api/v1/admin/campaigns?page=1&limit=15 ---');
  const campaignsRes = await fetch(`${baseUrl}/api/v1/admin/campaigns?page=1&limit=15`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(campaignsRes.status, 200, `Campaigns returned ${campaignsRes.status}`);
  const campaignsJson: any = await campaignsRes.json();
  console.log('Campaigns Success:', campaignsJson.success);
  console.log('Campaigns count:', campaignsJson.data?.campaigns?.length, 'total:', campaignsJson.data?.total, 'page:', campaignsJson.data?.page);
  assert.equal(campaignsJson.success, true);
  assert(Array.isArray(campaignsJson.data?.campaigns), 'campaigns must be an array');
  assert(typeof campaignsJson.data?.total === 'number', 'total must be a number');
  assert(typeof campaignsJson.data?.totalPages === 'number', 'totalPages must be a number');

  // 4. GET /api/v1/admin/campaigns/birthdays/today
  console.log('\n--- 4. Testing GET /api/v1/admin/campaigns/birthdays/today ---');
  const bdaysRes = await fetch(`${baseUrl}/api/v1/admin/campaigns/birthdays/today`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(bdaysRes.status, 200, `Birthdays returned ${bdaysRes.status}`);
  const bdaysJson: any = await bdaysRes.json();
  console.log('Birthdays Success:', bdaysJson.success, 'Count:', bdaysJson.data?.count, 'Items:', bdaysJson.data?.birthdays?.length);
  assert.equal(bdaysJson.success, true);
  assert(typeof bdaysJson.data?.count === 'number', 'count must be a number');
  assert(Array.isArray(bdaysJson.data?.birthdays), 'birthdays must be an array');

  // 5. GET /api/v1/admin/campaigns/target-options
  console.log('\n--- 5. Testing GET /api/v1/admin/campaigns/target-options ---');
  const targetsRes = await fetch(`${baseUrl}/api/v1/admin/campaigns/target-options`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(targetsRes.status, 200, `Target options returned ${targetsRes.status}`);
  const targetsJson: any = await targetsRes.json();
  console.log('Target Options Success:', targetsJson.success);
  console.log('Stores count:', targetsJson.data?.stores?.length);
  console.log('Departments count:', targetsJson.data?.departments?.length);
  console.log('Designations count:', targetsJson.data?.designations?.length);
  console.log('Employees count:', targetsJson.data?.employees?.length);
  assert.equal(targetsJson.success, true);
  assert(Array.isArray(targetsJson.data?.stores), 'stores must be an array');
  assert(Array.isArray(targetsJson.data?.departments), 'departments must be an array');
  assert(Array.isArray(targetsJson.data?.designations), 'designations must be an array');
  assert(Array.isArray(targetsJson.data?.employees), 'employees must be an array');

  // 6. GET /api/admin/notifications
  console.log('\n--- 6. Testing GET /api/admin/notifications ---');
  const notifsRes = await fetch(`${baseUrl}/api/admin/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(notifsRes.status, 200, `Notifications returned ${notifsRes.status}`);
  const notifsJson: any = await notifsRes.json();
  console.log('Notifications Success:', notifsJson.success);
  console.log('Notifications count:', notifsJson.notifications?.length, 'total:', notifsJson.total, 'unread:', notifsJson.unreadCount);
  assert.equal(notifsJson.success, true);
  assert(Array.isArray(notifsJson.notifications), 'notifications must be an array');
  assert(typeof notifsJson.unreadCount === 'number', 'unreadCount must be a number');

  // 7. GET /api/permissions/me
  console.log('\n--- 7. Testing GET /api/permissions/me ---');
  const permsRes = await fetch(`${baseUrl}/api/permissions/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(permsRes.status, 200, `Permissions returned ${permsRes.status}`);
  const permsJson: any = await permsRes.json();
  console.log('Permissions Success:', permsJson.success);
  console.log('Has permissions object:', Boolean(permsJson.permissions));
  console.log('Sample permissions keys:', Object.keys(permsJson.permissions || {}).slice(0, 5));
  assert.equal(permsJson.success, true);
  assert(typeof permsJson.permissions === 'object', 'permissions must be an object');

  console.log('\n🎉 ALL 5 ENDPOINTS + HEALTH CHECKS VERIFIED SUCCESSFULLY WITH HTTP 200 OK!');
}

verifyAll()
  .catch((err) => {
    console.error('❌ Verification failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    server.close();
    process.exit(process.exitCode || 0);
  });
