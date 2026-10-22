import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from './db';

export const REQUEST_APPROVER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'];

export async function canReviewRequests(userId: number, role: string, moduleId: string): Promise<boolean> {
  if (!REQUEST_APPROVER_ROLES.includes(role)) return false;
  if (role === 'SUPER_ADMIN' || role === 'PLATFORM_ADMIN') return true;
  const [userPermission, rolePermission] = await Promise.all([
    prisma.userPermission.findUnique({ where: { userId } }),
    prisma.rolePermission.findUnique({ where: { role: role as any } }),
  ]);
  const userPermissions = userPermission?.permissions as Record<string, unknown> | undefined;
  const rolePermissions = rolePermission?.permissions as Record<string, unknown> | undefined;
  return typeof userPermissions?.[moduleId] === 'boolean' ? userPermissions[moduleId] === true
    : rolePermissions?.[moduleId] !== false;
}

export function requireRequestApprover(moduleId: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id || !await canReviewRequests(req.user.id, String(req.user.role), moduleId)) {
        res.status(403).json({ success: false, message: 'Not authorized to review these requests.' });
        return;
      }
      next();
    } catch (error) { next(error); }
  };
}
