/** Resolve display identity from the session owner's trusted user or employee relationship. */
export const cashierUserSelect = {
  id: true,
  email: true,
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
    employee?: { firstName?: string | null; lastName?: string | null } | null;
    profile?: { fullName?: string | null } | null;
  } | null;
  profile?: { fullName?: string | null } | null;
};

export function cashierName(source: CashierSource | null | undefined): string {
  const directEmployee = source?.employee;
  const userEmployee = source?.user?.employee;
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

export function withCashierName<T extends CashierSource>(session: T): T & { cashierName: string } {
  return { ...session, cashierName: cashierName(session) };
}
