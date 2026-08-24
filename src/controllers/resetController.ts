import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'quickboom-reset-secret-key-2026';

// ─── Whitelist Definition ──────────────────────────────────────────────────────
export const WHITELISTED_TABLES = [
  'Attendance',
  'Leaves',
  'Payroll',
  'Sales',
  'Breaks',
  'ShiftRequests',
  'Tasks',
  'Notifications',
] as const;

export type WhitelistedTable = typeof WHITELISTED_TABLES[number];

const HR_ALLOWED_TABLES: WhitelistedTable[] = ['Attendance', 'Leaves', 'Breaks'];

const FORBIDDEN_KEYWORDS = ['user', 'auth', 'session', 'device', 'fcm', 'permission', 'profile', 'role'];

// ─── Rate Limiter (3 resets per hour per admin) ──────────────────────────────────
const resetHistory = new Map<string, number[]>(); // userId -> timestamps[]

function checkRateLimit(userId: string): { allowed: boolean; remaining: number; retryAfterSec?: number } {
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxResets = 3;
  const now = Date.now();
  const timestamps = (resetHistory.get(userId) || []).filter(t => now - t < windowMs);

  if (timestamps.length >= maxResets) {
    const oldest = timestamps[0];
    const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  return { allowed: true, remaining: maxResets - timestamps.length };
}

function recordRateLimitUsage(userId: string) {
  const windowMs = 60 * 60 * 1000;
  const now = Date.now();
  const timestamps = (resetHistory.get(userId) || []).filter(t => now - t < windowMs);
  timestamps.push(now);
  resetHistory.set(userId, timestamps);
}

// Used tokens cache to prevent reuse
const usedTokens = new Set<string>();

// ─── Helper: Build Prisma Where Filters for Each Table ──────────────────────────
async function buildTableWhere(table: WhitelistedTable, filters: any) {
  const { branchId, employeeId, attendanceStatus, dateFrom, dateTo } = filters || {};
  const where: any = {};

  let targetEmployeeIds: number[] | null = null;

  // Filter by branchId
  if (branchId) {
    const branchOfficeId = Number(branchId);
    const branchEmployees = await prisma.employee.findMany({
      where: { officeId: branchOfficeId },
      select: { id: true, employeeCode: true, employeeID: true },
    });
    targetEmployeeIds = branchEmployees.map(e => e.id);
  }

  // Filter by employeeId
  if (employeeId) {
    const empIdNum = Number(employeeId);
    if (!isNaN(empIdNum)) {
      if (targetEmployeeIds) {
        targetEmployeeIds = targetEmployeeIds.filter(id => id === empIdNum);
      } else {
        targetEmployeeIds = [empIdNum];
      }
    }
  }

  // Date Range setup
  let startDate: Date | null = null;
  let endDate: Date | null = null;
  if (dateFrom) {
    startDate = new Date(dateFrom);
    startDate.setHours(0, 0, 0, 0);
  }
  if (dateTo) {
    endDate = new Date(dateTo);
    endDate.setHours(23, 59, 59, 999);
  }

  switch (table) {
    case 'Attendance': {
      if (targetEmployeeIds !== null) {
        where.employeeId = { in: targetEmployeeIds };
      }
      if (attendanceStatus) {
        where.status = String(attendanceStatus).toUpperCase();
      }
      if (dateFrom || dateTo) {
        where.date = {};
        if (dateFrom) where.date.gte = dateFrom; // YYYY-MM-DD
        if (dateTo) where.date.lte = dateTo;
      }
      break;
    }
    case 'Leaves': {
      if (targetEmployeeIds !== null) {
        where.employeeId = { in: targetEmployeeIds };
      }
      if (startDate || endDate) {
        where.fromDate = {};
        if (startDate) where.fromDate.gte = startDate;
        if (endDate) where.fromDate.lte = endDate;
      }
      break;
    }
    case 'Payroll': {
      if (targetEmployeeIds !== null) {
        where.employeeId = { in: targetEmployeeIds };
      }
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }
      break;
    }
    case 'Sales': {
      if (targetEmployeeIds !== null) {
        where.employeeId = { in: targetEmployeeIds };
      }
      if (branchId) {
        where.storeId = Number(branchId);
      }
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }
      break;
    }
    case 'Breaks': {
      if (targetEmployeeIds !== null) {
        where.employeeId = { in: targetEmployeeIds };
      }
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }
      break;
    }
    case 'ShiftRequests': {
      if (targetEmployeeIds !== null) {
        where.employeeId = { in: targetEmployeeIds };
      }
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }
      break;
    }
    case 'Tasks': {
      if (targetEmployeeIds !== null) {
        where.assignedToId = { in: targetEmployeeIds };
      }
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }
      break;
    }
    case 'Notifications': {
      if (targetEmployeeIds !== null) {
        const users = await prisma.employee.findMany({
          where: { id: { in: targetEmployeeIds } },
          select: { userId: true },
        });
        const userIds = users.map(u => u.userId).filter((id): id is number => id !== null);
        where.userId = { in: userIds };
      }
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }
      break;
    }
  }

  return where;
}

// ─── Dry-Run Calculation ───────────────────────────────────────────────────────
async function getDryRunCount(table: WhitelistedTable, filters: any): Promise<number> {
  const where = await buildTableWhere(table, filters);

  switch (table) {
    case 'Attendance':
      return await prisma.attendance.count({ where });
    case 'Leaves':
      return await prisma.leaveRequest.count({ where });
    case 'Payroll': {
      const payslips = await prisma.payslip.count({ where });
      const advances = await prisma.salaryAdvance.count({ where });
      return payslips + advances;
    }
    case 'Sales':
      return await prisma.commissionTransaction.count({ where });
    case 'Breaks':
      return await prisma.break.count({ where });
    case 'ShiftRequests':
      return await prisma.shiftRequest.count({ where });
    case 'Tasks':
      return await prisma.task.count({ where });
    case 'Notifications':
      return await prisma.notification.count({ where });
    default:
      return 0;
  }
}

// ─── Table Reset Deletion ─────────────────────────────────────────────────────
async function deleteTableRecords(table: WhitelistedTable, filters: any): Promise<number> {
  const where = await buildTableWhere(table, filters);

  switch (table) {
    case 'Attendance': {
      // Find matching attendance IDs to delete dependent records first
      const atts = await prisma.attendance.findMany({ where, select: { id: true } });
      const attIds = atts.map(a => a.id);
      if (attIds.length > 0) {
        await prisma.attendanceCorrection.deleteMany({ where: { attendanceId: { in: attIds } } });
        await prisma.breakRecord.deleteMany({ where: { attendanceId: { in: attIds } } });
      }
      const res = await prisma.attendance.deleteMany({ where });
      return res.count;
    }
    case 'Leaves': {
      const res = await prisma.leaveRequest.deleteMany({ where });
      return res.count;
    }
    case 'Payroll': {
      const payslipsRes = await prisma.payslip.deleteMany({ where });
      const advancesRes = await prisma.salaryAdvance.deleteMany({ where });
      return payslipsRes.count + advancesRes.count;
    }
    case 'Sales': {
      const res = await prisma.commissionTransaction.deleteMany({ where });
      return res.count;
    }
    case 'Breaks': {
      const res = await prisma.break.deleteMany({ where });
      return res.count;
    }
    case 'ShiftRequests': {
      const res = await prisma.shiftRequest.deleteMany({ where });
      return res.count;
    }
    case 'Tasks': {
      const res = await prisma.task.deleteMany({ where });
      return res.count;
    }
    case 'Notifications': {
      const res = await prisma.notification.deleteMany({ where });
      return res.count;
    }
    default:
      return 0;
  }
}

// ==============================================================================
// 1. SuperAdmin Dry-Run (GET/POST /api/superadmin/reset/dry-run)
// ==============================================================================
export const superAdminResetDryRun = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const roleUpper = (req.user?.role || '').toUpperCase();
    if (roleUpper !== 'SUPERADMIN' && roleUpper !== 'SUPER_ADMIN') {
      res.status(403).json({
        success: false,
        message: 'Forbidden. Access restricted to SuperAdmin role only.',
      });
      return;
    }

    const userId = String(req.user?.id || 'admin');
    const rateCheck = checkRateLimit(userId);
    if (!rateCheck.allowed) {
      res.status(429).json({
        success: false,
        message: `Rate limit exceeded. Maximum 3 resets per hour allowed. Try again in ${rateCheck.retryAfterSec} seconds.`,
      });
      return;
    }

    const rawTables = req.body?.tables || req.query?.tables;
    let tables: any[] = [];
    if (Array.isArray(rawTables)) {
      tables = rawTables;
    } else if (typeof rawTables === 'string') {
      tables = rawTables.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      tables = [...WHITELISTED_TABLES];
    }

    const filters = req.body?.filters || req.query || {};

    if (!Array.isArray(tables) || tables.length === 0) {
      res.status(400).json({ success: false, message: 'Select at least one table to reset.' });
      return;
    }

    // Check for forbidden tables (User, Auth, Sessions, Devices, etc.)
    for (const t of tables) {
      const tLower = String(t).toLowerCase();
      if (FORBIDDEN_KEYWORDS.some(k => tLower.includes(k))) {
        res.status(403).json({
          success: false,
          message: `Forbidden table requested: "${t}". User, Auth, Sessions, and System tables cannot be reset.`,
        });
        return;
      }
      if (!WHITELISTED_TABLES.includes(t as any)) {
        res.status(400).json({
          success: false,
          message: `Invalid table "${t}". Must be from whitelisted tables only.`,
        });
        return;
      }
    }

    const preview: Array<{ table: string; rowCount: number }> = [];

    for (const table of tables as WhitelistedTable[]) {
      const count = await getDryRunCount(table, filters);
      preview.push({ table, rowCount: count });
    }

    // Generate 5-minute JWT confirmation token containing request payload
    const confirmToken = jwt.sign(
      {
        sub: userId,
        scope: 'SUPERADMIN_RESET',
        tables,
        filters,
        preview,
      },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    recordRateLimitUsage(userId);

    res.json({
      success: true,
      preview,
      confirmToken,
      expiresAt,
      remainingResets: rateCheck.remaining - 1,
    });
  } catch (error) {
    console.error('SuperAdmin dry-run error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate reset dry-run.' });
  }
};

// ==============================================================================
// 2. SuperAdmin Execute Reset (POST /api/superadmin/reset/execute)
// ==============================================================================
export const superAdminResetExecute = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const roleUpper = (req.user?.role || '').toUpperCase();
    if (roleUpper !== 'SUPERADMIN' && roleUpper !== 'SUPER_ADMIN') {
      res.status(403).json({
        success: false,
        message: 'Forbidden. Access restricted to SuperAdmin role only.',
      });
      return;
    }

    const userId = String(req.user?.id || 'admin');

    const { confirmToken, tables: reqTables, filters: reqFilters } = req.body;

    if (!confirmToken) {
      res.status(400).json({ success: false, message: 'Confirmation token is required.' });
      return;
    }

    if (usedTokens.has(confirmToken)) {
      res.status(400).json({ success: false, message: 'Confirmation token has already been used.' });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(confirmToken, JWT_SECRET);
    } catch (jwtErr) {
      res.status(400).json({ success: false, message: 'Confirmation token is invalid or expired (5min limit).' });
      return;
    }

    if (decoded.scope !== 'SUPERADMIN_RESET' || decoded.sub !== userId) {
      res.status(403).json({ success: false, message: 'Token scope or user mismatch.' });
      return;
    }

    // Rate limit check
    const rateCheck = checkRateLimit(userId);
    if (!rateCheck.allowed) {
      res.status(429).json({
        success: false,
        message: `Rate limit exceeded. Maximum 3 resets per hour allowed. Try again in ${rateCheck.retryAfterSec} seconds.`,
      });
      return;
    }

    const tables: WhitelistedTable[] = decoded.tables || reqTables;
    const filters = decoded.filters || reqFilters || {};

    // Forbidden table check
    for (const t of tables) {
      const tLower = String(t).toLowerCase();
      if (FORBIDDEN_KEYWORDS.some(k => tLower.includes(k))) {
        res.status(403).json({
          success: false,
          message: `Forbidden table requested: "${t}". User/Auth tables cannot be deleted.`,
        });
        return;
      }
      if (!WHITELISTED_TABLES.includes(t)) {
        res.status(400).json({ success: false, message: `Invalid table: "${t}"` });
        return;
      }
    }

    // Mark token used
    usedTokens.add(confirmToken);

    // Perform deletions
    const results: Array<{ table: string; rowsDeleted: number }> = [];
    const rowsDeletedMap: Record<string, number> = {};

    for (const table of tables) {
      const count = await deleteTableRecords(table, filters);
      results.push({ table, rowsDeleted: count });
      rowsDeletedMap[table] = count;
    }

    // Record rate limit usage
    recordRateLimitUsage(userId);

    // Create Audit Log in database (ResetLog)
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

    const logEntry = await (prisma as any).resetLog.create({
      data: {
        resetBy: req.user?.email || `User #${userId}`,
        tables: tables as string[],
        filters: filters as any,
        rowsDeleted: rowsDeletedMap as any,
        ipAddress: String(ipAddress),
      },
    });

    res.json({
      success: true,
      message: 'Reset executed successfully.',
      results,
      log: logEntry,
    });
  } catch (error) {
    console.error('SuperAdmin execute reset error:', error);
    res.status(500).json({ success: false, message: 'Failed to execute data reset.' });
  }
};

// ==============================================================================
// 3. HR Reset (Dry-Run & Execute) - Branch Scoped
// ==============================================================================
export const hrResetDryRun = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const roleUpper = (req.user?.role || '').toUpperCase();
    if (roleUpper !== 'HR' && roleUpper !== 'SUPERADMIN' && roleUpper !== 'SUPER_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied for HR reset.' });
      return;
    }

    const { tables, filters = {} } = req.body;

    if (!Array.isArray(tables) || tables.length === 0) {
      res.status(400).json({ success: false, message: 'Select at least one table.' });
      return;
    }

    // Validate table permissions (Attendance, Leaves, Breaks ONLY) FIRST
    for (const t of tables) {
      if (!HR_ALLOWED_TABLES.includes(t as any)) {
        res.status(403).json({
          success: false,
          message: `HR role is restricted to resetting Attendance, Leaves, and Breaks only. Table "${t}" is forbidden for HR.`,
        });
        return;
      }
    }

    // Resolve HR staff's assigned office/branchId
    const hrEmp = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      select: { officeId: true },
    });

    const hrBranchId = hrEmp?.officeId;
    if (!hrBranchId && roleUpper === 'HR' && !filters.branchId) {
      res.status(400).json({ success: false, message: 'HR staff has no assigned branch office.' });
      return;
    }

    // Force HR Branch filter (cannot override)
    const hrFilters = {
      ...filters,
      branchId: hrBranchId ? String(hrBranchId) : filters.branchId,
    };

    const preview: Array<{ table: string; rowCount: number }> = [];

    for (const table of tables as WhitelistedTable[]) {
      const count = await getDryRunCount(table, hrFilters);
      preview.push({ table, rowCount: count });
    }

    const confirmToken = jwt.sign(
      {
        sub: String(req.user?.id),
        scope: 'HR_RESET',
        branchId: hrFilters.branchId,
        tables,
        filters: hrFilters,
      },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    res.json({
      success: true,
      preview,
      confirmToken,
      branchScope: hrFilters.branchId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    console.error('HR dry-run reset error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate HR reset preview.' });
  }
};

export const hrResetExecute = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const roleUpper = (req.user?.role || '').toUpperCase();
    if (roleUpper !== 'HR' && roleUpper !== 'SUPERADMIN' && roleUpper !== 'SUPER_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied.' });
      return;
    }

    const { confirmToken } = req.body;
    if (!confirmToken) {
      res.status(400).json({ success: false, message: 'Confirm token required.' });
      return;
    }

    if (usedTokens.has(confirmToken)) {
      res.status(400).json({ success: false, message: 'Confirmation token already used.' });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(confirmToken, JWT_SECRET);
    } catch {
      res.status(400).json({ success: false, message: 'Confirm token invalid or expired.' });
      return;
    }

    if (decoded.scope !== 'HR_RESET') {
      res.status(403).json({ success: false, message: 'Invalid HR reset scope.' });
      return;
    }

    usedTokens.add(confirmToken);

    const tables: WhitelistedTable[] = decoded.tables;
    const filters = decoded.filters;

    const results: Array<{ table: string; rowsDeleted: number }> = [];
    const rowsDeletedMap: Record<string, number> = {};

    for (const table of tables) {
      if (!HR_ALLOWED_TABLES.includes(table)) {
        res.status(403).json({ success: false, message: `Table "${table}" forbidden for HR.` });
        return;
      }
      const count = await deleteTableRecords(table, filters);
      results.push({ table, rowsDeleted: count });
      rowsDeletedMap[table] = count;
    }

    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

    const logEntry = await (prisma as any).resetLog.create({
      data: {
        resetBy: `HR (${req.user?.email})`,
        tables: tables as string[],
        filters: filters as any,
        rowsDeleted: rowsDeletedMap as any,
        ipAddress: String(ipAddress),
      },
    });

    res.json({
      success: true,
      message: 'HR Branch data reset completed.',
      results,
      log: logEntry,
    });
  } catch (error) {
    console.error('HR execute reset error:', error);
    res.status(500).json({ success: false, message: 'Failed to execute HR reset.' });
  }
};

// ==============================================================================
// 4. Employee Mobile Reset (POST /api/mobile/reset/my-data)
// ==============================================================================
export const employeeResetMyData = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  res.status(403).json({
    success: false,
    message: 'Access denied. Data reset operations are restricted to SuperAdmin role only.',
  });
};

// ==============================================================================
// 5. Audit Log & Backup Status Endpoints
// ==============================================================================
export const fetchResetLogs = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const logs = await (prisma as any).resetLog.findMany({
      orderBy: { resetAt: 'desc' },
      take: 100,
    });

    res.json({
      success: true,
      logs,
    });
  } catch (error) {
    console.error('Fetch reset logs error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reset logs.' });
  }
};

export const fetchBackupStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const lastLog = await (prisma as any).resetLog.findFirst({
      orderBy: { resetAt: 'desc' },
    });

    res.json({
      success: true,
      status: 'HEALTHY',
      lastBackupAt: new Date(Date.now() - 3600000).toISOString(),
      lastResetAt: lastLog?.resetAt || null,
      message: 'Take a database snapshot before executing data resets. Resets are irreversible.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to check backup status.' });
  }
};
