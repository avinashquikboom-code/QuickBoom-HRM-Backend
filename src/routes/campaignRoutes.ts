import { Router, Response } from 'express';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { campaignService } from '../services/campaignService';
import { CampaignError, validateCampaign } from '../services/campaignPolicy';
import { prisma } from '../utils/db';

const router = Router();

const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN', 'STORE_MANAGER'];
router.use(authenticateToken, requireRole(allowedRoles));

/**
 * Helper error wrapper
 */
const handle = (fn: (req: AuthenticatedRequest, res: Response) => Promise<any>) => {
  return async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error: any) {
      if (error instanceof CampaignError) {
        res.status(error.status).json({ success: false, message: error.message });
      } else {
        console.error('[CampaignRoutes] Error:', error);
        res.status(500).json({
          success: false,
          message: error?.message || 'Campaign operation failed. Please try again.',
        });
      }
    }
  };
};

/**
 * 1. Target Options for modal dropdowns and CampaignPanel
 */
router.get('/target-options', handle(async (req, res) => {
  const options = await campaignService.getTargetOptions();
  res.json({
    success: true,
    data: options,
  });
}));

router.get('/options', handle(async (req, res) => {
  const scope = await campaignService.actorScope(req.user?.id);
  const restricted = Object.keys(scope).length > 0;
  const [stores, branches, departments] = await Promise.all([
    prisma.store.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const roles = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR',
    'PLATFORM_ADMIN',
    'STORE_MANAGER',
    'EMPLOYEE',
    'SALESMAN',
    'HELPER',
  ];
  res.json({
    success: true,
    data: {
      stores,
      branches,
      departments: restricted ? [] : departments,
      roles,
      canTargetAll: !restricted,
      timezone: 'Asia/Kolkata',
    },
  });
}));

router.get('/employees', handle(async (req, res) => {
  const page = parseInt(String(req.query.page || '1'), 10);
  const limit = Math.min(parseInt(String(req.query.limit || '20'), 10), 100);
  const skip = (page - 1) * limit;
  const scope = await campaignService.actorScope(req.user?.id);
  const q = String(req.query.q || '').slice(0, 200).trim();

  const where: any = {
    AND: [
      scope,
      { status: { in: ['active', 'ACTIVE'] } },
      ...(q
        ? [
            {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { employeeCode: { contains: q, mode: 'insensitive' } },
              ],
            },
          ]
        : []),
    ],
  };

  const [data, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      select: { id: true, firstName: true, lastName: true, employeeCode: true, storeId: true, branchId: true },
      take: limit,
      skip,
      orderBy: { id: 'asc' },
    }),
    prisma.employee.count({ where }),
  ]);

  res.json({ success: true, data, total, page, limit });
}));

/**
 * 2. Preview target audience before saving/sending
 */
router.get('/recipients/preview', handle(async (req, res) => {
  const { audienceType, storeId, storeIds, branchId, branchIds, departmentId, departmentIds, employeeIds, roles, designationId, birthdayOnly, timezone } = req.query;

  const toNums = (v: any) =>
    v ? (Array.isArray(v) ? v : String(v).split(',')).map(x => parseInt(String(x), 10)).filter(Number.isSafeInteger) : [];

  const parsedStoreIds = toNums(storeIds || storeId);
  const parsedBranchIds = toNums(branchIds || branchId);
  const parsedDepartmentIds = toNums(departmentIds || departmentId);
  const parsedEmployeeIds = toNums(employeeIds);
  const parsedRoles = roles
    ? (Array.isArray(roles) ? roles : String(roles).split(','))
        .map(r => String(r).toUpperCase().trim())
        .filter(Boolean) as any
    : [];

  const criteria = {
    storeId: parsedStoreIds[0],
    storeIds: parsedStoreIds,
    branchId: parsedBranchIds[0],
    branchIds: parsedBranchIds,
    departmentId: parsedDepartmentIds[0],
    departmentIds: parsedDepartmentIds,
    designationId: designationId ? parseInt(String(designationId), 10) : undefined,
    role: parsedRoles[0],
    roles: parsedRoles,
    employeeIds: parsedEmployeeIds,
    birthdayOnly: String(birthdayOnly) === 'true',
    automaticBirthday: false,
    timezone: String(timezone || 'Asia/Kolkata'),
  };

  const preview = await campaignService.previewAudience(
    String(audienceType || 'ALL_EMPLOYEES'),
    criteria,
    req.user?.id
  );

  res.json({
    success: true,
    data: preview,
  });
}));

/**
 * 3. Today birthdays list
 */
router.get('/birthdays/today', handle(async (req, res) => {
  const { timezone, storeId, branchId } = req.query;
  const tz = String(timezone || 'Asia/Kolkata');
  const sId = storeId ? parseInt(String(storeId), 10) : undefined;
  const bId = branchId ? parseInt(String(branchId), 10) : undefined;

  const birthdays = await campaignService.getTodayBirthdays({
    timezone: tz,
    storeId: sId,
    branchId: bId,
  });

  const formatted = birthdays.map(b => ({
    id: b.id,
    name: `${b.firstName || ''} ${b.lastName || ''}`.trim() || 'Employee',
    employeeCode: b.employeeCode || '',
    department: b.department?.name || 'General',
    store: b.store?.name || b.branch?.name || 'Headquarters',
    dateOfBirth: b.dateOfBirth ? b.dateOfBirth.toISOString() : null,
    alreadyWished: Boolean(b.alreadyWished),
  }));

  res.json({
    success: true,
    data: {
      count: formatted.length,
      birthdays: formatted,
    },
  });
}));

/**
 * 4. Send Birthday Wishes
 */
router.post('/birthdays/send-wishes', handle(async (req, res) => {
  const { employeeIds, customTitle, customMessage, imageUrl, broadcastToAll, timezone } = req.body;

  const result = await campaignService.sendBirthdayWishes({
    employeeIds,
    customTitle,
    customMessage,
    imageUrl,
    broadcastToAll: Boolean(broadcastToAll),
    timezone,
    actorId: req.user?.id,
  });

  res.json({
    success: true,
    data: result,
  });
}));

/**
 * 5. Upload Image (both /upload-image and /image endpoints)
 */
const handleUploadImage = handle(async (req, res) => {
  const { imageBase64, filename, mimeType } = req.body;
  if (!imageBase64) {
    throw new CampaignError(400, 'imageBase64 payload is required');
  }

  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  let detectedMime = mimeType || 'image/jpeg';
  const match = imageBase64.match(/^data:(image\/\w+);base64,/);
  if (match) detectedMime = match[1];

  const imageUrl = await campaignService.saveUploadedImage({
    buffer,
    originalname: filename || 'banner.jpg',
    mimetype: detectedMime,
    size: buffer.length,
  });

  res.status(201).json({
    success: true,
    message: 'Campaign image uploaded successfully.',
    data: { imageUrl },
  });
});

router.post('/upload-image', handleUploadImage);
router.post('/image', handleUploadImage);

/**
 * 6. List Campaigns (paginated)
 */
router.get('/', handle(async (req, res) => {
  const { status, notificationType, search, page, limit } = req.query;

  const result = await campaignService.listCampaigns({
    status: status ? String(status) : undefined,
    notificationType: notificationType ? String(notificationType) : undefined,
    search: search ? String(search) : undefined,
    page: page ? parseInt(String(page), 10) : 1,
    limit: limit ? parseInt(String(limit), 10) : 20,
  });

  // Provide both formats so both frontend consumers work seamlessly
  res.json({
    success: true,
    data: result,
    campaigns: result.campaigns,
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
}));

/**
 * 7. Create Campaign
 */
router.post('/', handle(async (req, res) => {
  const validated = validateCampaign(req.body);
  const campaign = await campaignService.createCampaign(validated, req.user?.id);
  res.status(201).json({
    success: true,
    message: 'Campaign created successfully.',
    data: campaign,
  });
}));

/**
 * 8. Get Campaign Analytics
 */
router.get('/:id/analytics', handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const analytics = await campaignService.getCampaignAnalytics(id);
  res.json({
    success: true,
    data: analytics,
  });
}));

/**
 * 9. Get Campaign by ID
 */
router.get('/:id', handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const campaign = await campaignService.getCampaignById(id);
  res.json({
    success: true,
    data: campaign,
  });
}));

/**
 * 10. Update Campaign
 */
const handleUpdate = handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const validated = validateCampaign(req.body);
  const updated = await campaignService.updateCampaign(id, validated, req.user?.id);
  res.json({
    success: true,
    message: 'Campaign updated successfully.',
    data: updated,
  });
});

router.put('/:id', handleUpdate);
router.patch('/:id', handleUpdate);

/**
 * 11. Send Campaign Immediately
 */
router.post('/:id/send', handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await campaignService.sendCampaign(id, req.user?.id);
  res.json({
    success: true,
    message: result.message,
    data: result,
  });
}));

/**
 * 12. Schedule Campaign
 */
router.post('/:id/schedule', handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { scheduledAt } = req.body;
  if (!scheduledAt) {
    throw new CampaignError(400, 'scheduledAt date is required');
  }

  const updated = await campaignService.scheduleCampaign(id, scheduledAt);
  res.json({
    success: true,
    message: 'Campaign scheduled successfully.',
    data: updated,
  });
}));

/**
 * 13. Cancel Campaign
 */
router.post('/:id/cancel', handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const updated = await campaignService.cancelCampaign(id);
  res.json({
    success: true,
    message: 'Campaign cancelled successfully.',
    data: updated,
  });
}));

export default router;
