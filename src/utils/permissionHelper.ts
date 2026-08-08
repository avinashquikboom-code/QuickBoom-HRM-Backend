import { prisma } from './db';
import { Role } from '@prisma/client';

export interface EmployeePermissions {
  canViewSalary: boolean;
  canViewCommission: boolean;
  canApplyLeave: boolean;
  canViewAttendance: boolean;
  canViewWallet: boolean;
  [key: string]: boolean;
}

export const DEFAULT_EMPLOYEE_PERMISSIONS: EmployeePermissions = {
  canViewSalary: true,
  canViewCommission: true,
  canApplyLeave: true,
  canViewAttendance: true,
  canViewWallet: true,
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
