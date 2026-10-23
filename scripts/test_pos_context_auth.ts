/** Real HTTP context regression; fixtures are restricted to the isolated local POS database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from '../src/utils/db';
import { signAccessToken } from '../src/utils/jwt';
import routes from '../src/pos/routes';

async function run() {
  const url = new URL(process.env.POS_TEST_DATABASE_URL ?? '');
  assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55439' && url.pathname.includes('pos_test') && process.env.DATABASE_URL === process.env.POS_TEST_DATABASE_URL, 'An isolated local POS test database is required');
  const suffix = randomUUID();
  const store = await prisma.store.create({ data: { name: `Context ${suffix}` } });
  const other = await prisma.store.create({ data: { name: `Other ${suffix}` } });
  const inactive = await prisma.store.create({ data: { name: `Inactive ${suffix}`, isActive: false } });
  await prisma.workMode.upsert({where:{id:'OFFICE'},create:{id:'OFFICE',name:'Office'},update:{}});
  const account = async (role: 'ADMIN' | 'SALESMAN', storeId?: number | null, employee = true) => prisma.user.create({ data: {
    email: `${randomUUID()}@context.test.invalid`, password: 'unused-test-hash', role,
    ...(employee ? { employee: { create: { employeeCode: randomUUID(), firstName: 'Context', lastName: 'Cashier', status: 'active', storeId } } } : {}),
  }});
  const admin = await account('ADMIN', undefined, false);
  const cashier = await account('SALESMAN', store.id);
  const unassigned = await account('SALESMAN', null);
  const missingEmployee = await account('SALESMAN', undefined, false);
  const disabledStore = await account('SALESMAN', inactive.id);
  const app = express(); app.use('/api/v1/pos', routes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as {port:number}).port}/api/v1/pos/context`;
  let count = 0;
  async function check(user: typeof admin | null, query: string, status: number, message?: RegExp) {
    const response = await fetch(endpoint + query, { headers: user ? { Authorization: `Bearer ${signAccessToken({id:user.id,role:user.role})}` } : {} });
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    if (message) assert.match(body.message, message);
    console.log(`HTTP ${response.status} ${query || '(no query)'} ${status === 200 ? 'context loaded' : JSON.stringify(body)}`);
    count++; return body;
  }
  try {
    await check(null, '', 401, /Sign in required/);
    await check(admin, '', 200);
    const body = await check(cashier, '', 200);
    assert.equal(body.data.actor.employeeId != null, true);
    assert.equal(body.data.actor.storeId, store.id);
    assert.deepEqual(body.data.stores.map((s:{id:number}) => s.id), [store.id]);
    assert.equal(body.data.activeStore.id, store.id);
    assert.equal(body.data.salesperson.name, 'Context Cashier');
    assert(Array.isArray(body.data.paymentMethods));
    await check(unassigned, '', 422, /No store location is assigned/);
    await check(missingEmployee, '', 422, /employee/i);
    await check(disabledStore, '', 422, /inactive or does not exist/);
    await check(cashier, `?storeId=${other.id}`, 403, /Store access denied/);
    await check(cashier, '?storeId=undefined', 400, /Invalid storeId/);
    await check(cashier, '?storeId=0', 400, /Invalid storeId/);
    await check(cashier, `?storeId=${store.id}&storeId=${store.id}`, 400, /Invalid storeId/);
    await check(admin, `?storeId=${other.id}`, 200);
    await check(cashier, `?storeId=${store.id}`, 200);
    console.log(`PASS ${count} real HTTP POS context checks`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}
run().then(() => process.exit(0)).catch(error => {console.error(error); process.exit(1);});
