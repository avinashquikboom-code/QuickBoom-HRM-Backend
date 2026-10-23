import { Router, Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/db";
import { isCommissionEligibleEmployee } from "../utils/salaryGross";
import {
  authenticate,
  POSRequest,
  permission,
  scope,
  storeFilter,
} from "./auth";
import {
  POSError,
  ensure,
  object,
  keys,
  text,
  uuid,
  integer,
  page,
  list,
  dateRange,
} from "./validation";
import * as service from "./service";
import {
  report,
  groupedSales,
  inventoryReport,
  registerReport,
  returnReport,
} from "./reports";
import * as operations from "./operations";
import { reviewCommission } from "./commissions";
import { authenticateStorePassword } from "./storeCredentials";
import { signAccessToken } from "../utils/jwt";

const router = Router();

// --- PUBLIC POS AUTH ROUTES ---
router.get("/auth/stores", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stores = await prisma.store.findMany({
      where: {
        isActive: true,
        posCredential: { posEnabled: true },
      },
      select: {
        id: true,
        name: true,
        code: true,
      },
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: stores });
  } catch (e) {
    next(e);
  }
});

// IP guard bounds unknown-store attempts; database locks also rate-limit each
// store across concurrent requests and server instances.
const loginAttempts = new Map<string, {count:number;expires:number}>();
router.post("/auth/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    ensure(process.env.NODE_ENV !== "production" || !!process.env.JWT_SECRET, "POS requires configured JWT_SECRET", 503);
    const now=Date.now();
    for(const [ip,entry] of loginAttempts) if(entry.expires<=now) loginAttempts.delete(ip);
    const ip=req.ip||req.socket.remoteAddress||"unknown";
    const attempts=loginAttempts.get(ip)??{count:0,expires:now+15*60*1000};
    ensure(attempts.count<30,"Too many POS login attempts. Try again in 15 minutes.",429);
    attempts.count++;loginAttempts.set(ip,attempts);
    const b=object(req.body);keys(b,["storeCode","storeId","password"]);
    ensure((b.storeCode!==undefined)!==(b.storeId!==undefined),"Provide either a store code or a store selection, not both.");
    ensure(typeof b.password==="string"&&b.password.length>0&&Buffer.byteLength(b.password,"utf8")<=72,"Enter a store password of at most 72 UTF-8 bytes.");
    const store=b.storeCode!==undefined
      ? await prisma.store.findFirst({where:{code:{equals:text(b.storeCode,"storeCode",80),mode:"insensitive"}},select:{id:true}})
      : await prisma.store.findUnique({where:{id:integer(b.storeId,"storeId")},select:{id:true}});
    ensure(store,"Store not found or invalid credentials.",401);
    const result=await authenticateStorePassword(store.id,b.password);
    if(result.error)throw result.error;
    const token=signAccessToken({id:result.userId!,role:"STORE_POS",storeId:result.store!.id,storeCode:result.store!.code??undefined,storeName:result.store!.name,isPosStoreSession:true,credentialVersion:result.version});
    res.cookie("pos_store_token",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",maxAge:60*60*1000});
    res.json({success:true,message:"POS login successful.",token,store:result.store});
  } catch(e) {next(e);}
});

router.post("/auth/logout", async (_req: Request, res: Response) => {
  res.clearCookie("pos_store_token");
  res.json({ success: true, message: "Logged out of POS session." });
});

// All POS routes below this line require authentication
router.use(authenticate);

router.get("/auth/me", (req: Request, res: Response) => {
  const a = (req as POSRequest).actor;
  res.json({
    success: true,
    data: {
      userId: a.userId,
      role: a.role,
      isPosStoreSession: a.isPosStoreSession ?? false,
      store: a.storeId
        ? {
            id: a.storeId,
            name: a.storeName,
            code: a.storeCode,
          }
        : null,
    },
  });
});
const route =
  (fn: (req: POSRequest) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await fn(req as POSRequest) });
    } catch (e) {
      next(e);
    }
  };
const id = (r: Request) => uuid(r.params.id);
router.get(
  "/access/users",
  route(async (r) => {
    ensure(r.actor.admin, "Administrator required", 403);
    const p = page(r.query);
    return prisma.user.findMany({
      skip: p.skip,
      take: p.take,
      select: {
        id: true,
        email: true,
        role: true,
        userPermission: true,
        employee: {
          select: { firstName: true, lastName: true, storeId: true },
        },
      },
      orderBy: { id: "asc" },
    });
  }),
);
router.patch(
  "/access/users/:userId",
  route(async (r) => {
    ensure(r.actor.admin, "Administrator required", 403);
    const userId = integer(Number(r.params.userId), "userId"),
      b = object(r.body);
    const names = [
      "read",
      "catalog",
      "inventory",
      "sell",
      "discount",
      "priceOverride",
      "refund",
      "reconcile",
      "reports",
      "configure",
      "commissionApprove",
    ].map((n) => `pos.${n}`);
    keys(b, names);
    ensure(
      Object.values(b).every((v) => typeof v === "boolean"),
      "Permissions must be booleans",
    );
    return service.transaction(async (tx) => {
      const previous = await tx.userPermission.findUnique({
        where: { userId },
      });
      const p = await tx.userPermission.upsert({
        where: { userId },
        create: { userId, permissions: b },
        update: {
          permissions: { ...((previous?.permissions ?? {}) as object), ...b },
        },
      });
      await service.audit(
        tx,
        r.actor,
        "POS_PERMISSIONS_UPDATED",
        String(userId),
        b,
      );
      return p;
    });
  }),
);
router.get(
  "/configuration",
  route(async (r) => {
    permission(r.actor, "read");
    const storeId = Number(r.query.storeId);
    scope(r.actor, storeId);
    return (
      (await prisma.pOSConfiguration.findUnique({ where: { storeId } })) ?? {
        storeId,
        commissionEnabled: false,
        returnWindowDays: null,
      }
    );
  }),
);
router.patch(
  "/configuration",
  route((r) => operations.configure(r.actor, r.body)),
);
router.get(
  "/payment-methods",
  route(async (r) => {
    permission(r.actor, "read");
    return operations.paymentMethods(r.actor, Number(r.query.storeId));
  }),
);
router.patch(
  "/payment-methods/:code",
  route((r) =>
    operations.savePaymentMethod(r.actor, String(r.params.code), r.body),
  ),
);
router.post(
  "/payments/:id/reconcile",
  route((r) => operations.reconcilePayment(r.actor, id(r), r.body)),
);
router.post(
  "/returns/:id/reconcile",
  route((r) => operations.reconcilePayment(r.actor, id(r), r.body, true)),
);
router.get(
  "/customers",
  route((r) => operations.customers(r.actor, r.query)),
);
router.post(
  "/customers",
  route((r) => operations.saveCustomer(r.actor, r.body)),
);
router.patch(
  "/customers/:id",
  route((r) => operations.saveCustomer(r.actor, r.body, id(r))),
);
router.post(
  "/products/bulk-update",
  route((r) => operations.bulkCatalog(r.actor, r.body)),
);
router.get(
  "/commissions",
  route(async (r) => {
    permission(r.actor, "reports");
    const storeId = storeFilter(r.actor, r.query.storeId),
      p = page(r.query);
    const where: Prisma.CommissionTransactionWhereInput = {
      storeId,
      eventType: { startsWith: "POS_" },
      ...(r.query.status ? { status: text(r.query.status, "status") } : {}),
    };
    return {
      items: await prisma.commissionTransaction.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          employee: { select: { firstName: true, lastName: true } },
          posLines: {
            include: {
              saleItem: { select: { saleId: true, name: true, sku: true } },
            },
          },
        },
      }),
      total: await prisma.commissionTransaction.count({ where }),
      page: p.page,
    };
  }),
);
router.post(
  "/commissions/:transactionId/review",
  route((r) =>
    reviewCommission(
      r.actor,
      integer(Number(r.params.transactionId), "transactionId"),
      r.body,
    ),
  ),
);
router.get(
  "/context",
  route(async (r) => {
    const a = r.actor;
    ensure(
      a.admin ||
        Object.entries(a.permissions).some(
          ([k, v]) => k.startsWith("pos.") && v === true,
        ),
      "POS access required",
      403,
    );
    let storeId: number | undefined;
    if (a.isPosStoreSession) {
      storeId = a.storeId;
    } else if (r.query.storeId !== undefined && r.query.storeId !== "") {
      ensure(typeof r.query.storeId === "string", "Invalid storeId: provide one positive integer");
      const requestedStoreId = integer(Number(r.query.storeId), "storeId");
      scope(a, requestedStoreId);
      storeId = requestedStoreId;
    } else if (!a.admin) {
      ensure(
        a.employeeId,
        "Your user account is not linked to an employee profile. Ask an administrator to link your employee profile and assign an active store in HRM Employees.",
        422,
      );
      ensure(
        a.storeId,
        "No store location is assigned to your employee account. Please contact an administrator to assign an active store.",
        422,
      );
      storeId = a.storeId;
    } else if (a.admin && a.storeId) {
      storeId = a.storeId;
    }

    if (storeId !== undefined) {
      const assignedStore = await prisma.store.findUnique({
        where: { id: storeId },
      });
      ensure(
        assignedStore && assignedStore.isActive,
        "The assigned store location is inactive or does not exist. Ask an administrator to activate it or update your store assignment in HRM Employees.",
        422,
      );
    }

    const canAccessAllStores =
      !a.isPosStoreSession &&
      (a.admin ||
        a.permissions["pos.allStores"] === true ||
        a.permissions["pos.manageStores"] === true);

    const [stores, systemSetting, employee] = await Promise.all([
      prisma.store.findMany({
        where: canAccessAllStores
          ? { isActive: true }
          : { id: a.storeId, isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          address: true,
          country: true,
          pincode: true,
          isActive: true,
        },
        orderBy: { name: "asc" },
      }),
      prisma.systemSetting.findFirst({
        select: { currency: true, company: true, platformName: true },
      }),
      a.employeeId
        ? prisma.employee.findUnique({
            where: { id: a.employeeId },
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              storeId: true,
              status: true,
            },
          })
        : null,
    ]);

    const activeStore = storeId
      ? (stores.find((s) => s.id === storeId) ?? null)
      : (a.storeId ? stores.find((s) => s.id === a.storeId) : null) ??
        stores[0] ??
        null;

    const resolvedStoreId = activeStore?.id ?? storeId;
    let configuration = null;
    let paymentMethods: {
      id?: string;
      code: string;
      name: string;
      enabled: boolean;
    }[] = [];
    if (resolvedStoreId) {
      try {
        configuration = await prisma.pOSConfiguration.findUnique({
          where: { storeId: resolvedStoreId },
        });
      } catch {
        configuration = null;
      }
      try {
        paymentMethods = await prisma.pOSPaymentMethod.findMany({
          where: { storeId: resolvedStoreId, enabled: true },
          select: { id: true, code: true, name: true, enabled: true },
        });
      } catch {
        paymentMethods = [];
      }
    }

    const effectivePaymentMethods =
      paymentMethods.length > 0
        ? paymentMethods
        : [
            { code: "CASH", name: "Cash", enabled: true },
            { code: "CARD", name: "Card", enabled: true },
            { code: "UPI", name: "UPI", enabled: true },
          ];

    const salesperson = employee
      ? {
          id: employee.id,
          name: `${employee.firstName} ${employee.lastName}`.trim(),
          employeeCode: employee.employeeCode,
          storeId: employee.storeId,
        }
      : null;

    const company = systemSetting?.company ?? {
      name: systemSetting?.platformName ?? "HOPKID",
    };

    return {
      actor: a,
      employee,
      salesperson,
      company,
      activeStore,
      stores,
      configuration,
      paymentMethods: effectivePaymentMethods,
      transferStores:
        a.admin || a.permissions["pos.inventory"] === true
          ? await prisma.store.findMany({
              where: { isActive: true },
              select: { id: true, name: true, code: true },
              orderBy: { name: "asc" },
            })
          : [],
      employees: await prisma.employee.findMany({
        where: {
          ...(storeId ? { storeId } : {}),
          status: { equals: "active", mode: "insensitive" },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          storeId: true,
        },
        orderBy: { firstName: "asc" },
        take: 500,
      }),
      currency: systemSetting?.currency ?? "INR",
      salespeople: (
        await prisma.employee.findMany({
          where: {
            ...(storeId ? { storeId } : {}),
            status: { equals: "active", mode: "insensitive" },
          },
          include: {
            department: true,
            user: true,
          },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
          take: 500,
        })
      )
        .filter((emp) => emp.user?.isActive !== false && isCommissionEligibleEmployee(emp))
        .map((emp) => ({
          id: emp.id,
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
          name: `${emp.firstName} ${emp.lastName}`.trim(),
          designation: emp.designation,
          storeId: emp.storeId,
        })),
    };
  }),
);
router.get(
  "/salespeople",
  route(async (r) => {
    permission(r.actor, "read");
    const storeId = storeFilter(r.actor, r.query.storeId);
    const employees = await prisma.employee.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        status: { equals: "active", mode: "insensitive" },
      },
      include: {
        department: true,
        user: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 500,
    });
    const eligible = employees.filter((emp) => emp.user?.isActive !== false && isCommissionEligibleEmployee(emp));
    return eligible.map((emp) => ({
      id: emp.id,
      employeeCode: emp.employeeCode,
      employeeID: emp.employeeID,
      firstName: emp.firstName,
      lastName: emp.lastName,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      designation: emp.designation,
      storeId: emp.storeId,
    }));
  }),
);
router.get(
  "/categories",
  route(async (r) => {
    permission(r.actor, "read");
    return prisma.pOSCategory.findMany({ orderBy: { name: "asc" }, take: 500 });
  }),
);
router.post(
  "/categories",
  route(async (r) => {
    permission(r.actor, "catalog");
    const b = object(r.body);
    keys(b, ["name", "parentId", "externalCommissionCategoryId"]);
    return service.transaction(async (tx) => {
      const c = await tx.pOSCategory.create({
        data: {
          name: text(b.name, "name"),
          externalCommissionCategoryId: b.externalCommissionCategoryId
            ? integer(
                b.externalCommissionCategoryId,
                "externalCommissionCategoryId",
              )
            : undefined,
          parentId: b.parentId ? uuid(b.parentId) : undefined,
        },
      });
      await service.audit(tx, r.actor, "CATEGORY_CREATED", c.id);
      return c;
    });
  }),
);
router.get(
  "/products",
  route(async (r) => {
    permission(r.actor, "read");
    const p = page(r.query),
      search =
        typeof r.query.search === "string" ? r.query.search.trim().slice(0, 200) : "",
      storeId = storeFilter(r.actor, r.query.storeId);
    ensure(
      r.query.searchMode === undefined ||
        ["all", "name", "barcode", "sku"].includes(String(r.query.searchMode)),
      "Invalid product search mode",
    );
    const searchMode = r.query.searchMode as string | undefined;
    const where: Prisma.POSProductWhereInput = {
      ...(["true", "false"].includes(String(r.query.active))
        ? { active: r.query.active === "true" }
        : {}),
      ...(r.query.brand
        ? {
            brand: {
              contains: text(r.query.brand, "brand"),
              mode: "insensitive",
            },
          }
        : {}),
      ...(r.query.categoryId ? { categoryId: uuid(r.query.categoryId) } : {}),
      ...(search
        ? {
            OR: [
              ...(searchMode === "barcode" || searchMode === "sku"
                ? []
                : [
                    { name: { contains: search, mode: "insensitive" as const } },
                    { code: { contains: search, mode: "insensitive" as const } },
                  ]),
              {
                variants: {
                  some: {
                    OR: [
                      { barcode: search },
                      { barcode: { equals: search, mode: "insensitive" as const } },
                      { barcode: { contains: search, mode: "insensitive" as const } },
                      { sku: { equals: search, mode: "insensitive" as const } },
                      { sku: { contains: search, mode: "insensitive" as const } },
                    ],
                  },
                },
              } as Prisma.POSProductWhereInput,
            ],
          }
        : {}),
    };
    const sort: Prisma.POSProductOrderByWithRelationInput =
      r.query.sort === "name"
        ? { name: "asc" }
        : r.query.sort === "name-desc"
          ? { name: "desc" }
          : r.query.sort === "oldest"
            ? { createdAt: "asc" }
            : { createdAt: "desc" };
    return {
      items: await prisma.pOSProduct.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: sort,
        include: {
          category: true,
          variants: { include: { balances: { where: { storeId } } } },
        },
      }),
      total: await prisma.pOSProduct.count({ where }),
      page: p.page,
    };
  }),
);
// Exact scan lookup is independent of paginated name search.
// Exact barcodes take priority over SKU collisions; ambiguous case-insensitive matches require a choice.
router.get(
  "/products/lookup",
  route(async (r) => {
    permission(r.actor, "read");
    const storeId = integer(Number(r.query.storeId), "storeId");
    scope(r.actor, storeId);
    const code = text(r.query.code, "barcode or SKU", 200).trim();
    let matches = await prisma.pOSProductVariant.findMany({
      where: {
        OR: [
          { barcode: code },
          { sku: code },
          { product: { code } },
        ],
      },
      include: { product: true, balances: { where: { storeId } } },
      take: 5,
    });
    // Fallback to case-insensitive lookup if no exact match is found
    if (!matches.length) {
      matches = await prisma.pOSProductVariant.findMany({
        where: {
          OR: [
            { barcode: { equals: code, mode: "insensitive" } },
            { sku: { equals: code, mode: "insensitive" } },
            { product: { code: { equals: code, mode: "insensitive" } } },
          ],
        },
        include: { product: true, balances: { where: { storeId } } },
        take: 5,
      });
    }
    return { matches };
  }),
);
router.get(
  "/products/:id",
  route(async (r) => {
    permission(r.actor, "read");
    const p = await prisma.pOSProduct.findUnique({
      where: { id: id(r) },
      include: { variants: true, category: true },
    });
    ensure(p, "Product not found", 404);
    return p;
  }),
);
router.post(
  "/products/import",
  route(async (r) => {
    permission(r.actor, "catalog");
    const b = object(r.body);
    keys(b, ["products"]);
    const products = list(b.products, 100);
    return service.transaction(async (tx) => {
      const results = [];
      for (const product of products)
        results.push(await service.createProduct(r.actor, product, tx));
      return results;
    });
  }),
);
router.post(
  "/products",
  route((r) => service.createProduct(r.actor, r.body)),
);
router.patch(
  "/products/:id",
  route(async (r) => {
    permission(r.actor, "catalog");
    const b = object(r.body);
    keys(b, [
      "name",
      "description",
      "code",
      "brand",
      "categoryId",
      "season",
      "material",
      "gender",
      "images",
      "sizeChart",
      "discountEligible",
      "active",
      "externalCommissionProductId",
    ]);
    return service.transaction(async (tx) => {
      const p = await tx.pOSProduct.update({
        where: { id: id(r) },
        data: service.productData(b),
      });
      await service.audit(tx, r.actor, "PRODUCT_UPDATED", p.id);
      return p;
    });
  }),
);
router.post(
  "/products/:id/variants",
  route(async (r) => {
    permission(r.actor, "catalog");
    const data = service.variantData(r.body);
    return service.transaction(async (tx) => {
      const v = await tx.pOSProductVariant.create({
        data: { ...data, productId: id(r) },
      });
      await service.audit(tx, r.actor, "VARIANT_CREATED", v.id);
      return v;
    });
  }),
);
router.patch(
  "/variants/:id",
  route((r) => operations.updateVariant(r.actor, id(r), r.body)),
);
router.get(
  "/inventory",
  route(async (r) => {
    permission(r.actor, "inventory");
    const storeId = storeFilter(r.actor, r.query.storeId),
      p = page(r.query),
      where = {
        storeId,
        ...(r.query.variantId ? { variantId: uuid(r.query.variantId) } : {}),
      };
    return {
      items: await prisma.pOSInventoryBalance.findMany({
        where,
        skip: p.skip,
        take: p.take,
        include: {
          variant: { include: { product: true } },
          store: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
      }),
      total: await prisma.pOSInventoryBalance.count({ where }),
      page: p.page,
    };
  }),
);
router.get(
  "/inventory/movements",
  route(async (r) => {
    permission(r.actor, "inventory");
    const storeId = storeFilter(r.actor, r.query.storeId),
      p = page(r.query),
      where = {
        storeId,
        ...(r.query.from || r.query.to
          ? { createdAt: dateRange(r.query) }
          : {}),
        ...(r.query.variantId ? { variantId: uuid(r.query.variantId) } : {}),
      };
    return {
      items: await prisma.pOSStockMovement.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: { variant: true },
      }),
      total: await prisma.pOSStockMovement.count({ where }),
    };
  }),
);
router.post(
  "/inventory/reconciliations",
  route((r) => service.reconcileStock(r.actor, r.body)),
);
router.patch(
  "/inventory/:id",
  route(async (r) => {
    permission(r.actor, "inventory");
    const b = object(r.body);
    keys(b, ["lowStockThreshold"]);
    const threshold = integer(b.lowStockThreshold, "lowStockThreshold", 0);
    return service.transaction(async (tx) => {
      const balance = await tx.pOSInventoryBalance.findUnique({
        where: { id: id(r) },
      });
      ensure(balance, "Balance not found", 404);
      scope(r.actor, balance.storeId);
      const result = await tx.pOSInventoryBalance.update({
        where: { id: balance.id },
        data: { lowStockThreshold: threshold },
      });
      await service.audit(
        tx,
        r.actor,
        "LOW_STOCK_THRESHOLD_UPDATED",
        balance.id,
        { threshold },
      );
      return result;
    });
  }),
);
router.post(
  "/inventory/adjustments",
  route((r) => service.adjust(r.actor, r.body)),
);
router.get(
  "/transfers",
  route(async (r) => {
    permission(r.actor, "inventory");
    const storeId = storeFilter(r.actor, r.query.storeId),
      p = page(r.query),
      where = storeId
        ? { OR: [{ fromStoreId: storeId }, { toStoreId: storeId }] }
        : {};
    return {
      items: await prisma.pOSStockTransfer.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: "desc" },
        include: {
          items: { include: { variant: true } },
          fromStore: { select: { name: true } },
          toStore: { select: { name: true } },
        },
      }),
      total: await prisma.pOSStockTransfer.count({ where }),
    };
  }),
);
router.post(
  "/transfers",
  route((r) => service.createTransfer(r.actor, r.body)),
);
router.post(
  "/transfers/:id/dispatch",
  route((r) => service.progressTransfer(r.actor, id(r), false)),
);
router.post(
  "/transfers/:id/receive",
  route((r) => service.progressTransfer(r.actor, id(r), true)),
);
router.get(
  "/registers",
  route(async (r) => {
    permission(r.actor, "read");
    const storeId = storeFilter(r.actor, r.query.storeId);
    return prisma.pOSRegister.findMany({
      where: { storeId },
      include: {
        sessions: { where: { closedAt: null } },
        store: { select: { name: true } },
      },
      take: 100,
    });
  }),
);
router.post(
  "/registers",
  route(async (r) => {
    permission(r.actor, "configure");
    const b = object(r.body);
    keys(b, ["storeId", "name"]);
    const storeId = integer(b.storeId, "storeId");
    scope(r.actor, storeId);
    return service.transaction(async (tx) => {
      await service.activeStore(tx, storeId);
      const result = await tx.pOSRegister.create({
        data: { storeId, name: text(b.name, "name", 80) },
      });
      await service.audit(tx, r.actor, "REGISTER_CREATED", result.id);
      return result;
    });
  }),
);
router.post(
  "/registers/:id/open",
  route((r) => service.openRegister(r.actor, id(r), r.body)),
);
router.post(
  "/registers/:id/close",
  route((r) => service.closeRegister(r.actor, id(r), r.body)),
);
router.post(
  "/sessions/:id/cash-movements",
  route((r) => service.cashMovement(r.actor, id(r), r.body)),
);
router.get(
  "/registers/:id/sessions",
  route(async (r) => {
    permission(r.actor, "read");
    const register = await prisma.pOSRegister.findUnique({
      where: { id: id(r) },
    });
    ensure(register, "Register not found", 404);
    scope(r.actor, register.storeId);
    const p = page(r.query);
    return prisma.pOSSession.findMany({
      where: { registerId: register.id },
      include: { cashMovements: true },
      skip: p.skip,
      take: p.take,
      orderBy: { openedAt: "desc" },
    });
  }),
);
// Sale creation completes atomically. No separate unsafe draft-completion endpoint.
router.post(
  "/quote",
  route((r) => service.quote(r.actor, r.body)),
);
router.post(
  "/sales",
  route((r) => service.checkout(r.actor, r.body)),
);
router.get(
  "/sales",
  route(async (r) => {
    permission(r.actor, "read");
    const storeId = storeFilter(r.actor, r.query.storeId),
      p = page(r.query);
    const where: Prisma.POSSaleWhereInput = {
      storeId,
      ...(r.query.from || r.query.to ? { createdAt: dateRange(r.query) } : {}),
      ...(r.query.status ? { status: text(r.query.status, "status") } : {}),
      ...(r.query.cashierId
        ? { cashierId: integer(Number(r.query.cashierId), "cashierId") }
        : {}),
      ...(r.query.salespersonId
        ? {
            salespersonId: integer(
              Number(r.query.salespersonId),
              "salespersonId",
            ),
          }
        : {}),
      ...(r.query.search
        ? {
            invoiceNo: {
              contains: text(r.query.search, "search"),
              mode: "insensitive",
            },
          }
        : {}),
    };
    return {
      items: await prisma.pOSSale.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: {
          salesperson: { select: { id: true, employeeID: true, firstName: true, lastName: true, employeeCode: true } },
          items: {
            include: {
              salesperson: { select: { id: true, employeeID: true, firstName: true, lastName: true, employeeCode: true } },
            },
          },
        },
      }),
      total: await prisma.pOSSale.count({ where }),
      page: p.page,
    };
  }),
);
router.get(
  "/sales/:id",
  route(async (r) => {
    permission(r.actor, "read");
    const s = await prisma.pOSSale.findUnique({
      where: { id: id(r) },
      include: {
        items: {
          include: {
            salesperson: { select: { id: true, employeeID: true, firstName: true, lastName: true, employeeCode: true } },
          },
        },
        payments: true,
        returns: { include: { items: true } },
        store: { select: { name: true, address: true } },
        cashier: { select: { email: true, profile: { select: { fullName: true } } } },
        salesperson: { select: { id: true, employeeID: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });
    ensure(s, "Invoice not found", 404);
    scope(r.actor, s.storeId);
    return s;
  }),
);
router.post(
  "/sales/:id/exchanges",
  route((r) => service.exchange(r.actor, id(r), r.body)),
);
router.post(
  "/sales/:id/cancel",
  route((r) => service.cancelSale(r.actor, id(r), r.body)),
);
router.post(
  "/sales/:id/returns",
  route((r) => service.returnSale(r.actor, id(r), r.body)),
);
router.get(
  "/reports/daily-sales",
  route((r) => report(r.actor, r.query)),
);
router.get(
  "/reports/employee-sales",
  route((r) => report(r.actor, r.query)),
);
router.get(
  "/reports/sales",
  route((r) => groupedSales(r.actor, r.query)),
);
router.get(
  "/reports/inventory",
  route((r) => {
    permission(r.actor, "inventory");
    return inventoryReport(r.actor, r.query);
  }),
);
router.get(
  "/reports/registers",
  route((r) => registerReport(r.actor, r.query)),
);
router.get(
  "/reports/returns",
  route((r) => returnReport(r.actor, r.query)),
);
router.get(
  "/sales/:id/audit",
  route(async (r) => {
    permission(r.actor, "read");
    const sale = await prisma.pOSSale.findUnique({
      where: { id: id(r) },
      select: {
        storeId: true,
        returns: { select: { id: true } },
        payments: { select: { id: true } },
      },
    });
    ensure(sale, "Invoice not found", 404);
    scope(r.actor, sale.storeId);
    const p = page(r.query);
    const ids = [
      id(r),
      ...sale.returns.map((x) => x.id),
      ...sale.payments.map((x) => x.id),
    ];
    const where = { entityId: { in: ids } };
    return {
      items: await prisma.pOSAuditLog.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: { user: { select: { id: true, email: true } } },
      }),
      total: await prisma.pOSAuditLog.count({ where }),
    };
  }),
);
router.use((e: unknown, req: Request, res: Response, next: NextFunction) => {
  if (e instanceof POSError) {
    res.status(e.status).json({ success: false, message: e.message });
    return;
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const status = ["P2002", "P2034"].includes(e.code)
      ? 409
      : ["P2003", "P2025"].includes(e.code)
        ? 400
        : 500;
    res.status(status).json({
      success: false,
      message:
        status === 409
          ? "Conflicting record or concurrent update. Retry with the same request key."
          : status === 400
            ? "Referenced record is missing or invalid."
            : "POS database operation failed.",
    });
    return;
  }
  console.error(
    JSON.stringify({
      module: "pos",
      event: "request_failed",
      method: req.method,
      path: req.path,
      errorType: e instanceof Error ? e.name : "Unknown",
    }),
  );
  res.status(500).json({ success: false, message: "POS request failed." });
});
export default router;
