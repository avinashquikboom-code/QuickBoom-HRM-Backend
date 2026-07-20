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

  async updateRole(id: string, name: string) {
    const normalized = name.trim();
    const roleId = parseInt(id, 10);

    if (isNaN(roleId)) {
      throw new Error('Invalid role ID.');
    }

    // Check if it's a system role
    if (Object.values(Role).some((r) => r === normalized.toUpperCase())) {
      throw new Error('Cannot modify built-in system roles.');
    }

    // Check if the role exists and is custom
    const existingRole = await prisma.customRole.findUnique({
      where: { id: roleId },
    });

    if (!existingRole) {
      throw new Error('Role not found or is a system role.');
    }

    return prisma.customRole.update({
      where: { id: roleId },
      data: { name: normalized },
    });
  }

  async deleteRole(id: string) {
    const roleId = parseInt(id, 10);

    if (isNaN(roleId)) {
      throw new Error('Invalid role ID.');
    }

    // Check if the role exists and is custom
    const existingRole = await prisma.customRole.findUnique({
      where: { id: roleId },
    });

    if (!existingRole) {
      throw new Error('Role not found or is a system role.');
    }

    await prisma.customRole.delete({
      where: { id: roleId },
    });
  }
}

export default new RoleService();
