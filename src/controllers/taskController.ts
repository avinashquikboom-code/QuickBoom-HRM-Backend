import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { HrPriority, HrTaskStatus } from '@prisma/client';
import { pushNotificationService } from '../services/pushNotificationService';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const now = () => new Date();

function isOverdue(task: { dueDate: Date | null; status: HrTaskStatus }): boolean {
  return (
    task.dueDate !== null &&
    task.dueDate < now() &&
    task.status !== HrTaskStatus.COMPLETED &&
    task.status !== HrTaskStatus.CANCELLED
  );
}

/** Fire-and-forget FCM to the user linked to a given Employee identifier */
async function notifyEmployee(
  employeeId: string,
  title: string,
  body: string
): Promise<void> {
  try {
    const isNum = !isNaN(Number(employeeId));
    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeID: employeeId },
          { employeeCode: employeeId },
          ...(isNum ? [{ id: Number(employeeId) }] : []),
        ],
      },
      select: { userId: true },
    });
    if (!employee?.userId) return;

    // Create in-app notification first
    await prisma.notification.create({
      data: {
        userId: employee.userId,
        title,
        body,
        isRead: false,
        actionType: 'TASK_ASSIGNED',
      }
    }).catch(() => {});

    // Send push notification
    pushNotificationService.sendPush([employee.userId], title, body, {
      type: 'task',
      screen: 'tasks',
      actionType: 'TASK_ASSIGNED',
    }).catch(() => {});
  } catch {
    // fire-and-forget — never throw
  }
}

/** Resolve display name from Employee record for a given employeeID/code/id string */
async function resolveAssigneeName(employeeId: string): Promise<string> {
  const isNum = !isNaN(Number(employeeId));
  const emp = await prisma.employee.findFirst({
    where: {
      OR: [
        { employeeID: employeeId },
        { employeeCode: employeeId },
        ...(isNum ? [{ id: Number(employeeId) }] : []),
      ],
    },
    select: { firstName: true, lastName: true, employeeCode: true },
  });
  if (!emp) return employeeId;
  return `${emp.firstName} ${emp.lastName}`.trim() || emp.employeeCode;
}

/** Resolve display name from User.id */
async function resolveActorName(userId: number): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, profile: { select: { fullName: true } } as any },
  });
  if (!user) return `User #${userId}`;
  return (user as any).profile?.fullName || user.email;
}

// ─── POST /api/tasks ───────────────────────────────────────────────────────────

export const createTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const {
      title,
      description,
      assignedTo,
      priority,
      dueDate,
      requiresPhoto,
      photoUrl,
    } = req.body as {
      title: string;
      description?: string;
      assignedTo: string;
      priority?: string;
      dueDate?: string;
      requiresPhoto?: boolean;
      photoUrl?: string;
    };

    if (!title || !assignedTo) {
      res.status(400).json({ success: false, message: 'title and assignedTo are required.' });
      return;
    }

    // Validate employee exists by employeeID, employeeCode, or id
    const isNum = !isNaN(Number(assignedTo));
    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeID: assignedTo },
          { employeeCode: assignedTo },
          ...(isNum ? [{ id: Number(assignedTo) }] : []),
        ],
      },
    });
    if (!emp) {
      res.status(404).json({
        success: false,
        message: `No employee found matching "${assignedTo}".`,
      });
      return;
    }

    const resolvedAssignedTo = emp.employeeID || emp.employeeCode || String(emp.id);

    // Resolve priority enum
    const priorityEnum: HrPriority =
      priority && Object.keys(HrPriority).includes(priority.toUpperCase())
        ? (priority.toUpperCase() as HrPriority)
        : HrPriority.MEDIUM;

    const [task] = await prisma.$transaction([
      prisma.hrTask.create({
        data: {
          title: title.trim(),
          description: description?.trim(),
          assignedTo: resolvedAssignedTo,
          assignedBy: req.user!.id,
          priority: priorityEnum,
          dueDate: dueDate ? new Date(dueDate) : null,
          status: HrTaskStatus.PENDING,
          requiresPhoto: Boolean(requiresPhoto),
          photoUrl: photoUrl ?? null,
          updates: {
            create: {
              byUserId: req.user!.id,
              oldStatus: null,
              newStatus: HrTaskStatus.PENDING,
              comment: 'Task created.',
            },
          },
        },
        include: { updates: true },
      }),
    ]);

    // Fire-and-forget notification
    notifyEmployee(
      assignedTo,
      '📋 New Task Assigned',
      `You have been assigned: ${task.title}`
    );

    res.status(201).json({ success: true, data: task });
  } catch (error) {
    console.error('[taskController.createTask]', error);
    res.status(500).json({ success: false, message: 'Failed to create task.' });
  }
};

// ─── GET /api/tasks ────────────────────────────────────────────────────────────

export const listTasks = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const {
      assignedTo,
      status,
      priority,
      from,
      to,
      page = '1',
      limit = '20',
      search,
    } = req.query as Record<string, string>;

    const where: any = {};

    if (assignedTo) where.assignedTo = assignedTo;

    if (status) {
      const sUpper = status.toUpperCase();
      if (Object.values(HrTaskStatus).includes(sUpper as HrTaskStatus)) {
        where.status = sUpper as HrTaskStatus;
      }
    }

    if (priority) {
      const pUpper = priority.toUpperCase();
      if (Object.values(HrPriority).includes(pUpper as HrPriority)) {
        where.priority = pUpper as HrPriority;
      }
    }

    if (from || to) {
      where.dueDate = {};
      if (from) where.dueDate.gte = new Date(from);
      if (to) where.dueDate.lte = new Date(to);
    }

    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * pageSize;

    const [tasks, total] = await Promise.all([
      prisma.hrTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }).catch((err) => {
        console.error('[taskController.listTasks] hrTask.findMany error:', err);
        return [];
      }),
      prisma.hrTask.count({ where }).catch((err) => {
        console.error('[taskController.listTasks] hrTask.count error:', err);
        return 0;
      }),
    ]);

    // Resolve assignee names in bulk safely
    const assigneeIds = [
      ...new Set(
        tasks
          .map((t) => t.assignedTo)
          .filter((id): id is string => Boolean(id) && typeof id === 'string')
      ),
    ];

    const empMap = new Map<string, string>();
    if (assigneeIds.length > 0) {
      const numIds = assigneeIds.map(Number).filter((n) => !isNaN(n));
      const employees = await prisma.employee
        .findMany({
          where: {
            OR: [
              { employeeID: { in: assigneeIds } },
              { employeeCode: { in: assigneeIds } },
              ...(numIds.length ? [{ id: { in: numIds } }] : []),
            ],
          },
          select: { id: true, employeeID: true, employeeCode: true, firstName: true, lastName: true },
        })
        .catch(() => []);

      employees.forEach((e) => {
        const name = `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || e.employeeCode || `Employee #${e.id}`;
        if (e.employeeID) empMap.set(e.employeeID, name);
        if (e.employeeCode) empMap.set(e.employeeCode, name);
        empMap.set(String(e.id), name);
      });
    }

    const rows = tasks.map((t) => ({
      ...t,
      assigneeName: (t.assignedTo ? empMap.get(t.assignedTo) : null) ?? t.assignedTo ?? 'Unassigned',
      overdue: isOverdue(t),
    }));

    res.json({
      success: true,
      data: rows,
      meta: { total, page: pageNum, limit: pageSize, pages: Math.ceil(total / pageSize) || 1 },
    });
  } catch (error) {
    console.error('[taskController.listTasks]', error);
    res.json({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 20, pages: 0 },
    });
  }
};

// ─── GET /api/tasks/stats ──────────────────────────────────────────────────────

export const getTaskStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { assignedTo } = req.query as { assignedTo?: string };
    const base = assignedTo ? { assignedTo } : {};

    const [assigned, completed, inProgress, pending, cancelled, overdueList] =
      await Promise.all([
        prisma.hrTask.count({ where: base }),
        prisma.hrTask.count({ where: { ...base, status: HrTaskStatus.COMPLETED } }),
        prisma.hrTask.count({ where: { ...base, status: HrTaskStatus.IN_PROGRESS } }),
        prisma.hrTask.count({ where: { ...base, status: HrTaskStatus.PENDING } }),
        prisma.hrTask.count({ where: { ...base, status: HrTaskStatus.CANCELLED } }),
        prisma.hrTask.findMany({
          where: {
            ...base,
            dueDate: { lt: now() },
            status: { notIn: [HrTaskStatus.COMPLETED, HrTaskStatus.CANCELLED] },
          },
          select: { id: true },
        }),
      ]);

    res.json({
      success: true,
      data: {
        assigned,
        completed,
        inProgress,
        pending,
        cancelled,
        overdue: overdueList.length,
      },
    });
  } catch (error) {
    console.error('[taskController.getTaskStats]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch task stats.' });
  }
};

// ─── GET /api/tasks/:id ────────────────────────────────────────────────────────

export const getTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;

    let task: any = await prisma.hrTask.findUnique({
      where: { id },
      include: { updates: { orderBy: { at: 'asc' } } },
    });

    if (!task && !isNaN(Number(id))) {
      // Fallback to legacy Task table if ID is numeric
      const legacyTask = await prisma.task.findUnique({
        where: { id: Number(id) },
        include: { assignedTo: true, assignedBy: true },
      });
      if (legacyTask) {
        task = {
          id: String(legacyTask.id),
          title: legacyTask.title,
          description: legacyTask.description,
          assignedTo: legacyTask.assignedTo.employeeID ?? String(legacyTask.assignedToId),
          assignedBy: legacyTask.assignedById,
          priority: legacyTask.priority as any,
          dueDate: legacyTask.dueDate,
          status: legacyTask.status as any,
          requiresPhoto: (legacyTask as any).requiresPhoto ?? false,
          photoUrl: (legacyTask as any).photoUrl ?? null,
          createdAt: legacyTask.createdAt,
          updatedAt: legacyTask.updatedAt,
          updates: [],
        };
      }
    }

    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found.' });
      return;
    }

    const assigneeName = await resolveAssigneeName(task.assignedTo);
    const assignerName = await resolveActorName(task.assignedBy);

    res.json({
      success: true,
      data: {
        ...task,
        assigneeName,
        assignerName,
        overdue: isOverdue(task),
      },
    });
  } catch (error) {
    console.error('[taskController.getTask]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch task.' });
  }
};

// ─── GET /api/tasks/:id/history ───────────────────────────────────────────────

export const getTaskHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;

    const updates = await prisma.hrTaskUpdate.findMany({
      where: { taskId: id },
      orderBy: { at: 'asc' },
    });

    if (!updates.length) {
      res.json({ success: true, data: [] });
      return;
    }

    const actorIds = [...new Set(updates.map((u) => u.byUserId))];
    const actors = await prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: {
        id: true,
        email: true,
        profile: { select: { fullName: true } } as any,
      },
    });
    const actorMap = new Map(
      actors.map((a) => [a.id, (a as any).profile?.fullName || a.email])
    );

    const history = updates.map((u) => ({
      ...u,
      byName: actorMap.get(u.byUserId) ?? `User #${u.byUserId}`,
    }));

    res.json({ success: true, data: history });
  } catch (error) {
    console.error('[taskController.getTaskHistory]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch task history.' });
  }
};

// ─── PATCH /api/tasks/:id ──────────────────────────────────────────────────────

export const updateTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const {
      title,
      description,
      assignedTo,
      priority,
      dueDate,
      status,
      comment,
      requiresPhoto,
      photoUrl,
    } = req.body as {
      title?: string;
      description?: string;
      assignedTo?: string;
      priority?: string;
      dueDate?: string | null;
      status?: string;
      comment?: string;
      requiresPhoto?: boolean;
      photoUrl?: string | null;
    };

    const existing = await prisma.hrTask.findUnique({ where: { id: id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Task not found.' });
      return;
    }

    // Validate new assignee if changing
    let newAssignee = existing.assignedTo;
    if (assignedTo && assignedTo !== existing.assignedTo) {
      const emp = await prisma.employee.findFirst({ where: { employeeID: assignedTo } });
      if (!emp) {
        res.status(404).json({
          success: false,
          message: `No employee found with employeeID "${assignedTo}".`,
        });
        return;
      }
      newAssignee = assignedTo;
    }

    // Resolve priority enum
    let priorityEnum: HrPriority = existing.priority;
    if (priority && Object.keys(HrPriority).includes(priority.toUpperCase())) {
      priorityEnum = priority.toUpperCase() as HrPriority;
    }

    // Resolve status enum
    let statusEnum: HrTaskStatus = existing.status;
    const statusChanged =
      status &&
      Object.keys(HrTaskStatus).includes(status.toUpperCase()) &&
      status.toUpperCase() !== existing.status;

    if (statusChanged) {
      statusEnum = status!.toUpperCase() as HrTaskStatus;
    }

    const updateData: any = {
      updatedAt: now(),
    };
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description?.trim() ?? null;
    if (assignedTo !== undefined) updateData.assignedTo = newAssignee;
    if (priority !== undefined) updateData.priority = priorityEnum;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (statusChanged) updateData.status = statusEnum;
    if (requiresPhoto !== undefined) updateData.requiresPhoto = Boolean(requiresPhoto);
    if (photoUrl !== undefined) updateData.photoUrl = photoUrl;

    // If status changed, write audit row in transaction
    if (statusChanged) {
      await prisma.$transaction([
        prisma.hrTask.update({ where: { id }, data: updateData }),
        prisma.hrTaskUpdate.create({
          data: {
            taskId: id,
            byUserId: req.user!.id,
            oldStatus: existing.status,
            newStatus: statusEnum,
            comment: comment?.trim() ?? null,
          },
        }),
      ]);
    } else {
      await prisma.hrTask.update({ where: { id }, data: updateData });
    }

    // Fire notification if reassigned
    if (newAssignee !== existing.assignedTo) {
      notifyEmployee(
        newAssignee,
        '📋 Task Reassigned to You',
        `You have been assigned: ${updateData.title ?? existing.title}`
      );
    }

    const updated = await prisma.hrTask.findUnique({
      where: { id },
      include: { updates: { orderBy: { at: 'asc' } } },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[taskController.updateTask]', error);
    res.status(500).json({ success: false, message: 'Failed to update task.' });
  }
};
