import { Request, Response } from 'express';
import { prisma } from '../utils/db';

export const getSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    let settings = await prisma.systemSetting.findUnique({
      where: { id: '00000000-0000-0000-0000-000000000001' },
    });

    if (!settings) {
      // Create default settings if not exists
      settings = await prisma.systemSetting.create({
        data: {
          id: '00000000-0000-0000-0000-000000000001',
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
      data: settings,
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings',
    });
  }
};

export const updateSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      platformName,
      supportEmail,
      currency,
      locale,
      twoFactor,
      sessionLock,
      auditLogs,
      ipRestriction,
      notifications,
    } = req.body;

    const updatedSettings = await prisma.systemSetting.upsert({
      where: { id: '00000000-0000-0000-0000-000000000001' },
      update: {
        platformName,
        supportEmail,
        currency,
        locale,
        twoFactor,
        sessionLock,
        auditLogs,
        ipRestriction,
        notifications,
      },
      create: {
        id: '00000000-0000-0000-0000-000000000001',
        platformName,
        supportEmail,
        currency,
        locale,
        twoFactor,
        sessionLock,
        auditLogs,
        ipRestriction,
        notifications,
      },
    });

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: updatedSettings,
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings',
    });
  }
};
