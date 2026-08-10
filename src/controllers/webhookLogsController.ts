import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { Role } from '@prisma/client';

const router = Router();

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.HR];
const SUPERADMIN_ROLES = [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN];

/**
 * GET /api/webhook/logs
 * 
 * Returns all webhook logs with filtering (or returns HopkidWebhookLogs if WebhookLog table is empty)
 */
router.get('/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, eventType, limit = '100', offset = '0' } = req.query;

    const limitNum = parseInt(limit as string, 10) || 100;
    const offsetNum = parseInt(offset as string, 10) || 0;

    // Build filter for WebhookLog
    const where: any = {};
    if (status) where.status = status;
    if (eventType) where.eventType = eventType;

    // Fetch logs from WebhookLog
    let logs = await prisma.webhookLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      skip: offsetNum,
    });

    let total = await prisma.webhookLog.count({ where });

    // Fallback: If WebhookLog has no records, fetch from HopkidWebhookLog
    if (total === 0 && !status && !eventType) {
      const hopkidLogs = await prisma.hopkidWebhookLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip: offsetNum,
      });

      total = await prisma.hopkidWebhookLog.count();

      const mappedLogs = hopkidLogs.map((log) => ({
        id: log.id,
        eventType: 'COMMISSION',
        status: 'SUCCESS',
        payload: log.rawPayload,
        employeeId: null,
        amount: log.amount,
        billId: log.billId,
        errorMessage: null,
        processedAt: log.createdAt,
        createdAt: log.createdAt,
      }));

      res.json({
        success: true,
        data: mappedLogs,
        pagination: {
          total,
          limit: limitNum,
          offset: offsetNum,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
      },
    });
  } catch (error: any) {
    console.error('Fetch webhook logs error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch webhook logs' });
  }
});

/**
 * GET /api/webhook/stats
 * 
 * Returns webhook stats (success, failed, total)
 */
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    let total = await prisma.webhookLog.count();
    let success = await prisma.webhookLog.count({ where: { status: 'SUCCESS' } });
    let failed = await prisma.webhookLog.count({ where: { status: 'FAILED' } });
    let processing = await prisma.webhookLog.count({ where: { status: 'PROCESSING' } });

    let totalAmount = await prisma.webhookLog.aggregate({
      where: { amount: { not: null } },
      _sum: { amount: true },
    });

    // Fallback to HopkidWebhookLog if WebhookLog is empty
    if (total === 0) {
      total = await prisma.hopkidWebhookLog.count();
      success = total;
      const hopkidTotalAmount = await prisma.hopkidWebhookLog.aggregate({
        where: { amount: { not: null } },
        _sum: { amount: true },
      });
      totalAmount = hopkidTotalAmount;
    }

    const sumAmount = totalAmount._sum?.amount || 0;

    res.json({
      success: true,
      data: {
        total,
        success,
        failed,
        processing,
        successRate: total > 0 ? ((success / total) * 100).toFixed(2) + '%' : '100%',
        totalAmount: sumAmount,
      },
    });
  } catch (error: any) {
    console.error('Fetch webhook stats error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch webhook stats' });
  }
});

/**
 * GET /api/webhook/logs/:id
 * 
 * Returns single webhook log detail
 */
router.get('/logs/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    let log: any = await prisma.webhookLog.findUnique({
      where: { id: id as string },
    });

    if (!log) {
      const hopkidLog = await prisma.hopkidWebhookLog.findUnique({
        where: { id: id as string },
      });

      if (hopkidLog) {
        log = {
          id: hopkidLog.id,
          eventType: 'COMMISSION',
          status: 'SUCCESS',
          payload: hopkidLog.rawPayload,
          employeeId: null,
          amount: hopkidLog.amount,
          billId: hopkidLog.billId,
          errorMessage: null,
          processedAt: hopkidLog.createdAt,
          createdAt: hopkidLog.createdAt,
        };
      }
    }

    if (!log) {
      res.status(404).json({ success: false, message: 'Log not found' });
      return;
    }

    res.json({ success: true, data: log });
  } catch (error: any) {
    console.error('Fetch webhook log detail error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch webhook log detail' });
  }
});

/**
 * DELETE /api/webhook/logs/:id
 * 
 * Delete a webhook log
 */
router.delete('/logs/:id', authMiddleware, roleMiddleware(SUPERADMIN_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.webhookLog.delete({
      where: { id: id as string },
    }).catch(() => {
      return prisma.hopkidWebhookLog.delete({
        where: { id: id as string },
      });
    });

    res.json({ success: true, message: 'Log deleted' });
  } catch (error: any) {
    console.error('Delete webhook log error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete webhook log' });
  }
});

/**
 * POST /api/webhook/logs/clear
 * 
 * Clear old webhook logs (older than X days)
 */
router.post('/logs/clear', authMiddleware, roleMiddleware(SUPERADMIN_ROLES), async (req: Request, res: Response): Promise<void> => {
  try {
    const daysOld = parseInt(req.body?.daysOld || '30', 10);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const [wRes, hRes] = await Promise.allSettled([
      prisma.webhookLog.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      }),
      prisma.hopkidWebhookLog.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      }),
    ]);

    const count1 = wRes.status === 'fulfilled' ? wRes.value.count : 0;
    const count2 = hRes.status === 'fulfilled' ? hRes.value.count : 0;

    res.json({ 
      success: true, 
      message: `Deleted ${count1 + count2} logs older than ${daysOld} days` 
    });
  } catch (error: any) {
    console.error('Clear webhook logs error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to clear webhook logs' });
  }
});

export default router;
