require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { S3Client } = require('@aws-sdk/client-s3');
require.cache[require.resolve('../src/utils/configService')] = { exports: {
  getIntegrationSettings: async () => ({ awsBucketName: 'private-campaign-test', awsRegion: 'ap-south-1', awsAccessKeyId: 'TESTACCESSKEY', awsSecretAccessKey: 'test-secret-never-output' }),
} };
const calls = [];
let status;
S3Client.prototype.send = async function(command) {
  calls.push(command);
  if (status) throw Object.assign(new Error('simulated'), { $metadata: { httpStatusCode: status } });
  return {};
};
(async () => {
  const { campaignS3 } = require('../src/services/campaignS3Service');
  const s3 = await campaignS3();
  await s3.put('campaigns/test.jpg', Buffer.from('image'));
  assert.equal(calls[0].input.IfNoneMatch, '*');
  assert.equal(calls[0].input.ACL, undefined);
  assert.equal(calls[0].input.Bucket, 'private-campaign-test');
  status = 412; await s3.put('campaigns/test.jpg', Buffer.from('image'));
  status = 404; assert.equal(await s3.exists('campaigns/missing.jpg'), false);
  status = 403; await assert.rejects(() => s3.exists('campaigns/test.jpg'));
  status = undefined;
  const signed = await s3.sign('campaigns/test.jpg');
  assert(signed.startsWith('https://'));
  assert(signed.includes('X-Amz-Signature='));
  assert(!signed.includes('test-secret-never-output'));
  await s3.remove('campaigns/test.jpg');
  assert.equal(calls.at(-1).constructor.name, 'DeleteObjectCommand');
  console.log('PASS real AWS SDK commands: private access, conditional writes, signing, 404 vs permission failures, cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
