import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { clearIntegrationCache } from '../utils/configService';

const DEFAULT_SYSTEM_SETTINGS = {
  id: 1,
  platformName: 'Super HRM',
  supportEmail: 'admin@hrm.com',
  currency: 'INR',
  locale: 'en',
  twoFactor: false,
  sessionLock: false,
  auditLogs: true,
  ipRestriction: false,
  notifications: {
    newEmployee: { email: true, push: false },
    leaveRequest: { email: true, push: true },
    expenseClaim: { email: false, push: true },
    securityAlert: { email: true, push: true },
  },
  company: {
    name: 'Company',
    timezone: 'Asia/Kolkata',
  },
  integrations: {
    hopkidApiUrl: 'https://hopkidapi.3dweb.in/api/Employee/GetEmployeeList',
    hopkidApiKey: 'HOPKID-MOBILE-ACCESS-API-KEY',
    mobileApiKey: 'HOPKID-MOBILE-ACCESS-API-KEY',
    firebaseServerKey: '',
    googleMapsApiKey: '',
    awsAccessKeyId: '',
    awsSecretAccessKey: '',
    awsRegion: 'ap-south-1',
    awsBucketName: '',
  },
};

export const getSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    let settings = null;
    try {
      settings = await prisma.systemSetting.findFirst();
    } catch (dbErr) {
      console.warn('[settingsController] DB findFirst failed, using fallback:', dbErr);
    }

    if (!settings) {
      try {
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
      } catch (createErr) {
        console.warn('[settingsController] DB default creation failed, using fallback object:', createErr);
        settings = DEFAULT_SYSTEM_SETTINGS as any;
      }
    }

    res.json({
      success: true,
      settings,
      data: settings,
    });
  } catch (error: any) {
    console.error('Error fetching settings:', error);
    res.json({
      success: true,
      settings: DEFAULT_SYSTEM_SETTINGS,
      data: DEFAULT_SYSTEM_SETTINGS,
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

    let existing = null;
    try {
      existing = await prisma.systemSetting.findFirst();
    } catch (err) {
      console.warn('[updateSettings] DB lookup failed:', err);
    }

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
    res.status(400).json({
      success: false,
      message: error?.message || 'Failed to update settings',
    });
  }
};
