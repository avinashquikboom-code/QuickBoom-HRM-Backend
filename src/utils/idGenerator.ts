import { prisma } from './db';

/**
 * Generate employee code based on role
 * EMP001 for employees/staff
 * SALP0001 for salespersons
 * MANG001 for managers
 * HR001 for HR
 * ADMIN001 for admins
 */
export async function generateEmployeeCode(role: string): Promise<string> {
  let prefix: string;
  
  switch (role.toUpperCase()) {
    case 'SALESMAN':
    case 'SALESPERSON':
      prefix = 'SALP';
      break;
    case 'STORE_MANAGER':
    case 'MANAGER':
      prefix = 'MANG';
      break;
    case 'HR':
    case 'HR_MANAGER':
    case 'PLATFORM_ADMIN':
      prefix = 'HR';
      break;
    case 'ADMIN':
    case 'SUPER_ADMIN':
      prefix = 'ADMIN';
      break;
    case 'EMPLOYEE':
    case 'STAFF':
    default:
      prefix = 'EMP';
      break;
  }

  // Find the highest existing code with this prefix
  const existingEmployees = await prisma.employee.findMany({
    where: {
      employeeCode: {
        startsWith: prefix,
      },
    },
    select: {
      employeeCode: true,
    },
    orderBy: {
      employeeCode: 'desc',
    },
    take: 1,
  });

  let nextNumber = 1;
  
  if (existingEmployees.length > 0) {
    const lastCode = existingEmployees[0].employeeCode;
    const lastNumber = parseInt(lastCode.replace(prefix, ''), 10);
    nextNumber = lastNumber + 1;
  }

  // Format with leading zeros (4 digits for most, 3 for HR/Admin)
  const digits = prefix === 'HR' || prefix === 'ADMIN' ? 3 : 4;
  const paddedNumber = nextNumber.toString().padStart(digits, '0');
  
  return `${prefix}${paddedNumber}`;
}

/**
 * Generate office code
 * OFF001, OFF002, etc.
 */
export async function generateOfficeCode(): Promise<string> {
  const prefix = 'OFF';
  
  const existingOffices = await prisma.office.findMany({
    where: {
      code: {
        startsWith: prefix,
      },
    },
    select: {
      code: true,
    },
    orderBy: {
      code: 'desc',
    },
    take: 1,
  });

  let nextNumber = 1;
  
  if (existingOffices.length > 0) {
    const lastCode = existingOffices[0].code || '';
    const lastNumber = parseInt(lastCode.replace(prefix, ''), 10);
    if (!isNaN(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  const paddedNumber = nextNumber.toString().padStart(3, '0');
  
  return `${prefix}${paddedNumber}`;
}



/**
 * Generate store code
 * STR001, STR002, etc.
 */
export async function generateStoreCode(): Promise<string> {
  const prefix = 'STR';
  
  const existingStores = await prisma.store.findMany({
    where: {
      code: {
        startsWith: prefix,
      },
    },
    select: {
      code: true,
    },
    orderBy: {
      code: 'desc',
    },
    take: 1,
  });

  let nextNumber = 1;
  
  if (existingStores.length > 0) {
    const lastCode = existingStores[0].code || '';
    const lastNumber = parseInt(lastCode.replace(prefix, ''), 10);
    if (!isNaN(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  const paddedNumber = nextNumber.toString().padStart(3, '0');
  
  return `${prefix}${paddedNumber}`;
}

/**
 * Generate branch code
 * BRH001, BRH002, etc.
 */
export async function generateBranchCode(): Promise<string> {
  const prefix = 'BRH';
  
  const existingBranches = await prisma.branch.findMany({
    where: {
      code: {
        startsWith: prefix,
      },
    },
    select: {
      code: true,
    },
    orderBy: {
      code: 'desc',
    },
    take: 1,
  });

  let nextNumber = 1;
  
  if (existingBranches.length > 0) {
    const lastCode = existingBranches[0].code || '';
    const lastNumber = parseInt(lastCode.replace(prefix, ''), 10);
    if (!isNaN(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  const paddedNumber = nextNumber.toString().padStart(3, '0');
  
  return `${prefix}${paddedNumber}`;
}
