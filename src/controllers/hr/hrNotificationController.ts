import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { persistAndPush, deliveryMessage } from '../../services/employeePushDelivery';

export const sendNotification = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { employeeId, title, body, category = 'GENERAL', actionId, actionType } = req.body;
  const id = Number(employeeId);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof title !== 'string' || !title.trim() || typeof body !== 'string' || !body.trim() || typeof category !== 'string') {
    res.status(400).json({ success: false, message: 'A valid employeeId, title and body are required.' }); return;
  }
  try {
    const employee = await prisma.employee.findFirst({ where: { id, status: { equals: 'active', mode: 'insensitive' }, OR: [{ userId: null }, { user: { isActive: true } }] }, select: { id: true, userId: true } });
    if (!employee) { res.status(404).json({ success: false, message: 'Active employee not found.' }); return; }
    const delivery = await persistAndPush([employee], { title, body, category: category.toUpperCase(), ...(actionId != null ? { actionId: String(actionId) } : {}), ...(actionType != null ? { actionType: String(actionType) } : {}) });
    res.status(201).json({ success: true, message: deliveryMessage(delivery), notification: delivery.notification, delivery });
  } catch (error: any) {
    console.error('[NotificationDelivery] Individual request failed', { code: error?.code, name: error?.name });
    res.status(500).json({ success: false, message: 'Notification processing failed. Check history before retrying.' });
  }
};

export const broadcastAnnouncement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { title, content, body, category = 'GENERAL' } = req.body;
  const messageBody = body ?? content;
  if (typeof title !== 'string' || !title.trim() || typeof messageBody !== 'string' || !messageBody.trim() || typeof category !== 'string') {
    res.status(400).json({ success: false, message: 'title and body (or content) are required.' }); return;
  }
  try {
    const employees = await prisma.employee.findMany({ where: { status: { equals: 'active', mode: 'insensitive' }, user: { isActive: true } }, select: { id: true, userId: true } });
    if (!employees.length) { res.status(404).json({ success: false, message: 'No active recipients found.' }); return; }
    const announcement = await prisma.announcement.create({ data: { title, content: messageBody, category: category.toUpperCase(), publishedBy: req.user?.email || 'HR Department' } });
    const delivery = await persistAndPush(employees, { title, body: messageBody, category: category.toUpperCase(), actionId: String(announcement.id), actionType: 'ANNOUNCEMENT' });
    res.status(201).json({ success: true, message: deliveryMessage(delivery), announcement, delivery });
  } catch (error: any) {
    console.error('[NotificationDelivery] Broadcast request failed', { code: error?.code, name: error?.name });
    res.status(500).json({ success: false, message: 'Announcement processing failed. Check history before retrying.' });
  }
};
