import { campaignImageResponse } from '../services/campaignImageService';
import { Router, Response } from 'express';
import path from 'path';
import multer from 'multer';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { campaignService } from '../services/campaignService';
import { CampaignError, validateCampaign } from '../services/campaignPolicy';
import { prisma } from '../utils/db';

const router = Router();

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new CampaignError(400, 'Only JPEG, PNG, WEBP, and GIF images are allowed'));
    }
  },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'banner', maxCount: 1 },
]);

const parseUpload = (req: any, res: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    uploadMiddleware(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return reject(new CampaignError(400, 'Image file must not exceed 5MB'));
          }
          return reject(new CampaignError(400, err.message));
        }
        return reject(err);
      }
      resolve();
    });
  });
};

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
  res.json(await campaignImageResponse({
    success: true,
    data: options,
  }));
}));

router.get('/options', handle(async (req, res) => {
  const scope = await campaignService.actorScope(req.user?.id);
  const isBranchOrStoreRestricted = Boolean(scope.storeId || scope.branchId);
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
  res.json(await campaignImageResponse({
    success: true,
    data: {
      stores,
      branches,
      departments: isBranchOrStoreRestricted ? [] : departments,
      roles,
      canTargetAll: !isBranchOrStoreRestricted,
      timezone: 'Asia/Kolkata',
    },
  }));
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

  res.json(await campaignImageResponse({ success: true, data, total, page, limit }));
}));

/**
 * 2. Preview target audience before saving/sending
 */
router.get('/recipients/preview', handle(async (req, res) => {
  const { audienceType, storeId, storeIds, branchId, branchIds, departmentId, departmentIds, employeeIds, roles, role, designationId, birthdayOnly, timezone } = req.query;

  const toNums = (v: any) =>
    v ? (Array.isArray(v) ? v : String(v).split(',')).map(x => parseInt(String(x), 10)).filter(Number.isSafeInteger) : [];

  const parsedStoreIds = toNums(storeIds || storeId);
  const parsedBranchIds = toNums(branchIds || branchId);
  const parsedDepartmentIds = toNums(departmentIds || departmentId);
  const parsedEmployeeIds = toNums(employeeIds);
  const roleInput = roles || role;
  const parsedRoles = roleInput
    ? (Array.isArray(roleInput) ? roleInput : String(roleInput).split(','))
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

  res.json(await campaignImageResponse({
    success: true,
    data: preview,
  }));
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

  res.json(await campaignImageResponse({
    success: true,
    data: {
      count: formatted.length,
      birthdays: formatted,
    },
  }));
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

  res.json(await campaignImageResponse({
    success: true,
    data: result,
  }));
}));

/**
 * 5. Upload Image (both /upload-image and /image endpoints)
 * Supports multipart/form-data (fields 'image', 'file', 'banner') and JSON base64 payloads
 */
const handleUploadImage = handle(async (req, res) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    await parseUpload(req, res);
  }

  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const multipartFile =
    files?.['image']?.[0] ||
    files?.['file']?.[0] ||
    files?.['banner']?.[0] ||
    (req as any).file;

  let buffer: Buffer;
  let detectedMime: string;
  let filename: string;

  if (multipartFile) {
    buffer = multipartFile.buffer;
    detectedMime = multipartFile.mimetype || 'image/jpeg';
    filename = multipartFile.originalname || 'banner.jpg';
  } else {
    const { imageBase64, filename: reqFilename, mimeType } = req.body || {};
    if (!imageBase64) {
      throw new CampaignError(400, 'Image file (field "image" or "file") or imageBase64 payload is required');
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    buffer = Buffer.from(base64Data, 'base64');

    detectedMime = mimeType || 'image/jpeg';
    const match = imageBase64.match(/^data:(image\/\w+);base64,/);
    if (match) detectedMime = match[1];
    filename = reqFilename || 'banner.jpg';
  }

  const imageUrl = await campaignService.saveUploadedImage({
    buffer,
    originalname: filename,
    mimetype: detectedMime,
    size: buffer.length,
  });

  const canonicalUrl = imageUrl;
  const objectKey = canonicalUrl.startsWith('s3://')
    ? canonicalUrl.replace(/^s3:\/\/[^/]+\//, '')
    : `campaigns/${path.basename(canonicalUrl)}`;

  res.status(201).json(await campaignImageResponse({
    success: true,
    message: 'Campaign image uploaded successfully.',
    data: {
      imageUrl,
      canonicalUrl,
      objectKey,
      key: objectKey,
    },
  }));
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
  res.json(await campaignImageResponse({
    success: true,
    data: result,
    campaigns: result.campaigns,
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  }));
}));

/**
 * 7. Create Campaign
 */
router.post('/', handle(async (req, res) => {
  const validated = validateCampaign(req.body);
  const campaign = await campaignService.createCampaign(validated, req.user?.id);
  res.status(201).json(await campaignImageResponse({
    success: true,
    message: 'Campaign created successfully.',
    data: campaign,
  }));
}));

/**
 * 8. Get Campaign Analytics
 */
router.get('/:id/analytics', handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const analytics = await campaignService.getCampaignAnalytics(id);
  res.json(await campaignImageResponse({
    success: true,
    data: analytics,
  }));
}));

/**
 * 9. Get Campaign by ID
 */
router.get('/:id', handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const campaign = await campaignService.getCampaignById(id);
  res.json(await campaignImageResponse({
    success: true,
    data: campaign,
  }));
}));

/**
 * 10. Update Campaign
 */
const handleUpdate = handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const validated = validateCampaign(req.body);
  const updated = await campaignService.updateCampaign(id, validated, req.user?.id);
  res.json(await campaignImageResponse({
    success: true,
    message: 'Campaign updated successfully.',
    data: updated,
  }));
});

router.put('/:id', handleUpdate);
router.patch('/:id', handleUpdate);

/**
 * 11. Send Campaign Immediately
 */
router.post('/:id/send', handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await campaignService.sendCampaign(id, req.user?.id);
  res.json(await campaignImageResponse({
    success: true,
    message: result.message,
    data: result,
  }));
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
  res.json(await campaignImageResponse({
    success: true,
    message: 'Campaign scheduled successfully.',
    data: updated,
  }));
}));

/**
 * 13. Cancel Campaign
 */
router.post('/:id/cancel', handle(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const updated = await campaignService.cancelCampaign(id);
  res.json(await campaignImageResponse({
    success: true,
    message: 'Campaign cancelled successfully.',
    data: updated,
  }));
}));

router.delete('/:id', handle(async (req, res) => {
  const result = await campaignService.deleteCampaign(String(req.params.id));
  res.json({ success: true, data: result });
}));

export default router;
