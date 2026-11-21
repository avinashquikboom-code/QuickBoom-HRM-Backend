import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

/**
 * GET /api/admin/branches
 * Fetches all organizational branches.
 */
export const fetchBranches = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { search, page, limit } = req.query;
    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      where.name = { contains: search.trim(), mode: 'insensitive' };
    }

    const pageNum = page ? Math.max(1, parseInt(page as string, 10)) : undefined;
    const limitNum = limit ? Math.max(1, parseInt(limit as string, 10)) : undefined;
    const skip = pageNum && limitNum ? (pageNum - 1) * limitNum : undefined;

    const [total, branches] = await Promise.all([
      prisma.branch.count({ where }),
      prisma.branch.findMany({
        where,
        include: {
          _count: {
            select: {
              employees: true,
            },
          },
        },
        orderBy: { name: 'asc' },
        ...(skip !== undefined ? { skip } : {}),
        ...(limitNum !== undefined ? { take: limitNum } : {}),
      }),
    ]);

    res.json({
      success: true,
      data: branches,
      branches,
      total,
      page: pageNum || 1,
      limit: limitNum || total,
    });
  } catch (error) {
    console.error('Fetch branches error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch branches.' });
  }
};

/**
 * GET /api/admin/branches/:id
 */
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
        employees: {
          where: { status: 'active' },
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            email: true,
            department: {
              select: { id: true, name: true },
            },
          },
        },
        _count: {
          select: {
            employees: true,
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
      branch,
    });
  } catch (error) {
    console.error('Fetch branch by ID error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch branch.' });
  }
};

/**
 * POST /api/admin/branches
 */
export const createBranch = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { name, latitude, longitude, radiusMeters, maxPunchRadiusMeters } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, message: 'Branch name is required.' });
      return;
    }

    const radius = Number(radiusMeters || maxPunchRadiusMeters) || 50.0;
    const lat = Number(latitude) || 0.0;
    const lng = Number(longitude) || 0.0;

    const newBranch = await prisma.branch.create({
      data: {
        name: name.trim(),
        latitude: lat,
        longitude: lng,
        radiusMeters: radius,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Branch created successfully.',
      data: newBranch,
      branch: newBranch,
    });
  } catch (error) {
    console.error('Create branch error:', error);
    res.status(500).json({ success: false, message: 'Failed to create branch.' });
  }
};

/**
 * PUT /api/admin/branches/:id
 */
export const updateBranch = async (
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

    const { name, latitude, longitude, radiusMeters, maxPunchRadiusMeters } = req.body;

    const dataToUpdate: any = {};
    if (name && typeof name === 'string' && name.trim()) {
      dataToUpdate.name = name.trim();
    }
    if (latitude !== undefined) {
      dataToUpdate.latitude = Number(latitude) || 0.0;
    }
    if (longitude !== undefined) {
      dataToUpdate.longitude = Number(longitude) || 0.0;
    }
    if (radiusMeters !== undefined || maxPunchRadiusMeters !== undefined) {
      dataToUpdate.radiusMeters = Number(radiusMeters || maxPunchRadiusMeters) || 50.0;
    }

    const updated = await prisma.branch.update({
      where: { id: branchId },
      data: dataToUpdate,
    });

    res.json({
      success: true,
      message: 'Branch updated successfully.',
      data: updated,
      branch: updated,
    });
  } catch (error) {
    console.error('Update branch error:', error);
    res.status(500).json({ success: false, message: 'Failed to update branch.' });
  }
};

/**
 * DELETE /api/admin/branches/:id
 */
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

    // Check if any employees are linked to this branch
    const employeeCount = await prisma.employee.count({
      where: { branchId },
    });

    if (employeeCount > 0) {
      res.status(400).json({
        success: false,
        message: `Cannot delete branch with ${employeeCount} assigned employee(s). Reassign them first.`,
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
  } catch (error) {
    console.error('Delete branch error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete branch.' });
  }
};

