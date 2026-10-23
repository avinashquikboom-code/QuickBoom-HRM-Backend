import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { generateStoreCode } from '../utils/idGenerator';
import { syncStoresAndOffices } from '../utils/employeeSync';
import bcrypt from 'bcryptjs';

export const fetchStores = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const stores = await prisma.store.findMany({
      include: {
        posCredential: {
          select: {
            posEnabled: true,
            lastLoginAt: true,
            updatedAt: true,
          },
        },
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
    const { name, code, address, country, pincode, maxPunchRadiusMeters, latitude, longitude } = req.body;

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
        country: country?.trim() || 'India',
        pincode: pincode?.trim() || null,
        maxPunchRadiusMeters: maxPunchRadiusMeters ? parseFloat(maxPunchRadiusMeters) : 50.0,
        latitude: latitude !== undefined && latitude !== null && latitude !== '' ? parseFloat(latitude as string) : null,
        longitude: longitude !== undefined && longitude !== null && longitude !== '' ? parseFloat(longitude as string) : null,
      },
    });

    await syncStoresAndOffices().catch(err => console.error('Failed to sync offices on createStore:', err));

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
    const { name, code, address, country, pincode, isActive, maxPunchRadiusMeters, latitude, longitude } = req.body;

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
        country: country?.trim() || 'India',
        pincode: pincode?.trim() || null,
        isActive: isActive !== undefined ? isActive : true,
        maxPunchRadiusMeters: maxPunchRadiusMeters !== undefined && maxPunchRadiusMeters !== null && maxPunchRadiusMeters !== '' ? parseFloat(maxPunchRadiusMeters as string) : undefined,
        latitude: latitude !== undefined ? (latitude !== null && latitude !== '' ? parseFloat(latitude as string) : null) : undefined,
        longitude: longitude !== undefined ? (longitude !== null && longitude !== '' ? parseFloat(longitude as string) : null) : undefined,
      },
    });

    await syncStoresAndOffices().catch(err => console.error('Failed to sync offices on updateStore:', err));

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

    const store = await prisma.store.findUnique({
      where: { id: storeId }
    });

    if (store) {
      // Delete matching office
      await prisma.office.deleteMany({
        where: {
          OR: [
            { code: store.code || undefined },
            { name: store.name }
          ]
        }
      }).catch(err => console.error('Failed to delete matching office on deleteStore:', err));
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

export const setStorePOSCredentials = async (
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

    const { password, posEnabled } = req.body;
    if (!password || typeof password !== 'string' || password.trim().length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password is required and must be at least 6 characters long.',
      });
      return;
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store) {
      res.status(404).json({ success: false, message: 'Store not found.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password.trim(), 10);

    const credential = await prisma.pOSStoreCredential.upsert({
      where: { storeId },
      create: {
        storeId,
        passwordHash,
        posEnabled: posEnabled !== undefined ? Boolean(posEnabled) : true,
        failedAttempts: 0,
        lockedUntil: null,
      },
      update: {
        passwordHash,
        posEnabled: posEnabled !== undefined ? Boolean(posEnabled) : true,
        failedAttempts: 0,
        lockedUntil: null,
      },
      select: {
        id: true,
        storeId: true,
        posEnabled: true,
        lastLoginAt: true,
        updatedAt: true,
      },
    });

    // Record credential changes in the activity log
    await prisma.activityLog.create({
      data: {
        actorId: req.user ? String(req.user.id) : null,
        actorName: req.user?.email || 'Super Admin',
        actorRole: req.user?.role || 'SUPER_ADMIN',
        source: 'ADMIN_PANEL',
        action: 'SET_STORE_POS_CREDENTIALS',
        entityType: 'Store',
        entityId: String(storeId),
        description: `Set POS password and configured access for store "${store.name}" (${store.code || storeId})`,
      },
    }).catch(() => {});

    res.json({
      success: true,
      message: 'Store POS credentials set successfully.',
      data: {
        storeId: credential.storeId,
        posEnabled: credential.posEnabled,
        updatedAt: credential.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Set store POS credentials error:', error);
    res.status(500).json({ success: false, message: 'Failed to set store POS credentials.' });
  }
};

export const updateStorePOSAccess = async (
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

    const { posEnabled } = req.body;
    if (typeof posEnabled !== 'boolean') {
      res.status(400).json({ success: false, message: 'posEnabled must be a boolean.' });
      return;
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      include: { posCredential: true },
    });
    if (!store) {
      res.status(404).json({ success: false, message: 'Store not found.' });
      return;
    }

    if (!store.posCredential) {
      res.status(400).json({
        success: false,
        message: 'POS credentials not yet configured for this store. Set a password first.',
      });
      return;
    }

    const updated = await prisma.pOSStoreCredential.update({
      where: { storeId },
      data: { posEnabled },
      select: {
        storeId: true,
        posEnabled: true,
        lastLoginAt: true,
        updatedAt: true,
      },
    });

    // Record in activity log
    await prisma.activityLog.create({
      data: {
        actorId: req.user ? String(req.user.id) : null,
        actorName: req.user?.email || 'Super Admin',
        actorRole: req.user?.role || 'SUPER_ADMIN',
        source: 'ADMIN_PANEL',
        action: 'UPDATE_STORE_POS_ACCESS',
        entityType: 'Store',
        entityId: String(storeId),
        description: `${posEnabled ? 'Enabled' : 'Disabled'} POS access for store "${store.name}"`,
      },
    }).catch(() => {});

    res.json({
      success: true,
      message: `POS login access ${posEnabled ? 'enabled' : 'disabled'} successfully.`,
      data: updated,
    });
  } catch (error: any) {
    console.error('Update store POS access error:', error);
    res.status(500).json({ success: false, message: 'Failed to update store POS access.' });
  }
};

