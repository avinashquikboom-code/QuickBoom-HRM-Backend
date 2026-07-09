import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { Role } from '@prisma/client';

// Get commission dashboard stats for logged-in user
export const getMobileCommissionDashboard = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Only Salesman can access commission
    if (req.user?.role !== Role.SALESMAN) {
      res.status(403).json({
        success: false,
        message: 'Commission data is only available for Salesman role.'
      });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { store: true }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayTransactions = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employee.id,
        createdAt: { gte: today, lte: todayEnd },
      },
    });

    const todayCommission = todayTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const todaySales = todayTransactions.reduce((sum, t) => sum + t.saleAmount, 0);

    // Get month's stats
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthTransactions = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employee.id,
        createdAt: { gte: monthStart },
      },
    });

    const monthCommission = monthTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const monthSales = monthTransactions.reduce((sum, t) => sum + t.saleAmount, 0);

    // Get pending stats
    const pendingTransactions = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employee.id,
        status: 'PENDING',
      },
    });

    const pendingCommission = pendingTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);

    // Get paid stats
    const paidTransactions = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: employee.id,
        status: 'PAID',
      },
    });

    const paidCommission = paidTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);

    // Get targets
    const targets = await prisma.commissionTarget.findMany({
      where: {
        employeeId: employee.id,
        status: 'ACTIVE',
      },
      orderBy: { startDate: 'desc' },
      take: 5,
    });

    res.json({
      success: true,
      data: {
        today: {
          commission: todayCommission,
          sales: todaySales,
        },
        month: {
          commission: monthCommission,
          sales: monthSales,
        },
        pending: {
          commission: pendingCommission,
          count: pendingTransactions.length,
        },
        paid: {
          commission: paidCommission,
          count: paidTransactions.length,
        },
        targets: targets.map(t => ({
          id: t.id,
          targetType: t.targetType,
          targetAmount: t.targetAmount,
          achievedAmount: t.achievedAmount,
          progressPercent: t.progressPercent,
          startDate: t.startDate,
          endDate: t.endDate,
          status: t.status,
          bonusAmount: t.bonusAmount,
        })),
      }
    });
  } catch (error) {
    console.error('Get mobile commission dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve commission dashboard.'
    });
  }
};

// Get commission transactions for logged-in user
export const getMobileCommissionTransactions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Only Salesman can access commission
    if (req.user?.role !== Role.SALESMAN) {
      res.status(403).json({
        success: false,
        message: 'Commission data is only available for Salesman role.'
      });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const { status, limit = 50, offset = 0 } = req.query;
    const whereClause: any = { employeeId: employee.id };
    if (status) whereClause.status = status;

    const transactions = await prisma.commissionTransaction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
    });

    const total = await prisma.commissionTransaction.count({
      where: whereClause,
    });

    res.json({
      success: true,
      data: {
        transactions: transactions.map(t => ({
          id: t.id,
          billId: t.billId,
          invoiceNumber: t.invoiceNumber,
          saleAmount: t.saleAmount,
          commissionType: t.commissionType,
          commissionPercent: t.commissionPercent,
          commissionAmount: t.commissionAmount,
          status: t.status,
          createdAt: t.createdAt,
          approvedAt: t.approvedAt,
          paidAt: t.paidAt,
          notes: t.notes,
        })),
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      }
    });
  } catch (error) {
    console.error('Get mobile commission transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve commission transactions.'
    });
  }
};

// Get commission targets for logged-in user
export const getMobileCommissionTargets = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const { status } = req.query;
    const whereClause: any = { employeeId: employee.id };
    if (status) whereClause.status = status;

    const targets = await prisma.commissionTarget.findMany({
      where: whereClause,
      orderBy: { startDate: 'desc' },
    });

    res.json({
      success: true,
      data: targets.map(t => ({
        id: t.id,
        targetType: t.targetType,
        targetAmount: t.targetAmount,
        achievedAmount: t.achievedAmount,
        progressPercent: t.progressPercent,
        startDate: t.startDate,
        endDate: t.endDate,
        status: t.status,
        bonusAmount: t.bonusAmount,
        bonusPaid: t.bonusPaid,
      }))
    });
  } catch (error) {
    console.error('Get mobile commission targets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve commission targets.'
    });
  }
};

// Get commission settlements for logged-in user
export const getMobileCommissionSettlements = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Only Salesman can access commission
    if (req.user?.role !== Role.SALESMAN) {
      res.status(403).json({
        success: false,
        message: 'Commission data is only available for Salesman role.'
      });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const { status } = req.query;
    const whereClause: any = { employeeId: employee.id };
    if (status) whereClause.status = status;

    const settlements = await prisma.commissionSettlement.findMany({
      where: whereClause,
      orderBy: { settlementDate: 'desc' },
    });

    res.json({
      success: true,
      data: settlements.map(s => ({
        id: s.id,
        settlementDate: s.settlementDate,
        totalCommission: s.totalCommission,
        totalBonus: s.totalBonus,
        totalDeduction: s.totalDeduction,
        netAmount: s.netAmount,
        status: s.status,
        payrollId: s.payrollId,
        processedAt: s.processedAt,
        notes: s.notes,
      }))
    });
  } catch (error) {
    console.error('Get mobile commission settlements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve commission settlements.'
    });
  }
};
