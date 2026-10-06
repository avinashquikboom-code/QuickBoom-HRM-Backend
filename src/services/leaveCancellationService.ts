import { prisma } from '../utils/db';
import leaveBalanceService from './leaveBalanceService';
import { getEffectiveUserPermissions } from '../utils/permissionHelper';
import { getWebSocketInstance } from '../utils/websocketSingleton';
import { sendHRNotification, notifyEmployee } from '../utils/hrNotificationHelper';

export interface CancelLeaveUserContext {
  id: number;
  email?: string | null;
  role?: string;
}

export interface CancelLeaveResult {
  success: boolean;
  message: string;
  leave?: any;
}

/**
 * Helper function to format a Date into YYYY-MM-DD string in a specified timezone.
 */
export function formatLocalDateString(dateInput: Date, timezone: string = 'Asia/Kolkata'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(dateInput);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    return `${year}-${month}-${day}`;
  } catch (e) {
    return dateInput.toISOString().split('T')[0];
  }
}

/**
 * Checks whether an employee has an active APPROVED Leave or Week Off for a target date.
 *
 * CRITICAL RULE:
 * Cancelled Leave/Week Off requests (status === 'CANCELLED') do NOT block attendance.
 * Pending and Rejected requests also do NOT block attendance.
 * Only requests with status === 'APPROVED' block attendance.
 */
export async function getActiveApprovedLeaveForDate(
  employeeId: number,
  targetDateStr: string,
  timezone: string = 'Asia/Kolkata'
) {
  const parts = targetDateStr.split('-').map(Number);
  const year = parts[0];
  const month = parts[1] - 1;
  const day = parts[2];

  const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  const searchStart = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
  const searchEnd = new Date(endOfDay.getTime() + 24 * 60 * 60 * 1000);

  // Strictly query status === 'APPROVED'. CANCELLED leaves are ignored.
  const activeLeaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      fromDate: { lte: searchEnd },
      toDate: { gte: searchStart }
    }
  });

  for (const leave of activeLeaves) {
    const fromUtc = leave.fromDate.toISOString().split('T')[0];
    const toUtc = leave.toDate.toISOString().split('T')[0];
    const fromLocal = formatLocalDateString(leave.fromDate, timezone);
    const toLocal = formatLocalDateString(leave.toDate, timezone);

    const matchesUtc = targetDateStr >= fromUtc && targetDateStr <= toUtc;
    const matchesLocal = targetDateStr >= fromLocal && targetDateStr <= toLocal;

    if (matchesUtc || matchesLocal) {
      return leave;
    }
  }

  return null;
}

/**
 * Cancels a Leave or Week Off request (whether PENDING or previously APPROVED).
 * Preserves the historical record with status 'CANCELLED'.
 * Cleans up unpunched placeholder attendance records so attendance is unlocked.
 */
export async function cancelLeaveRequest(
  leaveId: number,
  user: CancelLeaveUserContext,
  reason?: string
) {
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveId },
    include: {
      employee: {
        include: {
          user: true,
          department: true,
          office: true
        }
      }
    }
  });

  if (!leave) {
    throw new Error('Leave request not found.');
  }

  // Authorization check
  const isAdminOrHr = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'].includes(user.role || '');
  const employeeOfUser = await prisma.employee.findFirst({
    where: { userId: user.id }
  });

  const isOwner = employeeOfUser ? employeeOfUser.id === leave.employeeId : false;

  if (!isOwner && !isAdminOrHr) {
    throw new Error('You are not authorized to cancel this leave request.');
  }

  if (isOwner && !isAdminOrHr) {
    const permissions = await getEffectiveUserPermissions(user.id);
    if (permissions.canCancelLeave === false) {
      throw new Error('You do not have permission to cancel leave requests.');
    }
  }

  // Status validations
  if (leave.status === 'CANCELLED') {
    throw new Error('Leave request is already cancelled.');
  }

  if (leave.status === 'REJECTED') {
    throw new Error('Cannot cancel a rejected leave request.');
  }

  const wasApproved = leave.status === 'APPROVED';
  const cancellationNote = reason
    ? `Cancelled by ${user.email || 'employee'}: ${reason}`
    : `Cancelled by ${user.email || 'employee'}`;

  // Update status to CANCELLED (Never delete the request)
  const updatedLeave = await prisma.leaveRequest.update({
    where: { id: leave.id },
    data: {
      status: 'CANCELLED',
      reviewNote: leave.reviewNote ? `${leave.reviewNote} | ${cancellationNote}` : cancellationNote,
      reviewedAt: new Date()
    },
    include: {
      employee: {
        include: {
          user: true,
          department: true
        }
      }
    }
  });

  // If the request was previously approved:
  if (wasApproved) {
    // 1. Revert deducted used days in leave balance
    try {
      const days = Math.ceil((leave.toDate.getTime() - leave.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      await leaveBalanceService.updateUsedLeave(leave.employeeId, leave.type, -days);
    } catch (balErr) {
      console.error('Failed to revert leave balance upon cancellation:', balErr);
    }

    // 2. Clean up auto-created placeholder attendance records that have NO punches
    try {
      const curr = new Date(leave.fromDate);
      const end = new Date(leave.toDate);

      while (curr <= end) {
        const dateStr = curr.toISOString().split('T')[0];

        // Find placeholder record with no check-in / check-out
        const placeholderAtt = await prisma.attendance.findFirst({
          where: {
            employeeId: leave.employeeId,
            date: dateStr,
            checkIn: null,
            checkOut: null
          }
        });

        if (placeholderAtt && ['LEAVE', 'WEEK_OFF', 'WEEKEND'].includes(placeholderAtt.status)) {
          await prisma.attendance.delete({
            where: { id: placeholderAtt.id }
          });
          console.log(`🧹 Removed placeholder attendance record for date ${dateStr} after leave cancellation.`);
        }

        curr.setDate(curr.getDate() + 1);
      }
    } catch (attErr) {
      console.error('Failed to clear placeholder attendance records:', attErr);
    }
  }

  // 3. Log audit action
  try {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        employeeId: leave.employeeId,
        action: `LEAVE_CANCELLED: Request #${leave.id} (${leave.type})`,
        deviceInfo: 'App/Web'
      }
    });
  } catch (auditErr) {
    console.error('Failed to record audit log for leave cancellation:', auditErr);
  }

  // 4. Send notification
  try {
    const isWeekOff = leave.type === 'WEEK_OFF' || leave.type === 'WEEKOFF';
    const notifyTitle = `${isWeekOff ? 'Week-off' : 'Leave'} Cancellation Request`;
    const notifyBody = `${leave.employee.firstName} ${leave.employee.lastName} cancelled the ${isWeekOff ? 'week-off' : `${leave.type} leave`} request from ${leave.fromDate.toISOString().split('T')[0]} to ${leave.toDate.toISOString().split('T')[0]}.`;

    // 1. Notify Employee (in-app + FCM push)
    if (leave.employee.userId) {
      await notifyEmployee({
        employeeId: leave.employeeId,
        userId: leave.employee.userId,
        title: `${isWeekOff ? 'Week Off' : 'Leave'} Cancelled`,
        message: isAdminOrHr && !isOwner
          ? `Your ${isWeekOff ? 'week off' : `${leave.type} leave`} request was cancelled by ${user.email || 'HR'}.`
          : `Your ${isWeekOff ? 'week off' : `${leave.type} leave`} request from ${leave.fromDate.toISOString().split('T')[0]} to ${leave.toDate.toISOString().split('T')[0]} has been cancelled.`,
        category: 'LEAVE',
        actionType: 'LEAVE_CANCELLED',
        actionId: leave.id.toString(),
      });
    }

    // 2. Notify HR / Admins (in-app + FCM push)
    await sendHRNotification({
      title: notifyTitle,
      message: notifyBody,
      category: 'LEAVE',
      actionType: 'LEAVE_CANCELLED',
      actionId: leave.id.toString(),
      employeeId: leave.employeeId,
    });
  } catch (notifErr) {
    console.error('Failed to send leave cancellation notifications:', notifErr);
  }

  // 5. Broadcast WebSocket event
  try {
    const ws = getWebSocketInstance();
    if (ws) {
      const io = ws.getServer();
      if (io) {
        io.emit('leave_status_updated', {
          leaveId: leave.id,
          employeeId: leave.employeeId,
          status: 'CANCELLED'
        });
      }
    }
  } catch (wsErr) {
    // Silently continue
  }

  return updatedLeave;
}
