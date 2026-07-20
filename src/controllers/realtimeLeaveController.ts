import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

// ==========================================
// Real-time Leave Updates Controller
// ==========================================

// Get pending leave requests for HR/Admin (for real-time updates)
export const getPendingLeaveRequests = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Check if user has HR/Admin role
    if (!['HR', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'ADMIN'].includes(req.user?.role || '')) {
      res.status(403).json({
        success: false,
        message: 'Access denied. HR/Admin role required.',
        errorCode: 'ACCESS_DENIED'
      });
      return;
    }

    const { limit = 20, offset = 0 } = req.query;

    const pendingLeaves = await prisma.leaveRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        employee: {
          include: {
            user: true,
            department: true,
            office: true
          }
        }
      },
      orderBy: { appliedOn: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });

    const formattedLeaves = pendingLeaves.map(leave => ({
      id: leave.id.toString(),
      type: leave.type,
      typeLabel: leave.type === 'CASUAL' ? 'Casual Leave' : leave.type === 'SICK' ? 'Sick Leave' : 'Earned Leave',
      fromDate: leave.fromDate.toISOString().split('T')[0],
      toDate: leave.toDate.toISOString().split('T')[0],
      reason: leave.reason,
      status: leave.status,
      statusLabel: leave.status.charAt(0) + leave.status.slice(1).toLowerCase(),
      appliedOn: leave.appliedOn.toISOString(),
      days: Math.ceil((leave.toDate.getTime() - leave.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      employee: {
        id: leave.employee.id.toString(),
        employeeCode: leave.employee.employeeCode,
        name: `${leave.employee.firstName} ${leave.employee.lastName}`,
        firstName: leave.employee.firstName,
        lastName: leave.employee.lastName,
        designation: leave.employee.designation,
        email: leave.employee.user?.email || '',
        department: leave.employee.department?.name || 'N/A',
        office: leave.employee.office?.name || 'N/A'
      }
    }));

    res.json({
      success: true,
      data: {
        leaveRequests: formattedLeaves,
        count: formattedLeaves.length,
        hasMore: pendingLeaves.length === parseInt(limit as string)
      }
    });
  } catch (error) {
    console.error('Get pending leave requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending leave requests.',
      errorCode: 'GET_PENDING_LEAVES_ERROR'
    });
  }
};

// Get recent leave activity (for admin dashboard real-time updates)
export const getRecentLeaveActivity = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Check if user has HR/Admin role
    if (!['HR', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'ADMIN'].includes(req.user?.role || '')) {
      res.status(403).json({
        success: false,
        message: 'Access denied. HR/Admin role required.',
        errorCode: 'ACCESS_DENIED'
      });
      return;
    }

    const { limit = 10 } = req.query;

    const recentActivity = await prisma.leaveRequest.findMany({
      where: {
        status: { in: ['APPROVED', 'REJECTED'] },
        reviewedAt: { not: null }
      },
      include: {
        employee: {
          include: {
            user: true
          }
        }
      },
      orderBy: { reviewedAt: 'desc' },
      take: parseInt(limit as string)
    });

    const formattedActivity = recentActivity.map(activity => ({
      id: activity.id.toString(),
      type: activity.type,
      typeLabel: activity.type === 'CASUAL' ? 'Casual Leave' : activity.type === 'SICK' ? 'Sick Leave' : 'Earned Leave',
      status: activity.status,
      statusLabel: activity.status.charAt(0) + activity.status.slice(1).toLowerCase(),
      reviewedBy: activity.reviewedBy,
      reviewNote: activity.reviewNote,
      reviewedAt: activity.reviewedAt || activity.updatedAt,
      employee: {
        id: activity.employee.id.toString(),
        name: `${activity.employee.firstName} ${activity.employee.lastName}`,
        employeeCode: activity.employee.employeeCode,
        email: activity.employee.user?.email || ''
      }
    }));

    res.json({
      success: true,
      data: {
        activities: formattedActivity,
        count: formattedActivity.length
      }
    });
  } catch (error) {
    console.error('Get recent leave activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent leave activity.',
      errorCode: 'GET_RECENT_ACTIVITY_ERROR'
    });
  }
};

// Get leave request statistics for real-time dashboard
export const getLeaveRequestStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Check if user has HR/Admin role
    if (!['HR', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'ADMIN'].includes(req.user?.role || '')) {
      res.status(403).json({
        success: false,
        message: 'Access denied. HR/Admin role required.',
        errorCode: 'ACCESS_DENIED'
      });
      return;
    }

    const { timeRange = '7d' } = req.query;
    
    // Calculate date range based on timeRange
    let startDate = new Date();
    switch (timeRange) {
      case '1d':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }

    const stats = await prisma.leaveRequest.groupBy({
      by: ['status'],
      where: {
        appliedOn: { gte: startDate }
      },
      _count: {
        id: true
      }
    });

    const formattedStats = {
      total: stats.reduce((sum, stat) => sum + stat._count.id, 0),
      pending: stats.find(s => s.status === 'PENDING')?._count.id || 0,
      approved: stats.find(s => s.status === 'APPROVED')?._count.id || 0,
      rejected: stats.find(s => s.status === 'REJECTED')?._count.id || 0,
      timeRange,
      startDate: startDate.toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0]
    };

    res.json({
      success: true,
      data: formattedStats
    });
  } catch (error) {
    console.error('Get leave request stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leave request statistics.',
      errorCode: 'GET_LEAVE_STATS_ERROR'
    });
  }
};

// Get notifications for HR users about leave requests
export const getLeaveNotifications = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Check if user has HR/Admin role
    if (!['HR', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'ADMIN'].includes(req.user?.role || '')) {
      res.status(403).json({
        success: false,
        message: 'Access denied. HR/Admin role required.',
        errorCode: 'ACCESS_DENIED'
      });
      return;
    }

    const { limit = 20, unreadOnly = false } = req.query;

    let whereClause: any = {
      userId: req.user?.id,
      category: 'LEAVE'
    };

    if (unreadOnly === 'true') {
      whereClause.isRead = false;
    }

    const notifications = await prisma.notification.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string)
    });

    const formattedNotifications = notifications.map(notification => ({
      id: notification.id.toString(),
      title: notification.title,
      body: notification.body,
      category: notification.category,
      actionId: notification.actionId,
      actionType: notification.actionType,
      isRead: notification.isRead,
      createdAt: notification.createdAt.toISOString(),
      urgency: notification.actionType === 'LEAVE_APPLICATION' ? 'high' : 'normal'
    }));

    res.json({
      success: true,
      data: {
        notifications: formattedNotifications,
        count: formattedNotifications.length,
        unreadCount: formattedNotifications.filter(n => !n.isRead).length
      }
    });
  } catch (error) {
    console.error('Get leave notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leave notifications.',
      errorCode: 'GET_LEAVE_NOTIFICATIONS_ERROR'
    });
  }
};

// Mark leave notifications as read
export const markLeaveNotificationsRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { notificationIds } = req.body;

    if (!notificationIds || !Array.isArray(notificationIds)) {
      res.status(400).json({
        success: false,
        message: 'Notification IDs array is required.',
        errorCode: 'MISSING_NOTIFICATION_IDS'
      });
      return;
    }

    await prisma.notification.updateMany({
      where: {
        id: { in: notificationIds.map(id => id) },
        userId: req.user?.id
      },
      data: { isRead: true }
    });

    res.json({
      success: true,
      message: 'Notifications marked as read successfully.'
    });
  } catch (error) {
    console.error('Mark leave notifications read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notifications as read.',
      errorCode: 'MARK_NOTIFICATIONS_READ_ERROR'
    });
  }
};
