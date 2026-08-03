import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  applyRemoteWork,
  getMyRemoteWorkRequests,
  getHrRemoteWorkRequests,
  reviewRemoteWorkRequest,
  getRemoteWorkStatus
} from '../controllers/remoteWorkController';

const router = Router();

// Employee routes
router.post('/mobile/remote-work/apply', authMiddleware, applyRemoteWork);
router.get('/mobile/remote-work/my-requests', authMiddleware, getMyRemoteWorkRequests);
router.get('/mobile/remote-work/status', authMiddleware, getRemoteWorkStatus);

// HR routes
router.get('/hr/remote-work/requests', authMiddleware, getHrRemoteWorkRequests);
router.patch('/hr/remote-work/:id', authMiddleware, reviewRemoteWorkRequest);

export default router;
