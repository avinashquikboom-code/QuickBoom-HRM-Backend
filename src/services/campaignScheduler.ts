import cron from 'node-cron';
import { campaignImages } from './campaignImageService';
import { prisma } from '../utils/db';
import { campaignService } from './campaignService';
import { localDate } from './campaignPolicy';

let cronStarted = false;
let tickRunning = false;

export async function runCampaignTick() {
  if (tickRunning) return;
  tickRunning = true;

  try {
    const now = new Date();

    // 1. Recover stale locked campaigns (stuck in SENDING for over 15 minutes)
    const staleTime = new Date(now.getTime() - 15 * 60 * 1000);
    await prisma.campaign.updateMany({
      where: {
        status: 'SENDING',
        lockedAt: { lt: staleTime },
      },
      data: {
        status: 'DELIVERY_UNKNOWN',
        lockedAt: null,
      },
    });

    // 2. Dispatch due scheduled campaigns
    const dueCampaigns = await prisma.campaign.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: now },
      },
      take: 10,
      orderBy: { scheduledAt: 'asc' },
    });

    for (const campaign of dueCampaigns) {
      try {
        console.log(`⏰ [CampaignCron] Dispatching scheduled campaign "${campaign.title}" (${campaign.id})`);
        await campaignService.sendCampaign(campaign.id);
      } catch (err) {
        console.error(`❌ [CampaignCron] Failed to dispatch scheduled campaign ${campaign.id}:`, err);
      }
    }

    // 3. Process automatic daily birthday greetings templates
    const autoTemplates = await prisma.campaign.findMany({
      where: {
        status: 'AUTOMATIC',
        notificationType: 'BIRTHDAY',
      },
      take: 20,
    });

    for (const template of autoTemplates) {
      try {
        const criteria = (template.audienceCriteria as any) || {};
        const tz = criteria.timezone || 'Asia/Kolkata';
        const todayStr = localDate(now, tz);
        const dedupeKey = `birthday:${template.id}:${todayStr}`;

        const alreadyTriggered = await prisma.campaign.findUnique({
          where: { dedupeKey },
        });
        if (alreadyTriggered) continue;

        const birthdays = await campaignService.getTodayBirthdays({ timezone: tz });
        if (birthdays.length === 0) continue;

        // Create occurrence for today
        const occurrence = await prisma.campaign.create({
          data: {
            title: template.title,
            message: template.message,
            notificationType: 'BIRTHDAY',
            imageUrl: template.imageUrl,
            actionUrl: template.actionUrl,
            audienceType: template.audienceType,
            audienceCriteria: criteria,
            createdById: template.createdById,
            createdBy: 'Automatic Daily Birthday System',
            status: 'DRAFT',
            dedupeKey,
          },
        });

        await campaignService.sendCampaign(occurrence.id);
      } catch (autoErr) {
        console.error(`❌ [CampaignCron] Automatic birthday error for template ${template.id}:`, autoErr);
      }
    }
  } catch (globalErr) {
    console.error('❌ [CampaignCron] Tick execution error:', globalErr);
  } finally {
    tickRunning = false;
  }
}

export function initCampaignCron() {
  if (cronStarted) return;
  cronStarted = true;
  console.log('⏰ [CampaignCron] Initializing 1-minute campaign scheduler...');
  cron.schedule('17 * * * *', () => {
    void campaignImages.cleanup().catch(error => console.error('[CampaignImage] Cleanup failed', { code: error?.code }));
  });
  cron.schedule('* * * * *', () => {
    void runCampaignTick().catch(err => {
      console.warn('⚠️ [CampaignCron] Background tick failed:', err);
    });
  });
}
