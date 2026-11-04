/**
 * Mobile Overtime Controller (Employee Side)
 * Endpoints for employees to track their daily and monthly overtime.
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { OvertimeService } from '../../services/overtimeService';
import { prisma } from '../../utils/db';

export class MobileOvertimeController {
  /**
   * Helper to resolve the authenticated employee record.
   */
  private static async getEmployee(req: AuthenticatedRequest) {
    const user = req.user;
    if (!user) return null;
    return prisma.employee.findFirst({
      where: { userId: user.id },
    });
  }

  /**
   * GET /api/mobile/overtime/today
   */
  public static async getTodayOvertime(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const employee = await MobileOvertimeController.getEmployee(req);
      if (!employee) {
        res.status(404).json({ success: false, message: 'Employee profile not found' });
        return;
      }

      const dateQuery = typeof req.query.date === 'string' ? req.query.date : undefined;
      const data = await OvertimeService.getTodayOvertime(employee.id, dateQuery);

      res.json({
        success: true,
        data,
      });
    } catch (error: any) {
      console.error('[MobileOvertimeController] getTodayOvertime error:', error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to fetch today overtime',
      });
    }
  }

  /**
   * GET /api/mobile/overtime/summary
   */
  public static async getMonthlySummary(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const employee = await MobileOvertimeController.getEmployee(req);
      if (!employee) {
        res.status(404).json({ success: false, message: 'Employee profile not found' });
        return;
      }

      const now = new Date();
      const month = Number(req.query.month) || now.getMonth() + 1;
      const year = Number(req.query.year) || now.getFullYear();

      const summary = await OvertimeService.getMonthlySummary(employee.id, month, year);

      res.json({
        success: true,
        data: summary,
      });
    } catch (error: any) {
      console.error('[MobileOvertimeController] getMonthlySummary error:', error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to fetch monthly overtime summary',
      });
    }
  }

  /**
   * GET /api/mobile/overtime/history
   */
  public static async getHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const employee = await MobileOvertimeController.getEmployee(req);
      if (!employee) {
        res.status(404).json({ success: false, message: 'Employee profile not found' });
        return;
      }

      const month = req.query.month ? Number(req.query.month) : undefined;
      const year = req.query.year ? Number(req.query.year) : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 30;

      const result = await OvertimeService.getEmployeeHistory(employee.id, {
        month,
        year,
        status,
        page,
        limit,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('[MobileOvertimeController] getHistory error:', error);
      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to fetch overtime history',
      });
    }
  }
}

