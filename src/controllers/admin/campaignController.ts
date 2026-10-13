import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import campaignService from '../../services/campaignService';
import { prisma } from '../../utils/db';

/**
 * Create campaign
 */
export const createCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      title,
      message,
      description,
      notificationType,
      imageUrl,
      actionUrl,
      audienceType,
      audienceCriteria,
      scheduledAt,
      status,
    } = req.body;

    if (!title || !message) {
      res.status(400).json({ success: false, message: 'Title and message are required.' });
      return;
    }

    const campaign = await campaignService.createCampaign({
      title,
      message,
      description,
      notificationType,
      imageUrl,
      actionUrl,
      audienceType,
      audienceCriteria,
      scheduledAt,
      status,
      createdById: req.user?.id,
      createdBy: req.user?.email || 'Admin',
    });

    res.status(201).json({
      success: true,
      message: 'Campaign created successfully.',
      data: campaign,
    });
  } catch (error: any) {
    console.error('Create campaign error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create campaign.' });
  }
};

/**
 * List campaigns with pagination and filters
 */
export const listCampaigns = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, notificationType, search, page, limit } = req.query;

    const result = await campaignService.listCampaigns({
      status: status ? String(status) : undefined,
      notificationType: notificationType ? String(notificationType) : undefined,
      search: search ? String(search) : undefined,
      page: page ? parseInt(String(page), 10) : 1,
      limit: limit ? parseInt(String(limit), 10) : 20,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('List campaigns error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to list campaigns.' });
  }
};

/**
 * Get campaign by ID
 */
export const getCampaignById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const campaign = await campaignService.getCampaignById(Array.isArray(id) ? id[0] : id);

    res.json({
      success: true,
      data: campaign,
    });
  } catch (error: any) {
    console.error('Get campaign error:', error);
    res.status(404).json({ success: false, message: error.message || 'Campaign not found.' });
  }
};

/**
 * Update campaign
 */
export const updateCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const campaign = await campaignService.updateCampaign(Array.isArray(id) ? id[0] : id, req.body);

    res.json({
      success: true,
      message: 'Campaign updated successfully.',
      data: campaign,
    });
  } catch (error: any) {
    console.error('Update campaign error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update campaign.' });
  }
};

/**
 * Send campaign immediately
 */
export const sendCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await campaignService.sendCampaign(Array.isArray(id) ? id[0] : id, req.user?.email || undefined);

    res.json({
      success: true,
      message: 'Campaign sent successfully.',
      data: result,
    });
  } catch (error: any) {
    console.error('Send campaign error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to send campaign.' });
  }
};

/**
 * Schedule campaign
 */
export const scheduleCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { scheduledAt } = req.body;

    if (!scheduledAt) {
      res.status(400).json({ success: false, message: 'scheduledAt is required.' });
      return;
    }

    const campaign = await campaignService.scheduleCampaign(Array.isArray(id) ? id[0] : id, scheduledAt);

    res.json({
      success: true,
      message: 'Campaign scheduled successfully.',
      data: campaign,
    });
  } catch (error: any) {
    console.error('Schedule campaign error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to schedule campaign.' });
  }
};

/**
 * Cancel campaign
 */
export const cancelCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const campaign = await campaignService.cancelCampaign(Array.isArray(id) ? id[0] : id);

    res.json({
      success: true,
      message: 'Campaign cancelled successfully.',
      data: campaign,
    });
  } catch (error: any) {
    console.error('Cancel campaign error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to cancel campaign.' });
  }
};

/**
 * Get campaign analytics
 */
export const getCampaignAnalytics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const analytics = await campaignService.getCampaignAnalytics(Array.isArray(id) ? id[0] : id);

    res.json({
      success: true,
      data: analytics,
    });
  } catch (error: any) {
    console.error('Get campaign analytics error:', error);
    res.status(404).json({ success: false, message: error.message || 'Failed to get analytics.' });
  }
};

/**
 * Preview recipients based on audience criteria
 */
export const previewRecipients = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { audienceType, storeId, storeIds, departmentId, role, designationId, employeeIds } = req.query;

    const parsedStoreIds = storeIds
      ? (Array.isArray(storeIds) ? storeIds : String(storeIds).split(',')).map(id => parseInt(String(id), 10))
      : undefined;

    const parsedEmployeeIds = employeeIds
      ? (Array.isArray(employeeIds) ? employeeIds : String(employeeIds).split(',')).map(id => parseInt(String(id), 10))
      : undefined;

    const criteria = {
      storeId: storeId ? parseInt(String(storeId), 10) : undefined,
      storeIds: parsedStoreIds,
      departmentId: departmentId ? parseInt(String(departmentId), 10) : undefined,
      role: role ? String(role) : undefined,
      designationId: designationId ? parseInt(String(designationId), 10) : undefined,
      employeeIds: parsedEmployeeIds,
    };

    const preview = await campaignService.previewAudience(String(audienceType || 'ALL_EMPLOYEES'), criteria);

    res.json({
      success: true,
      data: preview,
    });
  } catch (error: any) {
    console.error('Preview recipients error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to preview recipients.' });
  }
};

/**
 * Upload campaign image or banner (supports Base64 JSON payload or Multipart)
 */
export const uploadCampaignImage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { imageBase64, filename, mimeType } = req.body;

    if (!imageBase64) {
      res.status(400).json({ success: false, message: 'imageBase64 payload is required.' });
      return;
    }

    // Strip data URI prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Extract MIME type if not provided
    let detectedMime = mimeType || 'image/jpeg';
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    if (mimeMatch) {
      detectedMime = mimeMatch[1];
    }

    const savedUrl = await campaignService.saveUploadedImage({
      buffer,
      originalname: filename || 'banner.jpg',
      mimetype: detectedMime,
      size: buffer.length,
    });

    res.json({
      success: true,
      message: 'Campaign image uploaded successfully.',
      data: {
        imageUrl: savedUrl,
      },
    });
  } catch (error: any) {
    console.error('Upload campaign image error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to upload image.' });
  }
};

/**
 * Fetch targeting options (stores, departments, roles, employees)
 */
export const getTargetOptions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [stores, departments, designations, employees] = await Promise.all([
      prisma.store.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      prisma.department.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      prisma.designation.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.employee.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          storeId: true,
          departmentId: true,
          designationId: true,
        },
        orderBy: { firstName: 'asc' },
      }),
    ]);

    const roles = [
      { id: 'SUPER_ADMIN', name: 'Super Admin' },
      { id: 'ADMIN', name: 'Admin' },
      { id: 'HR', name: 'HR Manager' },
      { id: 'PLATFORM_ADMIN', name: 'Platform Admin' },
      { id: 'EMPLOYEE', name: 'Employee' },
      { id: 'STORE_MANAGER', name: 'Store Manager' },
      { id: 'SALESMAN', name: 'Salesman' },
      { id: 'HELPER', name: 'Helper' },
    ];

    res.json({
      success: true,
      data: {
        stores,
        departments,
        designations,
        roles,
        employees: employees.map(e => ({
          id: e.id,
          name: `${e.firstName} ${e.lastName}`.trim(),
          employeeCode: e.employeeCode,
          storeId: e.storeId,
          departmentId: e.departmentId,
          designationId: e.designationId,
        })),
      },
    });
  } catch (error: any) {
    console.error('Get target options error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get target options.' });
  }
};

/**
 * Get employees celebrating their birthday today
 */
export const getTodayBirthdays = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { timezone } = req.query;
    const birthdays = await campaignService.getTodayBirthdays(
      timezone ? String(timezone) : 'Asia/Kolkata'
    );

    res.json({
      success: true,
      data: {
        count: birthdays.length,
        birthdays: birthdays.map(b => ({
          id: b.id,
          name: `${b.firstName} ${b.lastName}`.trim(),
          employeeCode: b.employeeCode,
          department: b.department?.name,
          store: b.store?.name,
          dateOfBirth: b.dateOfBirth,
        })),
      },
    });
  } catch (error: any) {
    console.error('Get today birthdays error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch birthdays.' });
  }
};

/**
 * Manually trigger birthday wishes
 */
export const sendBirthdayWishes = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { employeeIds, customTitle, customMessage, imageUrl, broadcastToAll, timezone } = req.body;

    const result = await campaignService.sendBirthdayWishes({
      employeeIds,
      customTitle,
      customMessage,
      imageUrl,
      broadcastToAll: !!broadcastToAll,
      timezone: timezone || 'Asia/Kolkata',
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Send birthday wishes error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to send birthday wishes.' });
  }
};
