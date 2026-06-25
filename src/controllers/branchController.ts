import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { generateBranchCode } from '../utils/idGenerator';

export const fetchBranches = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const branches = await prisma.branch.findMany({
      include: {
        stores: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            code: true,
            isActive: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      data: branches,
    });
  } catch (error) {
    console.error('Fetch branches error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch branches.' });
  }
};

export const fetchBranchById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const branchId = parseInt(id as string, 10);

    if (isNaN(branchId)) {
      res.status(400).json({ success: false, message: 'Invalid branch ID.' });
      return;
    }

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: {
        stores: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
            city: true,
            state: true,
            phone: true,
            isActive: true,
          },
        },
      },
    });

    if (!branch) {
      res.status(404).json({ success: false, message: 'Branch not found.' });
      return;
    }

    res.json({
      success: true,
      data: branch,
    });
  } catch (error) {
    console.error('Fetch branch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch branch.' });
  }
};

export const createBranch = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { name, code, address, city, state, country, pincode, phone, email } = req.body;

    if (!name || name.trim() === '') {
      res.status(400).json({ success: false, message: 'Branch name is required.' });
      return;
    }

    // Generate branch code if not provided
    const branchCode = code ? code.trim() : await generateBranchCode();

    const branch = await prisma.branch.create({
      data: {
        name: name.trim(),
        code: branchCode,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        country: country?.trim() || 'India',
        pincode: pincode?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Branch created successfully.',
      data: branch,
    });
  } catch (error: any) {
    console.error('Create branch error:', error);
    if (error.code === 'P2002') {
      res.status(400).json({ success: false, message: 'Branch code already exists.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create branch.' });
  }
};

export const updateBranch = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, code, address, city, state, country, pincode, phone, email, isActive } = req.body;

    const branchId = parseInt(id as string, 10);
    if (isNaN(branchId)) {
      res.status(400).json({ success: false, message: 'Invalid branch ID.' });
      return;
    }

    if (!name || name.trim() === '') {
      res.status(400).json({ success: false, message: 'Branch name is required.' });
      return;
    }

    const branch = await prisma.branch.update({
      where: { id: branchId },
      data: {
        name: name.trim(),
        code: code?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        country: country?.trim() || 'India',
        pincode: pincode?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    res.json({
      success: true,
      message: 'Branch updated successfully.',
      data: branch,
    });
  } catch (error: any) {
    console.error('Update branch error:', error);
    if (error.code === 'P2025') {
      res.status(404).json({ success: false, message: 'Branch not found.' });
      return;
    }
    if (error.code === 'P2002') {
      res.status(400).json({ success: false, message: 'Branch code already exists.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to update branch.' });
  }
};

export const deleteBranch = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const branchId = parseInt(id as string, 10);

    if (isNaN(branchId)) {
      res.status(400).json({ success: false, message: 'Invalid branch ID.' });
      return;
    }

    // Check if branch has stores
    const storeCount = await prisma.store.count({
      where: { branchId },
    });

    if (storeCount > 0) {
      res.status(400).json({ 
        success: false, 
        message: 'Cannot delete branch with assigned stores. Please reassign or delete stores first.' 
      });
      return;
    }

    await prisma.branch.delete({
      where: { id: branchId },
    });

    res.json({
      success: true,
      message: 'Branch deleted successfully.',
    });
  } catch (error: any) {
    console.error('Delete branch error:', error);
    if (error.code === 'P2025') {
      res.status(404).json({ success: false, message: 'Branch not found.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to delete branch.' });
  }
};
