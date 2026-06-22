import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import roleService from '../services/roleService';

export const fetchRoles = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const roles = await roleService.getRoles();
    res.json({
      success: true,
      data: roles,
    });
  } catch (error) {
    console.error('Fetch roles error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch roles.' });
  }
};

export const createRole = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { name } = req.body;
    if (!name || name.trim() === '') {
      res.status(400).json({ success: false, message: 'Role name is required.' });
      return;
    }

    const role = await roleService.createCustomRole(name);
    res.status(201).json({
      success: true,
      message: 'Role created successfully.',
      data: role,
    });
  } catch (error: any) {
    console.error('Create role error:', error);
    if (error.message === 'Role matches a built-in system role.') {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    if (error.code === 'P2002') {
      res.status(400).json({ success: false, message: 'Role with this name already exists.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create role.' });
  }
};
