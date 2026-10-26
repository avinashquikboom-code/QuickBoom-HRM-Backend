import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import {
  getCommissionDashboard,
  getCommissionTransactions,
  approveCommissionTransaction,
  rejectCommissionTransaction,
} from './commissionController';
import {
  listSubcategories,
  syncRetailCommissionsFromSales,
  resolveActorFromRequest,
  parseFlexibleDateRange,
} from '../pos/retailCommissions';
import { prisma } from '../utils/db';

const router = Router();

const allowedRoles = [
  'SUPER_ADMIN',
  'SUPERADMIN',
  'ADMIN',
  'HR',
  'PLATFORM_ADMIN',
  'STORE_MANAGER',
  'EMPLOYEE',
  'SALESMAN',
];

/**
 * GET /api/admin/commission/dashboard
 * Unified commission dashboard stats and top subcategories from CommissionTransaction
 */
router.get(
  '/dashboard',
  authenticateToken,
  roleMiddleware(allowedRoles),
  getCommissionDashboard
);

/**
 * GET /api/admin/commission/transactions
 * Commission transactions with database-side pagination & filtering
 */
router.get(
  '/transactions',
  authenticateToken,
  roleMiddleware(allowedRoles),
  getCommissionTransactions
);

/**
 * PUT /api/admin/commission/transactions/:id/approve
 */
router.put(
  '/transactions/:id/approve',
  authenticateToken,
  roleMiddleware(allowedRoles),
  approveCommissionTransaction
);

/**
 * PUT /api/admin/commission/transactions/:id/reject
 */
router.put(
  '/transactions/:id/reject',
  authenticateToken,
  roleMiddleware(allowedRoles),
  rejectCommissionTransaction
);

/**
 * Unified Subcategory Commission Report generator
 */
async function generateUnifiedCommissionReport(req: Request) {
  const actor = await resolveActorFromRequest(req);
  const range = parseFlexibleDateRange(req.query);
  const rawSubcat = typeof req.query.subcategoryId === 'string' ? req.query.subcategoryId.trim() : null;
  const search = req.query.search ? String(req.query.search).trim() : null;
  const storeFilterVal = req.query.storeId && req.query.storeId !== 'all' ? parseInt(String(req.query.storeId), 10) : null;

  // 1. Fetch matching CommissionTransaction records
  const commConditions: any[] = [
    { createdAt: { gte: range.gte, lt: range.lt } },
    { status: { notIn: ['REJECTED', 'CANCELLED'] } },
  ];
  if (storeFilterVal && !isNaN(storeFilterVal)) {
    commConditions.push({
      OR: [{ storeId: storeFilterVal }, { employee: { storeId: storeFilterVal } }],
    });
  }
  if (actor.role === 'STORE_MANAGER' && actor.storeId) {
    commConditions.push({
      OR: [{ storeId: actor.storeId }, { employee: { storeId: actor.storeId } }],
    });
  }

  const transactions = await prisma.commissionTransaction.findMany({
    where: { AND: commConditions },
    include: { store: true, employee: { include: { store: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const rowMap = new Map<string, any>();
  const seenInvoices = new Set<string>();

  for (const t of transactions) {
    const invNo = t.invoiceNumber || t.billId;
    if (invNo) seenInvoices.add(invNo.trim().toLowerCase());
    const storeName = t.store?.name || t.employee?.store?.name || 'Hopkid Branch';
    const sId = t.storeId || t.employee?.storeId || 0;

    if (Array.isArray(t.productBreakdown) && t.productBreakdown.length > 0) {
      for (const p of t.productBreakdown as any[]) {
        const subcatName = p.subcategoryName || p.subcategory || p.category || 'General';
        const subcatId = p.subcategoryId || null;
        if (rawSubcat && rawSubcat !== 'all' && subcatId !== rawSubcat && subcatName !== rawSubcat) continue;
        if (search && !storeName.toLowerCase().includes(search.toLowerCase()) && !subcatName.toLowerCase().includes(search.toLowerCase()) && !(invNo && invNo.toLowerCase().includes(search.toLowerCase()))) continue;

        const rate = p.commissionRate !== null && p.commissionRate !== undefined ? Number(p.commissionRate) : Number(t.commissionPercent) || null;
        const type = p.commissionType || t.commissionType || 'PERCENTAGE';
        const basis = p.basis || 'NET_EX_TAX';
        const fixedBasis = p.fixedBasis || 'UNIT';
        const key = `${sId}_${subcatName}_${type}_${rate}_${basis}`;

        const existing = rowMap.get(key) || {
          storeId: sId,
          store: storeName,
          subcategoryId: subcatId,
          subcategoryName: subcatName,
          commissionType: type,
          rate,
          basis,
          fixedBasis,
          exclusionReason: null,
          eligibleRevenue: 0,
          commissionAmount: 0,
          eligibleItems: 0,
          transactions: 0,
          _bills: new Set<string>(),
        };

        existing.eligibleRevenue += Number(p.eligibleSaleAmount ?? p.saleAmount ?? 0);
        existing.commissionAmount += Number(p.commissionAmount ?? 0);
        existing.eligibleItems += Number(p.quantity ?? 1);
        if (invNo) existing._bills.add(invNo);
        rowMap.set(key, existing);
      }
    } else {
      const subcatName = 'General';
      if (rawSubcat && rawSubcat !== 'all' && rawSubcat !== 'General') continue;
      if (search && !storeName.toLowerCase().includes(search.toLowerCase()) && !subcatName.toLowerCase().includes(search.toLowerCase()) && !(invNo && invNo.toLowerCase().includes(search.toLowerCase()))) continue;

      const rate = t.commissionPercent !== null && t.commissionPercent !== undefined ? Number(t.commissionPercent) : null;
      const type = t.commissionType || 'PERCENTAGE';
      const basis = 'NET_EX_TAX';
      const fixedBasis = 'UNIT';
      const key = `${sId}_${subcatName}_${type}_${rate}_${basis}`;

      const existing = rowMap.get(key) || {
        storeId: sId,
        store: storeName,
        subcategoryId: null,
        subcategoryName: subcatName,
        commissionType: type,
        rate,
        basis,
        fixedBasis,
        exclusionReason: null,
        eligibleRevenue: 0,
        commissionAmount: 0,
        eligibleItems: 0,
        transactions: 0,
        _bills: new Set<string>(),
      };

      existing.eligibleRevenue += Number(t.newAmount ?? t.saleAmount ?? 0);
      existing.commissionAmount += Number(t.newCommission ?? t.commissionAmount ?? 0);
      existing.eligibleItems += 1;
      if (invNo) existing._bills.add(invNo);
      rowMap.set(key, existing);
    }
  }

  // 2. Also check POSRetailCommission for rows not already represented
  try {
    const posRows = await prisma.pOSRetailCommission.findMany({
      where: {
        status: 'ACTIVE',
        createdAt: { gte: range.gte, lt: range.lt },
        ...(storeFilterVal && !isNaN(storeFilterVal) ? { storeId: storeFilterVal } : {}),
      },
    });

    const allStores = await prisma.store.findMany().catch(() => []);
    const storeNameMap = new Map(allStores.map(s => [s.id, s.name]));

    for (const p of posRows) {
      if (p.invoiceNumber && seenInvoices.has(p.invoiceNumber.trim().toLowerCase())) continue;
      const sId = p.storeId;
      const storeName = storeNameMap.get(sId) || 'Hopkid Store';
      const subcatName = p.subcategoryName || 'Uncategorized';
      const subcatId = p.subcategoryId || null;
      if (rawSubcat && rawSubcat !== 'all' && subcatId !== rawSubcat && subcatName !== rawSubcat) continue;
      if (search && !storeName.toLowerCase().includes(search.toLowerCase()) && !subcatName.toLowerCase().includes(search.toLowerCase()) && !(p.invoiceNumber && p.invoiceNumber.toLowerCase().includes(search.toLowerCase()))) continue;

      const rate = p.rate !== null && p.rate !== undefined ? Number(p.rate) : null;
      const type = p.commissionType || 'PERCENTAGE';
      const basis = p.basis || 'NET_EX_TAX';
      const fixedBasis = p.fixedBasis || 'UNIT';
      const key = `${sId}_${subcatName}_${type}_${rate}_${basis}`;

      const rev = Number(p.eligibleRevenue) - Number(p.reversedRevenue || 0);
      const comm = Number(p.amount) - Number(p.reversedAmount || 0);
      const items = (p.quantity || 1) - (p.returnedQuantity || 0);

      const existing = rowMap.get(key) || {
        storeId: sId,
        store: storeName,
        subcategoryId: subcatId,
        subcategoryName: subcatName,
        commissionType: type,
        rate,
        basis,
        fixedBasis,
        exclusionReason: p.exclusionReason || null,
        eligibleRevenue: 0,
        commissionAmount: 0,
        eligibleItems: 0,
        transactions: 0,
        _bills: new Set<string>(),
      };

      existing.eligibleRevenue += rev;
      existing.commissionAmount += comm;
      existing.eligibleItems += items;
      if (p.invoiceNumber || p.saleId) existing._bills.add(p.invoiceNumber || p.saleId);
      rowMap.set(key, existing);
    }
  } catch (err) {
    console.warn('[Report] POSRetailCommission inclusion notice:', err);
  }

  const items = Array.from(rowMap.values()).map(r => ({
    storeId: r.storeId,
    store: r.store,
    subcategoryId: r.subcategoryId,
    subcategoryName: r.subcategoryName,
    commissionType: r.commissionType,
    rate: r.rate,
    basis: r.basis,
    fixedBasis: r.fixedBasis,
    exclusionReason: r.exclusionReason,
    eligibleRevenue: Math.round(r.eligibleRevenue * 100) / 100,
    commissionAmount: Math.round(r.commissionAmount * 100) / 100,
    eligibleItems: r.eligibleItems,
    transactions: r._bills.size || 1,
  }));

  const totals = {
    eligibleRevenue: Math.round(items.reduce((s, i) => s + i.eligibleRevenue, 0) * 100) / 100,
    commissionAmount: Math.round(items.reduce((s, i) => s + i.commissionAmount, 0) * 100) / 100,
    eligibleItems: items.reduce((s, i) => s + i.eligibleItems, 0),
    transactions: items.reduce((s, i) => s + i.transactions, 0),
  };

  const storeMap = new Map<number, any>();
  for (const item of items) {
    const s = storeMap.get(item.storeId) || {
      storeId: item.storeId,
      store: item.store,
      eligibleRevenue: 0,
      commissionAmount: 0,
      eligibleItems: 0,
      transactions: 0,
    };
    s.eligibleRevenue += item.eligibleRevenue;
    s.commissionAmount += item.commissionAmount;
    s.eligibleItems += item.eligibleItems;
    s.transactions += item.transactions;
    storeMap.set(item.storeId, s);
  }

  const storeTotals = Array.from(storeMap.values()).map(s => ({
    ...s,
    eligibleRevenue: Math.round(s.eligibleRevenue * 100) / 100,
    commissionAmount: Math.round(s.commissionAmount * 100) / 100,
  }));

  return {
    items,
    total: items.length,
    totals,
    storeTotals,
    range: {
      gte: range.gte.toISOString(),
      lt: range.lt.toISOString(),
      displayFrom: range.displayFrom || range.gte.toISOString().slice(0, 10),
      displayTo: range.displayTo || range.lt.toISOString().slice(0, 10),
    },
  };
}

/**
 * GET /api/admin/commission/report
 * Subcategory-wise commission report
 */
router.get(
  '/report',
  authenticateToken,
  roleMiddleware(allowedRoles),
  async (req: Request, res: Response) => {
    try {
      const report = await generateUnifiedCommissionReport(req);
      res.json({
        success: true,
        data: report,
      });
    } catch (error: any) {
      console.error('[Commission Report] Error:', error.message);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Failed to generate commission report',
        data: {
          items: [],
          total: 0,
          totals: { eligibleRevenue: 0, commissionAmount: 0, eligibleItems: 0, transactions: 0 },
          storeTotals: [],
        },
      });
    }
  }
);

/**
 * GET /api/admin/commission/subcategories
 * List active subcategories with configured commission rates
 */
router.get(
  '/subcategories',
  authenticateToken,
  roleMiddleware(allowedRoles),
  async (req: Request, res: Response) => {
    try {
      const actor = await resolveActorFromRequest(req);
      const result = await listSubcategories(actor);
      res.json(result);
    } catch (error: any) {
      console.error('[Commission Subcategories] Error:', error.message);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Failed to list subcategories',
        subcategories: [],
      });
    }
  }
);

/**
 * POST /api/admin/commission/sync-sales
 * Manually synchronize completed POS sales into retail commission snapshots
 */
router.post(
  '/sync-sales',
  authenticateToken,
  roleMiddleware(allowedRoles),
  async (req: Request, res: Response) => {
    try {
      const actor = await resolveActorFromRequest(req);
      const result = await syncRetailCommissionsFromSales(actor, req.body);
      res.json(result);
    } catch (error: any) {
      console.error('[Commission Sync] Error:', error.message);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Failed to synchronize POS retail commissions',
      });
    }
  }
);

/**
 * GET /api/admin/commission/report/export
 * Export subcategory commission report as CSV
 */
router.get(
  '/report/export',
  authenticateToken,
  roleMiddleware(allowedRoles),
  async (req: Request, res: Response) => {
    try {
      const report = await generateUnifiedCommissionReport(req);

      let csv = 'Store,Product Subcategory,Commission Type,Rate (%),Basis,Eligible Net Sales (₹),Commission Amount (₹),Completed Bills,Eligible Items\n';

      for (const row of report.items) {
        const store = (row.store || 'All Stores').replace(/"/g, '""');
        const subcat = (row.subcategoryName || 'Uncategorized').replace(/"/g, '""');
        const type = row.commissionType || 'PERCENTAGE';
        const rate = row.rate !== null && row.rate !== undefined ? `${row.rate}%` : '0%';
        const basis = row.basis || 'NET_EX_TAX';
        const sales = Number(row.eligibleRevenue || 0).toFixed(2);
        const comm = Number(row.commissionAmount || 0).toFixed(2);
        const txns = row.transactions || 0;
        const items = row.eligibleItems || 0;

        csv += `"${store}","${subcat}","${type}","${rate}","${basis}",${sales},${comm},${txns},${items}\n`;
      }

      // Add summary totals row
      const totSales = Number(report.totals?.eligibleRevenue || 0).toFixed(2);
      const totComm = Number(report.totals?.commissionAmount || 0).toFixed(2);
      const totTxns = report.totals?.transactions || 0;
      const totItems = report.totals?.eligibleItems || 0;
      csv += `\n"TOTAL","","","","",${totSales},${totComm},${totTxns},${totItems}\n`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="subcategory-commission-report-${Date.now()}.csv"`
      );
      res.send(csv);
    } catch (error: any) {
      console.error('[Commission Export] Error:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

export default router;
