import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { firebaseNotificationService } from '../services/firebaseNotificationService';

// Helper to extract employee id from request
async function getEmployeeForUser(userId: number) {
  return prisma.employee.findUnique({
    where: { userId },
    include: { office: true, store: true, branch: true }
  });
}

function parseDayBoundaries(fromDate: string, toDate: string): { start: Date; end: Date } {
  let start: Date;
  let end: Date;

  if (typeof fromDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fromDate.trim())) {
    const [y1, m1, d1] = fromDate.trim().split('-').map(Number);
    start = new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0, 0));
  } else {
    const dt = new Date(fromDate);
    start = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 0, 0, 0, 0));
  }

  if (typeof toDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(toDate.trim())) {
    const [y2, m2, d2] = toDate.trim().split('-').map(Number);
    end = new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999));
  } else {
    const dt = new Date(toDate);
    end = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 23, 59, 59, 999));
  }

  return { start, end };
}

/**
 * 1. POST /api/mobile/remote-work/apply
 * Employee applies for Remote Work or resubmits existing request
 */
export const applyRemoteWork = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const employee = await getEmployeeForUser(userId);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found' });
      return;
    }

    const { fromDate, toDate, reason, requestId } = req.body;
    if (!fromDate || !toDate) {
      res.status(400).json({ success: false, message: 'fromDate and toDate are required' });
      return;
    }

    const { start, end } = parseDayBoundaries(fromDate, toDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({ success: false, message: 'Invalid date format' });
      return;
    }

    if (start > end) {
      res.status(400).json({ success: false, message: 'fromDate cannot be after toDate' });
      return;
    }

    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24));
    if (diffDays > 30) {
      res.status(400).json({ success: false, message: 'Remote work request cannot exceed 30 days' });
      return;
    }

    const empIdStr = String(employee.id);

    // Check for overlapping PENDING or APPROVED requests for this employee (excluding the request being edited/resubmitted)
    const whereOverlap: any = {
      employeeId: empIdStr,
      status: { in: ['PENDING', 'APPROVED'] },
      fromDate: { lte: end },
      toDate: { gte: start },
    };

    if (requestId) {
      whereOverlap.id = { not: String(requestId) };
    }

    const existingActiveRequest = await prisma.remoteWorkRequest.findFirst({
      where: whereOverlap
    });

    if (existingActiveRequest) {
      res.status(400).json({
        success: false,
        message: `You already have an active or pending remote work request (${existingActiveRequest.status}) that overlaps with these dates.`
      });
      return;
    }

    let requestResult;
    if (requestId) {
      const existingReq = await prisma.remoteWorkRequest.findUnique({
        where: { id: String(requestId) }
      });

      if (existingReq && (existingReq.employeeId === empIdStr || existingReq.employeeId === employee.employeeCode)) {
        requestResult = await prisma.remoteWorkRequest.update({
          where: { id: String(requestId) },
          data: {
            fromDate: start,
            toDate: end,
            reason: reason ? String(reason).trim() : null,
            status: 'PENDING',
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
            updatedAt: new Date()
          }
        });
      }
    }

    if (!requestResult) {
      requestResult = await prisma.remoteWorkRequest.create({
        data: {
          employeeId: empIdStr,
          fromDate: start,
          toDate: end,
          reason: reason ? String(reason).trim() : null,
          status: 'PENDING',
        }
      });
    }

    // FCM Notification to HR role
    const dateStr = `${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`;
    try {
      await firebaseNotificationService.sendNotificationToRole(
        'HR',
        'New Remote Work Request',
        `Remote work request from ${employee.firstName} ${employee.lastName} (${dateStr})`,
        {
          click_action: 'REMOTE_WORK_REQUEST',
          requestId: requestResult.id,
          employeeId: empIdStr
        }
      );
    } catch (fcmErr) {
      console.warn('Failed to send FCM notification to HR for remote work apply:', fcmErr);
    }

    res.status(200).json({
      success: true,
      message: requestId ? 'Remote work request resubmitted successfully.' : 'Remote work request submitted successfully.',
      data: requestResult
    });
  } catch (error: any) {
    console.error('Error in applyRemoteWork:', error);
    res.status(500).json({ success: false, message: 'Failed to submit remote work request.' });
  }
};

/**
 * 2. GET /api/mobile/remote-work/my-requests
 * Employee views request history
 */
export const getMyRemoteWorkRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const employee = await getEmployeeForUser(userId);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found' });
      return;
    }

    const empIdStr = String(employee.id);
    const requests = await prisma.remoteWorkRequest.findMany({
      where: {
        OR: [
          { employeeId: empIdStr },
          { employeeId: employee.employeeCode }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    const serialized = requests.map(r => ({
      id: String(r.id),
      employeeId: String(r.employeeId),
      fromDate: r.fromDate instanceof Date ? r.fromDate.toISOString() : String(r.fromDate),
      toDate: r.toDate instanceof Date ? r.toDate.toISOString() : String(r.toDate),
      reason: r.reason || null,
      status: r.status,
      appliedOn: r.appliedOn instanceof Date ? r.appliedOn.toISOString() : String(r.appliedOn || r.createdAt),
      reviewedBy: r.reviewedBy || null,
      reviewedAt: r.reviewedAt instanceof Date ? r.reviewedAt.toISOString() : (r.reviewedAt ? String(r.reviewedAt) : null),
      reviewNote: r.reviewNote || null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    }));

    res.json({
      success: true,
      data: serialized
    });
  } catch (error: any) {
    console.error('Error in getMyRemoteWorkRequests:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch remote work requests.' });
  }
};


/**
 * 3. GET /api/hr/remote-work/requests
 * HR views all requests (with optional status filter)
 */
export const getHrRemoteWorkRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rawStatus = req.query.status;
    const statusParam = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
    const statusFilter = statusParam ? String(statusParam).trim().toUpperCase() : undefined;

    const whereClause: any = {};
    if (statusFilter && statusFilter !== 'ALL') {
      whereClause.status = statusFilter;
    }

    const requests = await prisma.remoteWorkRequest.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });

    // Fetch employee details for each request
    const numericEmployeeIds = Array.from(
      new Set(
        requests
          .map(r => parseInt(String(r.employeeId), 10))
          .filter(id => !isNaN(id) && id > 0)
      )
    );
    const stringEmployeeIds = Array.from(
      new Set(
        requests
          .map(r => String(r.employeeId).trim())
          .filter(Boolean)
      )
    );

    const employees = await prisma.employee.findMany({
      where: {
        OR: [
          { id: { in: numericEmployeeIds.length > 0 ? numericEmployeeIds : [-1] } },
          { employeeCode: { in: stringEmployeeIds.length > 0 ? stringEmployeeIds : ['__NONE__'] } }
        ]
      },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        designation: true,
        office: { select: { name: true } },
        store: { select: { name: true } },
        branch: { select: { name: true } }
      }
    });

    const empMapById = new Map(employees.map(e => [String(e.id), e]));
    const empMapByCode = new Map(employees.map(e => [e.employeeCode, e]));

    const enriched = requests.map(r => {
      const emp = empMapById.get(String(r.employeeId)) || empMapByCode.get(String(r.employeeId)) || null;
      const officeName = emp?.office?.name || emp?.store?.name || emp?.branch?.name || null;

      return {
        id: String(r.id),
        employeeId: String(r.employeeId),
        fromDate: r.fromDate instanceof Date ? r.fromDate.toISOString() : String(r.fromDate),
        toDate: r.toDate instanceof Date ? r.toDate.toISOString() : String(r.toDate),
        reason: r.reason || null,
        status: r.status,
        appliedOn: r.appliedOn instanceof Date ? r.appliedOn.toISOString() : String(r.appliedOn || r.createdAt),
        reviewedBy: r.reviewedBy || null,
        reviewedAt: r.reviewedAt instanceof Date ? r.reviewedAt.toISOString() : (r.reviewedAt ? String(r.reviewedAt) : null),
        reviewNote: r.reviewNote || null,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
        employee: emp ? {
          id: emp.id,
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
          designation: emp.designation || null,
          office: officeName ? { name: officeName } : null
        } : null
      };
    });

    res.json({
      success: true,
      data: enriched
    });
  } catch (error: any) {
    console.error('Error in getHrRemoteWorkRequests:', error);
    res.status(500).json({ success: false, message: error?.message || 'Failed to fetch HR remote work requests.', data: [] });
  }
};

/**
 * 4. PATCH /api/hr/remote-work/:id
 * HR approves, rejects, or revokes a remote work request
 */
export const reviewRemoteWorkRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const requestId = Array.isArray(rawId) ? rawId[0] : String(rawId);
    const { status, reviewNote } = req.body;

    const validStatuses = ['APPROVED', 'REJECTED', 'REVOKED'];
    const newStatus = String(status).toUpperCase();

    if (!validStatuses.includes(newStatus)) {
      res.status(400).json({
        success: false,
        message: 'Invalid status. Must be APPROVED, REJECTED, or REVOKED.'
      });
      return;
    }

    const request = await prisma.remoteWorkRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) {
      res.status(404).json({ success: false, message: 'Remote work request not found' });
      return;
    }

    const reviewerIdStr = req.user?.id ? String(req.user.id) : 'HR';

    const updated = await prisma.remoteWorkRequest.update({
      where: { id: requestId },
      data: {
        status: newStatus,
        reviewedBy: reviewerIdStr,
        reviewedAt: new Date(),
        reviewNote: reviewNote ? String(reviewNote).trim() : null
      }
    });

    // FCM Notification to Employee (safely wrapped)
    const empNumericId = parseInt(request.employeeId, 10);
    if (!isNaN(empNumericId)) {
      try {
        const empUser = await prisma.employee.findUnique({
          where: { id: empNumericId },
          select: { userId: true, firstName: true }
        });

        if (empUser && empUser.userId) {
          const fromStr = request.fromDate.toISOString().split('T')[0];
          const toStr = request.toDate.toISOString().split('T')[0];

          let msgTitle = 'Remote Work Status Update';
          let msgBody = `Your remote work request (${fromStr} to ${toStr}) has been ${newStatus.toLowerCase()}.`;

          if (newStatus === 'APPROVED') {
            msgTitle = '✅ Remote Work Approved';
            msgBody = `Your remote work request for ${fromStr} to ${toStr} is approved. You can punch from anywhere!`;
          } else if (newStatus === 'REJECTED') {
            msgTitle = '❌ Remote Work Request Rejected';
            msgBody = `Remote work request rejected. ${reviewNote ? 'Note: ' + reviewNote : ''}`;
          } else if (newStatus === 'REVOKED') {
            msgTitle = '⚠️ Remote Work Approval Revoked';
            msgBody = `Your remote work permission has been revoked by HR. Normal store geofence is now in effect.`;
          }

          try {
            await prisma.notification.create({
              data: {
                userId: empUser.userId,
                title: msgTitle,
                body: msgBody,
                category: 'ATTENDANCE',
                actionId: updated.id,
                actionType: 'REMOTE_WORK_STATUS',
                isRead: false,
              }
            });
          } catch (dbNotifErr) {
            console.warn('Failed to create in-app notification for remote work status update:', dbNotifErr);
          }

          try {
            await firebaseNotificationService.sendNotificationToUser(
              empUser.userId,
              msgTitle,
              msgBody,
              {
                click_action: 'REMOTE_WORK_STATUS',
                requestId: updated.id,
                status: newStatus
              }
            );
          } catch (fcmErr) {
            console.warn('Failed to send FCM to employee for remote work status update:', fcmErr);
          }
        }
      } catch (empErr) {
        console.warn('Failed to look up employee user for notification:', empErr);
      }
    }

    res.json({
      success: true,
      message: `Remote work request ${newStatus.toLowerCase()} successfully.`,
      data: updated
    });
  } catch (error: any) {
    console.error('Error in reviewRemoteWorkRequest:', error);
    res.status(500).json({ success: false, message: error?.message || 'Failed to review remote work request.' });
  }
};

/**
 * 5. GET /api/mobile/remote-work/status (CRITICAL)
 * Checks if TODAY falls within an APPROVED remote work period for this employee.
 */
export const getRemoteWorkStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const employee = await getEmployeeForUser(userId);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found' });
      return;
    }

    const empIdStr = String(employee.id);
    const now = new Date();

    const activeRemoteRequest = await prisma.remoteWorkRequest.findFirst({
      where: {
        employeeId: empIdStr,
        status: 'APPROVED',
        fromDate: { lte: now },
        toDate: { gte: now }
      }
    });

    if (activeRemoteRequest) {
      res.json({
        success: true,
        data: {
          isRemoteApproved: true,
          fromDate: activeRemoteRequest.fromDate.toISOString().split('T')[0],
          toDate: activeRemoteRequest.toDate.toISOString().split('T')[0],
          requestId: activeRemoteRequest.id,
          reason: activeRemoteRequest.reason
        }
      });
    } else {
      res.json({
        success: true,
        data: {
          isRemoteApproved: false,
          fromDate: null,
          toDate: null,
          requestId: null
        }
      });
    }
  } catch (error: any) {
    console.error('Error in getRemoteWorkStatus:', error);
    res.status(500).json({ success: false, message: error?.message || 'Failed to check remote work status.' });
  }
};

