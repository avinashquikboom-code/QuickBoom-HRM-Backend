import express from 'express';
import http from 'http';
import { prisma } from '../src/utils/db';
import { signToken } from '../src/utils/jwt';
import commissionReportRouter from '../src/controllers/commissionReportController';
import commissionRouter from '../src/routes/commissionRoutes';

const app = express();
app.use(express.json());
app.use('/api/admin/commission', commissionReportRouter);
app.use('/api/commission', commissionRouter);

async function runTests() {
  console.log('=== STARTING COMMISSION DASHBOARD & REPORT SCENARIO TESTS ===\n');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function apiGet(path: string, token: string) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string, details?: any) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`, details ? JSON.stringify(details, null, 2) : '');
      failed++;
    }
  }

  try {
    // Set up test stores
    let activeStore = await prisma.store.findFirst({ where: { isActive: true } });
    if (!activeStore) {
      activeStore = await prisma.store.create({
        data: { name: 'Active Test Store', code: 'ACT-001', isActive: true },
      });
    }

    let inactiveStore = await prisma.store.findFirst({ where: { isActive: false } });
    if (!inactiveStore) {
      inactiveStore = await prisma.store.create({
        data: { name: 'Inactive Test Store', code: 'INACT-001', isActive: false },
      });
    }

    // 1. Employee with a valid active store assignment
    const empActiveUser = await prisma.user.upsert({
      where: { email: 'emp_active_store@test.local' },
      update: { isActive: true, role: 'EMPLOYEE' },
      create: {
        email: 'emp_active_store@test.local',
        password: 'hash',
        role: 'EMPLOYEE',
        isActive: true,
      },
    });
    await prisma.employee.upsert({
      where: { employeeCode: 'EMP_ACT_STORE_TEST' },
      update: { userId: empActiveUser.id, storeId: activeStore.id, status: 'active' },
      create: {
        userId: empActiveUser.id,
        employeeCode: 'EMP_ACT_STORE_TEST',
        firstName: 'Active',
        lastName: 'Employee',
        status: 'active',
        storeId: activeStore.id,
        workModeId: 'OFFICE',
        shiftTypeId: 'MORNING',
      },
    });
    const tokenActiveEmp = signToken({ id: empActiveUser.id, email: empActiveUser.email, role: empActiveUser.role });

    console.log('--- SCENARIO 1: Employee with valid active store assignment ---');
    const res1Dash = await apiGet('/api/admin/commission/dashboard', tokenActiveEmp);
    assert(res1Dash.status === 200 && res1Dash.body.success === true, 'Admin Dashboard returns 200 for active employee', res1Dash.body);

    const res1CommDash = await apiGet('/api/commission/dashboard', tokenActiveEmp);
    assert(res1CommDash.status === 200 && res1CommDash.body.success === true, 'Commission Dashboard returns 200 for active employee', res1CommDash.body);

    const res1Txns = await apiGet('/api/admin/commission/transactions?page=1&pageSize=10', tokenActiveEmp);
    assert(res1Txns.status === 200 && res1Txns.body.success === true, 'Transactions returns 200 for active employee', res1Txns.body);

    const res1Report = await apiGet('/api/admin/commission/report?startDate=2026-01-01&endDate=2026-10-25', tokenActiveEmp);
    assert(res1Report.status === 200 && res1Report.body.success === true, 'Report returns 200 for active employee', res1Report.body);

    // 2. Employee with NO store assignment
    const empNoStoreUser = await prisma.user.upsert({
      where: { email: 'emp_no_store@test.local' },
      update: { isActive: true, role: 'EMPLOYEE' },
      create: {
        email: 'emp_no_store@test.local',
        password: 'hash',
        role: 'EMPLOYEE',
        isActive: true,
      },
    });
    await prisma.employee.upsert({
      where: { employeeCode: 'EMP_NO_STORE_TEST' },
      update: { userId: empNoStoreUser.id, storeId: null, status: 'active' },
      create: {
        userId: empNoStoreUser.id,
        employeeCode: 'EMP_NO_STORE_TEST',
        firstName: 'NoStore',
        lastName: 'Employee',
        status: 'active',
        storeId: null,
        workModeId: 'OFFICE',
        shiftTypeId: 'MORNING',
      },
    });
    const tokenNoStoreEmp = signToken({ id: empNoStoreUser.id, email: empNoStoreUser.email, role: empNoStoreUser.role });

    console.log('\n--- SCENARIO 2: Employee with no store assignment ---');
    const res2Dash = await apiGet('/api/admin/commission/dashboard', tokenNoStoreEmp);
    assert(
      res2Dash.status === 422 &&
      res2Dash.body.message === 'No store location is assigned to your employee account. Please contact an administrator to assign an active store.',
      'Admin Dashboard returns 422 with actionable message for unassigned employee',
      res2Dash.body
    );

    const res2CommDash = await apiGet('/api/commission/dashboard', tokenNoStoreEmp);
    assert(
      res2CommDash.status === 422 &&
      res2CommDash.body.message === 'No store location is assigned to your employee account. Please contact an administrator to assign an active store.',
      'Commission Dashboard returns 422 with actionable message for unassigned employee',
      res2CommDash.body
    );

    const res2Txns = await apiGet('/api/admin/commission/transactions?page=1&pageSize=10', tokenNoStoreEmp);
    assert(
      res2Txns.status === 422 &&
      res2Txns.body.message === 'No store location is assigned to your employee account. Please contact an administrator to assign an active store.',
      'Transactions returns 422 for unassigned employee',
      res2Txns.body
    );

    const res2Report = await apiGet('/api/admin/commission/report?startDate=2026-01-01&endDate=2026-10-25', tokenNoStoreEmp);
    assert(
      res2Report.status === 422 &&
      res2Report.body.message === 'No store location is assigned to your employee account. Please contact an administrator to assign an active store.',
      'Report returns 422 for unassigned employee',
      res2Report.body
    );

    // 3. Employee assigned to an INACTIVE store
    const empInactStoreUser = await prisma.user.upsert({
      where: { email: 'emp_inact_store@test.local' },
      update: { isActive: true, role: 'EMPLOYEE' },
      create: {
        email: 'emp_inact_store@test.local',
        password: 'hash',
        role: 'EMPLOYEE',
        isActive: true,
      },
    });
    await prisma.employee.upsert({
      where: { employeeCode: 'EMP_INACT_STORE_TEST' },
      update: { userId: empInactStoreUser.id, storeId: inactiveStore.id, status: 'active' },
      create: {
        userId: empInactStoreUser.id,
        employeeCode: 'EMP_INACT_STORE_TEST',
        firstName: 'InactiveStore',
        lastName: 'Employee',
        status: 'active',
        storeId: inactiveStore.id,
        workModeId: 'OFFICE',
        shiftTypeId: 'MORNING',
      },
    });
    const tokenInactStoreEmp = signToken({ id: empInactStoreUser.id, email: empInactStoreUser.email, role: empInactStoreUser.role });

    console.log('\n--- SCENARIO 3: Employee assigned to an inactive store ---');
    const res3Dash = await apiGet('/api/admin/commission/dashboard', tokenInactStoreEmp);
    assert(
      res3Dash.status === 422 &&
      res3Dash.body.message === 'The assigned store location is inactive or does not exist. Ask an administrator to activate it or update your store assignment in HRM Employees.',
      'Admin Dashboard returns 422 with inactive store message',
      res3Dash.body
    );

    const res3Txns = await apiGet('/api/admin/commission/transactions?page=1&pageSize=10', tokenInactStoreEmp);
    assert(
      res3Txns.status === 422 &&
      res3Txns.body.message === 'The assigned store location is inactive or does not exist. Ask an administrator to activate it or update your store assignment in HRM Employees.',
      'Transactions returns 422 with inactive store message',
      res3Txns.body
    );

    // 4. Administrator with valid permissions (ADMIN & HR)
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN', isActive: true, NOT: { email: { contains: 'test' } } },
    }) || await prisma.user.upsert({
      where: { email: 'admin_scenario_test@hopkid.local' },
      update: { role: 'ADMIN', isActive: true },
      create: { email: 'admin_scenario_test@hopkid.local', password: 'hash', role: 'ADMIN', isActive: true },
    });
    const tokenAdmin = signToken({ id: adminUser.id, email: adminUser.email, role: adminUser.role });

    const hrUser = await prisma.user.findFirst({
      where: { role: 'HR', isActive: true },
    }) || await prisma.user.upsert({
      where: { email: 'hr_scenario_test@hopkid.local' },
      update: { role: 'HR', isActive: true },
      create: { email: 'hr_scenario_test@hopkid.local', password: 'hash', role: 'HR', isActive: true },
    });
    const tokenHR = signToken({ id: hrUser.id, email: hrUser.email, role: hrUser.role });

    console.log('\n--- SCENARIO 4: Administrator with valid permissions ---');
    const res4AdminDash = await apiGet('/api/admin/commission/dashboard', tokenAdmin);
    assert(res4AdminDash.status === 200 && res4AdminDash.body.success === true, 'ADMIN can query dashboard without storeId', res4AdminDash.body);

    const res4HRDash = await apiGet('/api/admin/commission/dashboard', tokenHR);
    assert(res4HRDash.status === 200 && res4HRDash.body.success === true, 'HR can query dashboard without storeId', res4HRDash.body);

    const res4AdminTxns = await apiGet('/api/admin/commission/transactions?page=1&pageSize=10', tokenAdmin);
    assert(res4AdminTxns.status === 200 && res4AdminTxns.body.success === true, 'ADMIN can query transactions without storeId', res4AdminTxns.body);

    const res4AdminReport = await apiGet('/api/admin/commission/report?startDate=2026-01-01&endDate=2026-10-25&from=2026-01-01&to=2026-10-25', tokenAdmin);
    assert(res4AdminReport.status === 200 && res4AdminReport.body.success === true, 'ADMIN can query report without storeId', res4AdminReport.body);

    // 5. Valid store assignment with no commission transactions
    const emptyStore = await prisma.store.create({
      data: { name: 'Empty Fresh Store', code: `EMPTY-${Date.now()}`, isActive: true },
    });
    console.log('\n--- SCENARIO 5: Valid store assignment with no commission transactions ---');
    const res5Dash = await apiGet(`/api/admin/commission/dashboard?storeId=${emptyStore.id}`, tokenAdmin);
    assert(
      res5Dash.status === 200 &&
      res5Dash.body.stats.today.commission === 0 &&
      res5Dash.body.stats.month.commission === 0,
      'Empty store returns 200 with zero totals',
      res5Dash.body
    );

    const res5Txns = await apiGet(`/api/admin/commission/transactions?storeId=${emptyStore.id}&page=1&pageSize=10`, tokenAdmin);
    assert(
      res5Txns.status === 200 &&
      res5Txns.body.transactions.length === 0 &&
      res5Txns.body.pagination.total === 0,
      'Empty store returns 200 with empty transactions list',
      res5Txns.body
    );

    // 6. Subcategory commission report with configured rates
    console.log('\n--- SCENARIO 6: Subcategory commission report with configured rates ---');
    const res6Report = await apiGet('/api/admin/commission/report?period=all', tokenAdmin);
    assert(
      res6Report.status === 200 &&
      res6Report.body.success === true &&
      Array.isArray(res6Report.body.data.items),
      'Subcategory commission report returns structured items array',
      res6Report.body.data?.totals
    );
    if (res6Report.body.data.items.length > 0) {
      const item0 = res6Report.body.data.items[0];
      assert(
        item0.subcategoryName !== undefined && item0.rate !== undefined && item0.commissionAmount !== undefined,
        'Report items have subcategoryName, rate, and commissionAmount fields'
      );
    }

    // 7. Invalid date parameters and pagination values
    console.log('\n--- SCENARIO 7: Invalid date parameters and pagination values ---');
    const res7BadParams = await apiGet(
      '/api/admin/commission/transactions?page=invalid&pageSize=-10&subcategoryId=not-a-uuid&from=2026-10-25&to=2026-01-01',
      tokenAdmin
    );
    assert(
      res7BadParams.status === 200 &&
      res7BadParams.body.pagination.page === 1 &&
      res7BadParams.body.pagination.pageSize === 20,
      'Handled invalid page, negative pageSize, non-UUID subcategoryId, and inverted dates gracefully',
      res7BadParams.body.pagination
    );

    const res7BadReport = await apiGet(
      '/api/admin/commission/report?startDate=invalid-date&endDate=also-invalid&subcategoryId=bad-uuid',
      tokenAdmin
    );
    assert(
      res7BadReport.status === 200 &&
      res7BadReport.body.success === true,
      'Handled invalid date strings and non-UUID subcategoryId in report without SQL errors',
      res7BadReport.body
    );

    console.log(`\n=== SCENARIO TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    server.close();
  }
}

runTests()
  .catch((e) => {
    console.error('Test execution failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
