import { Router } from 'express';
import { authMiddleware, requireRole } from '../middlewares/authMiddleware';
import {
  createAccessRequest,
  getAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
} from '../controllers/accessRequestController';

const router = Router();

// Mobile endpoint to submit access request
router.post('/mobile/access-requests', authMiddleware, createAccessRequest);
router.post('/access-requests', authMiddleware, createAccessRequest);

// Web Admin Panel endpoints (HR/Admin)
router.get('/access-requests', authMiddleware, requireRole(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), getAccessRequests);
router.post('/access-requests/:id/approve', authMiddleware, requireRole(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), approveAccessRequest);
router.post('/access-requests/:id/reject', authMiddleware, requireRole(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']), rejectAccessRequest);

export default router;
