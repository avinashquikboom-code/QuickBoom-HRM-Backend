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
          include: {
            _count: {
              select: {
                employees: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const branchesWithOfficeName = branches.map(branch => ({
      ...branch,
      officeName: branch.stores[0]?.name || null,
      officeId: branch.stores[0]?.id || null,
    }));

    res.json({
      success: true,
      data: branchesWithOfficeName,
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
          include: {
            _count: {
              select: {
                employees: true,
              },
            },
          },
        },
      },
    });

    if (!branch) {
      res.status(404).json({ success: false, message: 'Branch not found.' });
      return;
    }

    const branchWithOfficeName = {
      ...branch,
      officeName: branch.stores[0]?.name || null,
      officeId: branch.stores[0]?.id || null,
    };

    res.json({
      success: true,
      data: branchWithOfficeName,
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
    const { name, code, address, city, state, country, pincode, phone, email, officeId, latitude, longitude, maxPunchRadiusMeters } = req.body;

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
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        maxPunchRadiusMeters: maxPunchRadiusMeters ? parseFloat(maxPunchRadiusMeters) : 50.0,
      },
    });

    if (officeId) {
      const storeId = parseInt(officeId as string, 10);
      if (!isNaN(storeId)) {
        await prisma.store.update({
          where: { id: storeId },
          data: { branchId: branch.id },
        });
      }
    }

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
    const { name, code, address, city, state, country, pincode, phone, email, isActive, latitude, longitude, maxPunchRadiusMeters, officeId } = req.body;

    const branchId = parseInt(id as string, 10);
    if (isNaN(branchId)) {
      res.status(400).json({ success: false, message: 'Invalid branch ID.' });
      return;
    }

    const updateData: any = {};
    if (name !== undefined) {
      if (!name || name.trim() === '') {
        res.status(400).json({ success: false, message: 'Branch name is required.' });
        return;
      }
      updateData.name = name.trim();
    }
    if (code !== undefined) updateData.code = code?.trim() || null;
    if (address !== undefined) updateData.address = address?.trim() || null;
    if (city !== undefined) updateData.city = city?.trim() || null;
    if (state !== undefined) updateData.state = state?.trim() || null;
    if (country !== undefined) updateData.country = country?.trim() || 'India';
    if (pincode !== undefined) updateData.pincode = pincode?.trim() || null;
    if (phone !== undefined) updateData.phone = phone?.trim() || null;
    if (email !== undefined) updateData.email = email?.trim() || null;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (latitude !== undefined) updateData.latitude = latitude !== null && latitude !== '' ? parseFloat(latitude as string) : null;
    if (longitude !== undefined) updateData.longitude = longitude !== null && longitude !== '' ? parseFloat(longitude as string) : null;
    if (maxPunchRadiusMeters !== undefined) updateData.maxPunchRadiusMeters = maxPunchRadiusMeters !== null && maxPunchRadiusMeters !== '' ? parseFloat(maxPunchRadiusMeters as string) : 50.0;

    const branch = await prisma.branch.update({
      where: { id: branchId },
      data: updateData,
    });

    if (officeId !== undefined) {
      // Unlink any store currently linked to this branch
      await prisma.store.updateMany({
        where: { branchId: branchId },
        data: { branchId: null },
      });

      // Link the new store if specified
      if (officeId) {
        const storeId = parseInt(officeId as string, 10);
        if (!isNaN(storeId) && storeId !== 0) {
          await prisma.store.update({
            where: { id: storeId },
            data: { branchId: branchId },
          });
        }
      }
    }

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
