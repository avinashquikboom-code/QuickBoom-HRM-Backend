import cron from 'node-cron';
import { prisma } from '../utils/db';
import campaignService from './campaignService';

/**
 * Scheduled campaigns job: runs every minute to process due campaigns
 */
export async function processScheduledCampaignsJob() {
  try {
    const dueCampaigns = await prisma.campaign.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: {
          lte: new Date(),
        },
      },
    });

    if (dueCampaigns.length > 0) {
      console.log(`⏰ [CampaignScheduler] Found ${dueCampaigns.length} scheduled campaign(s) due for dispatch.`);

      for (const campaign of dueCampaigns) {
        try {
          console.log(`🚀 [CampaignScheduler] Dispatching scheduled campaign "${campaign.title}" (${campaign.id})`);
          await campaignService.sendCampaign(campaign.id, 'Background Cron Scheduler');
        } catch (err) {
          console.error(`❌ [CampaignScheduler] Failed to dispatch campaign ${campaign.id}:`, err);
        }
      }
    }
  } catch (error) {
    console.error('❌ [CampaignScheduler] Error polling scheduled campaigns:', error);
  }
}

/**
 * Daily Birthday Greeting job: runs once a day at 9:00 AM (configured timezone)
 */
export async function processDailyBirthdayJob() {
  try {
    console.log('🎂 [BirthdayScheduler] Running daily birthday notification job...');
    const result = await campaignService.sendBirthdayWishes({
      timezone: 'Asia/Kolkata',
    });
    console.log('🎂 [BirthdayScheduler] Completed daily birthday check:', result.message);
  } catch (error) {
    console.error('❌ [BirthdayScheduler] Error processing daily birthdays:', error);
  }
}

/**
 * Initialize Campaign & Birthday Cron Jobs
 */
export function initCampaignCron() {
  // Check every minute for scheduled campaigns
  cron.schedule('* * * * *', async () => {
    await processScheduledCampaignsJob();
  });
  console.log('✅ [CampaignCron] Scheduled campaigns processor initialized (every minute)');

  // Run every morning at 09:00 AM for birthday wishes
  cron.schedule('0 9 * * *', async () => {
    await processDailyBirthdayJob();
  });
  console.log('✅ [CampaignCron] Birthday greeting job initialized (daily at 09:00 AM)');
}
