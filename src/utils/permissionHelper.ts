import { prisma } from './db';
import { Role } from '@prisma/client';

export interface EmployeePermissions {
  // 1. HOME & DASHBOARD
  canViewGeofence: boolean;
  canPunchInOut: boolean;
  canPunchHalfDay: boolean;
  canTakeBreaks: boolean;

  // 2. ATTENDANCE & LOGS
  canViewAttendance: boolean;
  canViewBreakHistory: boolean;
  canRequestAttendanceCorrection: boolean;

  // 3. WALLET & FINANCIALS
  canViewSalary: boolean;
  canDownloadSalaryPDF: boolean;
  canRequestSalaryAdvance: boolean;
  canViewCommission: boolean;
  canLogSale: boolean;
  canViewExpenses: boolean;
  canSubmitExpenseClaim: boolean;
  canCancelExpenseClaim: boolean;
  canRequestBankDetailsEdit: boolean;

  // 4. LEAVE & HOLIDAYS
  canViewLeaveBalance: boolean;
  canViewLeaveHistory: boolean;
  canApplyLeave: boolean;
  canCancelLeave: boolean;
  canViewHolidays: boolean;

  // 5. TASKS MANAGEMENT
  canViewTasks: boolean;
  canCompleteTask: boolean;

  // 6. SHIFT & GUIDELINES
  canViewShift: boolean;
  canRequestShiftChange: boolean;
  canCancelShiftRequest: boolean;
  canViewShiftGuidelines: boolean;

  // 7. REMOTE WORK
  canViewRemoteWorkStatus: boolean;
  canApplyRemoteWork: boolean;
  canCancelRemoteRequest: boolean;

  // 8. PROFILE & SYSTEM
  canViewProfile: boolean;
  canEditAvatar: boolean;
  canChangePassword: boolean;
  canViewNotifications: boolean;

  [key: string]: boolean;
}

export const DEFAULT_EMPLOYEE_PERMISSIONS: EmployeePermissions = {
  // 1. HOME & DASHBOARD
  canViewGeofence: true,
  canPunchInOut: true,
  canPunchHalfDay: true,
  canTakeBreaks: true,

  // 2. ATTENDANCE & LOGS
  canViewAttendance: true,
  canViewBreakHistory: true,
  canRequestAttendanceCorrection: true,

  // 3. WALLET & FINANCIALS
  canViewSalary: true,
  canDownloadSalaryPDF: true,
  canRequestSalaryAdvance: true,
  canViewCommission: true,
  canLogSale: true,
  canViewExpenses: true,
  canSubmitExpenseClaim: true,
  canCancelExpenseClaim: true,
  canRequestBankDetailsEdit: true,

  // 4. LEAVE & HOLIDAYS
  canViewLeaveBalance: true,
  canViewLeaveHistory: true,
  canApplyLeave: true,
  canCancelLeave: true,
  canViewHolidays: true,

  // 5. TASKS MANAGEMENT
  canViewTasks: true,
  canCompleteTask: true,

  // 6. SHIFT & GUIDELINES
  canViewShift: true,
  canRequestShiftChange: true,
  canCancelShiftRequest: true,
  canViewShiftGuidelines: true,

  // 7. REMOTE WORK
  canViewRemoteWorkStatus: true,
  canApplyRemoteWork: true,
  canCancelRemoteRequest: true,

  // 8. PROFILE & SYSTEM
  canViewProfile: true,
  canEditAvatar: true,
  canChangePassword: true,
  canViewNotifications: true,
};

export async function getEffectiveUserPermissions(userId: number): Promise<EmployeePermissions> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) return DEFAULT_EMPLOYEE_PERMISSIONS;

    // 1. Role permissions
    const rolePerm = await prisma.rolePermission.findUnique({
      where: { role: user.role },
    });

    // 2. User custom permissions
    const userPerm = await prisma.userPermission.findUnique({
      where: { userId },
    });

    const merged = {
      ...DEFAULT_EMPLOYEE_PERMISSIONS,
      ...(rolePerm?.permissions ? (rolePerm.permissions as Record<string, boolean>) : {}),
      ...(userPerm?.permissions ? (userPerm.permissions as Record<string, boolean>) : {}),
    };

    return merged;
  } catch (error) {
    console.error('Error in getEffectiveUserPermissions:', error);
    return DEFAULT_EMPLOYEE_PERMISSIONS;
  }
}
