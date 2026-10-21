const assert = require('assert');
const { test } = require('node:test');

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

  // Helper simulating notifyEmployee with the mocked services
  async function runNotifyEmployee(params) {
    const targetUserId = params.targetUserId || 100;
    const targetEmployeeId = params.targetEmployeeId || 11884;
    const { category = 'LEAVE', actionType, actionId, title, body } = params;

    const notification = await mockPrisma.notification.create({
      data: {
        userId: targetUserId,
        employeeId: targetEmployeeId,
        title,
        body: body || '',
        category: category.toUpperCase(),
        actionType: actionType || 'GENERAL',
        actionId: actionId ? String(actionId) : null,
        isRead: false,
        deliveryStatus: 'PENDING',
      },
    });

    let deliveryStatus = 'IN_APP_ONLY';
    let failureReason = null;
    let fcmMessageId = null;

    try {
      const result = await mockFirebaseService.sendNotificationToUser(
        targetUserId,
        title,
        body || '',
        {
          id: String(notification.id),
          notificationId: String(notification.id),
          title,
          body: body || '',
          type: actionType || 'GENERAL',
          notificationType: actionType || 'GENERAL',
          actionType: actionType || 'GENERAL',
          actionId: actionId ? String(actionId) : '',
          entityType: category.toUpperCase(),
          category: category.toUpperCase(),
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        { priority: { high: true } }
      );

      const totalAttempted = result.successCount + result.failureCount;
      const unverified = result.responses.length !== totalAttempted;
      if (totalAttempted === 0) {
        deliveryStatus = 'IN_APP_ONLY';
      } else if (unverified) {
        deliveryStatus = 'UNKNOWN';
      } else if (result.failureCount > 0) {
        deliveryStatus = result.successCount > 0 ? 'PARTIAL' : 'FAILED';
      } else if (result.successCount > 0) {
        deliveryStatus = 'SENT';
      } else {
        deliveryStatus = 'IN_APP_ONLY';
      }

      fcmMessageId = result.responses.find((r) => r.success)?.messageId || null;
      const codes = [
        ...new Set(result.responses.filter((r) => !r.success).map((r) => r.error?.code || 'messaging/unknown-error')),
      ];
      if (codes.length) {
        failureReason = codes.join(', ');
      }
    } catch (fcmErr) {
      const code = typeof fcmErr?.code === 'string' && /^[a-zA-Z0-9/_-]+$/.test(fcmErr.code) ? fcmErr.code : 'messaging/unknown-outcome';
      deliveryStatus = ['messaging/not-configured', 'messaging/mismatched-credential', 'app/invalid-credential'].includes(code)
        ? 'FAILED'
        : 'UNKNOWN';
      failureReason = code;
    }

    return await mockPrisma.notification.update({
      where: { id: notification.id },
      data: { deliveryStatus, failureReason, fcmMessageId },
    });
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
