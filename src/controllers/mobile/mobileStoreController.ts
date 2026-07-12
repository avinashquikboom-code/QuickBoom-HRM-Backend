import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { Role } from '@prisma/client';

// Get store details for logged-in Store Manager
export const getMobileStoreDetails = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (req.user?.role !== Role.STORE_MANAGER) {
      res.status(403).json({
        success: false,
        message: 'Only Store Managers can access store details.'
      });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        store: {
          include: {
            branch: true
          }
        }
      }
    });

    if (!employee || !employee.storeId) {
      res.status(404).json({
        success: false,
        message: 'Store not found for this employee.'
      });
      return;
    }

    // Get store employees count
    const employeeCount = await prisma.employee.count({
      where: { storeId: employee.storeId, status: 'active' }
    });

    // Get today's attendance count
    const today = new Date().toISOString().split('T')[0];
    const todayAttendance = await prisma.attendance.count({
      where: {
        date: today,
        employee: { storeId: employee.storeId }
      }
    });

    res.json({
      success: true,
      data: {
        id: employee.store!.id,
        name: employee.store!.name,
        code: employee.store!.code,
        address: employee.store!.address,
        country: employee.store!.country,
        pincode: employee.store!.pincode,
        isActive: employee.store!.isActive,
        branch: employee.store!.branch ? {
          id: employee.store!.branch.id,
          name: employee.store!.branch.name,
          code: employee.store!.branch.code,
          address: employee.store!.branch.address,
          city: employee.store!.branch.city,
          state: employee.store!.branch.state,
        } : null,
        stats: {
          totalEmployees: employeeCount,
          todayPresent: todayAttendance,
        }
      }
    });
  } catch (error) {
    console.error('Get mobile store details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve store details.'
    });
  }
};

// Get employees of assigned store (Store Manager only)
export const getMobileStoreEmployees = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (req.user?.role !== Role.STORE_MANAGER) {
      res.status(403).json({
        success: false,
        message: 'Only Store Managers can view store employees.'
      });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee || !employee.storeId) {
      res.status(404).json({
        success: false,
        message: 'Store not found for this employee.'
      });
      return;
    }

    const { status } = req.query;
    const whereClause: any = { storeId: employee.storeId };
    if (status) whereClause.status = status;

    const employees = await prisma.employee.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            email: true,
            profile: {
              select: {
                fullName: true,
                phone: true,
                avatarUrl: true,
              }
            }
          }
        },
        department: {
          select: {
            id: true,
            name: true,
            code: true,
          }
        },
        designationRelation: {
          select: {
            id: true,
            name: true,
          }
        }
      },
      orderBy: { firstName: 'asc' },
    });

    res.json({
      success: true,
      data: employees.map(e => ({
        id: e.id,
        employeeCode: e.employeeCode,
        firstName: e.firstName,
        lastName: e.lastName,
        designation: e.designation,
        status: e.status,
        mobileNumber: e.mobileNumber,
        joiningDate: e.joiningDate,
        email: e.user?.email,
        fullName: e.user?.profile?.fullName || `${e.firstName} ${e.lastName}`,
        phone: e.user?.profile?.phone,
        avatarUrl: e.user?.profile?.avatarUrl,
        department: e.department,
        designationRelation: e.designationRelation,
      }))
    });
  } catch (error) {
    console.error('Get mobile store employees error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve store employees.'
    });
  }
};

// Get store reports (Store Manager only)
export const getMobileStoreReports = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (req.user?.role !== Role.STORE_MANAGER) {
      res.status(403).json({
        success: false,
        message: 'Only Store Managers can access store reports.'
      });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee || !employee.storeId) {
      res.status(404).json({
        success: false,
        message: 'Store not found for this employee.'
      });
      return;
    }

    const { startDate, endDate } = req.query;
    const today = new Date();
    const start = startDate ? new Date(startDate as string) : new Date(today.getFullYear(), today.getMonth(), 1);
    const end = endDate ? new Date(endDate as string) : today;

    // Get attendance summary
    const attendances = await prisma.attendance.findMany({
      where: {
        date: { gte: start.toISOString().split('T')[0], lte: end.toISOString().split('T')[0] },
        employee: { storeId: employee.storeId }
      },
      include: {
        employee: true
      }
    });

    const presentCount = attendances.filter(a => a.status === 'PRESENT').length;
    const absentCount = attendances.filter(a => a.status === 'ABSENT').length;
    const lateCount = attendances.filter(a => a.status === 'LATE').length;

    // Get leave summary
    const leaveRequests = await prisma.leaveRequest.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        employee: { storeId: employee.storeId }
      }
    });

    const pendingLeaves = leaveRequests.filter(l => l.status === 'PENDING').length;
    const approvedLeaves = leaveRequests.filter(l => l.status === 'APPROVED').length;
    const rejectedLeaves = leaveRequests.filter(l => l.status === 'REJECTED').length;

    // Get commission summary
    const commissionTransactions = await prisma.commissionTransaction.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        employee: { storeId: employee.storeId }
      }
    });

    const totalCommission = commissionTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);
    const totalSales = commissionTransactions.reduce((sum, t) => sum + t.saleAmount, 0);
    const pendingCommission = commissionTransactions
      .filter(t => t.status === 'PENDING')
      .reduce((sum, t) => sum + t.commissionAmount, 0);

    res.json({
      success: true,
      data: {
        period: {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0],
        },
        attendance: {
          total: attendances.length,
          present: presentCount,
          absent: absentCount,
          late: lateCount,
          presentRate: attendances.length > 0 ? ((presentCount / attendances.length) * 100).toFixed(2) : '0',
        },
        leaves: {
          total: leaveRequests.length,
          pending: pendingLeaves,
          approved: approvedLeaves,
          rejected: rejectedLeaves,
        },
        commission: {
          totalCommission,
          totalSales,
          pendingCommission,
          transactionCount: commissionTransactions.length,
        }
      }
    });
  } catch (error) {
    console.error('Get mobile store reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve store reports.'
    });
  }
};
