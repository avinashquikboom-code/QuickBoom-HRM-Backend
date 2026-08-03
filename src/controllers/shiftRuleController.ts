import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { firebaseNotificationService } from '../services/firebaseNotificationService';

/**
 * Helper to send FCM notifications to affected employees for a shift rule
 */
async function notifyEmployeesForRule(title: string, messageBody: string, shiftType?: string | null, branchId?: string | null) {
  try {
    const whereEmp: any = { isActive: true };

    if (branchId) {
      const officeIdNum = parseInt(branchId, 10);
      if (!isNaN(officeIdNum)) {
        whereEmp.officeId = officeIdNum;
      }
    }

    const employees = await prisma.employee.findMany({
      where: whereEmp,
      select: { userId: true, id: true }
    });

    const userIds = employees.map(e => e.userId).filter((id): id is number => Boolean(id));

    if (userIds.length > 0) {
      for (const userId of userIds) {
        try {
          await firebaseNotificationService.sendNotificationToUser(
            userId,
            title,
            messageBody,
            { click_action: 'SHIFT_GUIDELINES' }
          );
        } catch (fcmErr) {
          // ignore individual user push errors
        }
      }
    }
  } catch (err) {
    console.warn('[ShiftRuleController] FCM notification helper warning:', err);
  }
}

/**
 * 1. POST /api/hr/shift-rules
 * HR Creates a new shift rule / guideline
 */
export const createShiftRule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { title, content, shiftType, branchId, priority } = req.body;

    if (!title || !content) {
      res.status(400).json({ success: false, message: 'Title and content are required' });
      return;
    }

    const creatorId = req.user?.id ? String(req.user.id) : 'HR';

    const normalizedShiftType = shiftType && String(shiftType).toUpperCase() !== 'ALL'
      ? String(shiftType).toUpperCase()
      : null;

    const normalizedBranchId = branchId && String(branchId) !== 'ALL'
      ? String(branchId)
      : null;

    const rule = await prisma.shiftRule.create({
      data: {
        title: String(title).trim(),
        content: String(content).trim(),
        shiftType: normalizedShiftType,
        branchId: normalizedBranchId,
        priority: priority ? parseInt(String(priority), 10) : 0,
        isActive: true,
        createdBy: creatorId
      }
    });

    // Send FCM notification to affected employees
    notifyEmployeesForRule(
      '📋 New Shift Guideline',
      `New shift guideline added: ${rule.title}`,
      rule.shiftType,
      rule.branchId
    );

    res.status(201).json({
      success: true,
      message: 'Shift rule created successfully.',
      data: rule
    });
  } catch (error: any) {
    console.error('Error in createShiftRule:', error);
    res.status(500).json({ success: false, message: 'Failed to create shift rule.' });
  }
};

/**
 * 2. GET /api/hr/shift-rules
 * HR views all shift rules (active + inactive) with filters
 */
export const getHrShiftRules = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { shiftType, branchId, search } = req.query;

    const whereClause: any = {};

    if (shiftType && String(shiftType).toUpperCase() !== 'ALL') {
      whereClause.shiftType = String(shiftType).toUpperCase();
    }

    if (branchId && String(branchId) !== 'ALL') {
      whereClause.branchId = String(branchId);
    }

    if (search) {
      const term = String(search).trim();
      whereClause.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { content: { contains: term, mode: 'insensitive' } }
      ];
    }

    const rules = await prisma.shiftRule.findMany({
      where: whereClause,
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    res.json({
      success: true,
      data: rules
    });
  } catch (error: any) {
    console.error('Error in getHrShiftRules:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch shift rules.' });
  }
};

/**
 * 3. PATCH /api/hr/shift-rules/:id
 * HR updates a shift rule
 */
export const updateShiftRule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const ruleId = String(req.params.id);
    const { title, content, shiftType, branchId, isActive, priority } = req.body;

    const existing = await prisma.shiftRule.findUnique({
      where: { id: ruleId }
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Shift rule not found' });
      return;
    }

    const updateData: any = {};

    if (title !== undefined) updateData.title = String(title).trim();
    if (content !== undefined) updateData.content = String(content).trim();
    if (shiftType !== undefined) {
      updateData.shiftType = shiftType && String(shiftType).toUpperCase() !== 'ALL'
        ? String(shiftType).toUpperCase()
        : null;
    }
    if (branchId !== undefined) {
      updateData.branchId = branchId && String(branchId) !== 'ALL'
        ? String(branchId)
        : null;
    }
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (priority !== undefined) updateData.priority = parseInt(String(priority), 10);

    const updated = await prisma.shiftRule.update({
      where: { id: ruleId },
      data: updateData
    });

    // If content or title was updated, send FCM notification
    if ((title !== undefined || content !== undefined) && updated.isActive) {
      notifyEmployeesForRule(
        '📋 Shift Guideline Updated',
        `Shift guideline updated: ${updated.title}`,
        updated.shiftType,
        updated.branchId
      );
    }

    res.json({
      success: true,
      message: 'Shift rule updated successfully.',
      data: updated
    });
  } catch (error: any) {
    console.error('Error in updateShiftRule:', error);
    res.status(500).json({ success: false, message: 'Failed to update shift rule.' });
  }
};

/**
 * 4. DELETE /api/hr/shift-rules/:id
 * Soft delete or hard delete shift rule
 */
export const deleteShiftRule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const ruleId = String(req.params.id);

    const existing = await prisma.shiftRule.findUnique({
      where: { id: ruleId }
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Shift rule not found' });
      return;
    }

    await prisma.shiftRule.update({
      where: { id: ruleId },
      data: { isActive: false }
    });

    res.json({
      success: true,
      message: 'Shift rule deactivated successfully.'
    });
  } catch (error: any) {
    console.error('Error in deleteShiftRule:', error);
    res.status(500).json({ success: false, message: 'Failed to delete shift rule.' });
  }
};

/**
 * 5. GET /api/mobile/shift-rules
 * Employee retrieves applicable active guidelines
 */
export const getMobileShiftRules = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const employee = await prisma.employee.findUnique({
      where: { userId },
      include: {
        office: true,
        shiftAssignments: {
          where: {
            effectiveFrom: { lte: new Date() },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: new Date() } }
            ]
          },
          include: { shift: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1
        }
      }
    });

    let empShiftType: string | null = null;
    if (employee?.shiftAssignments && employee.shiftAssignments.length > 0) {
      empShiftType = employee.shiftAssignments[0].shift.name.toUpperCase();
    }

    const empBranchIdStr = employee?.officeId ? String(employee.officeId) : null;

    // Fetch active rules matching employee shift & branch, plus global rules
    const activeRules = await prisma.shiftRule.findMany({
      where: {
        isActive: true,
        AND: [
          {
            OR: [
              { shiftType: null },
              { shiftType: 'ALL' },
              ...(empShiftType ? [{ shiftType: { contains: empShiftType, mode: 'insensitive' as const } }] : [])
            ]
          },
          {
            OR: [
              { branchId: null },
              ...(empBranchIdStr ? [{ branchId: empBranchIdStr }] : [])
            ]
          }
        ]
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const enrichedRules = activeRules.map(rule => ({
      ...rule,
      isNew: new Date(rule.updatedAt) >= sevenDaysAgo || new Date(rule.createdAt) >= sevenDaysAgo
    }));

    res.json({
      success: true,
      data: enrichedRules
    });
  } catch (error: any) {
    console.error('Error in getMobileShiftRules:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch shift guidelines.' });
  }
};
