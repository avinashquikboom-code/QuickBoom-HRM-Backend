import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/utils/db';
import { signAccessToken } from '../src/utils/jwt';
import express from 'express';
import adminRoutes from '../src/routes/adminRoutes';

async function runTests() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 TESTING BRANCHES API & RUNTIME SAFETY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Check Favicon files in HRM-Admin-Pannel
  console.log('1. Checking Favicon assets...');
  const publicFavicon = path.resolve(__dirname, '../../HRM-Admin-Pannel/public/favicon.ico');
  const appFavicon = path.resolve(__dirname, '../../HRM-Admin-Pannel/src/app/favicon.ico');
  assert(fs.existsSync(publicFavicon), 'public/favicon.ico must exist');
  assert(fs.existsSync(appFavicon), 'src/app/favicon.ico must exist');
  console.log('   ✅ public/favicon.ico and src/app/favicon.ico exist.');

  // 2. Direct Prisma DB Branch test
  console.log('\n2. Testing Prisma Branch Database Operations...');
  const testBranchName = `Test Branch ${Date.now()}`;
  const createdBranch = await prisma.branch.create({
    data: {
      name: testBranchName,
      latitude: 19.0760,
      longitude: 72.8777,
      radiusMeters: 100,
    },
  });
  assert(createdBranch.id > 0, 'Branch must have valid auto-increment ID');
  assert.equal(createdBranch.name, testBranchName);
  console.log(`   ✅ Created Branch #${createdBranch.id}: ${createdBranch.name}`);

  const fetchedBranches = await prisma.branch.findMany({
    where: { id: createdBranch.id },
  });
  assert.equal(fetchedBranches.length, 1);
  console.log('   ✅ Prisma findMany retrieved created branch');

  // 3. Express Route Integration Testing
  console.log('\n3. Testing Express /api/admin/branches and /api/v1/admin/branches routing...');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use('/api/v1/admin', adminRoutes);

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 3a. Unauthorized GET (no token) -> Expect 401
    const unauthRes = await fetch(`${baseUrl}/api/admin/branches`);
    assert.equal(unauthRes.status, 401, 'Request without token must be rejected with 401');
    console.log('   ✅ GET /api/admin/branches without token correctly returned 401 Unauthorized');

    // 3b. Authorized GET with Admin Token -> Expect 200
    const dbAdmin = await prisma.user.findFirst({
      where: {
        role: { in: ['SUPER_ADMIN', 'ADMIN'] },
        isActive: true,
      },
    });

    let adminToken: string;
    if (dbAdmin) {
      adminToken = signAccessToken({
        id: dbAdmin.id,
        email: dbAdmin.email,
        role: dbAdmin.role,
      });
    } else {
      // Fallback: create temporary test admin
      const tempAdmin = await prisma.user.create({
        data: {
          email: `test_admin_${Date.now()}@example.com`,
          password: 'hashed_password',
          role: 'ADMIN',
          isActive: true,
        },
      });
      adminToken = signAccessToken({
        id: tempAdmin.id,
        email: tempAdmin.email,
        role: tempAdmin.role,
      });
    }

    const authRes = await fetch(`${baseUrl}/api/admin/branches`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(authRes.status, 200, 'Authorized request must return 200');
    const authData = await authRes.json();
    assert.equal(authData.success, true);
    assert(Array.isArray(authData.data), 'authData.data must be an Array');
    assert(Array.isArray(authData.branches), 'authData.branches must be an Array');
    console.log(`   ✅ GET /api/admin/branches returned HTTP 200 with ${authData.data.length} branches`);

    // 3c. Authorized GET on /api/v1/admin/branches -> Expect 200
    const v1Res = await fetch(`${baseUrl}/api/v1/admin/branches`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(v1Res.status, 200, 'GET /api/v1/admin/branches must return 200');
    const v1Data = await v1Res.json();
    assert.equal(v1Data.success, true);
    console.log('   ✅ GET /api/v1/admin/branches returned HTTP 200');

    // 3d. Search Filter -> Expect matched result
    const searchRes = await fetch(`${baseUrl}/api/admin/branches?search=${encodeURIComponent(testBranchName)}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.equal(searchData.data.length, 1);
    assert.equal(searchData.data[0].id, createdBranch.id);
    console.log('   ✅ Search query filtering returned the exact match');

    // Clean up created test branch
    await prisma.branch.delete({
      where: { id: createdBranch.id },
    });
    console.log('   ✅ Cleaned up test branch');

  } finally {
    server.close();
    await prisma.$disconnect();
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 ALL BRANCHES & RUNTIME SAFETY TESTS PASSED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
