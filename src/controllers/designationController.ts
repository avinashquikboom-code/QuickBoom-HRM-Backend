import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import designationService from '../services/designationService';

export const fetchDesignations = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const designations = await designationService.getDesignations();
    res.json({
      success: true,
      data: designations,
    });
  } catch (error) {
    console.error('Fetch designations error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch designations.' });
  }
};

export const createDesignation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { name } = req.body;
    if (!name || name.trim() === '') {
      res.status(400).json({ success: false, message: 'Designation name is required.' });
      return;
    }

    const designation = await designationService.createDesignation(name);
    res.status(201).json({
      success: true,
      message: 'Designation created successfully.',
      data: designation,
    });
  } catch (error: any) {
    console.error('Create designation error:', error);
    if (error.code === 'P2002') {
      res.status(400).json({ success: false, message: 'Designation with this name already exists.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create designation.' });
  }
};

export const updateDesignation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;
    const designationId = id as string;

    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(designationId)) {
      res.status(400).json({ success: false, message: 'Invalid designation ID.' });
      return;
    }

    if (!name || name.trim() === '') {
      res.status(400).json({ success: false, message: 'Designation name is required.' });
      return;
    }

    const designation = await designationService.updateDesignation(designationId, name, isActive);
    res.json({
      success: true,
      message: 'Designation updated successfully.',
      data: designation,
    });
  } catch (error) {
    console.error('Update designation error:', error);
    res.status(500).json({ success: false, message: 'Failed to update designation.' });
  }
};

export const deleteDesignation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const designationId = id as string;

    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(designationId)) {
      res.status(400).json({ success: false, message: 'Invalid designation ID.' });
      return;
    }

    await designationService.deleteDesignation(designationId);
    res.json({
      success: true,
      message: 'Designation deleted successfully.',
    });
  } catch (error) {
    console.error('Delete designation error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete designation.' });
  }
};
