import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { extractWebhookMeta, normalizeEventType } from '../utils/commissionHelper';

/**
 * GET /api/admin/activity-logs
 * Centralized Audit / Activity Logs API supporting search, multi-filters, pagination,
 * and seamless aggregation of ActivityLog and WebhookLog entries.
 */
export async function getActivityLogs(req: Request, res: Response): Promise<void> {
  try {
    const {
      search,
      source,
      role,
      action,
      entityType,
      status,
      fromDate,
      toDate,
      page = '1',
      limit = '20'
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // 1. Build ActivityLog where clause
    const where: any = {};

    if (source && String(source).toUpperCase() !== 'ALL') {
      const srcUpper = String(source).toUpperCase();
      if (srcUpper === 'ADMIN_PANEL') {
        where.source = { in: ['ADMIN_PANEL', 'SUPER_ADMIN', 'HR_ADMIN'] };
      } else {
        where.source = { equals: srcUpper, mode: 'insensitive' };
      }
    }

    if (role && String(role).toUpperCase() !== 'ALL') {
      where.actorRole = { equals: String(role).toUpperCase(), mode: 'insensitive' };
    }

    if (action && String(action).toUpperCase() !== 'ALL') {
      where.action = { equals: String(action).toUpperCase(), mode: 'insensitive' };
    }

    if (entityType && String(entityType).toUpperCase() !== 'ALL') {
      where.entityType = { equals: String(entityType), mode: 'insensitive' };
    }

    if (status && String(status).toUpperCase() !== 'ALL') {
      where.status = { equals: String(status).toUpperCase(), mode: 'insensitive' };
    }

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(String(fromDate));
      if (toDate) where.createdAt.lte = new Date(String(toDate));
    }

    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.OR = [
        { actorName: { contains: q, mode: 'insensitive' } },
        { action: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { entityType: { contains: q, mode: 'insensitive' } },
        { entityId: { contains: q, mode: 'insensitive' } },
        { metadata: { contains: q, mode: 'insensitive' } },
      ];
    }

    // 2. Fetch ActivityLogs from DB
    const [activityLogs, totalActivityLogs] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.activityLog.count({ where })
    ]);

    // 3. Fetch Hopkid Webhook Logs for aggregation if source filter permits
    let webhookMappedLogs: any[] = [];
    const sourceUpper = source ? String(source).toUpperCase() : 'ALL';

    if (sourceUpper === 'ALL' || sourceUpper === 'HOPKID_WEBHOOK' || sourceUpper === 'HOPKID WEBHOOK') {
      try {
        const webhookWhere: any = {};
        if (fromDate || toDate) {
          webhookWhere.createdAt = {};
          if (fromDate) webhookWhere.createdAt.gte = new Date(String(fromDate));
          if (toDate) webhookWhere.createdAt.lte = new Date(String(toDate));
        }

        const rawWebhookLogs = await prisma.webhookLog.findMany({
          where: webhookWhere,
          orderBy: { createdAt: 'desc' },
          take: limitNum,
        });

        webhookMappedLogs = rawWebhookLogs.map((log) => {
          const meta = extractWebhookMeta(log.payload);
          const normAction = normalizeEventType(log.eventType || meta.eventType, 'INVOICE_CREATED', log.payload);

          return {
            id: `wh-${log.id}`,
            actorId: null,
            actorName: meta.customerName || meta.firstItem?.employeeName || 'HopKid ERP System',
            actorRole: 'HOPKID_SYSTEM',
            source: 'HOPKID_WEBHOOK',
            action: normAction,
            entityType: normAction.includes('INVOICE') ? 'Invoice' : normAction.includes('CREDIT') ? 'Credit Note' : normAction.includes('EXCHANGE') ? 'Sales Exchange' : 'Employee',
            entityId: log.billId || meta.billId || meta.invoiceNumber || 'N/A',
            description: `HopKid Webhook ${normAction} event processed (Bill ID: ${log.billId || meta.billId || 'N/A'})`,
            metadata: log.payload,
            ipAddress: null,
            userAgent: 'HopKid Webhook Gateway',
            status: log.status || 'SUCCESS',
            createdAt: log.createdAt,
          };
        });
      } catch (whErr: any) {
        console.warn('[getActivityLogs] Webhook aggregation notice:', whErr.message);
      }
    }

    // Combine and sort by createdAt descending
    const combined = [...activityLogs, ...webhookMappedLogs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Apply pagination to combined result
    const paginatedLogs = combined.slice(0, limitNum);
    const totalCount = totalActivityLogs + webhookMappedLogs.length;
    const totalPages = Math.ceil(totalCount / limitNum);

    res.json({
      success: true,
      data: paginatedLogs,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages
      }
    });
  } catch (error: any) {
    console.error('[getActivityLogs Error]:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve activity logs.',
      error: error.message
    });
  }
}
