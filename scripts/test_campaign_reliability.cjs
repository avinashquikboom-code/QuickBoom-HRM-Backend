require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
let s3Storage = null;
const ledger = new Map();
let campaign, sends = 0, message, refs = [], notifications = [], rejectSend = false;
const db = {
  $executeRaw: async () => 1,
  campaignImageAsset: {
    upsert: async ({ where, create, update }) => ledger.set(where.canonicalUrl, { ...(ledger.get(where.canonicalUrl) || { ...create, lastUsedAt: new Date() }), ...update }),
    findMany: async ({ where }) => [...ledger.values()].filter(a => a.lastUsedAt < where.lastUsedAt.lt),
    delete: async ({ where }) => ledger.delete(where.canonicalUrl),
  },
  campaign: {
    findUnique: async () => ({ ...campaign }),
    updateMany: async ({ where, data }) => {
      if (!where.status.in.includes(campaign.status)) return { count: 0 };
      Object.assign(campaign, data); return { count: 1 };
    },
    update: async ({ data }) => Object.assign(campaign, data), findMany: async () => refs,
  },
  fCMToken: { findMany: async () => [{ userId: 9, token: 'device-one' }], updateMany: async () => ({ count: 0 }) },
  device: { findMany: async () => [{ userId: 9, fcmToken: 'device-one' }] },
  campaignRecipient: { upsert: async () => ({}), updateMany: async () => ({ count: 1 }) },
  notification: { findFirst: async () => null, create: async () => ({ id: 1 }), update: async () => ({}), findMany: async () => notifications },
};
db.$transaction = async fn => fn(db);
require.cache[require.resolve('../src/services/campaignS3Service')] = { exports: { campaignS3: async () => s3Storage } };
require.cache[require.resolve('../src/utils/db')] = { exports: { prisma: db } };
require.cache[require.resolve('../src/config/firebase')] = { exports: {
  getMessaging: () => ({ sendEachForMulticast: async payload => {
    sends++; message = payload;
    if (rejectSend) throw Object.assign(new Error('provider uncertain'), { code: 'messaging/server-unavailable' });
    return { successCount: payload.tokens.length, failureCount: 0, responses: payload.tokens.map(() => ({ success: true, messageId: 'accepted' })) };
  } }),
} };
const { campaignService } = require('../src/services/campaignService');
const { campaignImages } = require('../src/services/campaignImageService');
const { validateCampaign } = require('../src/services/campaignPolicy');
campaignService.resolveAudience = async () => [{ id: 7, userId: 9 }];
const fresh = () => ({ id: 'campaign-one', status: 'DRAFT', title: 'Hello', message: '😀'.repeat(1500), audienceType: 'ALL_EMPLOYEES', createdById: 1, imageUrl: null });
(async () => {
  campaign = fresh();
  const results = await Promise.allSettled([campaignService.sendCampaign(campaign.id), campaignService.sendCampaign(campaign.id)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(sends, 1);
  assert.equal(message.webpush.fcmOptions, undefined);
  assert(Buffer.byteLength(JSON.stringify(message)) < 4096);
  assert.equal(message.data.campaignId, 'campaign-one');
  assert.equal(message.android.notification.channelId, 'general_notifications');
  await assert.rejects(() => campaignService.scheduleCampaign(campaign.id, new Date(Date.now() + 60000)), /Only unsent/);
  await assert.rejects(() => campaignService.sendCampaign(campaign.id), /already been dispatched/);
  console.log('PASS concurrent claim, token dedupe, compact payload, web link, reschedule guard');
  campaign = fresh(); rejectSend = true;
  await campaignService.sendCampaign(campaign.id);
  assert.equal(campaign.status, 'COMPLETED_WITH_ERRORS');
  await assert.rejects(() => campaignService.sendCampaign(campaign.id), /already been dispatched/);
  assert.throws(() => validateCampaign({ title: 'x', message: 'y', imageUrl: 'data:image/png;base64,AAAA' }), /URL/);
  assert.throws(() => validateCampaign({ title: 'x', message: 'y', status: 'SENT' }), /status/);
  console.log('PASS uncertain delivery cannot be blindly retried; data URL and dispatch status rejected');
  const writes = [];
  db.device.upsert = async args => { writes.push(['device', args]); return { id: 1 }; };
  db.device.deleteMany = async args => { writes.push(['remove', args]); return { count: 1 }; };
  db.fCMToken.updateMany = async args => { writes.push(['deactivate', args]); return { count: 1 }; };
  db.fCMToken.upsert = async args => { writes.push(['register', args]); return {}; };
  const { registerDeviceToken } = require('../src/services/deviceTokenService');
  await registerDeviceToken(9, 'new-token', 'android', 'old-token');
  assert(writes.some(([kind, args]) => kind === 'deactivate' && args.where.userId?.not === 9));
  assert(writes.some(([kind, args]) => kind === 'device' && args.update.userId === 9));
  assert(writes.some(([kind, args]) => kind === 'remove' && args.where.fcmToken === 'old-token' && args.where.userId === 9));
  console.log('PASS token ownership transfer and authenticated previous-token retirement');
  const router = require('../src/routes/mobile/mobileNotificationRoutes').default;
  const detail = router.stack.find(layer => layer.route?.path === '/campaigns/:campaignId').route.stack[0].handle;
  db.notification.findFirst = async ({ where }) => where.userId === 9 && where.campaignId === 'campaign-one' ? { id: 1, campaignId: 'campaign-one', imageUrl: null } : null;
  let response, httpStatus = 200;
  const res = { json: value => { response = value; }, status: code => { httpStatus = code; return res; } };
  await detail({ user: { id: 9 }, params: { campaignId: 'campaign-one' } }, res);
  assert.equal(response.data.campaignId, 'campaign-one');
  await detail({ user: { id: 10 }, params: { campaignId: 'campaign-one' } }, res);
  assert.equal(httpStatus, 404);
  console.log('PASS campaign detail loads exact recipient record and denies another account');

  const cwd = process.cwd(), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'campaign-images-'));
  process.chdir(temp);
  try {
    const buffer = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#123456' } }).png().toBuffer();
    const file = { buffer, size: buffer.length, mimetype: 'image/png' };
    const first = await campaignImages.upload(file), second = await campaignImages.upload(file);
    assert.equal(first, second);
    const directory = path.join(temp, 'uploads', 'campaigns');
    const files = await fs.readdir(directory);
    assert.equal(files.length, 3);
    for (const name of files) {
      const meta = await sharp(path.join(directory, name)).metadata();
      assert(meta.width <= (name.includes('thumbnail') ? 320 : name.includes('notification') ? 800 : 1600));
      assert((await fs.stat(path.join(directory, name))).size <= 1024 * 1024);
      await fs.utimes(path.join(directory, name), new Date(0), new Date(0));
    }
    refs = [{ imageUrl: first }]; assert.equal(await campaignImages.cleanup(), 0);
    refs = []; notifications = [{ imageUrl: first }]; assert.equal(await campaignImages.cleanup(), 0);
    notifications = []; assert.equal(await campaignImages.cleanup(), 3);
    await assert.rejects(() => campaignImages.upload({ buffer: Buffer.from('not an image'), size: 12, mimetype: 'image/jpeg' }), /Invalid image/);
    await assert.rejects(() => campaignImages.upload({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1), size: 1, mimetype: 'image/jpeg' }), /5MB/);
    console.log('PASS real image compression, variants, dedupe, shared reference cleanup, file validation');
    const objects = new Map(); let puts = 0;
    s3Storage = {
      bucket: 'test-private-bucket', exists: async key => objects.has(key),
      put: async (key, body) => { puts++; objects.set(key, body); },
      sign: async key => `https://test-private-bucket.s3.ap-south-1.amazonaws.com/${key}?X-Amz-Signature=example`,
      remove: async key => objects.delete(key),
    };
    const stored = await campaignImages.upload(file);
    assert(stored.startsWith('s3://test-private-bucket/campaigns/'));
    assert.equal(await campaignImages.upload(file), stored);
    assert.equal(puts, 3, 'unchanged S3 upload creates no new objects or versions');
    const { canonicalCampaignImage, campaignImageResponse } = require('../src/services/campaignImageService');
    const signed = await campaignImageResponse({ imageUrl: stored });
    assert(signed.imageUrl.includes('X-Amz-Signature'));
    assert.equal(await canonicalCampaignImage(signed.imageUrl), stored);
    ledger.get(stored).lastUsedAt = new Date(0);
    refs = [{ imageUrl: stored }];
    await campaignImages.cleanup(); assert.equal(objects.size, 3);
    refs = []; notifications = [{ imageUrl: stored }];
    await campaignImages.cleanup(); assert.equal(objects.size, 3);
    notifications = [];
    await campaignImages.cleanup(); assert.equal(objects.size, 0);
    assert.equal(ledger.has(stored), false);
    console.log('PASS S3 dedupe, canonical keys, signed responses, shared references, eventual cleanup');
  } finally { process.chdir(cwd); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
