import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { firebaseNotificationService } from '../services/firebaseNotificationService';

// Helper to extract employee id from request
async function getEmployeeForUser(userId: number) {
  return prisma.employee.findUnique({
    where: { userId },
    include: { office: true }
  });
}

/**
 * 1. POST /api/mobile/remote-work/apply
 * Employee applies for Remote Work
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

    const { fromDate, toDate, reason } = req.body;
    if (!fromDate || !toDate) {
      res.status(400).json({ success: false, message: 'fromDate and toDate are required' });
      return;
    }

    const start = new Date(fromDate);
    const end = new Date(toDate);

    // Set start to beginning of day, end to end of day
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

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

    // Check for overlapping PENDING or APPROVED requests for this employee
    const existingActiveRequest = await prisma.remoteWorkRequest.findFirst({
      where: {
        employeeId: empIdStr,
        status: { in: ['PENDING', 'APPROVED'] },
        OR: [
          {
            fromDate: { lte: end },
            toDate: { gte: start },
          }
        ]
      }
    });

    if (existingActiveRequest) {
      res.status(400).json({
        success: false,
        message: `You already have an active or pending remote work request (${existingActiveRequest.status}) that overlaps with these dates.`
      });
      return;
    }

    const newRequest = await prisma.remoteWorkRequest.create({
      data: {
        employeeId: empIdStr,
        fromDate: start,
        toDate: end,
        reason: reason ? String(reason).trim() : null,
        status: 'PENDING',
      }
    });

    // FCM Notification to HR role
    const dateStr = `${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`;
    try {
      await firebaseNotificationService.sendNotificationToRole(
        'HR',
        'New Remote Work Request',
        `Remote work request from ${employee.firstName} ${employee.lastName} (${dateStr})`,
        {
          click_action: 'REMOTE_WORK_REQUEST',
          requestId: newRequest.id,
          employeeId: empIdStr
        }
      );
    } catch (fcmErr) {
      console.warn('Failed to send FCM notification to HR for remote work apply:', fcmErr);
    }

    res.status(201).json({
      success: true,
      message: 'Remote work request submitted successfully.',
      data: newRequest
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
      where: { employeeId: empIdStr },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: requests
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
    const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : undefined;

    const whereClause: any = {};
    if (statusFilter && statusFilter !== 'ALL') {
      whereClause.status = statusFilter;
    }

    const requests = await prisma.remoteWorkRequest.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });

    // Fetch employee details for each request
    const employeeIds = Array.from(new Set(requests.map(r => parseInt(r.employeeId, 10)).filter(id => !isNaN(id))));
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        designation: true,
        office: { select: { name: true } }
      }
    });

    const empMap = new Map(employees.map(e => [String(e.id), e]));

    const enriched = requests.map(r => ({
      ...r,
      employee: empMap.get(r.employeeId) || null
    }));

    res.json({
      success: true,
      data: enriched
    });
  } catch (error: any) {
    console.error('Error in getHrRemoteWorkRequests:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch HR remote work requests.' });
  }
};

/**
 * 4. PATCH /api/hr/remote-work/:id
 * HR approves, rejects, or revokes a remote work request
 */
export const reviewRemoteWorkRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const requestId = String(req.params.id);
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

    // FCM Notification to Employee
    const empNumericId = parseInt(request.employeeId, 10);
    if (!isNaN(empNumericId)) {
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
    }

    res.json({
      success: true,
      message: `Remote work request ${newStatus.toLowerCase()} successfully.`,
      data: updated
    });
  } catch (error: any) {
    console.error('Error in reviewRemoteWorkRequest:', error);
    res.status(500).json({ success: false, message: 'Failed to review remote work request.' });
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
    res.status(500).json({ success: false, message: 'Failed to check remote work status.' });
  }
};
