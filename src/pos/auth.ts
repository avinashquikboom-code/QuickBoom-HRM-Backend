import { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db";
import { verifyToken } from "../utils/jwt";
import { ensure, integer, POSError } from "./validation";

export interface Actor {
  userId: number;
  role: string;
  employeeId?: number;
  storeId?: number;
  permissions: Record<string, unknown>;
  admin: boolean;
}

export interface POSRequest extends Request {
  actor: Actor;
}

export const DEFAULT_ROLE_POS_PERMISSIONS: Record<
  string,
  Record<string, boolean>
> = {
  SUPER_ADMIN: {
    "pos.read": true,
    "pos.catalog": true,
    "pos.inventory": true,
    "pos.sell": true,
    "pos.discount": true,
    "pos.priceOverride": true,
    "pos.refund": true,
    "pos.reconcile": true,
    "pos.reports": true,
    "pos.configure": true,
    "pos.commissionApprove": true,
  },
  ADMIN: {
    "pos.read": true,
    "pos.catalog": true,
    "pos.inventory": true,
    "pos.sell": true,
    "pos.discount": true,
    "pos.priceOverride": true,
    "pos.refund": true,
    "pos.reconcile": true,
    "pos.reports": true,
    "pos.configure": true,
    "pos.commissionApprove": true,
  },
  STORE_MANAGER: {
    "pos.read": true,
    "pos.catalog": true,
    "pos.inventory": true,
    "pos.sell": true,
    "pos.discount": true,
    "pos.priceOverride": true,
    "pos.refund": true,
    "pos.reconcile": true,
    "pos.reports": true,
  },
  SALESMAN: {
    "pos.read": true,
    "pos.sell": true,
    "pos.discount": true,
  },
  HR: {
    "pos.read": true,
    "pos.reports": true,
    "pos.commissionApprove": true,
  },
  PLATFORM_ADMIN: {
    "pos.read": true,
    "pos.reports": true,
    "pos.commissionApprove": true,
  },
};

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    ensure(
      process.env.NODE_ENV !== "production" || !!process.env.JWT_SECRET,
      "POS requires configured JWT_SECRET",
      503,
    );
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    ensure(token, "Sign in required", 401);
    let id: number;
    try {
      id = verifyToken(token).id;
    } catch {
      throw new POSError(401, "Invalid or expired signed session");
    }
    const user = await prisma.user.findUnique({
      where: { id },
      include: { employee: true, userPermission: true },
    });
    ensure(user, "User account not found or session invalid", 401);
    ensure(user.isActive, "Account inactive", 403);
    ensure(
      !user.employee || user.employee.status.toLowerCase() === "active",
      "Employee inactive",
      403,
    );
    const defaults = await prisma.rolePermission.findUnique({
      where: { role: user.role },
    });
    const defaultRolePerms = DEFAULT_ROLE_POS_PERMISSIONS[user.role] ?? {};
    (req as POSRequest).actor = {
      userId: user.id,
      role: user.role,
      employeeId: user.employee?.id,
      storeId: user.employee?.storeId ?? undefined,
      admin: ["SUPER_ADMIN", "ADMIN"].includes(user.role),
      permissions: {
        ...defaultRolePerms,
        ...((defaults?.permissions ?? {}) as object),
        ...((user.userPermission?.permissions ?? {}) as object),
      },
    };
    next();
  } catch (e) {
    next(e);
  }
}

export function permission(actor: Actor, name: string) {
  ensure(
    actor.admin || actor.permissions[`pos.${name}`] === true,
    `Permission pos.${name} required`,
    403,
  );
}

export function scope(actor: Actor, storeId: number) {
  integer(storeId, "storeId");
  ensure(actor.admin || actor.storeId === storeId, "Store access denied", 403);
}

export function storeFilter(actor: Actor, input: unknown): number | undefined {
  if (input !== undefined && input !== "") {
    const id = Number(input);
    scope(actor, id);
    return id;
  }
  if (actor.admin) return undefined;
  ensure(
    actor.storeId,
    "No store location is assigned to your employee account. Please contact an administrator to assign an active store.",
    422,
  );
  return actor.storeId;
}
