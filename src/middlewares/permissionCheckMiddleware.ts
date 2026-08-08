import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { getEffectiveUserPermissions } from '../utils/permissionHelper';

export function requirePermission(permissionKey: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // HR, ADMIN, and SUPER_ADMIN bypass individual employee permission restrictions
      if (user.role === 'HR' || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN') {
        return next();
      }

      const effectivePerms = await getEffectiveUserPermissions(user.id);
      
      // If permission key is explicitly set to false, deny access
      if (effectivePerms[permissionKey] === false) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Access denied: Permission '${permissionKey}' is disabled for your account.`,
          permissionKey,
        });
      }

      next();
    } catch (error) {
      console.error(`Error in requirePermission middleware for [${permissionKey}]:`, error);
      next(); // Fail open on internal error to avoid locking out users
    }
  };
}
