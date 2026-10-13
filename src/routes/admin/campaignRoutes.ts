import { Router } from 'express';
import { authenticateToken, requireRole } from '../../middlewares/authMiddleware';
import {
  createCampaign,
  listCampaigns,
  getCampaignById,
  updateCampaign,
  sendCampaign,
  scheduleCampaign,
  cancelCampaign,
  getCampaignAnalytics,
  previewRecipients,
  uploadCampaignImage,
  getTargetOptions,
  getTodayBirthdays,
  sendBirthdayWishes,
} from '../../controllers/admin/campaignController';

const router = Router();

// Ensure only authorized admin and HR roles can access campaign management
const adminAuth = [authenticateToken, requireRole(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'])];

// Targeting & Previews
router.get('/recipients/preview', adminAuth, previewRecipients);
router.get('/target-options', adminAuth, getTargetOptions);

// Birthday endpoints
router.get('/birthdays/today', adminAuth, getTodayBirthdays);
router.post('/birthdays/send-wishes', adminAuth, sendBirthdayWishes);

// Image upload
router.post('/upload-image', adminAuth, uploadCampaignImage);

// Campaign CRUD & Lifecycle Actions
router.post('/', adminAuth, createCampaign);
router.get('/', adminAuth, listCampaigns);
router.get('/:id', adminAuth, getCampaignById);
router.patch('/:id', adminAuth, updateCampaign);
router.put('/:id', adminAuth, updateCampaign);
router.post('/:id/send', adminAuth, sendCampaign);
router.post('/:id/schedule', adminAuth, scheduleCampaign);
router.post('/:id/cancel', adminAuth, cancelCampaign);
router.get('/:id/analytics', adminAuth, getCampaignAnalytics);

export default router;
