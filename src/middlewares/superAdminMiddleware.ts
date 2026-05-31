import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';

export const requireSuperAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
    return;
  }

  if (req.user.role !== 'SUPER_ADMIN') {
    res.status(403).json({
      success: false,
      message: 'Super admin access required.',
    });
    return;
  }

  next();
};
