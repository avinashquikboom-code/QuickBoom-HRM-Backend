import cron from 'node-cron';
import { prisma } from '../utils/db';
import { Audience, localDate } from './campaignPolicy';
import { campaignSummary, deliverRecipient, queueCampaign, resolveRecipients } from './campaignService';

let started = false;
let running = false;
export async function runCampaignTick() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const automatic = await prisma.campaign.findMany({ where: { status: 'AUTOMATIC', companyId: null }, take: 100 });
    for (const template of automatic) {
      try {
        const a = template.audienceCriteria as unknown as Audience;
        const date = localDate(now, a.timezone);
        // One occurrence per template/local date, enforced across processes by the DB unique key.
        const key = `birthday:${template.id}:${date}`;
        if (await prisma.campaign.findUnique({ where: { dedupeKey: key } })) continue;
        const recipients = await resolveRecipients(template.createdById!, template.audienceType, a, date, true);
        await prisma.$transaction(async tx => {
          // Cancellation and occurrence creation serialize on the template row.
          const enabled = await tx.campaign.updateMany({ where: { id: template.id, status: 'AUTOMATIC' }, data: { updatedAt: now } });
          if (!enabled.count) return;
          const c = await tx.campaign.create({ data: { title: template.title, message: template.message, notificationType: template.notificationType, imageUrl: template.imageUrl, actionUrl: template.actionUrl, audienceType: template.audienceType, audienceCriteria: { ...a, automaticBirthday: false }, createdById: template.createdById, dedupeKey: key, status: recipients.length ? 'QUEUED' : 'COMPLETED', totalRecipients: recipients.length } });
          for (let i = 0; i < recipients.length; i += 1000) {
            await tx.campaignRecipient.createMany({ data: recipients.slice(i, i + 1000).map(e => ({ campaignId: c.id, employeeId: e.id, userId: e.userId })), skipDuplicates: true });
          }
        });
      } catch (error: any) { if (error?.code !== 'P2002') console.warn('Automatic birthday occurrence could not be queued', { campaignId: template.id }); }
    }
    const due = await prisma.campaign.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now }, companyId: null }, take: 20 });
    for (const c of due) {
      try { await queueCampaign(c.id, c.createdById!, true); }
      catch (error: any) {
        if (error?.status !== 409) await prisma.campaign.updateMany({ where: { id: c.id, status: 'SCHEDULED' }, data: { status: error?.status === 400 || error?.status === 403 ? 'BLOCKED' : 'SCHEDULED' } });
      }
    }
    const stale = new Date(now.getTime() - 15 * 60_000);
    const campaigns = await prisma.campaign.findMany({ where: { companyId: null, status: { in: ['QUEUED', 'PROCESSING'] }, OR: [{ lockedAt: null }, { updatedAt: { lt: stale } }] }, take: 10, orderBy: { createdAt: 'asc' } });
    for (const c of campaigns) {
      const lock = new Date();
      const claimed = await prisma.campaign.updateMany({ where: { id: c.id, status: { in: ['QUEUED', 'PROCESSING'] }, OR: [{ lockedAt: null }, { updatedAt: { lt: stale } }] }, data: { status: 'PROCESSING', lockedAt: lock } });
      if (!claimed.count) continue;
      try {
        // Recovery preserves token states; ambiguous FCM attempts are never resent.
        await prisma.campaignRecipient.updateMany({ where: { campaignId: c.id, deliveryStatus: 'SENDING', updatedAt: { lt: stale } }, data: { deliveryStatus: 'PENDING' } });
        const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId: c.id, deliveryStatus: { in: ['PENDING', 'RETRY'] } }, take: 50, orderBy: { createdAt: 'asc' } });
        for (const r of recipients) {
          const claim = await prisma.campaignRecipient.updateMany({ where: { id: r.id, deliveryStatus: { in: ['PENDING', 'RETRY'] } }, data: { deliveryStatus: 'SENDING' } });
          if (!claim.count) continue;
          try { await deliverRecipient(c, r); }
          catch (error: any) {
            await prisma.campaignRecipient.update({ where: { id: r.id }, data: { deliveryStatus: error?.status === 403 ? 'SKIPPED' : 'UNKNOWN', failureReason: 'Delivery interrupted; review before taking further action' } });
          }
          await prisma.campaign.updateMany({ where: { id: c.id, lockedAt: lock }, data: { updatedAt: new Date() } });
        }
        const summary = await campaignSummary(c.id);
        const pending = (summary.states.PENDING || 0) + (summary.states.RETRY || 0) + (summary.states.SENDING || 0);
        const failed = (summary.states.FAILED || 0) + (summary.states.PARTIAL || 0) + (summary.states.UNKNOWN || 0) + (summary.states.SKIPPED || 0);
        await prisma.campaign.updateMany({ where: { id: c.id, lockedAt: lock }, data: { status: pending ? 'QUEUED' : failed ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED', lockedAt: null, sentAt: pending ? null : new Date(), sentCount: summary.states.SENT || 0, failedCount: failed, readCount: summary.readCount } });
      } catch { await prisma.campaign.updateMany({ where: { id: c.id, lockedAt: lock }, data: { lockedAt: null, status: 'QUEUED' } }); }
    }
  } finally { running = false; }
}
export function initCampaignCron() {
  if (started) return;
  started = true;
  cron.schedule('* * * * *', () => { void runCampaignTick().catch(() => console.warn('Campaign worker failed; queued work remains persisted')); });
}
