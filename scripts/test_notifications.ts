import { prisma } from '../src/utils/db';
import { fetchAdminNotifications } from '../src/controllers/adminController';


async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING NOTIFICATION TESTS');
  console.log('====================================================\n');

  // Find or create an admin user for testing
  let adminUser = await prisma.user.findFirst({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] } },
    include: { employee: true }
  });

  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        email: 'test_admin_suite@example.com',
        password: 'hashed_password_123',
        role: 'ADMIN',
        isActive: true,
      },
      include: { employee: true }
    });
  }

  // Create mock res helper
  const createMockRes = () => {
    return {
      statusCode: 200,
      responseData: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.responseData = data;
        return this;
      }
    };
  };

  let passedTests = 0;
  let totalTests = 0;

  const assert = (condition: boolean, testName: string, details?: any) => {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`, details || '');
      throw new Error(`Test assertion failed: ${testName}`);
    }
  };

  // =========================================================================
  // SUITE 1: GET /api/admin/notifications?limit=1&status=unread
  // =========================================================================
  console.log('--- TEST SUITE 1: /api/admin/notifications ---');

  // Test 1.1: Empty notifications list handling
  {
    const req: any = {
      user: { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      query: { limit: '1', status: 'unread' }
    };
    const res = createMockRes();

    await fetchAdminNotifications(req, res as any);
    assert(res.statusCode === 200, 'Empty unread notifications returns 200');
    assert(res.responseData?.success === true, 'Response contains success: true');
    assert(Array.isArray(res.responseData?.notifications), 'notifications is an array');
    assert(typeof res.responseData?.total === 'number', 'total is a number');
    assert(typeof res.responseData?.unreadCount === 'number', 'unreadCount is a number');
    assert(res.responseData?.limit === 1, 'limit is respected as 1');
  }

  // Test 1.2: Invalid query parameters (defensive parsing)
  {
    const req: any = {
      user: { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      query: { limit: 'invalid_num', page: '-5', status: 'UNREAD', category: 'undefined' }
    };
    const res = createMockRes();

    await fetchAdminNotifications(req, res as any);
    assert(res.statusCode === 200, 'Invalid query parameters sanitized gracefully without 500 error');
    assert(res.responseData?.limit === 10, 'Fallback default limit applied (10)');
    assert(res.responseData?.page === 1, 'Fallback default page applied (1)');
  }

  // Test 1.3: String user ID in JWT payload resolution
  {
    const req: any = {
      user: { id: String(adminUser.id), email: adminUser.email, role: adminUser.role },
      query: { limit: '1', status: 'unread' }
    };
    const res = createMockRes();

    await fetchAdminNotifications(req, res as any);
    assert(res.statusCode === 200, 'String representation of numeric userId resolves cleanly');
  }

  // Test 1.4: Unauthorized request (missing user)
  {
    const req: any = {
      user: undefined,
      query: { limit: '1', status: 'unread' }
    };
    const res = createMockRes();

    await fetchAdminNotifications(req, res as any);
    assert(res.statusCode === 401, 'Missing user returns 401 Unauthorized (not 500)');
    assert(res.responseData?.success === false, 'Unauthorized response has success: false');
  }

  // Test 1.5: Notification creation, unread retrieval, and mapping
  let testNotif: any;
  {
    testNotif = await prisma.notification.create({
      data: {
        userId: adminUser.id,
        title: 'Suite Test Notification',
        body: 'Testing notification unread payload mapping',
        category: 'ANNOUNCEMENT',
        actionType: 'GENERAL',
        actionId: 'test-action-123',
        isRead: false,
      }
    });

    const req: any = {
      user: { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      query: { limit: '1', status: 'unread' }
    };
    const res = createMockRes();

    await fetchAdminNotifications(req, res as any);
    assert(res.statusCode === 200, 'Unread notification query returns 200');
    assert(res.responseData?.notifications.length === 1, 'Returned exactly 1 notification with limit=1');
    assert(res.responseData?.unreadCount >= 1, 'unreadCount reflects the unread record');
    const returned = res.responseData?.notifications[0];
    assert(returned.id === String(testNotif.id), 'Notification ID matches stringified ID');
    assert(returned.title === 'Suite Test Notification', 'Notification title matches');
    assert(returned.isRead === false, 'Notification isRead is false');
  }

  // Test 1.6: Status filter 'read' vs 'unread'
  {
    const reqRead: any = {
      user: { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      query: { status: 'read' }
    };
    const resRead = createMockRes();
    await fetchAdminNotifications(reqRead, resRead as any);
    const hasUnreadInReadList = resRead.responseData?.notifications.some((n: any) => n.id === String(testNotif.id));
    assert(!hasUnreadInReadList, 'Unread notification is excluded when status=read');
  }

  // Clean up test notification
  await prisma.notification.delete({ where: { id: testNotif.id } });

  console.log('\n====================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('====================================================\n');
}

runTests()
  .catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
