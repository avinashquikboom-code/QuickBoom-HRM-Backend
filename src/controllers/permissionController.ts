import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

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

// Get custom user permissions
export const getUserPermissions = async (req: Request, res: Response) => {
  try {
    const userIdStr = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const userId = parseInt(userIdStr, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (authReq.user.role === 'HR' || authReq.user.role === 'PLATFORM_ADMIN') {
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (targetUser.role !== 'EMPLOYEE') {
        return res.status(403).json({ error: 'Forbidden. HR can only manage employee permissions.' });
      }
    }

    const userPerm = await prisma.userPermission.findUnique({
      where: { userId },
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
    const userId = parseInt(userIdStr, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (authReq.user.role === 'HR' || authReq.user.role === 'PLATFORM_ADMIN') {
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }
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
      where: { userId },
      update: { permissions },
      create: { userId, permissions },
    });

    res.json({ message: 'User permissions updated successfully', permissions: updated.permissions });
  } catch (error) {
    console.error('Error updating user permissions:', error);
    res.status(500).json({ error: 'Server error updating user permissions' });
  }
};

// Get effective permissions for the authenticated user
export const getMyPermissions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    
    if (!userId || !role) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 1. Get global role permissions
    const rolePerm = await prisma.rolePermission.findUnique({
      where: { role: role as Role },
    });

    // 2. Get user custom permissions
    const userPerm = await prisma.userPermission.findUnique({
      where: { userId },
    });

    // Merge them: User permissions override Role permissions
    const effectivePermissions = {
      ...(rolePerm?.permissions ? (rolePerm.permissions as object) : {}),
      ...(userPerm?.permissions ? (userPerm.permissions as object) : {}),
    };

    res.json(effectivePermissions);
  } catch (error) {
    console.error('Error fetching my permissions:', error);
    res.status(500).json({ error: 'Server error fetching my permissions' });
  }
};
