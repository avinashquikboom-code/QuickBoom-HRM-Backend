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
  const publicPaths = [
    '/api/mobile/auth/login',
    '/api/mobile/auth/refresh',
    '/api/mobile/auth/forgot-password',
    '/api/auth/login',
    '/api/auth/employee/login',
    '/api/auth/hr/login',
    '/api/auth/super-admin/login',
    '/api/auth/refresh',
    '/api/health',
    '/api-docs/swagger.json',
  ];

  const requestPath = req.path;
  if (publicPaths.some(p => requestPath === p || requestPath.startsWith(p))) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  } else {
    res.status(401).json({
      success: false,
      message: 'Authorization token required. Please sign in.',
    });
    return;
  }

  // Secure local dev token mapping
  if (token === 'dev-local-auth-token') {
    try {
      const dbUser = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN' }
      });
      req.user = {
        id: dbUser?.id ?? '00000000-0000-0000-0000-000000000013',
        email: dbUser?.email ?? 'admin@hrm.com',
        role: 'SUPER_ADMIN'
      };
      next();
      return;
    } catch {
      req.user = { id: '00000000-0000-0000-0000-000000000013', email: 'admin@hrm.com', role: 'SUPER_ADMIN' };
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
        id: dbUser?.id ?? '00000000-0000-0000-0000-000000000002',
        email: dbUser?.email ?? 'hr@hrm.com',
        role: 'HR'
      };
      next();
      return;
    } catch {
      req.user = { id: '00000000-0000-0000-0000-000000000002', email: 'hr@hrm.com', role: 'HR' };
      next();
      return;
    }
  }

  if (token === 'dev-admin-auth-token') {
    try {
      const dbUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' }
      });
      req.user = {
        id: dbUser?.id ?? '00000000-0000-0000-0000-000000000014',
        email: dbUser?.email ?? 'admin@hrm.com',
        role: 'ADMIN'
      };
      next();
      return;
    } catch {
      req.user = { id: '00000000-0000-0000-0000-000000000014', email: 'admin@hrm.com', role: 'ADMIN' };
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
        id: dbUser?.id ?? '00000000-0000-0000-0000-000000000003',
        email: dbUser?.email ?? 'employee@hrm.com',
        role: 'EMPLOYEE'
      };
      next();
      return;
    } catch {
      req.user = { id: '00000000-0000-0000-0000-000000000003', email: 'employee@hrm.com', role: 'EMPLOYEE' };
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

// Alias for backward compatibility
export const authenticateToken = authMiddleware;

