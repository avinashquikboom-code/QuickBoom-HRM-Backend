import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { Role } from '@prisma/client';

// GET /api/mobile/store/all — returns all active stores (for salesman transaction form dropdown)
export const getAllMobileStores = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      data: stores,
    });
  } catch (error) {
    console.error('Get all mobile stores error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stores.',
    });
  }
};

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
        store: true
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
        branch: {
          id: employee.store!.id,
          name: employee.store!.name,
          code: employee.store!.code || '',
          address: employee.store!.address || '',
          city: '',
          state: '',
        },
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
      where: { userId: req.user?.id },
      include: {
        store: true
      }
    });

    if (!employee || !employee.storeId) {
      res.status(404).json({
        success: false,
        message: 'Store not found for this employee.'
      });
      return;
    }

    const storeId = employee.storeId;
    const storeName = employee.store!.name;

    const { status, search } = req.query;
    const whereClause: any = { storeId };
    
    if (status) {
      if (status === 'present') {
        // Filter by today's present/late attendance
        const today = new Date().toISOString().split('T')[0];
        const presentAtts = await prisma.attendance.findMany({
          where: {
            date: today,
            status: { in: ['PRESENT', 'LATE'] },
            employee: { storeId }
          },
          select: { employeeId: true }
        });
        whereClause.id = { in: presentAtts.map(a => a.employeeId) };
      } else if (status === 'absent') {
        const today = new Date().toISOString().split('T')[0];
        const presentAtts = await prisma.attendance.findMany({
          where: {
            date: today,
            status: { in: ['PRESENT', 'LATE'] },
            employee: { storeId }
          },
          select: { employeeId: true }
        });
        whereClause.id = { notIn: presentAtts.map(a => a.employeeId) };
      } else {
        whereClause.status = status;
      }
    }

    if (search) {
      whereClause.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { employeeCode: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const totalCount = await prisma.employee.count({
      where: whereClause
    });

    const employees = await prisma.employee.findMany({
      where: whereClause,
      include: {
        user: true,
        department: true,
      },
      orderBy: { firstName: 'asc' },
      skip,
      take: limit,
    });

    // Get today's attendance for these employees
    const today = new Date().toISOString().split('T')[0];
    const employeeIds = employees.map(e => e.id);
    const attendances = await prisma.attendance.findMany({
      where: {
        date: today,
        employeeId: { in: employeeIds }
      }
    });

    const attendanceMap = new Map(attendances.map(a => [a.employeeId, a]));

    const mappedEmployees = employees.map(e => {
      const att = attendanceMap.get(e.id);
      let attendanceStatus = 'not_punched';
      if (att) {
        if (att.status === 'PRESENT') attendanceStatus = 'present';
        else if (att.status === 'LATE') attendanceStatus = 'late';
        else if (att.status === 'ABSENT') attendanceStatus = 'absent';
      }
      return {
        id: e.id.toString(),
        employeeCode: e.employeeCode || '',
        name: `${e.firstName} ${e.lastName || ''}`.trim(),
        role: e.user?.role || 'EMPLOYEE',
        designation: e.designation || 'Active Employee',
        department: e.department?.name || 'Retail',
        phone: e.mobileNumber || '',
        storeId: storeId.toString(),
        storeName,
        attendanceStatus,
        checkInTime: att?.checkIn || null,
        checkOutTime: att?.checkOut || null,
        status: e.status || 'active',
      };
    });

    res.json({
      success: true,
      data: {
        employees: mappedEmployees,
        totalCount,
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit)
      }
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

export const getMobileStoreDashboard = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (req.user?.role !== Role.STORE_MANAGER) {
      res.status(403).json({
        success: false,
        message: 'Only Store Managers can access store dashboard.'
      });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        store: true
      }
    });

    if (!employee || !employee.storeId) {
      res.status(404).json({
        success: false,
        message: 'Store not found for this employee.'
      });
      return;
    }

    const storeId = employee.storeId;
    const storeName = employee.store!.name;

    // Get store employees count
    const totalEmployees = await prisma.employee.count({
      where: { storeId, status: 'active' }
    });

    // Get today's attendance count
    const today = new Date().toISOString().split('T')[0];
    const attendances = await prisma.attendance.findMany({
      where: {
        date: today,
        employee: { storeId }
      }
    });

    const presentEmployees = attendances.filter(a => a.status === 'PRESENT').length;
    const lateEmployees = attendances.filter(a => a.status === 'LATE').length;
    const presentAndLate = presentEmployees + lateEmployees;
    const absentEmployees = Math.max(0, totalEmployees - presentAndLate);

    // Get pending leaves
    const pendingLeaves = await prisma.leaveRequest.count({
      where: {
        status: 'PENDING',
        employee: { storeId }
      }
    });

    // Get pending expenses / claims
    const pendingExpenses = await prisma.expense.count({
      where: {
        status: 'PENDING',
        employee: { storeId }
      }
    });

    const storePerformance = totalEmployees > 0 
      ? Math.round((presentAndLate / totalEmployees) * 100) 
      : 100;

    // Get last 30 days sales & commission summary
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const commissionTransactions = await prisma.commissionTransaction.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        employee: { storeId }
      }
    });

    const monthlySales = commissionTransactions.reduce((sum, t) => sum + t.saleAmount, 0);
    const monthlyRevenue = commissionTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);

    // Today's transactions
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTransactions = commissionTransactions.filter(t => new Date(t.createdAt) >= todayStart);
    const todaySales = todayTransactions.reduce((sum, t) => sum + t.saleAmount, 0);
    const todayRevenue = todayTransactions.reduce((sum, t) => sum + t.commissionAmount, 0);

    res.json({
      success: true,
      data: {
        storeId: storeId.toString(),
        storeName,
        todaySales,
        todayRevenue,
        presentEmployees: presentAndLate,
        absentEmployees,
        lateEmployees,
        totalEmployees,
        pendingLeaves,
        pendingExpenses,
        storePerformance,
        monthlySales,
        monthlyRevenue,
        dailySalesSummary: [],
        attendanceSummary: []
      }
    });
  } catch (error) {
    console.error('Get mobile store dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve store dashboard.'
    });
  }
};
