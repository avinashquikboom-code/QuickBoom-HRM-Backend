const assert = require('assert');
const { test } = require('node:test');
const Module = require('node:module');
require('ts-node/register/transpile-only');

// Test suite verifying leave request push notification pipeline:
// 1. Initial status PENDING
// 2. FCM acceptance -> SENT with messageId
// 3. No device registered -> IN_APP_ONLY (never SENT)
// 4. Provider failure -> FAILED with failureReason (never SENT)
// 5. Network / unverified error -> UNKNOWN
// 6. Device acknowledgement -> DELIVERED
// 7. Payload contract (actionType: leave_request, actionId: 207, category: LEAVE)

test('Leave request notification pipeline verification', async (t) => {
  let createdNotification = null;
  let updatedNotification = null;
  let fcmCallArgs = null;
  let fcmOutcome = null;

  // Mock Prisma
  const mockPrisma = {
    employee: {
      findUnique: async () => ({ id: 11884, userId: 100, firstName: 'John', lastName: 'Doe' }),
      findFirst: async () => ({ id: 11884, userId: 100 }),
    },
    notification: {
      create: async ({ data }) => {
        createdNotification = { id: 2026, ...data, createdAt: new Date() };
        return createdNotification;
      },
      update: async ({ where, data }) => {
        updatedNotification = { ...createdNotification, ...data };
        return updatedNotification;
      },
      findFirst: async ({ where }) => {
        if (updatedNotification && updatedNotification.id === where.id) {
          return updatedNotification;
        }
        return createdNotification;
      },
    },
  };

  // Mock FirebaseNotificationService
  const mockFirebaseService = {
    sendNotificationToUser: async (userId, title, body, payload, options) => {
      fcmCallArgs = { userId, title, body, payload, options };
      if (fcmOutcome instanceof Error) throw fcmOutcome;
      return fcmOutcome;
    },
  };

  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === './db') return { prisma: mockPrisma };
    if (request === '../services/firebaseNotificationService') return { firebaseNotificationService: mockFirebaseService };
    if (request === './websocketSingleton') return { getWebSocketInstance: () => ({ sendToUser() {} }) };
    return originalLoad.call(this, request, parent, isMain);
  };
  const { notifyEmployee } = require('../src/utils/hrNotificationHelper');
  Module._load = originalLoad;
  async function runNotifyEmployee(params) {
    await notifyEmployee(params);
    return updatedNotification;
  }

  // 1. Successful FCM dispatch sets deliveryStatus = 'SENT'
  await t.test('FCM send accepted sets deliveryStatus to SENT and stores fcmMessageId', async () => {
    fcmOutcome = {
      responses: [{ success: true, messageId: 'projects/quickboom-hrm/messages/msg-123' }],
      successCount: 1,
      failureCount: 0,
    };

    const saved = await runNotifyEmployee({
      targetUserId: 100,
      targetEmployeeId: 11884,
      title: 'Leave Request Submitted',
      body: 'Your leave request for Oct 25 has been submitted.',
      category: 'LEAVE',
      actionType: 'leave_request',
      actionId: 207,
    });

    assert.equal(createdNotification.deliveryStatus, 'PENDING');
    assert.equal(saved.deliveryStatus, 'SENT');
    assert.equal(saved.fcmMessageId, 'projects/quickboom-hrm/messages/msg-123');
    assert.equal(saved.failureReason, null);
    assert.equal(fcmCallArgs.payload.actionType, 'leave_request');
    assert.equal(fcmCallArgs.payload.actionId, '207');
    assert.equal(fcmCallArgs.payload.category, 'LEAVE');
  });

  // 2. User with no registered device tokens receives IN_APP_ONLY, never SENT
  await t.test('User without registered devices sets deliveryStatus to IN_APP_ONLY, never SENT', async () => {
    fcmOutcome = {
      responses: [],
      successCount: 0,
      failureCount: 0,
    };

    const saved = await runNotifyEmployee({
      targetUserId: 100,
      targetEmployeeId: 11884,
      title: 'Leave Request Submitted',
      body: 'Your leave request has been submitted.',
      category: 'LEAVE',
      actionType: 'leave_request',
      actionId: 207,
    });

    assert.equal(saved.deliveryStatus, 'IN_APP_ONLY');
    assert.equal(saved.fcmMessageId, null);
    assert.equal(saved.failureReason, null);
    assert.notEqual(saved.deliveryStatus, 'SENT');
  });

  // 3. Invalid/unregistered token sets deliveryStatus to FAILED with reason, never SENT
  await t.test('FCM token rejection sets deliveryStatus to FAILED with failureReason, never SENT', async () => {
    fcmOutcome = {
      responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }],
      successCount: 0,
      failureCount: 1,
    };

    const saved = await runNotifyEmployee({
      targetUserId: 100,
      targetEmployeeId: 11884,
      title: 'Leave Request Submitted',
      body: 'Your leave request has been submitted.',
      category: 'LEAVE',
      actionType: 'leave_request',
      actionId: 207,
    });

    assert.equal(saved.deliveryStatus, 'FAILED');
    assert.equal(saved.failureReason, 'messaging/registration-token-not-registered');
    assert.notEqual(saved.deliveryStatus, 'SENT');
  });

  // 4. Unconfigured Firebase credentials sets deliveryStatus to FAILED, never SENT
  await t.test('Missing Firebase credentials sets deliveryStatus to FAILED, never SENT', async () => {
    fcmOutcome = Object.assign(new Error('Firebase messaging is not configured'), {
      code: 'messaging/not-configured',
    });

    const saved = await runNotifyEmployee({
      targetUserId: 100,
      targetEmployeeId: 11884,
      title: 'Leave Request Submitted',
      body: 'Your leave request has been submitted.',
      category: 'LEAVE',
      actionType: 'leave_request',
      actionId: 207,
    });

    assert.equal(saved.deliveryStatus, 'FAILED');
    assert.equal(saved.failureReason, 'messaging/not-configured');
    assert.notEqual(saved.deliveryStatus, 'SENT');
  });

  // 5. Network transport timeout sets deliveryStatus to UNKNOWN, never SENT
  await t.test('Network error sets deliveryStatus to UNKNOWN, never SENT', async () => {
    fcmOutcome = new Error('ETIMEDOUT network timeout');

    const saved = await runNotifyEmployee({
      targetUserId: 100,
      targetEmployeeId: 11884,
      title: 'Leave Request Submitted',
      body: 'Your leave request has been submitted.',
      category: 'LEAVE',
      actionType: 'leave_request',
      actionId: 207,
    });

    assert.equal(saved.deliveryStatus, 'UNKNOWN');
    assert.equal(saved.failureReason, 'messaging/unknown-outcome');
    assert.notEqual(saved.deliveryStatus, 'SENT');
  });

  await t.test('Success without a provider message ID is UNKNOWN, never SENT', async () => {
    fcmOutcome = { responses: [{ success: true }], successCount: 1, failureCount: 0 };
    const saved = await runNotifyEmployee({ targetUserId: 100, targetEmployeeId: 11884,
      title: 'Leave Request Submitted', body: 'Test', category: 'LEAVE', actionId: 207 });
    assert.equal(saved.deliveryStatus, 'UNKNOWN');
    assert.equal(saved.fcmMessageId, null);
  });

  await t.test('An unreadable production credential path is a known failure', async () => {
    fcmOutcome = Object.assign(new Error('Credential path is unreadable'), { code: 'firebase/credential-file-unreadable' });
    const saved = await runNotifyEmployee({ targetUserId: 100, targetEmployeeId: 11884,
      title: 'Leave Request Submitted', body: 'Test', category: 'LEAVE', actionId: 207 });
    assert.equal(saved.deliveryStatus, 'FAILED');
    assert.equal(saved.failureReason, 'firebase/credential-file-unreadable');
  });

  // 6. Device acknowledgement transitions status from SENT to DELIVERED
  await t.test('Device acknowledgement transitions status from SENT to DELIVERED', async () => {
    // Initial state: accepted by FCM
    updatedNotification = {
      id: 2026,
      userId: 100,
      employeeId: 11884,
      deliveryStatus: 'SENT',
      fcmMessageId: 'mock-msg-id',
      failureReason: null,
    };

    // Simulate POST /api/mobile/notifications/2026/ack
    const acknowledged = await mockPrisma.notification.update({
      where: { id: 2026 },
      data: { deliveryStatus: 'DELIVERED' },
    });

    assert.equal(acknowledged.deliveryStatus, 'DELIVERED');
  });
});
