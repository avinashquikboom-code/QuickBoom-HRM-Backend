import { safeFcmError } from './fcmErrors';
import { Role, Prisma } from '@prisma/client';
import { prisma } from './db';
import { firebaseNotificationService } from '../services/firebaseNotificationService';
import { getWebSocketInstance } from './websocketSingleton';

export interface SendHRNotificationParams {
  title: string;
  message?: string;
  body?: string;
  category: 'ATTENDANCE' | 'LEAVE' | 'PAYROLL' | 'EMPLOYEE' | 'COMMISSION' | 'GENERAL' | string;
  actionType?: string;
  actionId?: string | number;
  employeeId?: number | null; // The subject employee who requested or was affected
  employeeName?: string;
  requiredModuleId?: string;
  excludeUserId?: number;
  extraData?: Record<string, string>;
  deduplicate?: boolean;
  eventSince?: Date;
}

export interface SendEmployeeNotificationParams {
  employeeId?: number | null;
  targetEmployeeId?: number | null;
  userId?: number | null;
  targetUserId?: number | null;
  title: string;
  message?: string;
  body?: string;
  category: 'ATTENDANCE' | 'LEAVE' | 'PAYROLL' | 'EMPLOYEE' | 'COMMISSION' | 'GENERAL' | string;
  actionType?: string;
  actionId?: string | number;
  screen?: string;
  clickRoute?: string;
  extraData?: Record<string, string>;
  deduplicate?: boolean;
  eventSince?: Date;
}

/**
 * Determine the related Admin Panel page for the given notification
 */
export function getHRTargetRoute(category: string, actionType?: string): string {
  const cat = (category || '').toUpperCase();
  const act = (actionType || '').toUpperCase();

  if (act.includes('REMOTE_WORK')) return '/remote-work';
  if (act.includes('ACCESS_REQUEST') || act.includes('MODULE_ACCESS')) return '/access-requests';
  if (cat === 'ATTENDANCE' || act.includes('ATTENDANCE') || act.includes('PUNCH')) {
    return '/attendance';
  }
  if (cat === 'LEAVE' || act.includes('LEAVE') || act.includes('WEEK_OFF') || act.includes('WEEKOFF')) {
    return '/leave';
  }
  if (cat === 'PAYROLL' || act.includes('PAYROLL') || act.includes('SALARY') || act.includes('ADVANCE')) {
    return '/payroll';
  }
  if (cat === 'EXPENSE' || act.includes('EXPENSE')) return '/expenses';
  if (cat === 'RKD' || act.includes('RKD')) return '/rkd-requests';
  if (cat === 'EMPLOYEE' || act.includes('EMPLOYEE')) {
    return '/employees';
  }
  return '/notifications';
}

/**
 * Determine the related Employee mobile/web screen
 */
export function getEmployeeTargetRoute(category: string, actionType?: string): string {
  const cat = (category || '').toUpperCase();
  const act = (actionType || '').toUpperCase();

  if (act.includes('REMOTE_WORK')) return '/remote-work';
  if (act.includes('ACCESS_REQUEST') || act.includes('MODULE_ACCESS')) return '/access-requests';
  if (cat === 'ATTENDANCE' || act.includes('ATTENDANCE')) {
    return '/attendance';
  }
  if (cat === 'LEAVE' || act.includes('LEAVE') || act.includes('WEEK_OFF')) {
    return '/leave';
  }
  if (cat === 'PAYROLL' || act.includes('PAYROLL') || act.includes('SALARY') || act.includes('ADVANCE')) {
    return '/payroll';
  }
  if (cat === 'EXPENSE' || act.includes('EXPENSE')) return '/expenses';
  if (cat === 'RKD' || act.includes('RKD')) return '/rkd-requests';
  return '/profile';
}

/**
 * Map category/action to Admin permission module ID
 */
export function getModuleIdForCategory(category: string, actionType?: string): string {
  const cat = (category || '').toUpperCase();
  const act = (actionType || '').toUpperCase();

  if (act.includes('REMOTE_WORK')) return 'pa-remote-work';
  if (act.includes('ACCESS_REQUEST') || act.includes('MODULE_ACCESS')) return 'pa-access-requests';
  if (cat === 'ATTENDANCE' || act.includes('ATTENDANCE') || act.includes('PUNCH')) {
    return 'pa-attendance';
  }
  if (cat === 'LEAVE' || act.includes('LEAVE') || act.includes('WEEK_OFF')) {
    return 'pa-leave';
  }
  if (cat === 'PAYROLL' || act.includes('PAYROLL') || act.includes('SALARY') || act.includes('ADVANCE')) {
    return 'pa-payroll';
  }
  if (cat === 'EMPLOYEE' || act.includes('EMPLOYEE')) {
    return 'pa-employees';
  }
  if (cat === 'EXPENSE' || act.includes('EXPENSE')) return 'pa-payroll';
  if (cat === 'RKD' || act.includes('RKD')) return 'pa-commission';
  return 'pa-notifications';
}


/**
 * Dispatch an EMPLOYEE-SPECIFIC notification.
 * Targets ONLY the specified employee's user account.
 * Other employees receive NOTHING.
 */
export async function notifyEmployee(params: SendEmployeeNotificationParams): Promise<{ notificationId: number; deliveryStatus: string; fcmMessageId: string | null; failureReason: string | null } | undefined> {
  const { category = 'GENERAL', actionType, actionId, screen, clickRoute, extraData } = params;
  const title = params.title;
  const message = params.body || params.message || '';

  try {
    let targetUserId = params.targetUserId ?? params.userId;
    let targetEmployeeId = params.targetEmployeeId ?? params.employeeId;

    if (!targetUserId && targetEmployeeId) {
      const emp = await prisma.employee.findUnique({
        where: { id: targetEmployeeId },
        select: { userId: true },
      });
      targetUserId = emp?.userId || undefined;
    } else if (targetUserId && !targetEmployeeId) {
      const emp = await prisma.employee.findFirst({
        where: { userId: targetUserId },
        select: { id: true },
      });
      targetEmployeeId = emp?.id || undefined;
    }

    if (!targetUserId) {
      console.warn(`[notifyEmployee] No valid userId found for employeeId=${targetEmployeeId}. Skipping notification.`);
      return;
    }

    // 1. In-App Notification (Database) - strictly tied to this employee's userId
    const notificationData = {
      userId: targetUserId,
      employeeId: targetEmployeeId || null,
      title,
      body: message,
      category: category.toUpperCase(),
      actionType: actionType || 'GENERAL',
      actionId: actionId ? String(actionId) : null,
      isRead: false,
      deliveryStatus: 'PENDING',
    };
    // A transaction-scoped lock serializes this event across backend processes.
    // Push runs after commit; retries never resend an uncertain provider outcome.
    const notification = params.deduplicate && actionId
      ? await prisma.$transaction(async tx => {
          const key = `${targetUserId}:${category}:${actionType}:${actionId}`;
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
          const existing = await tx.notification.findFirst({ where: {
            userId: targetUserId!, category: category.toUpperCase(),
            actionType: actionType || 'GENERAL', actionId: String(actionId),
            ...(params.eventSince ? { createdAt: { gte: params.eventSince } } : {}),
          } });
          if (existing) return null;
          return tx.notification.create({ data: notificationData });
        })
      : await prisma.notification.create({ data: notificationData });
    if (!notification) return;

    const defaultRoute = getEmployeeTargetRoute(category, actionType);
    const targetScreen = screen || defaultRoute;
    const targetWebRoute = clickRoute || defaultRoute;

    // 2. FCM Push Notification (both mobile & web tokens for this employee)
    let deliveryStatus = 'IN_APP_ONLY';
    let failureReason: string | null = null;
    let fcmMessageId: string | null = null;

    try {
      const result = await firebaseNotificationService.sendNotificationToUser(
        targetUserId,
        title,
        message,
        {
          id: String(notification.id),
          notificationId: String(notification.id),
          title,
          body: message,
          type: actionType || 'GENERAL',
          notificationType: actionType || 'GENERAL',
          actionType: actionType || 'GENERAL',
          actionId: actionId ? String(actionId) : '',
          entityType: category.toUpperCase(),
          ...(actionId ? { entityId: String(actionId), referenceId: String(actionId) } : {}),
          category: category.toUpperCase(),
          screen: targetScreen,
          route: targetWebRoute,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          web_url: targetWebRoute,
          ...(targetEmployeeId ? { employeeId: String(targetEmployeeId) } : {}),
          ...extraData,
        },
        { priority: { high: true } }
      );

      const totalAttempted = result.successCount + result.failureCount;
      const unverified = result.responses.length !== totalAttempted ||
        result.responses.some(response => response.success && !response.messageId);
      if (totalAttempted === 0) {
        deliveryStatus = 'IN_APP_ONLY';
      } else if (unverified) {
        deliveryStatus = 'UNKNOWN';
      } else if (result.failureCount > 0) {
        deliveryStatus = result.successCount > 0 ? 'PARTIAL' : 'FAILED';
      } else if (result.successCount > 0) {
        deliveryStatus = 'SENT';
      } else {
        deliveryStatus = 'IN_APP_ONLY';
      }

      fcmMessageId = result.responses.find((r) => r.success)?.messageId || null;
      const codes = [
        ...new Set(result.responses.filter((r) => !r.success).map((r) => r.error?.code || 'messaging/unknown-error')),
      ];
      if (codes.length) {
        failureReason = codes.join(', ');
        console.warn('[notifyEmployee] FCM rejected token(s)', { notificationId: notification.id, codes });
      }
    } catch (fcmErr: any) {
      const code = typeof fcmErr?.code === 'string' && /^[a-zA-Z0-9/_-]+$/.test(fcmErr.code) ? fcmErr.code : 'messaging/unknown-outcome';
      deliveryStatus = ['configuration', 'credentials', 'permission', 'token'].includes(safeFcmError(fcmErr).category)
        ? 'FAILED'
        : 'UNKNOWN';
      failureReason = code;
      console.warn('[notifyEmployee] Push dispatch failed', { notificationId: notification.id, ...safeFcmError(fcmErr) });
    }

    // Persist actual delivery status & provider details
    await prisma.notification.update({
      where: { id: notification.id },
      data: { deliveryStatus, failureReason, fcmMessageId },
    });

    // 3. Emit real-time WebSocket notification to employee if connected
    try {
      const ws = getWebSocketInstance();
      if (ws) {
        ws.sendToUser(targetUserId, {
          type: 'new_notification',
          data: {
            id: String(notification.id),
            notificationId: String(notification.id),
            type: actionType || category.toUpperCase(),
            title,
            body: message,
            category: category.toUpperCase(),
            actionType,
            actionId,
          },
        });
      }
    } catch {
      // Notification persistence and provider outcome are independent of WebSocket availability.
    }
    return { notificationId: notification.id, deliveryStatus, fcmMessageId, failureReason };
  } catch (err) {
    console.error('⚠️ [notifyEmployee] Error sending employee notification:', err);
  }
}

/**
 * Dispatch an HR/ADMIN notification.
 * Targets ONLY authorized HR and Admin users who have permission for this module.
 * Standard employees receive NOTHING.
 */
export async function notifyHRAndAdmins(params: SendHRNotificationParams): Promise<NonNullable<Awaited<ReturnType<typeof notifyEmployee>>>[] | undefined> {
  const { category = 'GENERAL', actionType, actionId, employeeId, requiredModuleId } = params;
  const title = params.title;
  const message = params.body || params.message || '';

  try {
    const candidateRoles: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.PLATFORM_ADMIN];

    if (actionType?.startsWith('ATTENDANCE_CORRECTION')) candidateRoles.push(Role.STORE_MANAGER);

    const hrUsers = await prisma.user.findMany({
      where: {
        role: { in: candidateRoles },
        isActive: true,
      },
      select: { id: true, role: true },
    });

    if (hrUsers.length === 0) {
      return [];
    }

    const moduleId = requiredModuleId || getModuleIdForCategory(category, actionType);
    let authorizedUsers = hrUsers;

    // Enforce permission checks if module ID is specified
    if (moduleId) {
      const userIds = hrUsers.map((u) => u.id);
      const [userPerms, rolePerms] = await Promise.all([
        prisma.userPermission.findMany({
          where: { userId: { in: userIds } },
        }),
        prisma.rolePermission.findMany({
          where: { role: { in: candidateRoles } },
        }),
      ]);

      const userPermMap = new Map(userPerms.map((p) => [p.userId, p.permissions as Record<string, any>]));
      const rolePermMap = new Map(rolePerms.map((p) => [p.role, p.permissions as Record<string, any>]));

      authorizedUsers = hrUsers.filter((u) => {
        // Super Admin & Platform Admin always have full access
        if (u.role === Role.SUPER_ADMIN || u.role === Role.PLATFORM_ADMIN) {
          return true;
        }

        // Check user-specific permissions
        const uPerm = userPermMap.get(u.id);
        if (uPerm && typeof uPerm[moduleId] === 'boolean') {
          return uPerm[moduleId];
        }

        // Check role permissions
        const rPerm = rolePermMap.get(u.role);
        if (rPerm && typeof rPerm[moduleId] === 'boolean') {
          return rPerm[moduleId];
        }

        // Default: HR and ADMIN have access unless explicitly revoked
        return true;
      });
    }

    if (authorizedUsers.length === 0) {
      return [];
    }

    authorizedUsers = authorizedUsers.filter(user => user.id !== params.excludeUserId);
    const targetRoute = getHRTargetRoute(category, actionType);
    // Record and dispatch per authorized recipient. A rejected token must never
    // mark another recipient's notification FAILED or attach their message ID.
    const outcomes: NonNullable<Awaited<ReturnType<typeof notifyEmployee>>>[] = [];
    for (let offset = 0; offset < authorizedUsers.length; offset += 10) {
      const batch = await Promise.all(authorizedUsers.slice(offset, offset + 10).map(user => notifyEmployee({
        userId: user.id,
        employeeId: employeeId || undefined,
        title,
        body: message,
        category,
        actionType: actionType || 'GENERAL',
        actionId,
        deduplicate: params.deduplicate || actionType?.startsWith('ATTENDANCE_CORRECTION') || actionType === 'SALARY_APPROVED',
        eventSince: params.eventSince,
        extraData: params.extraData,
        screen: targetRoute,
        clickRoute: targetRoute,
      })));
      for (const result of batch) if (result) outcomes.push(result);
    }
    return outcomes;
  } catch (err) {
    console.error('⚠️ [notifyHRAndAdmins] Error sending HR/Admin notification:', err);
  }
}

/**
 * Backward-compatible alias for notifyHRAndAdmins
 */
export async function sendHRNotification(params: SendHRNotificationParams) {
  return notifyHRAndAdmins(params);
}


