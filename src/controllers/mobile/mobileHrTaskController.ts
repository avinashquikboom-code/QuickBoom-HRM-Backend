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
function toFlutterStatus(status: HrTaskStatus, dueDate: Date | null): string {
  if (status === HrTaskStatus.COMPLETED) return 'completed';
  if (status === HrTaskStatus.CANCELLED) return 'overdue';   // treat cancelled as overdue-style visually
  if (status === HrTaskStatus.IN_PROGRESS) return 'inprogress';
  // PENDING — check overdue
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
    case 'todo':        return HrTaskStatus.PENDING;
    case 'inprogress':  return HrTaskStatus.IN_PROGRESS;
    case 'completed':   return HrTaskStatus.COMPLETED;
    case 'overdue':     return HrTaskStatus.PENDING; // can't set overdue directly
    default:            return null;
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
    id: t.id,
    title: t.title,
    description: t.description ?? '',
    assignedToId: t.assignedTo,
    assignedToName: assigneeName,
    assignedById: String(t.assignedBy),
    assignedByName: assignerName,
    projectName: '',              // HrTask has no projectName — send empty string so Flutter doesn't crash
    dueDate: t.dueDate?.toISOString() ?? null,
    status: toFlutterStatus(t.status, t.dueDate),
    priority: t.priority.toLowerCase(),
    requiresPhoto: Boolean(t.requiresPhoto),
    photoUrl: photoUrls.length > 0 ? photoUrls[0] : (t.photoUrl ?? null),
    photoUrls: photoUrls,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// ─── GET /api/employee/tasks ───────────────────────────────────────────────────
// Employee sees their own assigned HrTasks.
// Auth: any authenticated mobile user (their Employee.employeeID is used as filter)

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

    const where: any = { assignedTo: { in: uniqueIdentifiers } };
    if (status) {
      const mapped = fromFlutterStatus(status);
      if (mapped) where.status = mapped;
    }
    if (priority) {
      where.priority = fromFlutterPriority(priority);
    }

    const tasks = await prisma.hrTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Resolve assigner names in bulk
    const assignerIds = [...new Set(tasks.map((t) => t.assignedBy))];
    const assigners = await prisma.user.findMany({
      where: { id: { in: assignerIds } },
      select: { id: true, email: true, profile: { select: { fullName: true } } },
    });
    const assignerMap = new Map(
      assigners.map((u) => [u.id, (u as any).profile?.fullName || u.email])
    );

    const myName = employee ? `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() : (user.email || `User #${user.id}`);

    res.json({
      success: true,
      tasks: tasks.map((t) =>
        buildFlutterTask(
          t,
          myName,
          assignerMap.get(t.assignedBy) ?? `User #${t.assignedBy}`,
        )
      ),
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
    const { status, photoUrl, photoUrls } = req.body as {
      status?: string;
      photoUrl?: string | string[];
      photoUrls?: string[];
    };

    // Verify task belongs to this employee
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

    const task = await prisma.hrTask.findFirst({
      where: { id, assignedTo: { in: uniqueIdentifiers } },
    });

    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found.' });
      return;
    }

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

    // Write audit row + update in transaction
    await prisma.$transaction([
      prisma.hrTask.update({
        where: { id },
        data: updateData,
      }),
      prisma.hrTaskUpdate.create({
        data: {
          taskId: id,
          byUserId: req.user!.id,
          oldStatus: task.status,
          newStatus,
          comment: 'Updated via mobile app.',
        },
      }),
    ]);

    const updated = await prisma.hrTask.findUnique({ where: { id } });
    const myName = employee ? `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() : (user.email || `User #${user.id}`);
    const assignerName = await resolveUserName(task.assignedBy);

    res.json({
      success: true,
      message: 'Task updated successfully.',
      data: buildFlutterTask(updated!, myName, assignerName),
    });
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

    const where: any = {};
    if (assignedTo) where.assignedTo = assignedTo;
    if (status) {
      const mapped = fromFlutterStatus(status);
      if (mapped) where.status = mapped;
    }
    if (priority) where.priority = fromFlutterPriority(priority);

    const tasks = await prisma.hrTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (!tasks.length) {
      res.json({ success: true, tasks: [] });
      return;
    }

    // Resolve employee names
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

    res.json({
      success: true,
      tasks: tasks.map((t) =>
        buildFlutterTask(
          t,
          empMap.get(t.assignedTo) ?? t.assignedTo,
          assignerMap.get(t.assignedBy) ?? `User #${t.assignedBy}`,
        )
      ),
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

    // Validate employee exists by employeeID, employeeCode, or id
    const isNum = !isNaN(Number(assignedToId));
    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeID: assignedToId },
          { employeeCode: assignedToId },
          ...(isNum ? [{ id: Number(assignedToId) }] : []),
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
