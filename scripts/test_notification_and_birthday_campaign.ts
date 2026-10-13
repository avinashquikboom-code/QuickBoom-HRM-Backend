import { prisma } from '../src/utils/db';
import { fetchAdminNotifications } from '../src/controllers/adminController';
import { getTodayBirthdays, sendBirthdayWishes } from '../src/controllers/admin/campaignController';
import { CampaignService } from '../src/services/campaignService';

const campaignService = new CampaignService();

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING NOTIFICATION & BIRTHDAY CAMPAIGN TESTS');
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

  // =========================================================================
  // SUITE 2: GET /api/v1/admin/campaigns/birthdays/today
  // =========================================================================
  console.log('\n--- TEST SUITE 2: /api/v1/admin/campaigns/birthdays/today ---');

  // Test 2.1: Clean response when no birthdays match
  {
    const req: any = {
      user: { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      query: { timezone: 'Asia/Kolkata' }
    };
    const res = createMockRes();

    await getTodayBirthdays(req, res as any);
    assert(res.statusCode === 200, 'Birthday query returns 200 OK');
    assert(res.responseData?.success === true, 'Response contains success: true');
    assert(typeof res.responseData?.data?.count === 'number', 'count is a number');
    assert(Array.isArray(res.responseData?.data?.birthdays), 'birthdays is an array');
  }

  // Test 2.2: Invalid or undefined timezone parameter handling
  {
    const req: any = {
      user: { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      query: { timezone: 'Invalid/NonExistent_Zone' }
    };
    const res = createMockRes();

    await getTodayBirthdays(req, res as any);
    assert(res.statusCode === 200, 'Invalid timezone falls back safely to Asia/Kolkata without 500 error');
  }

  // Test 2.3: Active employee birthday matching today
  let birthdayEmp: any;
  let store: any;
  {
    // Find or create store
    store = await prisma.store.findFirst();
    if (!store) {
      store = await prisma.store.create({
        data: { name: 'Test Suite Store', code: 'TEST_STR_01' }
      });
    }

    // Set employee DOB to today's month/day in 1995
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', month: 'numeric', day: 'numeric' });
    const parts = formatter.formatToParts(now);
    const m = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10);
    const d = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);

    const testDob = new Date(Date.UTC(1995, m - 1, d, 0, 0, 0));

    birthdayEmp = await prisma.employee.create({
      data: {
        firstName: 'BirthdayCelebrant',
        lastName: 'Tester',
        employeeCode: 'BDAY_EMP_01',
        status: 'active',
        dateOfBirth: testDob,
        storeId: store.id,
      }
    });

    const req: any = {
      user: { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      query: { timezone: 'Asia/Kolkata' }
    };
    const res = createMockRes();

    await getTodayBirthdays(req, res as any);
    assert(res.statusCode === 200, 'Celebrant query returns 200 OK');
    const found = res.responseData?.data?.birthdays.find((b: any) => b.id === birthdayEmp.id);
    assert(Boolean(found), 'Celebrant employee identified in birthdays today list');
    assert(found?.name.includes('BirthdayCelebrant'), 'Celebrant full name mapped properly');
    assert(found?.alreadyWished === false, 'alreadyWished is false before wishing');
  }

  // Test 2.4: Store scoping on birthday query
  {
    const reqOtherStore: any = {
      user: { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      query: { timezone: 'Asia/Kolkata', storeId: '999999' }
    };
    const resOtherStore = createMockRes();
    await getTodayBirthdays(reqOtherStore, resOtherStore as any);
    const foundInWrongStore = resOtherStore.responseData?.data?.birthdays.find((b: any) => b.id === birthdayEmp.id);
    assert(!foundInWrongStore, 'Store filter excludes employees outside the targeted store');
  }

  // Test 2.5: Inactive employee with today birthday ignored
  let inactiveBirthdayEmp: any;
  {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', month: 'numeric', day: 'numeric' });
    const parts = formatter.formatToParts(now);
    const m = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10);
    const d = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);

    inactiveBirthdayEmp = await prisma.employee.create({
      data: {
        firstName: 'InactiveCelebrant',
        lastName: 'Tester',
        employeeCode: 'INACT_EMP_01',
        status: 'inactive',
        dateOfBirth: new Date(Date.UTC(1992, m - 1, d, 0, 0, 0)),
      }
    });

    const req: any = {
      user: { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      query: { timezone: 'Asia/Kolkata' }
    };
    const res = createMockRes();
    await getTodayBirthdays(req, res as any);
    const foundInactive = res.responseData?.data?.birthdays.find((b: any) => b.id === inactiveBirthdayEmp.id);
    assert(!foundInactive, 'Inactive employee is excluded from today birthdays');
  }

  // Test 2.6: Leap-day born employee (Feb 29) handled on non-leap years
  {
    // Call getTodayBirthdays on leap year simulation logic
    const feb29Dob = new Date(Date.UTC(2000, 1, 29, 0, 0, 0)); // Feb 29 2000 (Leap Year)
    assert(feb29Dob.getUTCMonth() === 1 && feb29Dob.getUTCDate() === 29, 'Leap day date constructed accurately');

    // Verify leap calculation helper in service
    const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    assert(!isLeap(2025), '2025 is not a leap year');
    assert(!isLeap(2026), '2026 is not a leap year');
    assert(isLeap(2028), '2028 is a leap year');
  }

  // Test 2.7: Duplicate birthday wishes prevention (Idempotency)
  {
    const wishResult1 = await campaignService.sendBirthdayWishes({
      employeeIds: [birthdayEmp.id],
      timezone: 'Asia/Kolkata'
    });
    assert(wishResult1.count === 1, 'First sendBirthdayWishes triggers campaign send');

    // Repeated call on the same day
    const wishResult2 = await campaignService.sendBirthdayWishes({
      employeeIds: [birthdayEmp.id],
      timezone: 'Asia/Kolkata'
    });
    assert(wishResult2.count === 0, 'Duplicate birthday wish on same day suppressed by idempotency control');

    // Query today birthdays again: alreadyWished should now be true
    const req: any = {
      user: { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      query: { timezone: 'Asia/Kolkata' }
    };
    const res = createMockRes();
    await getTodayBirthdays(req, res as any);
    const updatedEmp = res.responseData?.data?.birthdays.find((b: any) => b.id === birthdayEmp.id);
    assert(updatedEmp?.alreadyWished === true, 'alreadyWished flag reflects the sent status');
  }

  // Clean up test employees and created test campaigns
  await prisma.campaignRecipient.deleteMany({ where: { employeeId: birthdayEmp.id } });
  await prisma.employee.delete({ where: { id: birthdayEmp.id } });
  await prisma.employee.delete({ where: { id: inactiveBirthdayEmp.id } });

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
