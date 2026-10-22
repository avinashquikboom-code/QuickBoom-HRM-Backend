import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { notifyEmployee, sendHRNotification } from '../utils/hrNotificationHelper';

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
    const empFilter = employee.employeeCode
      ? { in: [empIdStr, employee.employeeCode] }
      : empIdStr;

    const result = await prisma.$transaction(async tx => {
      const key = `remote-work:${employee.id}`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const target = requestId ? await tx.remoteWorkRequest.findUnique({ where: { id: String(requestId) } }) : null;
      if (requestId && (!target || ![empIdStr, employee.employeeCode].includes(target.employeeId))) {
        return { error: 'Request not found for this employee.' };
      }
      if (target?.status === 'APPROVED') return { error: 'Approved requests cannot be resubmitted.' };
      const overlap = await tx.remoteWorkRequest.findFirst({ where: {
        employeeId: empFilter, status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: end }, toDate: { gte: start },
        ...(requestId ? { id: { not: String(requestId) } } : {}),
      } });
      if (overlap) return { error: 'A pending or approved request already covers these dates.' };
      if (target?.status === 'PENDING' && target.fromDate.getTime() === start.getTime() && target.toDate.getTime() === end.getTime() &&
          (target.reason || '') === (reason ? String(reason).trim() : target.reason || '')) {
        return { request: target, changed: false, resubmission: false };
      }
      const rejected = target || await tx.remoteWorkRequest.findFirst({ where: {
        employeeId: empFilter, status: 'REJECTED', fromDate: { lte: end }, toDate: { gte: start },
      }, orderBy: { createdAt: 'desc' } });
      const data = { fromDate: start, toDate: end, reason: reason ? String(reason).trim() : rejected?.reason || null,
        status: 'PENDING', reviewedBy: null, reviewedAt: null, reviewNote: null, appliedOn: new Date() };
      const request = rejected
        ? await tx.remoteWorkRequest.update({ where: { id: rejected.id }, data })
        : await tx.remoteWorkRequest.create({ data: { employeeId: empIdStr, ...data } });
      return { request, changed: true, resubmission: !!rejected };
    });
    if (result.error || !result.request) {
      res.status(400).json({ success: false, message: result.error }); return;
    }
    const requestResult = result.request;
    const isResubmission = result.resubmission;
    const dateStr = `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;
    if (result.changed) await sendHRNotification({
      title: isResubmission ? 'Remote Work Request Resubmitted' : 'New Remote Work Request',
      message: `${employee.firstName} ${employee.lastName} requested remote work for ${dateStr}. Reference: ${requestResult.id}.`,
      category: 'ATTENDANCE', actionType: 'REMOTE_WORK_REQUEST', actionId: requestResult.id,
      employeeId: employee.id, requiredModuleId: 'pa-remote-work', excludeUserId: userId,
      deduplicate: true, eventSince: requestResult.appliedOn,
      extraData: { requestId: requestResult.id, fromDate: start.toISOString(), toDate: end.toISOString() },
    });

    res.status(200).json({
      success: true,
      message: isResubmission ? 'Remote work request resubmitted successfully.' : 'Remote work request submitted successfully.',
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
    const expectedStatus = newStatus === 'REVOKED' ? 'APPROVED' : 'PENDING';
    const changed = await prisma.$transaction(async tx => {
      // Use the same lock as apply/resubmit; stale reviews cannot decide a newer revision.
      const numericId = /^[1-9]\d*$/.test(request.employeeId) ? Number(request.employeeId) : null;
      const employee = numericId ? await tx.employee.findUnique({ where: { id: numericId } })
        : await tx.employee.findUnique({ where: { employeeCode: request.employeeId } });
      if (!employee) throw new Error('Remote work requester not found');
      const key = `remote-work:${employee.id}`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const claim = await tx.remoteWorkRequest.updateMany({ where: {
        id: requestId, status: expectedStatus, appliedOn: request.appliedOn,
      }, data: { status: newStatus, reviewedBy: reviewerIdStr, reviewedAt: new Date(),
        reviewNote: reviewNote ? String(reviewNote).trim() : null } });
      const updated = await tx.remoteWorkRequest.findUnique({ where: { id: requestId } });
      return { changed: !!claim.count, updated: updated!, employee };
    });
    const updated = changed.updated;
    if (!changed.changed) {
      res.status(updated.status === newStatus ? 200 : 409).json({ success: updated.status === newStatus,
        message: 'Request already reviewed or changed. Refresh before reviewing.', data: updated }); return;
    }
    const fromStr = updated.fromDate.toISOString().slice(0, 10);
    const toStr = updated.toDate.toISOString().slice(0, 10);
    const notificationDelivery = await notifyEmployee({
      employeeId: changed.employee.id,
      title: `Remote Work ${newStatus.charAt(0) + newStatus.slice(1).toLowerCase()}`,
      message: `Your remote work request for ${fromStr} to ${toStr} has been ${newStatus.toLowerCase()}.`,
      category: 'ATTENDANCE', actionType: `REMOTE_WORK_${newStatus}`, actionId: updated.id,
      screen: '/remote-work', clickRoute: '/remote-work', deduplicate: true, eventSince: updated.appliedOn,
      extraData: { requestId: updated.id, status: newStatus, fromDate: updated.fromDate.toISOString(), toDate: updated.toDate.toISOString() },
    });

    res.json({
      success: true,
      message: `Remote work request ${newStatus.toLowerCase()} successfully.`,
      data: updated,
      notificationDelivery,
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

