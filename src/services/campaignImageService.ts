import sharp from 'sharp';
import { campaignS3 } from './campaignS3Service';
import path from 'path';
import fs from 'fs/promises';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/db';
import { CampaignError } from './campaignPolicy';

const folder = () => path.join(process.cwd(), 'uploads', 'campaigns');
const prefix = '/uploads/campaigns/';
const pattern = /^v1-([a-f0-9]{64})-(detail|notification|thumbnail)\.jpg$/;
const graceMs = 7 * 24 * 60 * 60 * 1000;

export function managedImageName(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('s3://')) {
    const match = /^s3:\/\/[^/]+\/campaigns\/(.+)$/.exec(url);
    return match && pattern.test(match[1]) ? match[1] : null;
  }
  const base = process.env.PUBLIC_API_URL?.replace(/\/$/, '');
  const relative = base && url.startsWith(`${base}${prefix}`) ? url.slice(base.length) : url;
  if (!relative.startsWith(prefix)) return null;
  const name = relative.slice(prefix.length);
  return pattern.test(name) ? name : null;
}

/** Serialize managed-image assignment and GC across backend processes. */
export async function withCampaignImageLock<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73409112)`;
    return fn(tx);
  }, { timeout: 30000 });
}

function campaignFilename(value: string): string | null {
  let pathname = value;
  if (/^https?:\/\//.test(value)) {
    try { pathname = new URL(value).pathname; } catch { return null; }
  }
  const clean = pathname.replace(/^\/+/, '');
  if (/^https?:\/\//.test(value) && !/^(?:api\/)*uploads\/campaigns\//.test(clean)) return null;
  const name = clean.replace(/^(?:api\/)*uploads\/campaigns\//, '');
  if (name === clean && clean.includes('/')) return null;
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:png|jpe?g|webp|gif)$/i.test(name) && !name.includes('..') ? name : null;
}

async function localCampaignExists(name: string): Promise<boolean> {
  for (const candidate of [path.join(folder(),name),path.resolve(__dirname,'..','uploads','campaigns',name)]) {
    try { await fs.access(candidate); return true; }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  return false;
}

function bucketKey(value: string, bucket: string): string | null {
  if (value.startsWith(`s3://${bucket}/`)) return value.slice(`s3://${bucket}/`.length);
  if (!value.startsWith('https://')) return null;
  const parsed = new URL(value);
  if ((parsed.hostname.startsWith(`${bucket}.s3.`) && parsed.hostname.endsWith('.amazonaws.com')) || parsed.hostname === `${bucket}.s3.amazonaws.com`) return parsed.pathname.replace(/^\/+/, '');
  return null;
}

function validCampaignKey(key: string): boolean {
  return key.startsWith('campaigns/') && campaignFilename(key.slice('campaigns/'.length)) !== null;
}

export async function canonicalCampaignImage(url?: string | null): Promise<string | null | undefined> {
  if (!url) return url;
  const name = campaignFilename(url);
  const s3 = name || url.startsWith('s3://') || /\.s3\./.test(url) ? await campaignS3() : null;
  const key = s3 ? bucketKey(url,s3.bucket) : null;
  if (key) {
    if (!validCampaignKey(key)) throw new CampaignError(400,'Unknown campaign image key');
    return `s3://${s3!.bucket}/${key}`;
  }
  if (name) {
    if (await localCampaignExists(name)) return `/uploads/campaigns/${name}`;
    if (s3 && await s3.exists(`campaigns/${name}`)) return `s3://${s3.bucket}/campaigns/${name}`;
    throw new CampaignError(400,'Campaign image is missing. Please upload it again or remove it.');
  }
  return url;
}

export async function validateManagedImage(url?: string | null) {
  if (!url) return;
  if (url.startsWith('s3://')) {
    const s3 = await campaignS3();
    const key = s3 ? bucketKey(url,s3.bucket) : null;
    if (!key || !validCampaignKey(key)) throw new CampaignError(400,'Unknown campaign image storage');
    if (!(await s3!.exists(key))) throw new CampaignError(400,'Campaign image is missing. Please upload it again.');
    return;
  }
  const name = campaignFilename(url);
  if (name && !(await localCampaignExists(name))) throw new CampaignError(400,'Campaign image is missing. Please upload it again.');
}

/** Refresh signed URLs at response time; only database keys are persisted. */
export async function campaignImageResponse<T>(value: T): Promise<T> {
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return await Promise.all(value.map(campaignImageResponse)) as T;
  const result: any = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = key === 'imageUrl' && typeof item === 'string'
      ? await campaignImages.displayUrl(item) : await campaignImageResponse(item);
    if (key === 'imageUrl' && item && result[key] === null) result.imageMissing = true;
  }
  return result;
}

export const campaignImages = {
  async upload(file: { buffer: Buffer; mimetype: string; size: number }): Promise<string> {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      throw new CampaignError(400, 'Only JPEG, PNG, WEBP, and GIF images are allowed');
    }
    if (!file.buffer.length) throw new CampaignError(400,'Image is empty');
    if (file.buffer.length > 5 * 1024 * 1024) throw new CampaignError(413,'Image file must not exceed 5MB');
    // Decode the actual file; MIME headers and filenames are not trusted.
    let normalized: Buffer;
    try {
      const metadata = await sharp(file.buffer, { limitInputPixels: 25000000 }).metadata();
      if (!['jpeg', 'png', 'webp', 'gif'].includes(metadata.format || '')) throw new Error('Unsupported image format');
      normalized = await sharp(file.buffer, { limitInputPixels: 25000000, animated: false })
        .rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    } catch {
      throw new CampaignError(400, 'Invalid image or image exceeds 25 megapixels');
    }
    const hash = createHash('sha256').update(normalized).digest('hex');
    const variants = await Promise.all([
      Promise.resolve(normalized),
      sharp(normalized).resize(800, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75, mozjpeg: true }).toBuffer(),
      sharp(normalized).resize(320, 320, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70, mozjpeg: true }).toBuffer(),
    ]);
    if (variants.some(buffer => buffer.length > 1024 * 1024)) {
      throw new CampaignError(400, 'Optimized image exceeds 1MB. Please choose a simpler image.');
    }
    const s3 = await campaignS3();
    const base = process.env.PUBLIC_API_URL?.replace(/\/$/, '') || '';
    const name = `v1-${hash}-detail.jpg`;
    const canonicalUrl = s3 ? `s3://${s3.bucket}/campaigns/${name}` : `${base}${prefix}${name}`;
    // Reserve a ledger entry before any object write. A failed/abandoned upload stays
    // discoverable by GC; never delete an existing shared object on upload failure.
    await withCampaignImageLock(async tx => {
      await tx.campaignImageAsset.upsert({
        where: { canonicalUrl },
        create: { canonicalUrl, objectKey: `campaigns/${name}`, bucket: s3?.bucket || null },
        update: { lastUsedAt: new Date() },
      });
    });
    try {
      await withCampaignImageLock(async () => {
        if (!s3) await fs.mkdir(folder(), { recursive: true });
        for (const [index, variant] of ['detail', 'notification', 'thumbnail'].entries()) {
          const filename = `v1-${hash}-${variant}.jpg`;
          if (s3) {
            const key = `campaigns/${filename}`;
            if (!(await s3.exists(key))) await s3.put(key, variants[index]);
          } else {
            const target = path.join(folder(), filename);
            try { await fs.writeFile(target, variants[index], { flag: 'wx' }); }
            catch (error: any) { if (error.code !== 'EEXIST') throw error; }
            await fs.utimes(target, new Date(), new Date());
          }
        }
      });
    } catch (uploadError: any) {
      try {
        await withCampaignImageLock(async tx => {
          await tx.campaignImageAsset.deleteMany({ where: { canonicalUrl } });
        });
      } catch {}
      console.error('[CampaignImage] Upload failed',{ key: `campaigns/${name}`, code: uploadError?.code || uploadError?.name });
      throw uploadError;
    }
    console.info('[CampaignImage] Upload ready', { key: `campaigns/${name}`, storage: s3 ? 's3' : 'local', inputBytes: file.buffer.length, storedBytes: variants.map(b => b.length) });
    return canonicalUrl;
  },

  async displayUrl(url: string): Promise<string | null> {
    if (!url) return null;
    const name = campaignFilename(url);
    const s3 = name || url.startsWith('s3://') || /\.s3\./.test(url) ? await campaignS3() : null;
    const key = s3 ? bucketKey(url,s3.bucket) : null;
    if (key) {
      if (!validCampaignKey(key)) return null;
      return await s3!.exists(key) ? s3!.sign(key) : null;
    }
    if (url.startsWith('s3://')) {
      console.warn('[CampaignImage] Stored image storage is unavailable');
      return null;
    }
    if (!name) return url; // Preserve unrelated external/static banners.
    const base = process.env.PUBLIC_API_URL?.replace(/\/$/,'').replace(/\/api(?:\/v\d+)?$/,'') || '';
    if (s3 && await s3.exists(`campaigns/${name}`)) {
      return s3.sign(`campaigns/${name}`);
    }
    return `${base}/api/uploads/campaigns/${name}`;
  },

  async notificationUrl(url?: string | null): Promise<string | undefined> {
    if (!url) return undefined;
    const name = managedImageName(url);
    const variant = name ? url.replace(/-detail\.jpg$/, '-notification.jpg') : url;
    if (variant.startsWith('s3://')) return (await this.displayUrl(variant)) || undefined;
    const base = process.env.PUBLIC_API_URL?.replace(/\/$/, '');
    const displayed = await this.displayUrl(variant);
    if (!displayed) return undefined;
    if (/^https?:\/\//.test(displayed)) return displayed;
    if (displayed.startsWith('/') && base) return `${base}${displayed}`;
    return undefined;
  },

  async cleanup(): Promise<number> {
    return withCampaignImageLock(async tx => {
      const [campaigns, notifications] = await Promise.all([
        tx.campaign.findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } }),
        tx.notification.findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } }),
      ]);
      const referenced = new Set([...campaigns, ...notifications].flatMap(row => {
        const name = managedImageName(row.imageUrl);
        return name ? [pattern.exec(name)![1]] : [];
      }));
      const candidates = await tx.campaignImageAsset.findMany({ orderBy: { lastUsedAt: 'asc' }, where: { lastUsedAt: { lt: new Date(Date.now() - graceMs) } } });
      const assets = candidates.filter(asset => {
        const name = managedImageName(asset.canonicalUrl);
        return name && !referenced.has(pattern.exec(name)![1]);
      }).slice(0, 10);
      const s3 = assets.some(a => a.bucket) ? await campaignS3() : null;
      let removed = 0;
      for (const asset of assets) {
        const name = managedImageName(asset.canonicalUrl);
        if (!name || referenced.has(pattern.exec(name)![1])) continue;
        if (asset.bucket) {
          if (!s3 || s3.bucket !== asset.bucket) { console.warn('[CampaignImage] Cleanup skipped: bucket configuration changed'); continue; }
          for (const variant of ['detail', 'notification', 'thumbnail']) {
            await s3.remove(asset.objectKey.replace(/-detail\.jpg$/, `-${variant}.jpg`));
            removed++;
          }
          await tx.campaignImageAsset.delete({ where: { canonicalUrl: asset.canonicalUrl } });
        }
      }
      let files: string[];
      try { files = await fs.readdir(folder()); }
      catch (error: any) { if (error.code === 'ENOENT') return removed; throw error; }
      for (const name of files) {
        const match = pattern.exec(name);
        if (!match || referenced.has(match[1])) continue;
        const target = path.join(folder(), name);
        if (Date.now() - (await fs.stat(target)).mtimeMs < graceMs) continue;
        await fs.unlink(target);
        removed++;
      }
      for (const asset of assets.filter(a => !a.bucket)) {
        const name = managedImageName(asset.canonicalUrl)!;
        const remaining = await Promise.all(['detail', 'notification', 'thumbnail'].map(async variant => {
          try { await fs.access(path.join(folder(), name.replace(/-detail\.jpg$/, `-${variant}.jpg`))); return true; }
          catch (error: any) { if (error.code === 'ENOENT') return false; throw error; }
        }));
        if (!remaining.some(Boolean)) await tx.campaignImageAsset.delete({ where: { canonicalUrl: asset.canonicalUrl } });
      }
      console.info('[CampaignImage] Cleanup complete', { removed });
      return removed;
    });
  },
};
