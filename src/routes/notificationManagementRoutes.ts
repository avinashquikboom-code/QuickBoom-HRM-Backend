import express, { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware';
import { executeRuleManually } from '../services/notificationRuleScheduler';

const router = express.Router();

// Middleware to ensure only authorized roles can access management endpoints
const managementAuth = [authenticateToken, requireRole(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'])];

/**
 * Seed standard default HRM notification rules & templates if none exist
 */
export async function ensureDefaultNotificationRules(): Promise<void> {
  try {
    const count = await prisma.notificationRule.count();
    if (count > 0) return;

    const defaultRules = [
      {
        event: 'EMPLOYEE_BIRTHDAY',
        category: 'GREETINGS',
        recipients: ['ALL_EMPLOYEES', 'MANAGERS'],
        inApp: true,
        push: true,
        status: 'ACTIVE',
        template: {
          title: '🎂 Happy Birthday {firstName}!',
          message: 'Wishing you a very Happy Birthday and a wonderful year ahead from all of us at Hopkid!',
          channel: 'ALL',
        }
      },
      {
        event: 'WORK_ANNIVERSARY',
        category: 'GREETINGS',
        recipients: ['ALL_EMPLOYEES', 'MANAGERS'],
        inApp: true,
        push: true,
        status: 'ACTIVE',
        template: {
          title: '🎉 Happy Work Anniversary {firstName}!',
          message: 'Congratulations on completing another milestone year with the team! Thank you for your dedication.',
          channel: 'ALL',
        }
      },
      {
        event: 'UPCOMING_HOLIDAY',
        category: 'HOLIDAY',
        recipients: ['ALL_EMPLOYEES'],
        inApp: true,
        push: true,
        status: 'ACTIVE',
        template: {
          title: '🌴 Upcoming Holiday: {holidayName}',
          message: 'Offices will be closed on {holidayDate} in celebration of {holidayName}. Enjoy your time off!',
          channel: 'PUSH',
        }
      },
      {
        event: 'COMPANY_ANNOUNCEMENT',
        category: 'ANNOUNCEMENT',
        recipients: ['ALL_EMPLOYEES'],
        inApp: true,
        push: true,
        status: 'ACTIVE',
        template: {
          title: '📢 Company Announcement',
          message: '{title}: {message}',
          channel: 'ALL',
        }
      },
      {
        event: 'LEAVE_REQUEST',
        category: 'LEAVE',
        recipients: ['MANAGERS', 'HR'],
        inApp: true,
        push: true,
        status: 'ACTIVE',
        template: {
          title: '📝 Leave Application: {employeeName}',
          message: '{employeeName} has applied for {type} leave from {fromDate} to {toDate}.',
          channel: 'ALL',
        }
      },
      {
        event: 'LEAVE_STATUS_CHANGED',
        category: 'LEAVE',
        recipients: ['EMPLOYEE'],
        inApp: true,
        push: true,
        status: 'ACTIVE',
        template: {
          title: 'Leave Request {status}',
          message: 'Your leave application for {fromDate} to {toDate} has been {status}.',
          channel: 'ALL',
        }
      },
      {
        event: 'PAYSLIP_RELEASED',
        category: 'PAYROLL',
        recipients: ['EMPLOYEE'],
        inApp: true,
        push: true,
        status: 'ACTIVE',
        template: {
          title: '💰 Payslip Available for {monthYear}',
          message: 'Your monthly salary payslip for {monthYear} is now available in your Employee Portal.',
          channel: 'PUSH',
        }
      }
    ];

    for (const item of defaultRules) {
      await prisma.notificationRule.upsert({
        where: { event: item.event },
        update: {},
        create: {
          event: item.event,
          category: item.category,
          recipients: item.recipients,
          inApp: item.inApp,
          push: item.push,
          status: item.status,
        }
      });

      await prisma.notificationTemplate.upsert({
        where: { event: item.event },
        update: {},
        create: {
          event: item.event,
          channel: item.template.channel,
          language: 'English',
          title: item.template.title,
          message: item.template.message,
          status: 'ACTIVE'
        }
      });
    }
    console.log('✅ [NotificationManagement] Seeded default notification rules & templates.');
  } catch (error) {
    console.warn('⚠️ [NotificationManagement] Default rules seeding notice:', error);
  }
}

// ----------------------------------------------------
// NOTIFICATION STATS
// ----------------------------------------------------
router.get('/stats', managementAuth, async (req: Request, res: Response) => {
  try {
    const [total, unread, sentCount, failedCount] = await Promise.all([
      prisma.notification.count(),
      prisma.notification.count({ where: { isRead: false } }),
      prisma.notification.count({ where: { deliveryStatus: 'SENT' } }),
      prisma.notification.count({ where: { deliveryStatus: 'FAILED' } }),
    ]);

    // Push Sent count is derived from actual sent deliveries
    res.json({
      total,
      unread,
      pushSent: sentCount,
      failed: failedCount
    });
  } catch (error) {
    console.error('Failed to fetch notification stats:', error);
    res.status(500).json({ error: 'Failed to fetch notification stats' });
  }
});

// ----------------------------------------------------
// NOTIFICATION RULES
// ----------------------------------------------------

// GET all rules (auto-seeds defaults if empty)
router.get('/rules', managementAuth, async (req: Request, res: Response) => {
  try {
    await ensureDefaultNotificationRules();

    const [rules, templates] = await Promise.all([
      prisma.notificationRule.findMany({
        orderBy: { createdAt: 'desc' }
      }),
      prisma.notificationTemplate.findMany()
    ]);

    const templateMap = new Map<string, typeof templates[0]>();
    for (const t of templates) {
      templateMap.set(t.event, t);
    }

    const rulesWithTemplates = rules.map(r => {
      const tmpl = templateMap.get(r.event);
      return {
        ...r,
        title: tmpl?.title || r.event,
        message: tmpl?.message || '',
        template: tmpl || null
      };
    });

    res.json(rulesWithTemplates);
  } catch (error) {
    console.error('Failed to fetch notification rules:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// POST create rule
router.post('/rules', managementAuth, async (req: Request, res: Response) => {
  try {
    const { event, category, recipients, inApp, push, status, title, message } = req.body;

    if (!event || !category) {
      res.status(400).json({ error: 'Event and category are required' });
      return;
    }

    const normalizedRecipients = Array.isArray(recipients) ? recipients : ['ALL_EMPLOYEES'];

    const rule = await prisma.notificationRule.upsert({
      where: { event: String(event).toUpperCase().trim() },
      update: {
        category,
        recipients: normalizedRecipients,
        inApp: inApp ?? true,
        push: push ?? true,
        status: status || 'ACTIVE'
      },
      create: {
        event: String(event).toUpperCase().trim(),
        category,
        recipients: normalizedRecipients,
        inApp: inApp ?? true,
        push: push ?? true,
        status: status || 'ACTIVE'
      }
    });

    // Create or update template if title or message provided
    if (title || message) {
      await prisma.notificationTemplate.upsert({
        where: { event: rule.event },
        update: {
          title: title || rule.event,
          message: message || '',
          status: rule.status
        },
        create: {
          event: rule.event,
          title: title || rule.event,
          message: message || '',
          channel: rule.push ? 'PUSH' : 'IN_APP',
          language: 'English',
          status: rule.status
        }
      });
    }

    res.status(201).json(rule);
  } catch (error) {
    console.error('Failed to create notification rule:', error);
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

// PUT update rule
router.put('/rules/:id', managementAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { event, category, recipients, inApp, push, status, title, message } = req.body;

    const dataToUpdate: Record<string, any> = {};
    if (category !== undefined) dataToUpdate.category = category;
    if (recipients !== undefined) dataToUpdate.recipients = Array.isArray(recipients) ? recipients : [recipients];
    if (inApp !== undefined) dataToUpdate.inApp = Boolean(inApp);
    if (push !== undefined) dataToUpdate.push = Boolean(push);
    if (status !== undefined) dataToUpdate.status = status;
    if (event !== undefined) dataToUpdate.event = String(event).toUpperCase().trim();

    const rule = await prisma.notificationRule.update({
      where: { id },
      data: dataToUpdate
    });

    if (title !== undefined || message !== undefined) {
      await prisma.notificationTemplate.upsert({
        where: { event: rule.event },
        update: {
          ...(title !== undefined && { title }),
          ...(message !== undefined && { message }),
          status: rule.status
        },
        create: {
          event: rule.event,
          title: title || rule.event,
          message: message || '',
          channel: rule.push ? 'PUSH' : 'IN_APP',
          language: 'English',
          status: rule.status
        }
      });
    }

    res.json(rule);
  } catch (error) {
    console.error('Failed to update notification rule:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

// DELETE rule
router.delete('/rules/:id', managementAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const rule = await prisma.notificationRule.delete({
      where: { id }
    });
    res.json({ success: true, message: 'Rule deleted successfully', rule });
  } catch (error) {
    console.error('Failed to delete notification rule:', error);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// POST trigger rule on demand
router.post('/rules/:id/trigger', managementAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const result = await executeRuleManually(id);
    res.json(result);
  } catch (error) {
    console.error('Failed to trigger notification rule:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to trigger rule' });
  }
});

// ----------------------------------------------------
// NOTIFICATION TEMPLATES
// ----------------------------------------------------

// GET all templates
router.get('/templates', managementAuth, async (req: Request, res: Response) => {
  try {
    await ensureDefaultNotificationRules();
    const templates = await prisma.notificationTemplate.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(templates);
  } catch (error) {
    console.error('Failed to fetch templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST create template
router.post('/templates', managementAuth, async (req: Request, res: Response) => {
  try {
    const { event, channel, language, title, message, status } = req.body;
    if (!event || !title || !message) {
      res.status(400).json({ error: 'Event, title, and message are required' });
      return;
    }
    const template = await prisma.notificationTemplate.create({
      data: {
        event: String(event).toUpperCase().trim(),
        channel: channel || 'PUSH',
        language: language || 'English',
        title,
        message,
        status: status || 'ACTIVE'
      }
    });
    res.status(201).json(template);
  } catch (error) {
    console.error('Failed to create template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT update template
router.put('/templates/:id', managementAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { event, channel, language, title, message, status } = req.body;
    const template = await prisma.notificationTemplate.update({
      where: { id },
      data: {
        ...(event && { event: String(event).toUpperCase().trim() }),
        ...(channel && { channel }),
        ...(language && { language }),
        ...(title && { title }),
        ...(message && { message }),
        ...(status && { status })
      }
    });
    res.json(template);
  } catch (error) {
    console.error('Failed to update template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// DELETE template
router.delete('/templates/:id', managementAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const template = await prisma.notificationTemplate.delete({
      where: { id }
    });
    res.json({ success: true, message: 'Template deleted successfully', template });
  } catch (error) {
    console.error('Failed to delete template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// ----------------------------------------------------
// DEVICE TOKENS (Management view)
// ----------------------------------------------------

router.get('/devices', managementAuth, async (req: Request, res: Response) => {
  try {
    const devices = await prisma.fCMToken.findMany({
      include: {
        user: {
          select: { email: true, role: true, employee: { select: { firstName: true, lastName: true } } }
        }
      },
      orderBy: { lastUsedAt: 'desc' }
    });
    res.json(devices);
  } catch (error) {
    console.error('Failed to fetch devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

router.put('/devices/:id/deactivate', managementAuth, async (req: Request, res: Response) => {
  try {
    const device = await prisma.fCMToken.update({
      where: { id: Number(req.params.id) },
      data: { isActive: false }
    });
    res.json(device);
  } catch (error) {
    console.error('Failed to deactivate device:', error);
    res.status(500).json({ error: 'Failed to deactivate device' });
  }
});

export default router;
