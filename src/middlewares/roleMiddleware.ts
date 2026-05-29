import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';

export const roleMiddleware = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. Sign in required.',
      });
      return;
    }

    const { role } = req.user;

    // Check if the user's role is in the allowed list (case-insensitive for robustness)
    const hasRole = allowedRoles.some(
      (r) => r.toUpperCase() === role.toUpperCase()
    );

    if (!hasRole) {
      res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permissions to perform this action.',
      });
      return;
    }

    next();
  };
};
