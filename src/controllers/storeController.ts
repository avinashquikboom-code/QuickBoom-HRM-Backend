import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { generateStoreCode } from '../utils/idGenerator';

export const fetchStores = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const stores = await prisma.store.findMany({
      include: {
        _count: {
          select: {
            employees: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      data: stores,
    });
  } catch (error) {
    console.error('Fetch stores error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stores.' });
  }
};

export const fetchStoreById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const storeId = parseInt(id as string, 10);

    if (isNaN(storeId)) {
      res.status(400).json({ success: false, message: 'Invalid store ID.' });
      return;
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      include: {
        employees: {
          where: { status: 'active' },
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            designation: true,
            status: true,
          },
        },
      },
    });

    if (!store) {
      res.status(404).json({ success: false, message: 'Store not found.' });
      return;
    }

    res.json({
      success: true,
      data: store,
    });
  } catch (error) {
    console.error('Fetch store error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch store.' });
  }
};

export const createStore = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { name, code, address, city, state, country, pincode, phone, email } = req.body;

    if (!name || name.trim() === '') {
      res.status(400).json({ success: false, message: 'Store name is required.' });
      return;
    }

    // Generate store code if not provided
    const storeCode = code ? code.trim() : await generateStoreCode();

    const store = await prisma.store.create({
      data: {
        name: name.trim(),
        code: storeCode,
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
      message: 'Store created successfully.',
      data: store,
    });
  } catch (error: any) {
    console.error('Create store error:', error);
    if (error.code === 'P2002') {
      res.status(400).json({ success: false, message: 'Store code already exists.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create store.' });
  }
};

export const updateStore = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, code, address, city, state, country, pincode, phone, email, isActive } = req.body;

    const storeId = parseInt(id as string, 10);
    if (isNaN(storeId)) {
      res.status(400).json({ success: false, message: 'Invalid store ID.' });
      return;
    }

    if (!name || name.trim() === '') {
      res.status(400).json({ success: false, message: 'Store name is required.' });
      return;
    }

    const store = await prisma.store.update({
      where: { id: storeId },
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
      message: 'Store updated successfully.',
      data: store,
    });
  } catch (error: any) {
    console.error('Update store error:', error);
    if (error.code === 'P2025') {
      res.status(404).json({ success: false, message: 'Store not found.' });
      return;
    }
    if (error.code === 'P2002') {
      res.status(400).json({ success: false, message: 'Store code already exists.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to update store.' });
  }
};

export const deleteStore = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const storeId = parseInt(id as string, 10);

    if (isNaN(storeId)) {
      res.status(400).json({ success: false, message: 'Invalid store ID.' });
      return;
    }

    // Check if store has employees
    const employeeCount = await prisma.employee.count({
      where: { storeId },
    });

    if (employeeCount > 0) {
      res.status(400).json({ 
        success: false, 
        message: 'Cannot delete store with assigned employees. Please reassign or delete employees first.' 
      });
      return;
    }

    await prisma.store.delete({
      where: { id: storeId },
    });

    res.json({
      success: true,
      message: 'Store deleted successfully.',
    });
  } catch (error: any) {
    console.error('Delete store error:', error);
    if (error.code === 'P2025') {
      res.status(404).json({ success: false, message: 'Store not found.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to delete store.' });
  }
};
