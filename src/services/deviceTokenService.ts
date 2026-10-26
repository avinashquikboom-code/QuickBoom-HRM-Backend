import { prisma } from '../utils/db';

/** Keep legacy and current token stores in agreement when an account changes. */
export async function registerDeviceToken(userId: number, token: string, platform = 'unknown', previousToken?: string) {
  if (typeof token !== 'string' || !token.trim() || token.length > 4096) throw new Error('Invalid FCM token');
  return prisma.$transaction(async tx => {
    // All registration endpoints serialize ownership transfers for the same token.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${token})::bigint)`;
    const device = await tx.device.upsert({
      where: { fcmToken: token },
      update: { userId, platform, updatedAt: new Date() },
      create: { userId, fcmToken: token, platform },
    });
    await tx.fCMToken.updateMany({ where: { token, userId: { not: userId } }, data: { isActive: false } });
    await tx.fCMToken.upsert({
      where: { userId_token: { userId, token } },
      update: { isActive: true, platform, lastUsedAt: new Date() },
      create: { userId, token, platform },
    });
    if (typeof previousToken === 'string' && previousToken !== token && previousToken.length <= 4096) {
      await tx.device.deleteMany({ where: { fcmToken: previousToken, userId } });
      await tx.fCMToken.updateMany({ where: { token: previousToken, userId }, data: { isActive: false } });
    }
    return device;
  });
}
