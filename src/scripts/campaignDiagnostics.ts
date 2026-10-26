/** Read-only deployment checks. Never print credentials, tokens or image URLs. */
import { prisma } from '../utils/db';
import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';

async function main() {
  const schema = await prisma.$queryRaw<Array<{ campaigns: boolean; imageAssets: boolean; fcmTokens: boolean; devices: boolean }>>`
    SELECT to_regclass('public."Campaign"') IS NOT NULL AS campaigns,
      to_regclass('public."CampaignImageAsset"') IS NOT NULL AS "imageAssets",
      to_regclass('public."FCMToken"') IS NOT NULL AS "fcmTokens",
      to_regclass('public.devices') IS NOT NULL AS devices`;
  const setting = await prisma.systemSetting.findFirst({ select: { integrations: true } });
  const configured = (setting?.integrations ?? {}) as Record<string, unknown>;
  const uploads = path.join(process.cwd(), 'uploads', 'campaigns');
  let uploadsReadableWritable = false;
  try { await fs.access(uploads, constants.R_OK | constants.W_OK); uploadsReadableWritable = true; }
  catch (error: any) { if (!['ENOENT','EACCES','EPERM'].includes(error.code)) throw error; }
  const image = process.argv[2];
  let requestedLocalImageExists: boolean | undefined;
  if (image) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(image) || image.includes('..')) throw new Error('Invalid image filename');
    try { await fs.access(path.join(uploads,image)); requestedLocalImageExists = true; }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; requestedLocalImageExists = false; }
  }
  console.log(JSON.stringify({
    schema: schema[0], uploadsReadableWritable, requestedLocalImageExists,
    configuration: {
      publicApiUrl: Boolean(process.env.PUBLIC_API_URL),
      awsBucket: Boolean(configured.awsBucketName || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME),
      awsAccessKey: Boolean(configured.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID),
      awsSecret: Boolean(configured.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY),
      awsRegion: Boolean(configured.awsRegion || process.env.AWS_REGION),
    },
  }));
  if (!schema[0]?.campaigns || !schema[0]?.imageAssets || !schema[0]?.fcmTokens || !schema[0]?.devices) process.exitCode=1;
}
main().catch(error => { console.error('[CampaignDiagnostics] Failed', {code:error?.code || error?.name});process.exitCode=1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode || 0); });
