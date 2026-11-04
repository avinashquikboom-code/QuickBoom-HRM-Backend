/**
 * HopKid Report Routes
 * Exposes authenticated endpoints for all 6 filter lists and 25 documented HopKid reports.
 */

import { Router } from 'express';
import { HopKidReportController } from '../../controllers/admin/hopkidReportController';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';

const router = Router();

// Apply authentication to all HopKid report routes
router.use(authMiddleware);

// Permitted admin roles (consistent with adminRoutes.ts)
const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN', 'STORE_MANAGER'];

// Apply role authorization
router.use(roleMiddleware(adminRoles));

// ─── Filter Lists ─────────────────────────────────────────────────────────────────────
router.get('/filters/branches', HopKidReportController.getBranches);
router.get('/filters/brands', HopKidReportController.getBrands);
router.get('/filters/categories', HopKidReportController.getCategories);
router.get('/filters/subcategories', HopKidReportController.getSubCategories);
router.get('/filters/departments', HopKidReportController.getDepartments);
router.get('/filters/suppliers', HopKidReportController.getSuppliers);
router.post('/filters/refresh', HopKidReportController.refreshFilters);

// ─── Metadata ─────────────────────────────────────────────────────────────────────────
router.get('/meta/reports', HopKidReportController.listReports);

// ─── 5.1 Sales Reports ────────────────────────────────────────────────────────────────
router.post(
  '/sales/item-register',
  HopKidReportController.createReportHandler('sales/item-register')
);
router.post(
  '/sales/brand-wise',
  HopKidReportController.createReportHandler('sales/brand-wise')
);
router.post(
  '/sales/returns',
  HopKidReportController.createReportHandler('sales/returns')
);
router.post(
  '/sales/brand-wise-returns',
  HopKidReportController.createReportHandler('sales/brand-wise-returns')
);
router.post(
  '/sales/daily-summary',
  HopKidReportController.createReportHandler('sales/daily-summary')
);
router.post(
  '/sales/brand-summary',
  HopKidReportController.createReportHandler('sales/brand-summary')
);
router.get(
  '/sales/employee-summary',
  HopKidReportController.createReportHandler('sales/employee-summary')
);

// ─── 5.2 Purchase Reports ─────────────────────────────────────────────────────────────
router.post(
  '/purchase/register',
  HopKidReportController.createReportHandler('purchase/register')
);
router.post(
  '/purchase/summary',
  HopKidReportController.createReportHandler('purchase/summary')
);
router.post(
  '/purchase/summary-detailed',
  HopKidReportController.createReportHandler('purchase/summary-detailed')
);
router.post(
  '/purchase/return-summary',
  HopKidReportController.createReportHandler('purchase/return-summary')
);
router.post(
  '/purchase/return-summary-detailed',
  HopKidReportController.createReportHandler('purchase/return-summary-detailed')
);
router.get(
  '/purchase/simple-summary',
  HopKidReportController.createReportHandler('purchase/simple-summary')
);

// ─── 5.3 Stock Reports ────────────────────────────────────────────────────────────────
router.post(
  '/stock/barcode-wise',
  HopKidReportController.createReportHandler('stock/barcode-wise')
);
router.post(
  '/stock/branch-wise',
  HopKidReportController.createReportHandler('stock/branch-wise')
);
router.post(
  '/stock/summary',
  HopKidReportController.createReportHandler('stock/summary')
);
router.post(
  '/stock/summary-detailed',
  HopKidReportController.createReportHandler('stock/summary-detailed')
);
router.post(
  '/stock/auto-replenishment',
  HopKidReportController.createReportHandler('stock/auto-replenishment')
);
router.post(
  '/stock/design-summary',
  HopKidReportController.createReportHandler('stock/design-summary')
);
router.post(
  '/stock/inventory-detailed',
  HopKidReportController.createReportHandler('stock/inventory-detailed')
);
router.post(
  '/stock/inter-branch',
  HopKidReportController.createReportHandler('stock/inter-branch')
);

// ─── 5.4 Stock Transfer Reports ───────────────────────────────────────────────────────
router.post(
  '/stock-transfer/summary',
  HopKidReportController.createReportHandler('stock-transfer/summary')
);
router.post(
  '/stock-transfer/summary-detailed',
  HopKidReportController.createReportHandler('stock-transfer/summary-detailed')
);

// ─── 5.5 Vasy Reports ─────────────────────────────────────────────────────────────────
router.post(
  '/vasy/sales',
  HopKidReportController.createReportHandler('vasy/sales')
);
router.post(
  '/vasy/purchase',
  HopKidReportController.createReportHandler('vasy/purchase')
);

// ─── Generic / Parameterized Execution ────────────────────────────────────────────────
router.post('/execute/:category/:slug', HopKidReportController.executeReportBySlug);
router.get('/execute/:category/:slug', HopKidReportController.executeReportBySlug);

export default router;

