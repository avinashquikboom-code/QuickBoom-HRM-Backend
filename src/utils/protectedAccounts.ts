import { prisma } from './db';

/**
 * Normalized list of system-protected account emails.
 */
export const PROTECTED_ACCOUNT_EMAILS = [
  'admin@hrm.com',
  'hr@hrm.com',
] as const;

export const PROTECTED_SYSTEM_ACCOUNT_MESSAGES = {
  CANNOT_DELETE: 'This system account cannot be deleted.',
  CANNOT_DEACTIVATE: 'This system account cannot be deactivated.',
  CANNOT_CHANGE_OWN_PASSWORD: 'Protected system accounts cannot change their own password.',
  HR_ONLY_PASSWORD_MANAGEMENT: 'Password can only be changed by authorized HR accounts.',
};

/**
 * Checks if a given email is a protected system account.
 */
export function isProtectedEmail(email?: string | null): boolean {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  return (PROTECTED_ACCOUNT_EMAILS as readonly string[]).includes(normalized);
}

/**
 * Checks if a user object has a protected email.
 */
export function isProtectedUser(user?: { email?: string | null } | null): boolean {
  if (!user) return false;
  return isProtectedEmail(user.email);
}

/**
 * Checks by user database ID if the account is protected.
 */
export async function isProtectedUserId(userId: number): Promise<boolean> {
  if (!userId || isNaN(userId)) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });
    return isProtectedUser(user);
  } catch (error) {
    console.error('[AccountProtection] Error checking protected userId:', error);
    return false;
  }
}

/**
 * Checks if an employee database ID or GUID belongs to a protected account.
 */
export async function isProtectedEmployeeId(employeeId: number | string): Promise<boolean> {
  if (!employeeId) return false;
  try {
    const numId = typeof employeeId === 'number' ? employeeId : parseInt(employeeId, 10);
    if (!isNaN(numId) && numId > 0) {
      const emp = await prisma.employee.findUnique({
        where: { id: numId },
        include: { user: { select: { email: true } } }
      });
      if (emp && (isProtectedEmail(emp.user?.email) || isProtectedEmail((emp as any).email))) {
        return true;
      }
    }

    if (typeof employeeId === 'string') {
      const emp = await prisma.employee.findFirst({
        where: {
          OR: [
            { employeeID: employeeId.trim().toLowerCase() },
            { employeeCode: employeeId.trim() },
            { employeeCode: employeeId.trim().toUpperCase() },
            { employeeCode: employeeId.trim().toLowerCase() }
          ]
        },
        include: { user: { select: { email: true } } }
      });
      if (emp && (isProtectedEmail(emp.user?.email) || isProtectedEmail((emp as any).email))) {
        return true;
      }
    }
  } catch (error) {
    console.error('[AccountProtection] Error checking protected employeeId:', error);
  }
  return false;
}

/**
 * Ensures all SUPER_ADMIN accounts in the database have an active linked Employee record
 * with proper naming and designation, so they are always visible across all employee queries.
 */
export async function ensureSuperAdminEmployee(): Promise<void> {
  try {
    const superAdminUsers = await prisma.user.findMany({
      where: {
        OR: [
          { role: 'SUPER_ADMIN' },
          { email: 'admin@hrm.com' }
        ]
      },
      include: { employee: true, profile: true }
    });

    for (const user of superAdminUsers) {
      const targetName = user.profile?.fullName || 'Super Admin';
      const nameParts = targetName.split(' ');
      const firstName = nameParts[0] || 'Super Admin';
      const lastName = nameParts.slice(1).join(' ') || '';

      if (!user.employee) {
        await prisma.employee.create({
          data: {
            userId: user.id,
            employeeCode: 'ADMIN001',
            firstName: firstName,
            lastName: lastName,
            designation: 'Super Admin',
            status: 'active',
            source: 'MANUAL',
          }
        });
        console.log(`[AccountProtection] ✅ Created linked Employee record for Super Admin user ${user.email}`);
      } else {
        const needsNameUpdate = !user.employee.firstName || user.employee.firstName === 'Admin';
        const needsDesignationUpdate = !user.employee.designation || user.employee.designation === 'HR Administrator';
        
        if (needsNameUpdate || needsDesignationUpdate || user.employee.status !== 'active') {
          await prisma.employee.update({
            where: { id: user.employee.id },
            data: {
              firstName: needsNameUpdate ? 'Super Admin' : user.employee.firstName,
              designation: needsDesignationUpdate ? 'Super Admin' : user.employee.designation,
              status: 'active',
            }
          });
          console.log(`[AccountProtection] ✅ Synchronized Employee record for Super Admin user ${user.email}`);
        }
      }
    }
  } catch (error) {
    console.error('[AccountProtection] Error ensuring Super Admin employee record:', error);
  }
}

