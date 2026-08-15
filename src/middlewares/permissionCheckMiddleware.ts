import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { getEffectiveUserPermissions } from '../utils/permissionHelper';

export function requirePermission(permissionKey: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
        return;
      }

      const effectivePerms = await getEffectiveUserPermissions(user.id);
      
      // If permission key is explicitly set to false in custom rights, block access
      if (effectivePerms[permissionKey] === false) {
        res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: `Access denied: Module permission '${permissionKey}' is disabled by HR.`,
          permissionKey,
        });
        return;
      }

      next();
    } catch (error) {
      console.error(`Error in requirePermission middleware for [${permissionKey}]:`, error);
      res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: `Access denied: Permission check failed for '${permissionKey}'.`,
        permissionKey,
      });
    }
  };
}
