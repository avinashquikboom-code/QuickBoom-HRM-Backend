import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getIntegrationSettings } from '../utils/configService';
import { CampaignError } from './campaignPolicy';

function storageFailure(action: string, key: string, error: any): Error {
  const code = error?.name || error?.code || 'UnknownError';
  const status = error?.$metadata?.httpStatusCode;
  console.error('[CampaignS3] Operation failed', {
    action,
    key,
    code,
    httpStatus: status,
    message: error?.message,
  });

  if (status === 403 || code === 'AccessDenied') {
    return new CampaignError(500, `Storage permission denied during ${action}. Please check AWS S3 IAM permissions.`);
  }
  if (status === 404 || code === 'NoSuchBucket') {
    return new CampaignError(500, `Storage bucket not found during ${action}. Please verify AWS S3 bucket configuration.`);
  }
  return new CampaignError(status >= 400 && status < 600 ? status : 500, `Campaign image storage ${action} failed: ${error?.message || code}`);
}

/** Uses the same backend integration settings as the Settings page. No public ACLs. */
export async function campaignS3() {
  const settings = await getIntegrationSettings();
  const bucket = settings.awsBucketName?.trim();
  if (!bucket) return null;
  const accessKeyId = settings.awsAccessKeyId?.trim();
  const secretAccessKey = settings.awsSecretAccessKey?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new CampaignError(500, 'Incomplete AWS campaign storage credentials');
  }
  const region = settings.awsRegion?.trim() || process.env.AWS_REGION || 'ap-south-1';
  const client = new S3Client({
    region,
    ...(accessKeyId ? { credentials: { accessKeyId, secretAccessKey: secretAccessKey! } } : {}),
  });
  return {
    bucket,
    async exists(key: string) {
      try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true; }
      catch (error: any) { if (error.$metadata?.httpStatusCode === 404) return false; throw storageFailure('read', key, error); }
    },
    async put(key: string, body: Buffer) {
      // Conditional writes avoid duplicate object versions, including concurrent servers.
      try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'image/jpeg', IfNoneMatch: '*' })); }
      catch (error: any) { if (error.$metadata?.httpStatusCode !== 412) throw storageFailure('upload', key, error); }
    },
    async sign(key: string) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 86400 });
    },
    async remove(key: string) {
      try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }
      catch (error) { throw storageFailure('cleanup', key, error); }
    },
  };
}
