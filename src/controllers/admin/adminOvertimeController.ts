/**
 * Admin Overtime Controller
 * Endpoints for HR/Admin managers to review, approve, reject, and monitor employee overtime records.
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { OvertimeService } from '../../services/overtimeService';
import { prisma } from '../../utils/db';

export class AdminOvertimeController {
  /**
   * Helper to format approver display name
   */
  private static getApproverName(req: AuthenticatedRequest): string {
    if (req.user) {
      return (req.user as any).name || (req.user as any).email || `Admin #${req.user.id}`;
    }
    return 'Admin';
  }

  /**
   * GET /api/v1/admin/overtime
   */
  public static async listOvertime(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const query = {
        startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
        endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
        departmentId: req.query.departmentId ? Number(req.query.departmentId) : undefined,
        branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      };

      const result = await OvertimeService.listAdminOvertime(query);
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('[AdminOvertimeController] listOvertime error:', error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to list overtime records',
      });
    }
  }

  /**
   * GET /api/v1/admin/overtime/stats
   */
  public static async getOvertimeStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const month = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
      const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
      const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

      const [pending, approved, rejected, totalsAgg] = await Promise.all([
        prisma.overtimeRecord.count({
          where: { overtimeDate: { startsWith: monthPrefix }, approvalStatus: 'PENDING' },
        }),
        prisma.overtimeRecord.count({
          where: { overtimeDate: { startsWith: monthPrefix }, approvalStatus: 'APPROVED' },
        }),
        prisma.overtimeRecord.count({
          where: { overtimeDate: { startsWith: monthPrefix }, approvalStatus: 'REJECTED' },
        }),
        prisma.overtimeRecord.aggregate({
          where: { overtimeDate: { startsWith: monthPrefix }, approvalStatus: 'APPROVED' },
          _sum: { totalOvertimeMinutes: true, payableAmount: true },
        }),
      ]);

      const approvedMinutes = totalsAgg._sum?.totalOvertimeMinutes || 0;
      const payableAmount = totalsAgg._sum?.payableAmount || 0;

      res.json({
        success: true,
        data: {
          month,
          year,
          pendingCount: pending,
          approvedCount: approved,
          rejectedCount: rejected,
          totalApprovedHours: Math.round((approvedMinutes / 60) * 100) / 100,
          totalPayableAmount: Math.round(payableAmount * 100) / 100,
        },
      });
    } catch (error: any) {
      console.error('[AdminOvertimeController] getOvertimeStats error:', error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to fetch overtime stats',
      });
    }
  }

  /**
   * PATCH /api/v1/admin/overtime/:id/approve
   */
  public static async approve(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ success: false, message: 'Invalid overtime ID' });
        return;
      }

      const approverName = AdminOvertimeController.getApproverName(req);
      const updated = await OvertimeService.approveOvertime(id, approverName);

      res.json({
        success: true,
        message: `Overtime record #${id} approved successfully`,
        data: updated,
      });
    } catch (error: any) {
      console.error('[AdminOvertimeController] approve error:', error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to approve overtime',
      });
    }
  }

  /**
   * PATCH /api/v1/admin/overtime/:id/reject
   */
  public static async reject(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ success: false, message: 'Invalid overtime ID' });
        return;
      }

      const reason = req.body?.reason || req.body?.remarks || 'Rejected by administrator';
      const approverName = AdminOvertimeController.getApproverName(req);
      const updated = await OvertimeService.rejectOvertime(id, approverName, reason);

      res.json({
        success: true,
        message: `Overtime record #${id} rejected`,
        data: updated,
      });
    } catch (error: any) {
      console.error('[AdminOvertimeController] reject error:', error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to reject overtime',
      });
    }
  }

  /**
   * POST /api/v1/admin/overtime/bulk-approve
   */
  public static async bulkApprove(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
      if (ids.length === 0) {
        res.status(400).json({ success: false, message: 'Please provide an array of IDs to approve' });
        return;
      }

      const approverName = AdminOvertimeController.getApproverName(req);
      const result = await OvertimeService.bulkApprove(ids, approverName);

      res.json({
        success: true,
        message: `Successfully approved ${result.updatedCount} overtime records`,
        data: result,
      });
    } catch (error: any) {
      console.error('[AdminOvertimeController] bulkApprove error:', error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to bulk approve overtime',
      });
    }
  }

  /**
   * POST /api/v1/admin/overtime/recalculate
   */
  public static async recalculate(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { attendanceId, employeeId, date } = req.body || {};

      if (attendanceId) {
        const record = await OvertimeService.syncOvertimeRecord(Number(attendanceId));
        res.json({
          success: true,
          message: 'Overtime recalculated for attendance record',
          data: record,
        });
        return;
      }

      if (employeeId && date) {
        const att = await prisma.attendance.findFirst({
          where: { employeeId: Number(employeeId), date: String(date) },
        });
        if (!att) {
          res.status(404).json({ success: false, message: 'No attendance record found for given employee and date' });
          return;
        }
        const record = await OvertimeService.syncOvertimeRecord(att.id);
        res.json({
          success: true,
          message: 'Overtime recalculated',
          data: record,
        });
        return;
      }

      res.status(400).json({
        success: false,
        message: 'Must provide either attendanceId or employeeId and date',
      });
    } catch (error: any) {
      console.error('[AdminOvertimeController] recalculate error:', error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to recalculate overtime',
      });
    }
  }
}

