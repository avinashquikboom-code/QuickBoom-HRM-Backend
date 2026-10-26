require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const sharp = require('sharp');

// 1. Mock Database
const users = new Map([
  [1, { id: 1, role: 'SUPER_ADMIN', isActive: true, employee: null }],
  [2, { id: 2, role: 'HR', isActive: true, employee: { id: 20, officeId: 101, storeId: null, branchId: null } }],
  [3, { id: 3, role: 'ADMIN', isActive: true, employee: null }],
  [4, { id: 4, role: 'PLATFORM_ADMIN', isActive: true, employee: { id: 40, officeId: null } }],
  [5, { id: 5, role: 'STORE_MANAGER', isActive: true, employee: { id: 50, storeId: 7, branchId: null } }],
  [6, { id: 6, role: 'STORE_MANAGER', isActive: true, employee: { id: 60, storeId: null, branchId: 12 } }],
  [7, { id: 7, role: 'STORE_MANAGER', isActive: true, employee: { id: 70, storeId: null, branchId: null } }],
  [8, { id: 8, role: 'EMPLOYEE', isActive: true, employee: { id: 80, storeId: 7 } }],
  [9, { id: 9, role: 'SALESMAN', isActive: true, employee: { id: 90, storeId: 7 } }],
  [10, { id: 10, role: 'SUPER_ADMIN', isActive: false, employee: null }],
]);

let s3Storage = null;
const ledger = new Map();

const db = {
  $executeRaw: async () => 1,
  user: {
    findUnique: async ({ where }) => users.get(where.id) || null,
  },
  campaignImageAsset: {
    upsert: async ({ where, create, update }) => ledger.set(where.canonicalUrl, { ...(ledger.get(where.canonicalUrl) || { ...create, lastUsedAt: new Date() }), ...update }),
    findMany: async () => [...ledger.values()],
    deleteMany: async ({ where }) => {
      if (where.canonicalUrl) ledger.delete(where.canonicalUrl);
      return { count: 1 };
    },
  },
};
db.$transaction = async fn => fn(db);

require.cache[require.resolve('../src/utils/db')] = { exports: { prisma: db } };
require.cache[require.resolve('../src/services/campaignS3Service')] = { exports: { campaignS3: async () => s3Storage } };

(async () => {
  const { campaignService } = require('../src/services/campaignService');
  const { campaignImages, campaignImageResponse } = require('../src/services/campaignImageService');

  console.log('--- Testing actorScope Scoping & Roles ---');

  // A. Global Admin (SUPER_ADMIN) -> unrestricted access across all companies and locations
  const globalScope = await campaignService.actorScope(1);
  assert.deepEqual(globalScope, {}, 'Global admin must have unrestricted scope');
  console.log('PASS: Global admin (SUPER_ADMIN) has unrestricted scope');

  // B. Company Admin (HR with assigned office) -> scoped to company/office without store/branch requirement
  const hrOfficeScope = await campaignService.actorScope(2);
  assert.deepEqual(hrOfficeScope, { officeId: 101 }, 'HR with officeId must scope to their company/office');
  console.log('PASS: Company admin (HR with office) scopes to company office without store/branch requirement');

  // C. Company Admin (ADMIN / PLATFORM_ADMIN without specific office) -> company-wide access
  const adminScope = await campaignService.actorScope(3);
  assert.deepEqual(adminScope, {}, 'Admin without office must have company-wide scope');
  const platformAdminScope = await campaignService.actorScope(4);
  assert.deepEqual(platformAdminScope, {}, 'Platform Admin without office must have company-wide scope');
  console.log('PASS: Company admins (ADMIN & PLATFORM_ADMIN) have company-wide scope');

  // D. Store Administrator (STORE_MANAGER with storeId) -> restricted to store
  const storeScope = await campaignService.actorScope(5);
  assert.deepEqual(storeScope, { storeId: 7 }, 'Store manager must scope to their storeId');
  console.log('PASS: Store administrator is properly restricted to store');

  // E. Branch Administrator (STORE_MANAGER with branchId) -> restricted to branch
  const branchScope = await campaignService.actorScope(6);
  assert.deepEqual(branchScope, { branchId: 12 }, 'Branch manager must scope to their branchId');
  console.log('PASS: Branch administrator is properly restricted to branch');

  // F. Store Manager with NO assigned store or branch -> throws 403
  await assert.rejects(
    () => campaignService.actorScope(7),
    (err) => err.status === 403 && err.message === 'Campaign actor has no assigned store or branch',
    'Unassigned store manager must throw 403'
  );
  console.log('PASS: Unassigned store manager throws 403 with meaningful message');

  // G. Unauthorized Roles (EMPLOYEE, SALESMAN) -> throws 403
  await assert.rejects(
    () => campaignService.actorScope(8),
    (err) => err.status === 403 && /Unauthorized/.test(err.message),
    'Employee must be rejected with 403'
  );
  await assert.rejects(
    () => campaignService.actorScope(9),
    (err) => err.status === 403 && /Unauthorized/.test(err.message),
    'Salesman must be rejected with 403'
  );
  console.log('PASS: Unauthorized users (EMPLOYEE, SALESMAN) are rejected with 403');

  // H. Inactive User -> throws 403
  await assert.rejects(
    () => campaignService.actorScope(10),
    (err) => err.status === 403 && /Active/.test(err.message),
    'Inactive user must be rejected'
  );
  console.log('PASS: Inactive users are rejected with 403');

  console.log('\n--- Testing Campaign Image URL Resolution & S3 Signing ---');

  // A. Stale / Bare Filename (campaign_1793030810851_22178914.png)
  const legacyFilename = 'campaign_1793030810851_22178914.png';
  const resolvedLegacy = await campaignImages.displayUrl(legacyFilename);
  assert.equal(resolvedLegacy, `/api/uploads/campaigns/${legacyFilename}`, 'Bare filename must resolve to accessible /api/uploads/ path');
  console.log('PASS: Bare filename resolves to /api/uploads/campaigns/...');

  // B. Relative uploads path
  const relativeUpload = '/uploads/campaigns/v1-sample-detail.jpg';
  const resolvedRelative = await campaignImages.displayUrl(relativeUpload);
  assert.equal(resolvedRelative, '/api/uploads/campaigns/v1-sample-detail.jpg', 'Relative /uploads/ path must normalize to /api/uploads/');
  console.log('PASS: Relative /uploads/ path normalizes to /api/uploads/');

  // C. Legacy / arbitrary S3 key signing (not matching v1 pattern)
  const legacyS3Uri = 's3://test-bucket/campaigns/campaign_1793030810851_22178914.png';
  s3Storage = {
    bucket: 'test-bucket',
    exists: async () => true,
    sign: async key => `https://test-bucket.s3.ap-south-1.amazonaws.com/${key}?X-Amz-Signature=signed_token`,
    put: async () => {},
    remove: async () => {},
  };
  const signedLegacy = await campaignImages.displayUrl(legacyS3Uri);
  assert(signedLegacy.includes('X-Amz-Signature=signed_token'), 'S3 legacy keys must generate valid signed URLs');
  assert(signedLegacy.includes(legacyFilename), 'Signed URL must contain original object key');
  console.log('PASS: Legacy S3 keys sign successfully without failing pattern check');

  // D. S3 upload error cleanup: ledger entry must not persist if storage fails
  const buffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer();
  s3Storage.exists = async () => false;
  s3Storage.put = async () => {
    throw Object.assign(new Error('S3 Access Denied'), { $metadata: { httpStatusCode: 403 }, name: 'AccessDenied' });
  };
  await assert.rejects(
    () => campaignImages.upload({ buffer, size: buffer.length, mimetype: 'image/png' }),
    /AccessDenied|storage/i,
    'S3 put failure must reject'
  );
  assert.equal(ledger.size, 0, 'Failed upload must clean up pending ledger entry');
  console.log('PASS: Failed S3 upload cleans up ledger entry and throws clear error');

  console.log('\nALL ACTOR SCOPING & IMAGE RESOLUTION TESTS PASSED SUCCESSFULLY!');
})().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
