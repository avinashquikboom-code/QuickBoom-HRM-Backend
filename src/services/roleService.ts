import { prisma } from '../utils/db';
import { Role } from '@prisma/client';

class RoleService {
  async getRoles() {
    // 1. Get all system roles from Prisma enum
    const systemRoles = Object.values(Role).map((r) => ({
      name: r,
      isSystem: true,
      isActive: true,
    }));

    // 2. Get custom roles from database
    const customRoles = await prisma.customRole.findMany({
      orderBy: { name: 'asc' },
    });

    const mappedCustom = customRoles.map((cr) => ({
      id: cr.id,
      name: cr.name,
      isSystem: false,
      isActive: cr.isActive,
    }));

    return [...systemRoles, ...mappedCustom];
  }

  async createCustomRole(name: string) {
    const normalized = name.trim();
    
    // Check if it matches a system role
    if (Object.values(Role).some((r) => r.toUpperCase() === normalized.toUpperCase())) {
      throw new Error('Role matches a built-in system role.');
    }

    return prisma.customRole.create({
      data: { name: normalized },
    });
  }
}

export default new RoleService();
