import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { getEffectiveUserPermissions } from '../../utils/permissionHelper';
import { prisma } from '../../utils/db';

const router = Router();

/**
 * GET /api/mobile/features/access
 * Returns complete feature & module permission state for the authenticated mobile user,
 * evaluating approved date & time windows.
 */
router.get('/access', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const effectivePermissions = await getEffectiveUserPermissions(userId);

    const employee = await prisma.employee.findFirst({
      where: { userId },
    });

    const now = new Date();

    // Fetch approved access requests for this employee
    const approvedRequests = employee
      ? await prisma.featureAccessRequest.findMany({
          where: {
            employeeId: employee.id,
            status: 'APPROVED',
          },
          orderBy: { appliedOn: 'desc' },
        })
      : [];

    const featureNames = [
      { name: 'Attendance', key: 'canViewAttendance' },
      { name: 'Leave', key: 'canViewLeaveBalance' },
      { name: 'Sales', key: 'canLogSale' },
      { name: 'Wallet', key: 'canViewSalary' },
      { name: 'Commission', key: 'canViewCommission' },
      { name: 'Expenses', key: 'canViewExpenses' },
      { name: 'Tasks', key: 'canViewTasks' },
      { name: 'Shift Guidelines', key: 'canViewShiftGuidelines' },
      { name: 'Remote Work', key: 'canViewRemoteWorkStatus' },
    ];

    const featuresList = featureNames.map((f) => {
      const basePermission = Boolean(effectivePermissions[f.key] ?? true);

      // Check if there is an approved access request for this feature
      const matchingRequest = approvedRequests.find(
        (r) => r.featureName.toLowerCase() === f.name.toLowerCase()
      );

      let enabled = basePermission;
      let reason = basePermission ? 'Access Granted' : 'Requires HR approval';
      let validFrom: string | undefined = undefined;
      let validUntil: string | undefined = undefined;

      if (matchingRequest) {
        validFrom = matchingRequest.requestedFromDate
          ? new Date(matchingRequest.requestedFromDate).toISOString()
          : undefined;
        validUntil = matchingRequest.requestedToDate
          ? new Date(matchingRequest.requestedToDate).toISOString()
          : undefined;

        const fromTime = matchingRequest.requestedFromDate
          ? new Date(matchingRequest.requestedFromDate).getTime()
          : 0;
        const toTime = matchingRequest.requestedToDate
          ? new Date(matchingRequest.requestedToDate).getTime()
          : Infinity;
        const currentTime = now.getTime();

        if (currentTime >= fromTime && currentTime <= toTime) {
          enabled = true;
          reason = `Approved access active until ${matchingRequest.requestedToDate ? new Date(matchingRequest.requestedToDate).toLocaleDateString() : 'end of window'}`;
        } else if (currentTime > toTime) {
          enabled = false;
          reason = 'Approved access window has expired';
        } else if (currentTime < fromTime) {
          enabled = false;
          reason = 'Approved access window has not started yet';
        }
      }

      return {
        name: f.name,
        enabled,
        reason,
        validFrom,
        validUntil,
      };
    });

    res.json({
      success: true,
      permissions: effectivePermissions,
      features: featuresList,
    });
  } catch (error: any) {
    console.error('Error fetching mobile feature access:', error);
    res.status(500).json({ success: false, message: error?.message || 'Server error' });
  }
});

export default router;
