import { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/db';
import { verifyToken } from '../utils/jwt';
import { ensure, integer, POSError } from './validation';
export interface Actor { userId: number; role: string; employeeId?: number; storeId?: number; permissions: Record<string, unknown>; admin: boolean; }
export interface POSRequest extends Request { actor: Actor; }
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    ensure(process.env.NODE_ENV !== 'production' || !!process.env.JWT_SECRET, 'POS requires configured JWT_SECRET', 503);
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    ensure(token, 'Sign in required', 401);
    let id: number;
    try { id = verifyToken(token).id; } catch { throw new POSError(401, 'Invalid or expired signed session'); }
    const user = await prisma.user.findUnique({ where: { id }, include: { employee: true, userPermission: true } });
    ensure(user?.isActive, 'Account inactive', 403);
    ensure(!user.employee || user.employee.status.toLowerCase() === 'active', 'Employee inactive', 403);
    const defaults = await prisma.rolePermission.findUnique({ where: { role: user.role } });
    (req as POSRequest).actor = { userId: user.id, role: user.role, employeeId: user.employee?.id, storeId: user.employee?.storeId ?? undefined, admin: ['SUPER_ADMIN', 'ADMIN'].includes(user.role), permissions: { ...((defaults?.permissions ?? {}) as object), ...((user.userPermission?.permissions ?? {}) as object) } };
    next();
  } catch (e) { next(e); }
}
export function permission(actor: Actor, name: string) { ensure(actor.admin || actor.permissions[`pos.${name}`] === true, `Permission pos.${name} required`, 403); }
export function scope(actor: Actor, storeId: number) { integer(storeId, 'storeId'); ensure(actor.admin || actor.storeId === storeId, 'Store access denied', 403); }
export function storeFilter(actor: Actor, input: unknown): number | undefined { if (input !== undefined && input !== '') { const id = Number(input); scope(actor, id); return id; } if (actor.admin) return undefined; ensure(actor.storeId, 'Employee has no assigned store', 403); return actor.storeId; }
