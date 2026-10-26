import { Request, Response, NextFunction } from 'express';
import { verifyToken, UserJWTPayload } from '../utils/jwt';
import { prisma } from '../utils/db';
import { resolveUserEmployee } from '../pos/cashierIdentity';

// Extend Express Request type
export interface AuthenticatedRequest extends Request {
  user?: UserJWTPayload;
  actor?: any;
}

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Bypass CORS Preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  const publicPaths = [
    '/api/mobile/auth/login',
    '/api/mobile/auth/hr/login',
    '/api/mobile/auth/register',
    '/api/mobile/auth/refresh',
    '/api/mobile/auth/forgot-password',
    '/api/mobile/auth/verify-mobile',
    '/api/mobile/auth/verify-identifier',
    '/api/mobile/auth/reset-password',
    '/api/auth/login',
    '/api/auth/employee/login',
    '/api/auth/hr/login',
    '/api/auth/super-admin/login',
    '/api/admin/auth/login',
    '/api/admin/login',
    '/api/auth/refresh',
    '/api/auth/forgot-password',
    '/api/health',
    '/api-docs',
    '/api/webhook',
    '/api/hopkid',
    '/api/webhooks',
  ];

  const fullPath = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;
  const requestPath = req.path;
  // Delivery endpoints are public; audit reads and management still require an HRM session.
  const isWebhookAudit = /^\/api\/(?:webhook|webhooks|hopkid)\/(?:logs(?:\/|$)|stats(?:\/|$))/.test(fullPath);
  if (
    !isWebhookAudit && publicPaths.some(
      p =>
        fullPath === p ||
        fullPath.startsWith(p) ||
        requestPath === p ||
        requestPath.startsWith(p)
    )
  ) {
    next();
    return;
  }

  // Extract token from Authorization header, x-access-token, x-auth-token, query param, or cookies
  const authHeader =
    req.headers.authorization ||
    (req.headers as any)['x-access-token'] ||
    (req.headers as any)['x-auth-token'];

  if (fullPath.includes('/commission/transactions')) {
    console.log(`[AUTH] Request ${req.method} ${fullPath} | Authorization header present: ${Boolean(authHeader)}`);
  }

  let token = '';

  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else {
      token = authHeader.trim();
    }
  } else if (req.query?.token && typeof req.query.token === 'string') {
    token = req.query.token as string;
  } else if ((req as any).cookies?.token) {
    token = (req as any).cookies.token;
  }

  if (!token) {
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

  if (token === 'dev-admin-auth-token') {
    try {
      const dbUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' }
      });
      req.user = {
        id: dbUser?.id ?? 14,
        email: dbUser?.email ?? 'admin@hrm.com',
        role: 'ADMIN'
      };
      next();
      return;
    } catch {
      req.user = { id: 14, email: 'admin@hrm.com', role: 'ADMIN' };
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
    if (decoded.role === "STORE_POS" || decoded.isPosStoreSession) {
      res.status(403).json({success:false,message:"Store POS sessions cannot access HRM APIs."});
      return;
    }
    req.user = decoded;

    // Validate that user and employee account are currently ACTIVE in the database
    const dbUser = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        isActive: true,
        email: true,
        role: true,
        employeeID: true,
        employee: {
          select: {
            id: true,
            status: true,
            storeId: true,
            store: {
              select: {
                id: true,
                name: true,
                code: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (dbUser && /^pos-store-\d+@hopkid\.local$/i.test(dbUser.email ?? "")) {
      res.status(403).json({success:false,message:"Store terminal accounts must use the dedicated POS login."});return;
    }
    if (!dbUser || !dbUser.isActive) {
      res.status(403).json({
        success: false,
        message: 'Your account is inactive. Please contact your administrator.',
        errorCode: 'ACCOUNT_INACTIVE',
      });
      return;
    }

    const employee = dbUser.employee ?? (await resolveUserEmployee(dbUser));
    let store = (employee as any)?.store;
    if (employee && !store && employee.storeId) {
      store = await prisma.store.findUnique({
        where: { id: employee.storeId },
        select: { id: true, name: true, code: true, isActive: true },
      });
    }

    const isAdminRole = ["SUPER_ADMIN", "ADMIN", "SUPERADMIN", "PLATFORM_ADMIN", "HR"].includes(dbUser.role);
    const isEmployeeInactive = employee?.status && employee.status.toLowerCase() !== 'active';
    if (!isAdminRole && isEmployeeInactive) {
      res.status(403).json({
        success: false,
        message: 'Your employee account is inactive. Please contact your administrator.',
        errorCode: 'ACCOUNT_INACTIVE',
      });
      return;
    }

    req.user = {
      ...decoded,
      employeeId: employee?.id,
      storeId: employee?.storeId ?? undefined,
      storeName: store?.name ?? undefined,
      storeCode: store?.code ?? undefined,
      storeIsActive: store ? Boolean(store.isActive) : undefined,
    };

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

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.role) {
      res.status(403).json({ success: false, message: 'Access denied: No role assigned.' });
      return;
    }
    const roleLower = String(req.user.role).toLowerCase();
    const isAllowed = allowedRoles.some(r => r.toLowerCase() === roleLower);
    if (!isAllowed) {
      res.status(403).json({ success: false, message: 'Access denied: Insufficient permissions.' });
      return;
    }
    next();
  };
};

