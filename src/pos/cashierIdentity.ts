import { prisma } from "../utils/db";
/** Resolve display identity from the session owner's trusted user or employee relationship. */
export const cashierUserSelect = {
  id: true,
  email: true,
  employeeID: true,
  role: true,
  profile: { select: { fullName: true } },
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
} as const;

export const cashierEmployeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
} as const;

export type CashierSource = {
  employee?: { firstName?: string | null; lastName?: string | null } | null;
  user?: {
    id?: number;
    email?: string | null;
    employeeID?: string | null;
    employee?: { firstName?: string | null; lastName?: string | null } | null;
    profile?: { fullName?: string | null } | null;
  } | null;
  profile?: { fullName?: string | null } | null;
};

export function cashierName(source: CashierSource | null | undefined): string {
  const directEmployee = source?.employee;
  const userEmployee = source?.user?.employee;
  if (!directEmployee && isStoreTerminal(source?.user?.email)) return "Unknown Cashier";
  const effectiveEmployee = directEmployee || userEmployee;

  const employeeName = [effectiveEmployee?.firstName, effectiveEmployee?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  if (employeeName) {
    return employeeName;
  }

  const profileFullName = source?.user?.profile?.fullName || source?.profile?.fullName;
  if (profileFullName && profileFullName.trim()) {
    return profileFullName.trim();
  }

  return "Unknown Cashier";
}

function isStoreTerminal(email?: string | null) {
  return /^pos-store-\d+@hopkid\.local$/i.test(email ?? "");
}

// Imported HR records can have the external employeeID before Employee.userId is linked.
// Only accept an unambiguous identifier match belonging to this user or unlinked.
export async function resolveUserEmployee(user: { id: number; employeeID?: string | null }) {
  const linked = await prisma.employee.findUnique({ where: { userId: user.id } });
  if (linked || !user.employeeID) return linked;
  const matches = await prisma.employee.findMany({ where: {
    OR: [{ employeeID: user.employeeID }, { employeeCode: user.employeeID }],
    AND: [{ OR: [{ userId: null }, { userId: user.id }] }],
  }, take: 2 });
  return matches.length === 1 ? matches[0] : null;
}

export async function resolveCashierName(source: CashierSource) {
  if (!source.employee && isStoreTerminal(source.user?.email)) return "Unknown Cashier";
  if (!source.employee && !source.user?.employee && source.user?.id != null) {
    const employee = await resolveUserEmployee({ id: source.user.id, employeeID: source.user.employeeID });
    if (employee) return cashierName({ employee });
  }
  return cashierName(source);
}

export async function withCashierName<T extends CashierSource>(session: T): Promise<T & { cashierName: string }> {
  return { ...session, cashierName: await resolveCashierName(session) };
}

export async function withCashierUser<T extends { id: number; employeeID?: string | null; email?: string | null; employee?: { firstName: string; lastName: string } | null }>(user: T) {
  if (isStoreTerminal(user.email)) return { ...user, employee: null };
  if (user.employee) return { ...user, employee: user.employee };
  const employee = await resolveUserEmployee(user);
  return { ...user, employee: employee ? {
    id: employee.id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode,
  } : null };
}

/** A bill's human cashier is the saved register owner; cashierId remains the audit user. */
export async function saleCashier<T extends { id: number; employeeID?: string | null; email?: string | null; employee?: { id: number; firstName: string; lastName: string; employeeCode: string } | null }>(
  user: T,
  employee: { id: number; firstName: string; lastName: string; employeeCode: string } | null,
) {
  return employee ? { ...user, employee } : withCashierUser(user);
}
