import { reconcilePendingInvoiceCommissions } from '../services/pendingInvoiceReconciliation';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/db';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { date, decimal, identifier, requireValue, CommissionInputError } from './normalize';
import { processStoredLog, projectStoredHopkidLogs } from './projection';
const router = Router();
const adminRoles = ['ADMIN', 'SUPERADMIN', 'PLATFORMADMIN'];
const reportRoles = [...adminRoles, 'HR', 'STOREMANAGER'];
function access(req: AuthenticatedRequest, write = false) {
  const user = req.user;
  if (!user || user.isPosStoreSession) throw Object.assign(new Error('HRM session required'), { status: 403 });
  const role = String(user.role).toUpperCase().replace(/_/g, '');
  if (!(write ? adminRoles : reportRoles).includes(role)) throw Object.assign(new Error('Commission access denied'), { status: 403 });
  return { id: user.id, role, storeId: user.storeId, admin: adminRoles.includes(role) };
}
function storeScope(req: AuthenticatedRequest) {
  const actor = access(req), requested = req.query.storeId;
  if (!actor.admin && actor.role !== 'HR') {
    if (!actor.storeId || (requested && Number(requested) !== actor.storeId)) throw Object.assign(new Error('Store access denied'), { status: 403 });
    return actor.storeId;
  }
  if (!requested || requested === 'all') return undefined;
  const id = Number(requested); requireValue(Number.isSafeInteger(id) && id > 0, 'INVALID_STORE'); return id;
}
export function range(req: AuthenticatedRequest) {
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const from = String(req.query.from ?? req.query.startDate ?? `${today.slice(0, 7)}-01`), to = String(req.query.to ?? req.query.endDate ?? today);
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to), 'INVALID_DATE_RANGE');
  const gte = date(from, 'FROM'), lt = new Date(date(to, 'TO').getTime() + 86400000);
  requireValue(lt > gte && lt.getTime() - gte.getTime() <= 366 * 86400000, 'DATE_RANGE_MAXIMUM_366_DAYS');
  return { gte, lt };
}
const route = (fn: (req: AuthenticatedRequest) => Promise<any>) => async (req: AuthenticatedRequest, res: any) => {
  try { res.json({ success: true, data: await fn(req) }); }
  catch (e: any) { const status = e.status ?? (e instanceof CommissionInputError ? 400 : e.code === 'P2002' ? 409 : 500);
    res.status(status).json({ success: false, message: status === 500 ? 'HRM commission request failed' : e.code === 'P2002' ? 'Configuration already exists for this effective date' : e.message }); }
};
router.use(authMiddleware);
async function audit(tx: Prisma.TransactionClient, userId: number, action: string, data: any) {
  await tx.hrmCommissionAudit.create({ data: { userId, action, data: JSON.parse(JSON.stringify(data)) } });
}
router.get('/configuration', route(async req => {
  const actor = access(req);
  return { canConfigure: actor.admin, settings: await prisma.hrmCommissionSettings.findUnique({ where: { id: 1 } }),
    subcategories: await prisma.hrmCommissionSubcategory.findMany({ orderBy: { name: 'asc' } }),
    rates: await prisma.hrmCommissionRate.findMany({ where: actor.admin || actor.role === 'HR' ? {} : { storeKey: { in: [0, actor.storeId ?? 0] } }, orderBy: { effectiveFrom: 'desc' }, take: 500 }),
    mappings: await prisma.hrmCommissionMapping.findMany({ orderBy: { effectiveFrom: 'desc' }, take: 500 }) };
}));
router.put('/settings', route(async req => {
  const actor = access(req, true), b = req.body;
  requireValue(typeof b.enabled === 'boolean' && typeof b.discounted === 'boolean', 'INVALID_SETTINGS');
  requireValue(['productNetAmount', 'netAmount', 'lineTotal', 'creditAmount'].includes(b.netField), 'INVALID_NET_FIELD');
  requireValue(['UNVERIFIED', 'NET_EX_TAX', 'NET_INCL_TAX'].includes(b.netBasis), 'INVALID_SOURCE_BASIS');
  const data = { enabled: b.enabled, ingestSince: date(b.ingestSince, 'INGEST_SINCE'), netField: b.netField, netBasis: b.netBasis, discounted: b.discounted, updatedBy: actor.id };
  return prisma.$transaction(async tx => { const row = await tx.hrmCommissionSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data }); await audit(tx, actor.id, 'SOURCE_CONTRACT_CONFIGURED', data); return row; });
}));
router.post('/subcategories', route(async req => {
  const actor = access(req, true), b = req.body;
  const data = { externalId: identifier(b.externalId, 'EXTERNAL_SUBCATEGORY_ID'), name: identifier(b.name, 'SUBCATEGORY_NAME'), categoryExternalId: b.categoryExternalId ? identifier(b.categoryExternalId, 'CATEGORY_ID') : null };
  return prisma.$transaction(async tx => { const row = await tx.hrmCommissionSubcategory.upsert({ where: { externalId: data.externalId }, create: data, update: { name: data.name, categoryExternalId: data.categoryExternalId } }); await audit(tx, actor.id, 'SUBCATEGORY_REGISTERED', data); return row; });
}));
router.post('/mappings', route(async req => {
  const actor = access(req, true), b = req.body;
  const sub = await prisma.hrmCommissionSubcategory.findUnique({ where: { id: String(b.subcategoryId) } }); requireValue(sub, 'SUBCATEGORY_NOT_FOUND');
  const data = { productId: identifier(b.productId, 'PRODUCT_ID'), variantId: b.variantId ? identifier(b.variantId, 'VARIANT_ID') : '', subcategoryId: sub.id, effectiveFrom: date(b.effectiveFrom, 'EFFECTIVE_FROM'), createdBy: actor.id };
  return prisma.$transaction(async tx => { const row = await tx.hrmCommissionMapping.create({ data }); await audit(tx, actor.id, 'PRODUCT_MAPPING_VERSION_CREATED', data); return row; });
}));
router.post('/rates', route(async req => {
  const actor = access(req, true), b = req.body;
  requireValue(b.isActive === undefined || typeof b.isActive === 'boolean', 'INVALID_RATE_ACTIVE_FLAG');
  requireValue(['PERCENTAGE', 'FIXED'].includes(b.type) && ['NET_EX_TAX', 'NET_INCL_TAX'].includes(b.basis) && ['UNIT', 'LINE'].includes(b.fixedBasis), 'INVALID_RATE_TYPE_OR_BASIS');
  const rate = decimal(b.rate, 'RATE'); requireValue(rate.decimalPlaces() <= 4 && rate.lt('100000000000') && (b.type !== 'PERCENTAGE' || rate.lte(100)), 'INVALID_RATE');
  const storeKey = Number(b.storeId ?? 0); requireValue(Number.isSafeInteger(storeKey) && storeKey >= 0, 'INVALID_STORE');
  if (storeKey) requireValue(await prisma.store.findUnique({ where: { id: storeKey } }), 'STORE_NOT_FOUND');
  const sub = await prisma.hrmCommissionSubcategory.findUnique({ where: { id: String(b.subcategoryId) } }); requireValue(sub, 'SUBCATEGORY_NOT_FOUND');
  const data = { subcategoryId: sub.id, isActive: b.isActive ?? true, storeKey, type: b.type, rate, basis: b.basis, fixedBasis: b.fixedBasis, effectiveFrom: date(b.effectiveFrom, 'EFFECTIVE_FROM'), createdBy: actor.id };
  return prisma.$transaction(async tx => { const row = await tx.hrmCommissionRate.create({ data }); await audit(tx, actor.id, 'COMMISSION_RATE_VERSION_CREATED', data); return row; });
}));
router.get('/exceptions', route(async req => {
  const actor = access(req, true);
  return prisma.hrmCommissionInbox.findMany({ where: { status: 'EXCEPTION' }, orderBy: { createdAt: 'desc' }, take: 100 });
}));
router.post('/process', route(async req => {
  const actor=access(req,true);
  requireValue((await prisma.hrmCommissionSettings.findUnique({where:{id:1}}))?.enabled, 'HRM_COMMISSION_IMPORT_DISABLED');
  const projection=await projectStoredHopkidLogs();
  if(req.body?.reconcilePendingInvoices!==true) return projection;
  requireValue(req.body.dryRun!==false || (Array.isArray(req.body.transactionIds) && req.body.transactionIds.length>0), 'RECONCILIATION_APPLY_REQUIRES_TRANSACTION_IDS');
  const reconciliation=await reconcilePendingInvoiceCommissions({actorId:actor.id,dryRun:req.body.dryRun!==false,transactionIds:req.body.transactionIds,limit:req.body.limit});
  return {projection,reconciliation};
}));
router.post('/exceptions/:id/retry', route(async req => {
  const actor = access(req, true);
  const inbox = await prisma.hrmCommissionInbox.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  requireValue(inbox.status === 'EXCEPTION', 'ONLY_EXCEPTIONS_CAN_BE_RETRIED');
  await prisma.hrmCommissionAudit.create({ data: { userId: actor.id, action: 'EXCEPTION_RETRIED', data: { inboxId: inbox.id } } });
  return processStoredLog(inbox.sourceLogId);
}));
router.get('/diagnostics', route(async req => {
  const storeId = storeScope(req);
  const where = storeId ? { storeId } : {};
  const settings = await prisma.hrmCommissionSettings.findUnique({ where: { id: 1 } });
  const [sourceLogs, documents, ledgerEntries, exceptions, pending] = await Promise.all([
    prisma.hopkidWebhookLog.count({ where }),
    prisma.hrmCommissionDocument.count({ where }),
    prisma.hrmCommissionLedger.count({ where }),
    prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "HrmCommissionInbox" i JOIN "HopkidWebhookLog" l ON l.id=i."sourceLogId" WHERE i.status='EXCEPTION' AND (${storeId ?? null}::int IS NULL OR l."storeId"=${storeId ?? null})`,
    prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "HopkidWebhookLog" l WHERE (${storeId ?? null}::int IS NULL OR l."storeId"=${storeId ?? null}) AND NOT EXISTS (SELECT 1 FROM "HrmCommissionInbox" i WHERE i."sourceLogId"=l.id)`,
  ]);
  const result = { sourceLogs, documents, ledgerEntries, exceptions: Number(exceptions[0].count), unprocessedLogs: Number(pending[0].count), importEnabled: settings?.enabled ?? false, ingestSince: settings?.ingestSince ?? null };
  console.info('[HRM commission pipeline counts]', { storeId: storeId ?? 'permitted', ...result });
  return result;
}));
router.get('/report', route(async req => {
  const storeId = storeScope(req), dates = range(req), axis = req.query.dateBasis === 'posting' ? Prisma.sql`l."postedAt"` : Prisma.sql`l."saleDate"`;
  requireValue(!req.query.dateBasis || ['sale', 'posting'].includes(String(req.query.dateBasis)), 'INVALID_DATE_BASIS');
  const subcategoryId = req.query.subcategoryId ? String(req.query.subcategoryId) : null;
  if (subcategoryId) requireValue(/^[0-9a-f-]{36}$/i.test(subcategoryId), 'INVALID_SUBCATEGORY');
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH line_net AS (
      SELECT l."storeId",s.name AS store,l."subcategoryId",l."subcategoryName",l.type,l.rate,l.basis,l."fixedBasis",
        origin."documentId" AS "saleDocumentId",origin.id AS "saleLineId",
        SUM(l."eligibleRevenue") AS revenue,SUM(l."commissionAmount") AS commission,SUM(l.quantity) AS units,
        SUM(CASE WHEN l."commissionAmount"<0 THEN l."commissionAmount" ELSE 0 END) AS reversals
      FROM "HrmCommissionLedger" l JOIN "Store" s ON s.id=l."storeId"
      JOIN "HrmCommissionLine" source ON source.id=l."lineId"
      JOIN "HrmCommissionLine" origin ON origin.id=COALESCE(source."originalSaleLineId",source.id)
      JOIN "HrmCommissionDocument" sale ON sale.id=origin."documentId"
      WHERE ${axis}>=${dates.gte} AND ${axis}<${dates.lt}
      AND (${storeId ?? null}::int IS NULL OR l."storeId"=${storeId ?? null}::int)
      AND (${subcategoryId}::uuid IS NULL OR l."subcategoryId"=${subcategoryId}::uuid)
      AND (${String(req.query.search ?? '').trim()} = '' OR l."subcategoryName" ILIKE ${'%' + String(req.query.search ?? '').trim() + '%'} OR s.name ILIKE ${'%' + String(req.query.search ?? '').trim() + '%'} OR l.basis ILIKE ${'%' + String(req.query.search ?? '').trim() + '%'} OR sale."externalId" ILIKE ${'%' + String(req.query.search ?? '').trim() + '%'} OR sale."invoiceNumber" ILIKE ${'%' + String(req.query.search ?? '').trim() + '%'})
      GROUP BY l."storeId",s.name,l."subcategoryId",l."subcategoryName",l.type,l.rate,l.basis,l."fixedBasis",origin."documentId",origin.id
    )
    SELECT "storeId",store,"subcategoryId","subcategoryName",type,rate,basis,"fixedBasis",
      SUM(revenue) AS "eligibleNetSales",SUM(commission) AS "commissionAmount",SUM(units) AS "netUnits",
      COUNT(DISTINCT CASE WHEN units>0 AND revenue>0 THEN "saleDocumentId" END)::int AS "earningTransactions",
      ARRAY_AGG(DISTINCT "saleDocumentId") FILTER (WHERE units>0 AND revenue>0) AS "earningDocumentIds",
      SUM(reversals) AS reversals
    FROM line_net GROUP BY "storeId",store,"subcategoryId","subcategoryName",type,rate,basis,"fixedBasis"
    ORDER BY store,"subcategoryName",rate`);
  const sum = (list: any[]) => list.reduce((a,r) => ({ eligibleNetSales: a.eligibleNetSales.plus(r.eligibleNetSales), commissionAmount: a.commissionAmount.plus(r.commissionAmount), netUnits: a.netUnits.plus(r.netUnits), reversals: a.reversals.plus(r.reversals) }), { eligibleNetSales: new Prisma.Decimal(0), commissionAmount: new Prisma.Decimal(0), netUnits: new Prisma.Decimal(0), reversals: new Prisma.Decimal(0) });
  const storeTotals = [...new Set(rows.map(r => r.storeId))].map(id => ({ storeId: id, store: rows.find(r => r.storeId === id).store, ...sum(rows.filter(r => r.storeId === id)) }));
  console.info('[HRM commission report]', { storeId: storeId ?? 'permitted', dateBasis: req.query.dateBasis ?? 'sale', from: dates.gte.toISOString(), toExclusive: dates.lt.toISOString(), groupsAfterFilters: rows.length });
  const completedBillsCount = new Set(rows.flatMap(r => r.earningDocumentIds ?? [])).size;
  return { rows: rows.map(({earningDocumentIds, ...row}) => row), totals: { ...sum(rows), completedBillsCount }, storeTotals, range: dates, dateBasis: req.query.dateBasis ?? 'sale' };
}));
router.get('/ledger', route(async req => {
  const storeId = storeScope(req), dates = range(req);
  const page = Number(req.query.page ?? 1), pageSize = Number(req.query.pageSize ?? 50);
  requireValue(Number.isSafeInteger(page) && page > 0 && page < 100000 && Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100, 'INVALID_PAGE');
  const subcategoryId = req.query.subcategoryId ? String(req.query.subcategoryId) : null;
  if (subcategoryId) requireValue(/^[0-9a-f-]{36}$/i.test(subcategoryId), 'INVALID_SUBCATEGORY');
  const search = '%' + String(req.query.search ?? '').trim() + '%';
  const filter = Prisma.sql`FROM "HrmCommissionLedger" l JOIN "HrmCommissionDocument" d ON d.id=l."documentId" JOIN "Store" s ON s.id=l."storeId"
    JOIN "HrmCommissionLine" source ON source.id=l."lineId"
    JOIN "HrmCommissionLine" origin ON origin.id=COALESCE(source."originalSaleLineId",source.id)
    JOIN "HrmCommissionDocument" sale ON sale.id=origin."documentId"
    WHERE (${storeId ?? null}::int IS NULL OR l."storeId"=${storeId ?? null})
    AND (CASE WHEN ${req.query.dateBasis === 'posting'} THEN l."postedAt" ELSE l."saleDate" END)>=${dates.gte}
    AND (CASE WHEN ${req.query.dateBasis === 'posting'} THEN l."postedAt" ELSE l."saleDate" END)<${dates.lt}
    AND (${subcategoryId}::uuid IS NULL OR l."subcategoryId"=${subcategoryId}::uuid)
    AND (l."subcategoryName" ILIKE ${search} OR s.name ILIKE ${search} OR l.basis ILIKE ${search} OR sale."externalId" ILIKE ${search} OR sale."invoiceNumber" ILIKE ${search})`;
  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT l.*,d."externalId" AS "billId",d."invoiceNumber",s.name AS "storeName" ${filter} ORDER BY l."postedAt" DESC,l.id DESC LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`),
    prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total ${filter}`),
  ]);
  return { rows, total: Number(counts[0].total), page, pageSize };
}));

export default router;
