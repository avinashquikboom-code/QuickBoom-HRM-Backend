import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { clearIntegrationCache } from '../utils/configService';

export const getSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    let settings = await prisma.systemSetting.findFirst();

    if (!settings) {
      // Create default settings if not exists
      settings = await prisma.systemSetting.create({
        data: {
          id: 1,
          platformName: 'Super HRM',
          supportEmail: 'admin@hrm.com',
          currency: 'INR',
          locale: 'en',
          notifications: {
            newEmployee: { email: true, push: false },
            leaveRequest: { email: true, push: true },
            expenseClaim: { email: false, push: true },
            securityAlert: { email: true, push: true },
          },
        },
      });
    }

    res.json({
      success: true,
      settings,
      data: settings,
    });
  } catch (error: any) {
    console.error('Error fetching settings:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Failed to fetch settings',
    });
  }
};

export const updateSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const fieldsToUpdate: any = {};
    const allowedFields = [
      'platformName',
      'supportEmail',
      'currency',
      'locale',
      'twoFactor',
      'sessionLock',
      'auditLogs',
      'ipRestriction',
      'notifications',
      'company',
      'attendance',
      'leave',
      'payroll',
      'integrations',
    ];

    // If payload sent as { category: 'integrations', settings: { ... } }
    if (req.body.category && req.body.settings && allowedFields.includes(req.body.category)) {
      fieldsToUpdate[req.body.category] = req.body.settings;
    }

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fieldsToUpdate[field] = req.body[field];
      }
    }

    let existing = await prisma.systemSetting.findFirst();

    let updatedSettings;
    if (existing) {
      updatedSettings = await prisma.systemSetting.update({
        where: { id: existing.id },
        data: fieldsToUpdate,
      });
    } else {
      updatedSettings = await prisma.systemSetting.create({
        data: {
          id: 1,
          ...fieldsToUpdate,
        },
      });
    }

    clearIntegrationCache();

    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings: updatedSettings,
      data: updatedSettings,
    });
  } catch (error: any) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Failed to update settings',
    });
  }
};
