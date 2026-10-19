import express, { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { authenticateToken, requireRole } from '../middlewares/authMiddleware';

const router = express.Router();

// Middleware to ensure only authorized roles can access management endpoints
const managementAuth = [authenticateToken, requireRole(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'])];

// ----------------------------------------------------
// NOTIFICATION RULES
// ----------------------------------------------------

// GET all rules
router.get('/rules', managementAuth, async (req: Request, res: Response) => {
  try {
    const rules = await prisma.notificationRule.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(rules);
  } catch (error) {
    console.error('Failed to fetch notification rules:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// POST create rule
router.post('/rules', managementAuth, async (req: Request, res: Response) => {
  try {
    const { event, category, recipients, inApp, push, status } = req.body;
    const rule = await prisma.notificationRule.create({
      data: { event, category, recipients, inApp, push, status }
    });
    res.status(201).json(rule);
  } catch (error) {
    console.error('Failed to create notification rule:', error);
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

// PUT update rule
router.put('/rules/:id', managementAuth, async (req: Request, res: Response) => {
  try {
    const { event, category, recipients, inApp, push, status } = req.body;
    const rule = await prisma.notificationRule.update({
      where: { id: Number(req.params.id) },
      data: { event, category, recipients, inApp, push, status }
    });
    res.json(rule);
  } catch (error) {
    console.error('Failed to update notification rule:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

// ----------------------------------------------------
// NOTIFICATION TEMPLATES
// ----------------------------------------------------

// GET all templates
router.get('/templates', managementAuth, async (req: Request, res: Response) => {
  try {
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
    const template = await prisma.notificationTemplate.create({
      data: { event, channel, language, title, message, status }
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
    const { event, channel, language, title, message, status } = req.body;
    const template = await prisma.notificationTemplate.update({
      where: { id: Number(req.params.id) },
      data: { event, channel, language, title, message, status }
    });
    res.json(template);
  } catch (error) {
    console.error('Failed to update template:', error);
    res.status(500).json({ error: 'Failed to update template' });
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
