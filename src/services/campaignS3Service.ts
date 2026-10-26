import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getIntegrationSettings } from '../utils/configService';

function storageFailure(action: string, key: string, error: any): Error {
  console.error('[CampaignS3] Operation failed', { action, key, code: error?.name, httpStatus: error?.$metadata?.httpStatusCode });
  return new Error(`Campaign image storage ${action} failed`);
}

/** Uses the same backend integration settings as the Settings page. No public ACLs. */
export async function campaignS3() {
  const settings = await getIntegrationSettings();
  if (!settings.awsBucketName) return null;
  if (Boolean(settings.awsAccessKeyId) !== Boolean(settings.awsSecretAccessKey)) throw new Error('Incomplete AWS campaign credentials');
  const client = new S3Client({
    region: settings.awsRegion,
    ...(settings.awsAccessKeyId ? { credentials: { accessKeyId: settings.awsAccessKeyId, secretAccessKey: settings.awsSecretAccessKey } } : {}),
  });
  const bucket = settings.awsBucketName;
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
