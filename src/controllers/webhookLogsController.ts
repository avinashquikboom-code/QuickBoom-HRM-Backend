import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { Role } from '@prisma/client';
import { extractWebhookMeta } from '../utils/commissionHelper';

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
    let logs: any[] = [];
    let total = 0;

    try {
      logs = await prisma.webhookLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
      total = logs.length;
    } catch (e) {
      total = 0;
    }

    // Fallback: If WebhookLog has no records, fetch from HopkidWebhookLog
    if (total === 0 && !status && !eventType) {
      const hopkidLogs = await prisma.hopkidWebhookLog.findMany({
        orderBy: { createdAt: 'desc' },
      });

      total = hopkidLogs.length;

      const mappedLogs = hopkidLogs.map((log) => {
        const meta = extractWebhookMeta(log.rawPayload);
        const amountVal = log.amount !== null && log.amount !== undefined ? log.amount : meta.amount;
        const billIdVal = log.billId || meta.billId;

        return {
          id: log.id,
          eventType: meta.eventType || 'INVOICE_CREATED',
          status: 'SUCCESS',
          payload: log.rawPayload,
          employeeId: null,
          amount: amountVal || 0,
          billId: billIdVal || null,
          customerName: meta.customerName || log.name || 'N/A',
          employeeName: meta.employeeName || meta.employeeIdentifier || 'N/A',
          commissionAmount: meta.commissionAmount || 0,
          errorMessage: null,
          processedAt: log.createdAt,
          createdAt: log.createdAt,
        };
      });

      const paginatedLogs = mappedLogs.slice(offsetNum, offsetNum + limitNum);

      res.json({
        success: true,
        data: paginatedLogs,
        pagination: {
          total,
          limit: limitNum,
          offset: offsetNum,
        },
      });
      return;
    }

    const mappedLogs = logs.map((log) => {
      const meta = extractWebhookMeta(log.payload);
      const amountVal = log.amount !== null && log.amount !== undefined ? log.amount : meta.amount;
      const billIdVal = log.billId || meta.billId;

      return {
        ...log,
        amount: amountVal || 0,
        billId: billIdVal || null,
        customerName: meta.customerName || 'N/A',
        employeeName: meta.employeeName || meta.employeeIdentifier || 'N/A',
        commissionAmount: meta.commissionAmount || 0,
        eventType: log.eventType || meta.eventType || 'INVOICE_CREATED',
      };
    });

    const paginatedLogs = mappedLogs.slice(offsetNum, offsetNum + limitNum);

    res.json({
      success: true,
      data: paginatedLogs,
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
    let total = 0;
    let success = 0;
    let failed = 0;
    let processing = 0;
    let sumAmount = 0;

    let webhookLogs: any[] = [];
    try {
      webhookLogs = await prisma.webhookLog.findMany();
      total = webhookLogs.length;
    } catch (e) {
      total = 0;
    }

    if (total > 0) {
      success = webhookLogs.filter((l) => l.status === 'SUCCESS').length;
      failed = webhookLogs.filter((l) => l.status === 'FAILED').length;
      processing = webhookLogs.filter((l) => l.status === 'PROCESSING').length;

      sumAmount = webhookLogs.reduce((acc, log) => {
        let amt = log.amount;
        if (amt === null || amt === undefined) {
          const meta = extractWebhookMeta(log.payload);
          amt = meta.amount;
        }
        return acc + (isNaN(amt) ? 0 : amt);
      }, 0);
    } else {
      const hopkidLogs = await prisma.hopkidWebhookLog.findMany();
      total = hopkidLogs.length;
      success = total;
      failed = 0;
      processing = 0;

      sumAmount = hopkidLogs.reduce((acc, log) => {
        let amt = log.amount;
        if (amt === null || amt === undefined) {
          const meta = extractWebhookMeta(log.rawPayload);
          amt = meta.amount;
        }
        return acc + (isNaN(amt) ? 0 : amt);
      }, 0);
    }

    const successRate = total > 0 ? ((success / total) * 100).toFixed(2) + '%' : '100%';

    res.json({
      success: true,
      data: {
        total,
        success,
        failed,
        processing,
        successRate,
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
        const meta = extractWebhookMeta(hopkidLog.rawPayload);
        log = {
          id: hopkidLog.id,
          eventType: meta.eventType || 'INVOICE_CREATED',
          status: 'SUCCESS',
          payload: hopkidLog.rawPayload,
          employeeId: null,
          amount: hopkidLog.amount ?? meta.amount,
          billId: hopkidLog.billId || meta.billId,
          errorMessage: null,
          processedAt: hopkidLog.createdAt,
          createdAt: hopkidLog.createdAt,
        };
      }
    } else {
      const meta = extractWebhookMeta(log.payload);
      log = {
        ...log,
        amount: log.amount ?? meta.amount,
        billId: log.billId || meta.billId,
        eventType: log.eventType || meta.eventType,
      };
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
