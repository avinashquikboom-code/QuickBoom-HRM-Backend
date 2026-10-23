import { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db";
import { credentialVersion } from "./storeCredentials";
import { verifyToken } from "../utils/jwt";
import { ensure, integer, POSError } from "./validation";

export interface Actor {
  userId: number;
  role: string;
  employeeId?: number;
  storeId?: number;
  storeName?: string;
  storeCode?: string;
  permissions: Record<string, unknown>;
  admin: boolean;
  isPosStoreSession?: boolean;
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
  EMPLOYEE: {
    "pos.read": true,
    "pos.sell": true,
    "pos.discount": true,
  },
  HELPER: {
    "pos.read": true,
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
    const token =
      req.headers.authorization?.replace(/^Bearer /, "") ||
      (req.cookies?.pos_store_token as string | undefined);
    ensure(token, "Sign in required", 401);
    let payload: any;
    try {
      payload = verifyToken(token);
    } catch {
      throw new POSError(401, "Invalid or expired signed session");
    }

    if (payload.isPosStoreSession || payload.role === "STORE_POS") {
      const storeId = Number(payload.storeId);
      ensure(
        Number.isSafeInteger(storeId) && storeId > 0,
        "Invalid store session token",
        401,
      );
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        include: { posCredential: true },
      });
      ensure(store, "Store not found or session invalid", 401);
      ensure(
        store.isActive,
        "Store location is currently inactive. Contact an administrator.",
        403,
      );
      ensure(
        store.posCredential && store.posCredential.posEnabled,
        "POS access is disabled for this store. Contact an administrator.",
        403,
      );

      ensure(payload.credentialVersion === credentialVersion(store.posCredential.passwordHash), "Store password changed. Sign in to POS again.", 401);
      const terminal = await prisma.user.findUnique({where:{id:payload.id},select:{email:true,isActive:true}});
      ensure(terminal?.isActive && terminal.email === `pos-store-${storeId}@hopkid.local`, "Invalid or disabled POS terminal session", 401);
      (req as POSRequest).actor = {
        userId: payload.id,
        role: "STORE_POS",
        storeId: store.id,
        storeName: store.name,
        storeCode: store.code ?? undefined,
        admin: false,
        isPosStoreSession: true,
        permissions: {
          "pos.read": true,
          "pos.sell": true,
          "pos.discount": true,
          "pos.reports": true,
          "pos.refund": true,
          "pos.reconcile": true,
          "pos.catalog": false,
          "pos.inventory": false,
        },
      };
      next();
      return;
    }

    const id: number = payload.id;
    const user = await prisma.user.findUnique({
      where: { id },
      include: { employee: true, userPermission: true },
    });
    ensure(user, "User account not found or session invalid", 401);
    ensure(user.isActive, "Account inactive", 403);
    ensure(!/^pos-store-\d+@hopkid\.local$/i.test(user.email ?? ""), "Store terminal accounts must use the dedicated POS login.", 401);

    let employee = user.employee;
    if (!employee) {
      employee = await prisma.employee.findFirst({
        where: {
          OR: [
            ...(user.employeeID
              ? [{ employeeID: user.employeeID }, { employeeCode: user.employeeID }]
              : []),
            ...(user.email ? [{ user: { email: user.email } }] : []),
          ],
        },
      });
      if (employee && !employee.userId) {
        await prisma.employee
          .update({
            where: { id: employee.id },
            data: { userId: user.id },
          })
          .catch(() => {});
      }
    }

    ensure(
      !employee || employee.status.toLowerCase() === "active",
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
      employeeId: employee?.id,
      storeId: employee?.storeId ?? undefined,
      admin: ["SUPER_ADMIN", "ADMIN"].includes(user.role),
      isPosStoreSession: false,
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
  if (actor.isPosStoreSession) {
    ensure(
      actor.storeId === storeId,
      "Unauthorized store access: POS session is locked to its authenticated store.",
      403,
    );
    return;
  }
  ensure(
    actor.admin ||
      actor.permissions["pos.allStores"] === true ||
      actor.permissions["pos.manageStores"] === true ||
      actor.storeId === storeId,
    "Store access denied",
    403,
  );
}

export function storeFilter(actor: Actor, input: unknown): number | undefined {
  if (actor.isPosStoreSession) {
    ensure(
      actor.storeId,
      "POS store session is missing an assigned store ID",
      403,
    );
    return actor.storeId;
  }
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
