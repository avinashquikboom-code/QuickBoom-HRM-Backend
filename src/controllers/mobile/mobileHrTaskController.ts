import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { HrPriority, HrTaskStatus } from '@prisma/client';
import { pushNotificationService } from '../../services/pushNotificationService';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map HrTask status (backend enum) → Flutter-expected status strings.
 * Flutter parser recognises: 'todo' | 'inprogress' | 'completed' | 'overdue'
 */
function toFlutterStatus(status: HrTaskStatus | string, dueDate: Date | null): string {
  const s = String(status).toUpperCase();
  if (s === 'COMPLETED') return 'completed';
  if (s === 'CANCELLED') return 'overdue';
  if (s === 'IN_PROGRESS' || s === 'INPROGRESS') return 'inprogress';
  // PENDING / TODO — check overdue
  if (dueDate && dueDate < new Date()) return 'overdue';
  return 'todo';
}

/**
 * Map Flutter priority string → HrPriority enum (case-insensitive)
 */
function fromFlutterPriority(p: string | undefined): HrPriority {
  if (!p) return HrPriority.MEDIUM;
  const up = p.toUpperCase();
  if (up === 'HIGH') return HrPriority.HIGH;
  if (up === 'LOW') return HrPriority.LOW;
  return HrPriority.MEDIUM;
}

/**
 * Map Flutter status string → HrTaskStatus enum
 */
function fromFlutterStatus(s: string | undefined): HrTaskStatus | null {
  if (!s) return null;
  switch (s.toLowerCase()) {
    case 'todo':
    case 'pending':
      return HrTaskStatus.PENDING;
    case 'inprogress':
    case 'in_progress':
      return HrTaskStatus.IN_PROGRESS;
    case 'completed':
    case 'done':
      return HrTaskStatus.COMPLETED;
    case 'overdue':
    case 'cancelled':
      return HrTaskStatus.PENDING;
    default:
      return null;
  }
}

/** Resolve display name of an HR user from User.id */
async function resolveUserName(userId: number): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, profile: { select: { fullName: true } } },
  });
  if (!user) return `User #${userId}`;
  return (user as any).profile?.fullName || user.email;
}

/** Build the Flutter-compatible task object from an HrTask DB record + resolved names */
function buildFlutterTask(
  t: any,
  assigneeName: string,
  assignerName: string,
) {
  let photoUrls: string[] = [];
  if (t.photoUrl) {
    try {
      const parsed = JSON.parse(t.photoUrl);
      if (Array.isArray(parsed)) {
        photoUrls = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
      } else if (typeof t.photoUrl === 'string' && t.photoUrl.trim().length > 0) {
        photoUrls = [t.photoUrl];
      }
    } catch {
      if (typeof t.photoUrl === 'string' && t.photoUrl.trim().length > 0) {
        photoUrls = [t.photoUrl];
      }
    }
  }

  return {
    id: String(t.id),
    title: t.title,
    description: t.description ?? '',
    assignedToId: String(t.assignedTo ?? t.assignedToId ?? ''),
    assignedToName: assigneeName,
    assignedById: String(t.assignedBy ?? t.assignedById ?? ''),
    assignedByName: assignerName,
    projectName: t.projectName ?? 'General',
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
    status: toFlutterStatus(t.status, t.dueDate ? new Date(t.dueDate) : null),
    priority: String(t.priority ?? 'MEDIUM').toLowerCase(),
    requiresPhoto: Boolean(t.requiresPhoto),
    photoUrl: photoUrls.length > 0 ? photoUrls[0] : (t.photoUrl ?? null),
    photoUrls: photoUrls,
    createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: t.updatedAt ? new Date(t.updatedAt).toISOString() : new Date().toISOString(),
  };
}

// ─── GET /api/employee/tasks ───────────────────────────────────────────────────
// Employee sees their own assigned tasks (both HrTask and legacy Task).
// Auth: any authenticated mobile user

export const getMyHrTasks = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const user = req.user!;
    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user.id },
          ...(user.email ? [{ user: { email: user.email } }] : []),
        ],
      },
      select: { id: true, employeeID: true, employeeCode: true, firstName: true, lastName: true },
    });

    const identifiers: string[] = [
      String(user.id),
      ...(user.email ? [user.email] : []),
    ];

    if (employee) {
      if (employee.employeeID) identifiers.push(employee.employeeID);
      if (employee.employeeCode) identifiers.push(employee.employeeCode);
      if (employee.id) identifiers.push(String(employee.id));
      const fullName = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim();
      if (fullName) identifiers.push(fullName);
    }

    const uniqueIdentifiers = [...new Set(identifiers.filter((x): x is string => Boolean(x) && typeof x === 'string'))];

    const { status, priority } = req.query as Record<string, string>;

    const hrWhere: any = { assignedTo: { in: uniqueIdentifiers } };
    if (status) {
      const mapped = fromFlutterStatus(status);
      if (mapped) hrWhere.status = mapped;
    }
    if (priority) {
      hrWhere.priority = fromFlutterPriority(priority);
    }

    // Fetch HrTasks
    const hrTasks = await prisma.hrTask.findMany({
      where: hrWhere,
      orderBy: { createdAt: 'desc' },
    });

    // Fetch legacy Tasks if employee exists
    let legacyTasks: any[] = [];
    if (employee) {
      const legacyWhere: any = {
        OR: [
          { assignedToId: employee.id },
          ...(user ? [{ assignedById: user.id }] : []),
        ],
      };
      if (status) {
        const sLower = status.toLowerCase();
        if (sLower === 'completed') legacyWhere.status = 'COMPLETED';
        else if (sLower === 'inprogress') legacyWhere.status = 'IN_PROGRESS';
        else if (sLower === 'todo') legacyWhere.status = 'TODO';
      }
      if (priority) {
        legacyWhere.priority = priority.toUpperCase();
      }

      legacyTasks = await prisma.task.findMany({
        where: legacyWhere,
        include: {
          assignedBy: {
            select: {
              id: true,
              email: true,
              profile: { select: { fullName: true } },
            },
          },
          assignedTo: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Resolve assigner names in bulk for HrTasks
    const assignerIds = [...new Set(hrTasks.map((t) => t.assignedBy))];
    const assigners = await prisma.user.findMany({
      where: { id: { in: assignerIds } },
      select: { id: true, email: true, profile: { select: { fullName: true } } },
    });
    const assignerMap = new Map(
      assigners.map((u) => [u.id, (u as any).profile?.fullName || u.email])
    );

    const myName = employee ? `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() : (user.email || `User #${user.id}`);

    const formattedHrTasks = hrTasks.map((t) =>
      buildFlutterTask(
        t,
        myName,
        assignerMap.get(t.assignedBy) ?? `User #${t.assignedBy}`,
      )
    );

    const formattedLegacyTasks = legacyTasks.map((t) =>
      buildFlutterTask(
        t,
        t.assignedTo ? `${t.assignedTo.firstName ?? ''} ${t.assignedTo.lastName ?? ''}`.trim() : myName,
        t.assignedBy?.profile?.fullName || t.assignedBy?.email || `User #${t.assignedById}`,
      )
    );

    // Merge and sort by createdAt descending
    const allTasksMap = new Map<string, any>();
    formattedHrTasks.forEach((t) => allTasksMap.set(`hr-${t.id}`, t));
    formattedLegacyTasks.forEach((t) => allTasksMap.set(`legacy-${t.id}`, t));

    const allTasks = Array.from(allTasksMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.json({
      success: true,
      tasks: allTasks,
    });
  } catch (error) {
    console.error('[mobileHrTaskController.getMyHrTasks]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve tasks.' });
  }
};

// ─── PUT /api/employee/tasks/:id ───────────────────────────────────────────────
// Employee updates status of one of their own tasks.

export const updateMyHrTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { status, comment, photoUrl, photoUrls } = req.body as {
      status?: string;
      comment?: string;
      photoUrl?: string | string[];
      photoUrls?: string[];
    };

    const user = req.user!;
    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user.id },
          ...(user.email ? [{ user: { email: user.email } }] : []),
        ],
      },
      select: { id: true, employeeID: true, employeeCode: true, firstName: true, lastName: true },
    });

    const identifiers: string[] = [
      String(user.id),
      ...(user.email ? [user.email] : []),
    ];

    if (employee) {
      if (employee.employeeID) identifiers.push(employee.employeeID);
      if (employee.employeeCode) identifiers.push(employee.employeeCode);
      if (employee.id) identifiers.push(String(employee.id));
      const fullName = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim();
      if (fullName) identifiers.push(fullName);
    }

    const uniqueIdentifiers = [...new Set(identifiers.filter((x): x is string => Boolean(x) && typeof x === 'string'))];

    // Try finding in HrTask first
    const hrTask = await prisma.hrTask.findFirst({
      where: { id, assignedTo: { in: uniqueIdentifiers } },
    });

    if (hrTask) {
      const newStatus = fromFlutterStatus(status);
      if (!newStatus) {
        res.status(400).json({ success: false, message: 'Invalid status value.' });
        return;
      }

      const updateData: any = { status: newStatus, updatedAt: new Date() };
      if (Array.isArray(photoUrls) && photoUrls.length > 0) {
        updateData.photoUrl = JSON.stringify(photoUrls);
      } else if (Array.isArray(photoUrl) && photoUrl.length > 0) {
        updateData.photoUrl = JSON.stringify(photoUrl);
      } else if (typeof photoUrl === 'string' && photoUrl.trim().length > 0) {
        updateData.photoUrl = photoUrl;
      }

      await prisma.$transaction([
        prisma.hrTask.update({
          where: { id },
          data: updateData,
        }),
        prisma.hrTaskUpdate.create({
          data: {
            taskId: id,
            byUserId: req.user!.id,
            oldStatus: hrTask.status,
            newStatus,
            comment: comment || 'Updated via mobile app.',
          },
        }),
      ]);

      const updated = await prisma.hrTask.findUnique({ where: { id } });
      const myName = employee ? `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() : (user.email || `User #${user.id}`);
      const assignerName = await resolveUserName(hrTask.assignedBy);

      res.json({
        success: true,
        message: 'Task updated successfully.',
        data: buildFlutterTask(updated!, myName, assignerName),
      });
      return;
    }

    // Fallback to legacy Task table if numeric ID
    const isNum = !isNaN(Number(id));
    if (isNum && employee) {
      const legacyTask = await prisma.task.findFirst({
        where: { id: Number(id), assignedToId: employee.id },
        include: {
          assignedBy: {
            select: { id: true, email: true, profile: { select: { fullName: true } } },
          },
          assignedTo: true,
        },
      });

      if (legacyTask) {
        let legacyStatus = legacyTask.status;
        if (status) {
          const sLower = status.toLowerCase();
          if (sLower === 'completed' || sLower === 'done') legacyStatus = 'COMPLETED';
          else if (sLower === 'inprogress' || sLower === 'in_progress') legacyStatus = 'IN_PROGRESS';
          else if (sLower === 'todo' || sLower === 'pending') legacyStatus = 'TODO';
        }

        const updateData: any = { status: legacyStatus, updatedAt: new Date() };
        if (Array.isArray(photoUrls) && photoUrls.length > 0) {
          updateData.photoUrl = JSON.stringify(photoUrls);
        } else if (typeof photoUrl === 'string' && photoUrl.trim().length > 0) {
          updateData.photoUrl = photoUrl;
        }

        const updated = await prisma.task.update({
          where: { id: Number(id) },
          data: updateData,
          include: {
            assignedBy: {
              select: { id: true, email: true, profile: { select: { fullName: true } } },
            },
            assignedTo: true,
          },
        });

        const myName = `${updated.assignedTo.firstName ?? ''} ${updated.assignedTo.lastName ?? ''}`.trim();
        const assignerName = updated.assignedBy?.profile?.fullName || updated.assignedBy?.email || `User #${updated.assignedById}`;

        res.json({
          success: true,
          message: 'Task updated successfully.',
          data: buildFlutterTask(updated, myName, assignerName),
        });
        return;
      }
    }

    res.status(404).json({ success: false, message: 'Task not found.' });
  } catch (error) {
    console.error('[mobileHrTaskController.updateMyHrTask]', error);
    res.status(500).json({ success: false, message: 'Failed to update task.' });
  }
};

// ─── GET /api/hr/tasks ─────────────────────────────────────────────────────────
// HR/Store-Manager sees ALL tasks (or filtered). Used by HrTasksView on mobile.

export const getHrTasksMobile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { status, priority, assignedTo } = req.query as Record<string, string>;

    const hrWhere: any = {};
    if (assignedTo) hrWhere.assignedTo = assignedTo;
    if (status) {
      const mapped = fromFlutterStatus(status);
      if (mapped) hrWhere.status = mapped;
    }
    if (priority) hrWhere.priority = fromFlutterPriority(priority);

    const tasks = await prisma.hrTask.findMany({
      where: hrWhere,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Also fetch from legacy Task model
    const legacyTasks = await prisma.task.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        assignedBy: {
          select: { id: true, email: true, profile: { select: { fullName: true } } },
        },
        assignedTo: {
          select: { id: true, employeeCode: true, firstName: true, lastName: true, employeeID: true },
        },
      },
    });

    // Resolve employee names for HrTasks
    const assigneeIds = [...new Set(tasks.map((t) => t.assignedTo))];
    const numIds = assigneeIds.map(Number).filter((n) => !isNaN(n));
    const employees = await prisma.employee.findMany({
      where: {
        OR: [
          { employeeID: { in: assigneeIds } },
          { employeeCode: { in: assigneeIds } },
          ...(numIds.length ? [{ id: { in: numIds } }] : []),
        ],
      },
      select: { id: true, employeeID: true, employeeCode: true, firstName: true, lastName: true },
    });
    const empMap = new Map<string, string>();
    employees.forEach((e) => {
      const name = `${e.firstName} ${e.lastName}`.trim() || e.employeeCode;
      if (e.employeeID) empMap.set(e.employeeID, name);
      if (e.employeeCode) empMap.set(e.employeeCode, name);
      empMap.set(String(e.id), name);
    });

    const assignerIds = [...new Set(tasks.map((t) => t.assignedBy))];
    const assigners = await prisma.user.findMany({
      where: { id: { in: assignerIds } },
      select: { id: true, email: true, profile: { select: { fullName: true } } },
    });
    const assignerMap = new Map(
      assigners.map((u) => [u.id, (u as any).profile?.fullName || u.email])
    );

    const formattedHrTasks = tasks.map((t) =>
      buildFlutterTask(
        t,
        empMap.get(t.assignedTo) ?? t.assignedTo,
        assignerMap.get(t.assignedBy) ?? `User #${t.assignedBy}`,
      )
    );

    const formattedLegacyTasks = legacyTasks.map((t) =>
      buildFlutterTask(
        t,
        t.assignedTo ? `${t.assignedTo.firstName ?? ''} ${t.assignedTo.lastName ?? ''}`.trim() : `Employee #${t.assignedToId}`,
        t.assignedBy?.profile?.fullName || t.assignedBy?.email || `User #${t.assignedById}`,
      )
    );

    const allTasksMap = new Map<string, any>();
    formattedHrTasks.forEach((t) => allTasksMap.set(`hr-${t.id}`, t));
    formattedLegacyTasks.forEach((t) => allTasksMap.set(`legacy-${t.id}`, t));

    const combinedTasks = Array.from(allTasksMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.json({
      success: true,
      tasks: combinedTasks,
    });
  } catch (error) {
    console.error('[mobileHrTaskController.getHrTasksMobile]', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve tasks.' });
  }
};

// ─── POST /api/hr/tasks ────────────────────────────────────────────────────────
// HR/Store-Manager creates a task. Used by HrTasksView → Assign Task FAB.

export const createHrTaskMobile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const {
      title,
      description,
      assignedToId,
      assignedToName,
      projectName,
      dueDate,
      priority,
      requiresPhoto,
    } = req.body as {
      title: string;
      description?: string;
      assignedToId?: string;
      assignedToName?: string;
      projectName?: string;
      dueDate?: string;
      priority?: string;
      requiresPhoto?: boolean;
    };

    if (!title || !assignedToId) {
      res.status(400).json({ success: false, message: 'title and assignedToId are required.' });
      return;
    }

    // Validate employee exists by employeeID, employeeCode, id, userId, or user email
    const isNum = !isNaN(Number(assignedToId));
    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeID: assignedToId },
          { employeeCode: assignedToId },
          ...(isNum ? [{ id: Number(assignedToId) }] : []),
          ...(isNum ? [{ userId: Number(assignedToId) }] : []),
          { user: { email: assignedToId } },
        ],
      },
      select: { id: true, employeeID: true, employeeCode: true, firstName: true, lastName: true, userId: true },
    });

    if (!emp) {
      res.status(404).json({
        success: false,
        message: `No employee found matching "${assignedToId}".`,
      });
      return;
    }

    const resolvedAssignedTo = emp.employeeID || emp.employeeCode || String(emp.id);

    const [task] = await prisma.$transaction([
      prisma.hrTask.create({
        data: {
          title: title.trim(),
          description: description?.trim() ?? '',
          assignedTo: resolvedAssignedTo,
          assignedBy: req.user!.id,
          priority: fromFlutterPriority(priority),
          dueDate: dueDate ? new Date(dueDate) : null,
          status: HrTaskStatus.PENDING,
          requiresPhoto: Boolean(requiresPhoto),
          updates: {
            create: {
              byUserId: req.user!.id,
              oldStatus: null,
              newStatus: HrTaskStatus.PENDING,
              comment: 'Task created via mobile app.',
            },
          },
        },
      }),
    ]);

    // Fire-and-forget notifications (in-app and FCM)
    if (emp.userId) {
      prisma.notification.create({
        data: {
          userId: emp.userId,
          title: '📋 New Task Assigned',
          body: `You have been assigned: ${task.title}`,
          isRead: false,
          actionType: 'TASK_ASSIGNED',
        }
      }).catch(() => {});

      pushNotificationService
        .sendPush([emp.userId], '📋 New Task Assigned', `You have been assigned: ${task.title}`, {
          type: 'task',
          screen: 'tasks',
          actionType: 'TASK_ASSIGNED',
        })
        .catch(() => {});
    }

    const assignerName = await resolveUserName(req.user!.id);
    const assigneeName = assignedToName ?? `${emp.firstName} ${emp.lastName}`.trim();

    res.status(201).json({
      success: true,
      message: 'Task assigned successfully.',
      data: buildFlutterTask(task, assigneeName, assignerName),
    });
  } catch (error) {
    console.error('[mobileHrTaskController.createHrTaskMobile]', error);
    res.status(500).json({ success: false, message: 'Failed to create task.' });
  }
};

