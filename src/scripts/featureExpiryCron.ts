import cron from 'node-cron';
import { prisma } from '../utils/db';
import { sendPushNotification } from '../utils/pushNotifications';

export const initFeatureExpiryCron = () => {
  // Run daily at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('Running feature expiry cron job...');
    try {
      const now = new Date();
      // Find features that have a validToDate less than now and are still enabled
      const expiredFeatures = await prisma.featureAccess.findMany({
        where: {
          isEnabled: true,
          validToDate: {
            lt: now
          }
        },
        include: {
          employee: true
        }
      });

      if (expiredFeatures.length === 0) {
        console.log('No features to expire.');
        return;
      }

      for (const feature of expiredFeatures) {
        // Disable feature
        await prisma.featureAccess.update({
          where: { id: feature.id },
          data: {
            isEnabled: false,
            reason: `Auto-expired on ${now.toISOString().split('T')[0]}`
          }
        });

        // Notify employee
        if (feature.employee?.userId) {
          await sendPushNotification(
            feature.employee.userId,
            'Feature Access Expired',
            `Your access to ${feature.featureName} has expired.`
          );
        }
      }

      console.log(`Successfully expired ${expiredFeatures.length} features.`);
    } catch (error) {
      console.error('Error running feature expiry cron job:', error);
    }
  });
};
