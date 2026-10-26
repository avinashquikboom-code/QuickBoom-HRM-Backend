import { Router, Request, Response } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../utils/db';
import { authMiddleware } from '../middlewares/authMiddleware';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { extractWebhookMeta, normalizeEventType } from '../utils/commissionHelper';
import { date, requireValue, CommissionInputError } from '../hrmCommission/normalize';

const router = Router();
const SUPERADMIN_ROLES = [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN];
const readers = [...SUPERADMIN_ROLES, Role.HR];
// Audit records are HRM data, never accessible via a POS store session.
router.use(authMiddleware, (req: any, res, next) => {
  if (req.user?.isPosStoreSession) { res.status(403).json({ success: false, message: 'HRM session required' }); return; }
  next();
}, roleMiddleware(readers));

function filters(req: Request) {
  const q = req.query;
  const start = q.fromDate ? date(String(q.fromDate), 'FROM') : null;
  const end = q.toDate ? new Date(date(String(q.toDate), 'TO').getTime() + 86400000) : null;
  requireValue(!start || !end || end > start, 'INVALID_DATE_RANGE');
  const store = q.store && !['ALL','all'].includes(String(q.store)) ? String(q.store) : null;
  const status = q.status && String(q.status) !== 'ALL' ? String(q.status).toUpperCase() : null;
  return { start, end, store, status };
}

/** Real stored deliveries only. Raw ingress is RECEIVED until a processing outcome exists.
 * Exact duplicate payloads in both ingress tables are represented by WebhookLog.
 * No synthetic events are generated from financial transactions.
 */
function events(req: Request) {
  const f = filters(req);
  const search = String(req.query.search ?? '').trim();
  return Prisma.sql`WITH deliveries AS (
    SELECT w.id,w."eventType",w.status,w.payload,w."billId",w.amount,w."errorMessage",w."createdAt",w."processedAt",
      COALESCE(w."employeeId", (SELECT c."employeeId" FROM "CommissionTransaction" c WHERE c."billId" = w."billId" OR c."invoiceNumber" = w."billId" LIMIT 1), e.id) AS "employeeId",
      COALESCE(NULLIF(concat_ws(' ',e."firstName",e."lastName"), ''), (SELECT concat_ws(' ', ce."firstName", ce."lastName") FROM "CommissionTransaction" c JOIN "Employee" ce ON ce.id=c."employeeId" WHERE c."billId" = w."billId" OR c."invoiceNumber" = w."billId" LIMIT 1)) AS "employeeName",
      COALESCE(s.id, (SELECT c."storeId" FROM "CommissionTransaction" c WHERE c."billId" = w."billId" OR c."invoiceNumber" = w."billId" LIMIT 1), e."storeId") AS "storeId",
      COALESCE(s.name, (SELECT cs.name FROM "CommissionTransaction" c JOIN "Store" cs ON cs.id=c."storeId" WHERE c."billId" = w."billId" OR c."invoiceNumber" = w."billId" LIMIT 1), (SELECT st.name FROM "Store" st WHERE st.id=e."storeId")) AS "storeName",
      'WEBHOOK' AS source
    FROM "WebhookLog" w 
    LEFT JOIN "Employee" e ON e.id=w."employeeId" 
    LEFT JOIN "Store" s ON s.id=COALESCE((SELECT h."storeId" FROM "HopkidWebhookLog" h WHERE h."rawPayload"=w.payload AND h."storeId" IS NOT NULL ORDER BY h."createdAt" LIMIT 1),e."storeId")
    UNION ALL
    SELECT 'hopkid-'||h.id,NULL,
      CASE i.status WHEN 'PROCESSED' THEN 'SUCCESS' WHEN 'EXCEPTION' THEN 'FAILED' WHEN 'IGNORED' THEN 'IGNORED' ELSE 'RECEIVED' END,
      h."rawPayload",h."billId",h.amount,i.error,h."createdAt",i."processedAt",
      COALESCE(eh.id, (SELECT c."employeeId" FROM "CommissionTransaction" c WHERE c."billId" = h."billId" OR c."invoiceNumber" = h."billId" LIMIT 1)) AS "employeeId",
      COALESCE(NULLIF(concat_ws(' ',eh."firstName",eh."lastName"), ''), (SELECT concat_ws(' ', ce."firstName", ce."lastName") FROM "CommissionTransaction" c JOIN "Employee" ce ON ce.id=c."employeeId" WHERE c."billId" = h."billId" OR c."invoiceNumber" = h."billId" LIMIT 1)) AS "employeeName",
      COALESCE(s.id, (SELECT c."storeId" FROM "CommissionTransaction" c WHERE c."billId" = h."billId" OR c."invoiceNumber" = h."billId" LIMIT 1), eh."storeId") AS "storeId",
      COALESCE(s.name, (SELECT cs.name FROM "CommissionTransaction" c JOIN "Store" cs ON cs.id=c."storeId" WHERE c."billId" = h."billId" OR c."invoiceNumber" = h."billId" LIMIT 1), (SELECT st.name FROM "Store" st WHERE st.id=eh."storeId")) AS "storeName",
      'RAW_INGRESS'
    FROM "HopkidWebhookLog" h 
    LEFT JOIN "HrmCommissionInbox" i ON i."sourceLogId"=h.id 
    LEFT JOIN "Employee" eh ON (h."employeeCode" IS NOT NULL AND eh."employeeCode"=h."employeeCode") OR (h."mobileNo" IS NOT NULL AND eh."mobileNumber"=h."mobileNo")
    LEFT JOIN "Store" s ON s.id=h."storeId"
    WHERE NOT EXISTS (SELECT 1 FROM "WebhookLog" w WHERE w.payload=h."rawPayload")
  ), filtered AS (
    SELECT * FROM deliveries WHERE (${f.start}::timestamp IS NULL OR "createdAt">=${f.start})
      AND (${f.end}::timestamp IS NULL OR "createdAt"<${f.end})
      AND (${f.status}::text IS NULL OR status=${f.status})
      AND (${f.store}::text IS NULL OR "storeName"=${f.store} OR "storeId"::text=${f.store})
      AND (${search}='' OR COALESCE("billId",'') ILIKE ${'%' + search + '%'} OR COALESCE("employeeName",'') ILIKE ${'%' + search + '%'} OR COALESCE("storeName",'') ILIKE ${'%' + search + '%'})
  )`;
}
function fail(res: Response, error: any) {
  console.error('[Webhook audit query failed]', { code: error.code, kind: error.name });
  res.status(error instanceof CommissionInputError ? 400 : 500).json({ success: false, message: error instanceof CommissionInputError ? error.message : 'Webhook audit data could not be loaded. Retry or contact the administrator.' });
}
router.get('/logs', async (req, res) => {
  try {
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit ?? 100)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    requireValue(Number.isSafeInteger(limit) && Number.isSafeInteger(offset), 'INVALID_PAGINATION');
    const cte = events(req);
    const [rows, counts] = await Promise.all([
      prisma.$queryRaw<any[]>(Prisma.sql`${cte} SELECT * FROM filtered ORDER BY "createdAt" DESC,id DESC LIMIT ${limit} OFFSET ${offset}`),
      prisma.$queryRaw<any[]>(Prisma.sql`${cte} SELECT (SELECT COUNT(*) FROM deliveries) AS before,COUNT(*) AS total FROM filtered`),
    ]);
    const data = rows.map(row => {
      let payload: any = {}; try { payload = JSON.parse(row.payload); } catch { /* Preserve original for audit inspection. */ }
      const meta = extractWebhookMeta(payload);
      return { ...row, eventType: normalizeEventType(row.eventType ?? meta.eventType, 'UNKNOWN', payload),
        invoiceNumber: meta.invoiceNumber ?? null, billId: row.billId ?? meta.billId, amount: row.amount ?? meta.amount ?? null,
        storeName: row.storeName ?? meta.storeName ?? null };
    });
    console.info('[Webhook audit counts]', { beforeFilters: Number(counts[0].before), afterFilters: Number(counts[0].total), returned: rows.length, offset });
    res.json({ success: true, data, pagination: { total: Number(counts[0].total), limit, offset, totalPages: Math.max(1, Math.ceil(Number(counts[0].total)/limit)) } });
  } catch (error) { fail(res,error); }
});
router.get('/stats', async (req, res) => {
  try {
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`${events(req)} SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status='SUCCESS') AS success,COUNT(*) FILTER (WHERE status='FAILED') AS failed,
      COUNT(*) FILTER (WHERE status IN ('RECEIVED','PROCESSING')) AS processing,COALESCE(SUM(amount),0) AS "totalAmount" FROM filtered`);
    const row = rows[0], total = Number(row.total), success = Number(row.success);
    res.json({ success: true, data: { total, success, failed: Number(row.failed), processing: Number(row.processing), totalAmount: Number(row.totalAmount), successRate: total ? `${(success/total*100).toFixed(2)}%` : '—' } });
  } catch (error) { fail(res,error); }
});
router.get('/logs/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const raw = id.startsWith('hopkid-');
    const row = raw ? await prisma.hopkidWebhookLog.findUnique({ where: { id: id.slice(7) } }) : await prisma.webhookLog.findUnique({ where: { id } });
    if (!row) { res.status(404).json({ success: false, message: 'Log not found' }); return; }
    res.json({ success: true, data: row });
  } catch (error) { fail(res,error); }
});

export default router;
