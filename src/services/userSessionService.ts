import { prisma } from '../utils/db';
import { verifyRefreshToken, signAccessToken, signRefreshToken, UserJWTPayload } from '../utils/jwt';

class UserSessionService {
  /**
   * Create a new session for a user login
   */
  async createSession(userId: string, token: string, deviceInfo?: string, ipAddress?: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    return prisma.userSession.create({
      data: {
        userId,
        token,
        deviceInfo,
        ipAddress,
        expiresAt,
        isActive: true,
      },
    });
  }

  /**
   * Rotate a refresh token
   * Old token is invalidated, new token pair is generated and saved as a new session
   */
  async rotateToken(oldToken: string, deviceInfo?: string, ipAddress?: string): Promise<{ accessToken: string; refreshToken: string; payload: UserJWTPayload } | null> {
    try {
      // 1. Verify old refresh token
      const payload = verifyRefreshToken(oldToken);
      
      // 2. Find active session
      const session = await prisma.userSession.findUnique({
        where: { token: oldToken },
      });

      if (!session || !session.isActive || session.expiresAt < new Date()) {
        // Token reuse or expired session: revoke all sessions for security (GDPR/Compliance standard)
        if (session) {
          await this.revokeAllSessions(session.userId);
        }
        return null;
      }

      // 3. Invalidate old session
      await prisma.userSession.update({
        where: { id: session.id },
        data: { isActive: false },
      });

      // 4. Generate new tokens
      const newPayload: UserJWTPayload = {
        id: payload.id,
        email: payload.email,
        role: payload.role,
      };
      const newAccessToken = signAccessToken(newPayload);
      const newRefreshToken = signRefreshToken(newPayload);

      // 5. Create new session
      await this.createSession(payload.id, newRefreshToken, deviceInfo || session.deviceInfo || undefined, ipAddress || session.ipAddress || undefined);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        payload: newPayload,
      };
    } catch (error) {
      console.error('Refresh token rotation failed:', error);
      return null;
    }
  }

  /**
   * Revoke a single session by token
   */
  async revokeSession(token: string) {
    return prisma.userSession.updateMany({
      where: { token },
      data: { isActive: false },
    });
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllSessions(userId: string) {
    return prisma.userSession.updateMany({
      where: { userId },
      data: { isActive: false },
    });
  }

  /**
   * Get active sessions for a user
   */
  async getActiveSessions(userId: string) {
    return prisma.userSession.findMany({
      where: {
        userId,
        isActive: true,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export default new UserSessionService();
