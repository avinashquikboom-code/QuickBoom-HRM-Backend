import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { firebaseNotificationService } from '../services/firebaseNotificationService';
import { pushNotificationService } from '../services/pushNotificationService';


// GET /api/shifts
export const getShifts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const shifts = await prisma.shift.findMany({
      orderBy: { name: 'asc' }
    });
    res.json({ success: true, data: shifts });
  } catch (error) {
    console.error('Get shifts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch shifts.' });
  }
};

// POST /api/shift-requests
export const createShiftRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { requestedShift, reason } = req.body;
    if (!requestedShift || !reason) {
      res.status(400).json({ success: false, message: 'Requested shift and reason are required.' });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        shiftAssignments: {
          include: { shift: true },
          where: { effectiveTo: null }
        }
      }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    // Get current shift name
    const currentShift = employee.shiftAssignments[0]?.shift.name || 'None';

    // Reject if one PENDING request already exists
    const pendingRequest = await prisma.shiftRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: 'PENDING'
      }
    });

    if (pendingRequest) {
      res.status(400).json({ success: false, message: 'You already have a pending shift change request.' });
      return;
    }

    // Create shift request
    const request = await prisma.shiftRequest.create({
      data: {
        employeeId: employee.id,
        currentShift,
        requestedShift,
        reason,
        status: 'PENDING'
      }
    });

    // Trigger FCM to all HR: "Shift change request from {name}"
    try {
      await firebaseNotificationService.sendNotificationToRole(
        'HR',
        'Shift Change Request',
        `Shift change request from ${employee.firstName} ${employee.lastName}`,
        {
          click_action: 'SHIFT_CHANGE_REQUEST',
          requestId: request.id.toString()
        }
      );
    } catch (fcmError) {
      console.error('Failed to send FCM notification to HR:', fcmError);
    }

    res.json({ success: true, message: 'Shift change request submitted successfully.', data: request });
  } catch (error) {
    console.error('Create shift request error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit shift request.' });
  }
};

// GET /api/shift-requests/my
export const getMyShiftRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const requests = await prisma.shiftRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('Get shift requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch shift requests.' });
  }
};

// GET /api/admin/shift-requests
export const fetchAdminShiftRequests = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { status } = req.query;
    const whereClause: any = {};
    if (status && status !== 'All') {
      whereClause.status = status;
    }

    const requests = await prisma.shiftRequest.findMany({
      where: whereClause,
      include: {
        employee: {
          include: { office: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('Fetch admin shift requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch shift requests.' });
  }
};

// PATCH /api/admin/shift-requests/:id
export const decideShiftRequest = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { status, note } = req.body; // APPROVED or REJECTED

  const requestId = parseInt(String(id), 10);
  if (isNaN(requestId)) {
    res.status(400).json({ success: false, message: 'Invalid request ID.' });
    return;
  }

  if (status !== 'APPROVED' && status !== 'REJECTED') {
    res.status(400).json({ success: false, message: 'Status must be APPROVED or REJECTED.' });
    return;
  }

  try {
    const request = await prisma.shiftRequest.findUnique({
      where: { id: requestId },
      include: { employee: true }
    });

    if (!request) {
      res.status(404).json({ success: false, message: 'Shift request not found.' });
      return;
    }

    if (request.status !== 'PENDING') {
      res.status(400).json({ success: false, message: `Request is already ${request.status.toLowerCase()}.` });
      return;
    }

    if (status === 'APPROVED') {
      let targetShift = await prisma.shift.findFirst({
        where: { name: request.requestedShift }
      });

      if (!targetShift) {
        const shiftId = parseInt(request.requestedShift, 10);
        if (!isNaN(shiftId)) {
          targetShift = await prisma.shift.findUnique({
            where: { id: shiftId }
          });
        }
      }

      if (!targetShift) {
        res.status(400).json({ success: false, message: `Requested shift "${request.requestedShift}" could not be resolved in settings.` });
        return;
      }

      await prisma.$transaction([
        prisma.shiftAssignment.updateMany({
          where: {
            employeeId: request.employeeId,
            effectiveTo: null
          },
          data: {
            effectiveTo: new Date()
          }
        }),
        prisma.shiftAssignment.create({
          data: {
            employeeId: request.employeeId,
            shiftId: targetShift.id,
            effectiveFrom: new Date(),
            effectiveTo: null
          }
        }),
        prisma.employee.update({
          where: { id: request.employeeId },
          data: {
            shiftTypeId: String(targetShift.id)
          }
        }),
        prisma.shiftRequest.update({
          where: { id: requestId },
          data: {
            status: 'APPROVED',
            decidedAt: new Date(),
            decidedBy: req.user?.id
          }
        })
      ]);
    } else {
      await prisma.shiftRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          decidedBy: req.user?.id
        }
      });
    }

    try {
      if (request.employee.userId) {
        // Create in-app notification row
        await prisma.notification.create({
          data: {
            userId: request.employee.userId,
            title: `Shift Request ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
            body: `Your shift change request has been ${status.toLowerCase()}.${note ? ` Reason: ${note}` : ''}`,
            isRead: false,
            actionType: 'SHIFT_CHANGE',
          }
        });

        // Send push notification via standard pushNotificationService
        pushNotificationService.sendPush(
          [request.employee.userId],
          `Shift Request ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
          `Your shift change request has been ${status.toLowerCase()}.${note ? ` Reason: ${note}` : ''}`,
          {
            click_action: 'SHIFT_CHANGE',
            status: status
          }
        ).catch(err => console.error('Failed to send shift request push:', err));
      }
    } catch (fcmError) {
      console.error('Failed to send FCM notification for shift request decision:', fcmError);
    }

    res.json({ success: true, message: `Shift request has been ${status.toLowerCase()} successfully.` });
  } catch (error) {
    console.error('Decide shift request error:', error);
    res.status(500).json({ success: false, message: 'Failed to process shift request.' });
  }
};
