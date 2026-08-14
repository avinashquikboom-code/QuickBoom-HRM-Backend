import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { getEffectiveUserPermissions } from '../../utils/permissionHelper';

const router = Router();

/**
 * GET /api/mobile/features/access
 * Returns complete feature & module permission state for the authenticated mobile user
 */
router.get('/access', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const effectivePermissions = await getEffectiveUserPermissions(userId);

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
      const enabled = Boolean(effectivePermissions[f.key] ?? true);
      return {
        name: f.name,
        enabled,
        reason: enabled ? 'Access Granted' : 'Requires HR approval',
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
