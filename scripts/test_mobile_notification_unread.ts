import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { prisma } from '../src/utils/db';
import notificationRoutes from '../src/routes/mobile/mobileNotificationRoutes';
import { signAccessToken } from '../src/utils/jwt';
import WebSocketService from '../src/services/websocketService';

async function main() {
  const host = new URL(process.env.DATABASE_URL!).hostname;
  assert(['localhost', '127.0.0.1', '[::1]'].includes(host), 'Run only against a local development/test database');
  const employees = await prisma.employee.findMany({
    where: { status: 'active', user: { isActive: true, role: 'EMPLOYEE' } },
    include: { user: true }, take: 2,
  });
  assert(employees.length === 2, 'Two active development employees are required');
  const [owner, other] = employees;
  const token = signAccessToken({ id: owner.userId, role: 'EMPLOYEE' });
  const otherToken = signAccessToken({ id: other.userId, role: 'EMPLOYEE' });
  const fixture = await prisma.notification.create({ data: {
    userId: owner.userId, employeeId: owner.id, title: 'Unread integration test',
    body: 'Temporary local test fixture', category: 'GENERAL', isRead: true, readAt: new Date(),
  } });
  const app = express();
  app.use(express.json());
  app.use('/api/mobile/notifications', notificationRoutes);
  app.use('/api/v1/mobile/notifications', notificationRoutes);
  const server = createServer(app);
  const sockets = new WebSocketService(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const put = (path: string, bearer?: string) => fetch(`${base}${path}`, {
    method: 'PUT', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });
  const path = `/api/mobile/notifications/${fixture.id}`;
  try {
    assert.equal((await put(`${path}/unread`)).status, 401);
    assert.equal((await put(`${path}/unread`, 'invalid')).status, 401);
    assert.equal((await put(`${path}/unread`, otherToken)).status, 404);
    let persisted = await prisma.notification.findUniqueOrThrow({ where: { id: fixture.id } });
    assert.equal(persisted.isRead, true);
    assert(persisted.readAt);
    for (const id of ['abc', '1abc', '0', '-1', '1.5', '2147483648']) {
      assert.equal((await put(`/api/mobile/notifications/${id}/unread`, token)).status, 400);
    }
    assert.equal((await put('/api/mobile/notifications/2147483647/unread', token)).status, 404);
    const response = await put(`${path}/unread`, token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, message: 'Notification marked as unread' });
    persisted = await prisma.notification.findUniqueOrThrow({ where: { id: fixture.id } });
    assert.equal(persisted.isRead, false);
    assert.equal(persisted.readAt, null);
    for (const key of ['userId', 'employeeId', 'title', 'body', 'category', 'actionId', 'actionType'] as const) {
      assert.equal(persisted[key], fixture[key]);
    }
    assert.equal((await put(`${path}/unread`, token)).status, 200); // idempotent
    assert.equal((await put(`${path}/read`, token)).status, 200);
    persisted = await prisma.notification.findUniqueOrThrow({ where: { id: fixture.id } });
    assert.equal(persisted.isRead, true);
    assert(persisted.readAt);
    assert.equal((await put(`/api/v1/mobile/notifications/${fixture.id}/unread`, token)).status, 200);
    const listing = await fetch(`${base}/api/mobile/notifications/${fixture.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await listing.json() as any;
    assert.equal(result.data.isRead, false);
    assert.equal(result.data.readAt, null);
    assert.equal(result.data.id, String(fixture.id));
    console.log('PASS: authenticated unread/read routes, both prefixes, validation, ownership, response contract and database persistence');

    // Exercise the actual Socket.IO engine and JWT middleware using the app's token format.
    const handshake = (authToken: string) => new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=websocket`);
      const timer = setTimeout(() => { socket.close(); reject(new Error('Socket handshake timed out')); }, 5000);
      socket.onmessage = event => {
        const message = String(event.data);
        if (message.startsWith('0')) socket.send(`40${JSON.stringify({ token: authToken })}`);
        if (message.startsWith('40') || message.startsWith('44')) {
          clearTimeout(timer); socket.close(); resolve(message);
        }
      };
      socket.onerror = () => { clearTimeout(timer); socket.close(); reject(new Error('Socket connection failed')); };
    });
    assert((await handshake(token)).startsWith('40'), 'Application-issued JWT must authenticate');
    assert((await handshake('invalid')).startsWith('44'), 'Invalid JWT must be rejected');
    assert((await handshake(signAccessToken({ id: 2147483647, role: 'EMPLOYEE' }))).startsWith('44'), 'Unknown account must be rejected');
    console.log('PASS: real WebSocket upgrade and Socket.IO authentication with application JWT, invalid JWT and unknown account');
  } finally {
    await prisma.notification.delete({ where: { id: fixture.id } });
    await new Promise<void>(resolve => (sockets as any).io.close(() => resolve()));
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
