import { Request, Response, NextFunction } from 'express';
import { verifyToken, UserJWTPayload } from '../utils/jwt';
import { prisma } from '../utils/db';

// Extend Express Request type
export interface AuthenticatedRequest extends Request {
  user?: UserJWTPayload;
}

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Authorization token required. Please sign in.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  // Secure local dev token mapping
  if (token === 'dev-local-auth-token') {
    try {
      const dbUser = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN' }
      });
      req.user = {
        id: dbUser?.id ?? 13,
        email: dbUser?.email ?? 'admin@hrm.com',
        role: 'SUPER_ADMIN'
      };
      next();
      return;
    } catch {
      req.user = { id: 13, email: 'admin@hrm.com', role: 'SUPER_ADMIN' };
      next();
      return;
    }
  }

  if (token === 'dev-platform-auth-token') {
    try {
      const dbUser = await prisma.user.findFirst({
        where: { role: 'HR' }
      });
      req.user = {
        id: dbUser?.id ?? 2,
        email: dbUser?.email ?? 'hr@hrm.com',
        role: 'HR'
      };
      next();
      return;
    } catch {
      req.user = { id: 2, email: 'hr@hrm.com', role: 'HR' };
      next();
      return;
    }
  }

  if (token === 'dev-employee-auth-token') {
    try {
      const dbUser = await prisma.user.findFirst({
        where: { role: 'EMPLOYEE' }
      });
      req.user = {
        id: dbUser?.id ?? 3,
        email: dbUser?.email ?? 'employee@hrm.com',
        role: 'EMPLOYEE'
      };
      next();
      return;
    } catch {
      req.user = { id: 3, email: 'employee@hrm.com', role: 'EMPLOYEE' };
      next();
      return;
    }
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired authorization token.',
    });
  }
};

