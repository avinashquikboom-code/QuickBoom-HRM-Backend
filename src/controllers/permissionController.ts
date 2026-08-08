import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import bcrypt from 'bcryptjs';

// Get global permissions for all roles
export const getGlobalPermissions = async (req: Request, res: Response) => {
  try {
    const permissions = await prisma.rolePermission.findMany();
    
    // Convert to a dictionary: { "ADMIN": { ... }, "HR": { ... } }
    const formatted: Record<string, any> = {};
    for (const p of permissions) {
      formatted[p.role] = p.permissions;
    }

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching global permissions:', error);
    res.status(500).json({ error: 'Server error fetching permissions' });
  }
};

// Update global permissions for multiple roles
export const updateGlobalPermissions = async (req: Request, res: Response) => {
  try {
    const { permissions } = req.body; // Expects { "ADMIN": { ... }, "HR": { ... } }
    
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'Invalid permissions format' });
    }

    // Upsert each role's permissions
    const updatePromises = Object.entries(permissions).map(([roleStr, rolePerms]) => {
      // Validate role
      if (!Object.values(Role).includes(roleStr as Role)) return Promise.resolve();

      return prisma.rolePermission.upsert({
        where: { role: roleStr as Role },
        update: { permissions: rolePerms || {} },
        create: { role: roleStr as Role, permissions: rolePerms || {} },
      });
    });

    await Promise.all(updatePromises);
    res.json({ message: 'Permissions updated successfully' });
  } catch (error) {
    console.error('Error updating global permissions:', error);
    res.status(500).json({ error: 'Server error updating permissions' });
  }
};

const resolveTargetUser = async (idParam: string) => {
  const rawStr = String(idParam || '').trim();
  if (!rawStr) return null;

  const numericId = parseInt(rawStr, 10);

  // 1. Check User table if numeric and positive
  if (!isNaN(numericId) && numericId > 0) {
    const user = await prisma.user.findUnique({ where: { id: numericId } });
    if (user) return user;
  }

  // 2. Check Employee table by positive numeric id or string employeeCode
  const empId = !isNaN(numericId) ? Math.abs(numericId) : null;
  let emp = null;

  if (empId !== null) {
    emp = await prisma.employee.findUnique({
      where: { id: empId },
      include: { user: true },
    });
  }

  if (!emp) {
    emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: rawStr },
          { employeeCode: rawStr.toUpperCase() },
          { employeeCode: rawStr.toLowerCase() },
        ],
      },
      include: { user: true },
    });
  }

  if (!emp) return null;

  if (emp.user) return emp.user;

  // Auto-provision User account for unlinked Hopkid employee so permissions can be assigned
  const fallbackEmail = emp.mobileNumber
    ? `${emp.mobileNumber}@hopkid.internal`
    : (emp.employeeCode ? `${emp.employeeCode.toLowerCase()}@hopkid.internal` : `emp_${emp.id}@hopkid.internal`);

  const dummyPasswordHash = await bcrypt.hash(`Emp@${emp.employeeCode || emp.id}!`, 10);

  const newUser = await prisma.user.create({
    data: {
      email: fallbackEmail,
      password: dummyPasswordHash,
      role: 'EMPLOYEE',
      isActive: emp.status === 'active',
      profile: {
        create: {
          email: fallbackEmail,
          fullName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee',
        },
      },
    },
  });

  await prisma.employee.update({
    where: { id: emp.id },
    data: { userId: newUser.id },
  });

  return newUser;
};

// Get custom user permissions
export const getUserPermissions = async (req: Request, res: Response) => {
  try {
    const userIdStr = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    if (!userIdStr) return res.status(400).json({ error: 'Invalid user ID' });

    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const targetUser = await resolveTargetUser(userIdStr);
    if (!targetUser) {
      return res.status(404).json({ error: 'User or Employee not found' });
    }

    if (authReq.user.role === 'HR' || authReq.user.role === 'PLATFORM_ADMIN') {
      if (targetUser.role !== 'EMPLOYEE') {
        return res.status(403).json({ error: 'Forbidden. HR can only manage employee permissions.' });
      }
    }

    const userPerm = await prisma.userPermission.findUnique({
      where: { userId: targetUser.id },
    });

    res.json(userPerm ? userPerm.permissions : {});
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    res.status(500).json({ error: 'Server error fetching user permissions' });
  }
};

// Update custom user permissions
export const updateUserPermissions = async (req: Request, res: Response) => {
  try {
    const userIdStr = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    if (!userIdStr) return res.status(400).json({ error: 'Invalid user ID' });

    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const targetUser = await resolveTargetUser(userIdStr);
    if (!targetUser) {
      return res.status(404).json({ error: 'User or Employee not found' });
    }

    if (authReq.user.role === 'HR' || authReq.user.role === 'PLATFORM_ADMIN') {
      if (targetUser.role !== 'EMPLOYEE') {
        return res.status(403).json({ error: 'Forbidden. HR can only manage employee permissions.' });
      }
    }

    const { permissions } = req.body;
    
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'Invalid permissions format' });
    }

    // Upsert user's custom permissions
    const updated = await prisma.userPermission.upsert({
      where: { userId: targetUser.id },
      update: { permissions },
      create: { userId: targetUser.id, permissions },
    });

    res.json({ message: 'User permissions updated successfully', permissions: updated.permissions });
  } catch (error) {
    console.error('Error updating user permissions:', error);
    res.status(500).json({ error: 'Server error updating user permissions' });
  }
};

import { getEffectiveUserPermissions } from '../utils/permissionHelper';

// Get effective permissions for the authenticated user
export const getMyPermissions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const effectivePermissions = await getEffectiveUserPermissions(userId);

    res.json({
      success: true,
      permissions: effectivePermissions,
      ...effectivePermissions,
    });
  } catch (error) {
    console.error('Error fetching my permissions:', error);
    res.status(500).json({ error: 'Server error fetching my permissions' });
  }
};

// GET /api/hr/employee-permissions/:employeeId or /api/permissions/employee/:employeeId
export const getHREmployeePermissions = async (req: Request, res: Response) => {
  try {
    const employeeIdStr = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    if (!employeeIdStr) return res.status(400).json({ error: 'Invalid employee ID' });

    const targetUser = await resolveTargetUser(employeeIdStr);
    if (!targetUser) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const effectivePermissions = await getEffectiveUserPermissions(targetUser.id);

    res.json({
      success: true,
      employeeId: targetUser.id,
      permissions: effectivePermissions,
      ...effectivePermissions,
    });
  } catch (error) {
    console.error('Error fetching employee permissions for HR:', error);
    res.status(500).json({ error: 'Server error fetching employee permissions' });
  }
};

// PATCH /api/hr/employee-permissions/:employeeId or /api/permissions/employee/:employeeId
export const patchHREmployeePermissions = async (req: Request, res: Response) => {
  try {
    const employeeIdStr = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    if (!employeeIdStr) return res.status(400).json({ error: 'Invalid employee ID' });

    const authReq = req as AuthenticatedRequest;
    const targetUser = await resolveTargetUser(employeeIdStr);
    if (!targetUser) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const payload = req.body.permissions || req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid permissions payload' });
    }

    const current = await getEffectiveUserPermissions(targetUser.id);
    const updatedPermissions: Record<string, boolean> = { ...current };

    Object.keys(payload).forEach((key) => {
      if (typeof payload[key] === 'boolean') {
        updatedPermissions[key] = payload[key];
      }
    });

    const updated = await prisma.userPermission.upsert({
      where: { userId: targetUser.id },
      update: { permissions: updatedPermissions },
      create: { userId: targetUser.id, permissions: updatedPermissions },
    });

    console.log(`🔒 [AUDIT LOG] HR User ${authReq.user?.email || authReq.user?.id} updated permissions for employee ${targetUser.id} (${targetUser.email}):`, {
      updatedBy: authReq.user?.email,
      timestamp: new Date().toISOString(),
      employeeId: targetUser.id,
      newPermissions: updatedPermissions,
    });

    res.json({
      success: true,
      message: `Employee permissions updated successfully for ${targetUser.email || targetUser.id}`,
      permissions: updated.permissions,
      ...(updated.permissions as Record<string, boolean>),
    });
  } catch (error) {
    console.error('Error patching employee permissions for HR:', error);
    res.status(500).json({ error: 'Server error patching employee permissions' });
  }
};

