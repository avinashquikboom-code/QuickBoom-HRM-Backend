import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import {
  getMobileDocuments
} from '../../controllers/mobile/mobileDocumentController';

const router = Router();

// Apply auth middleware to protect all mobile document routes
router.use(authMiddleware);

// Restrict access to mobile roles only (Store Manager, Salesman, Helper)
const mobileRoles = ['STORE_MANAGER', 'SALESMAN', 'HELPER'];
router.use(roleMiddleware(mobileRoles));

/**
 * @swagger
 * /api/mobile/documents:
 *   get:
 *     summary: Get documents for logged-in user (Mobile)
 *     tags: [Mobile - Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by document type
 *       - in: query
 *         name: isPublic
 *         schema:
 *           type: boolean
 *         description: Filter by public status
 *     responses:
 *       200:
 *         description: Documents retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', getMobileDocuments);

export default router;
