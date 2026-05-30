import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

// ==========================================
// HR Dashboard Stats
// ==========================================

export const fetchHRStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const todayStr = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const [
      totalEmployees,
      activeEmployees,
      presentToday,
      pendingLeaves,
      newHires,
      openTasks,
      departments,
      totalAttendanceToday,
      totalHRAdmins,
      activeSessions,
      totalUsers,
      activeUsers
    ] = await Promise.all([
      prisma.employee.count(),
      prisma.employee.count({ where: { status: 'active' } }),
      prisma.attendance.count({ where: { date: todayStr, status: 'PRESENT' } }),
      prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
      prisma.employee.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.task.count({ where: { status: { in: ['TODO', 'IN_PROGRESS'] } } }),
      prisma.department.count(),
      prisma.attendance.count({ where: { date: todayStr } }),
      prisma.user.count({ where: { role: { in: ['HR', 'PLATFORM_ADMIN', 'ADMIN'] } } }),
      prisma.attendance.count({ where: { date: todayStr } }), // dynamic sessions today
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } })
    ]);

    const attendanceRate = totalEmployees > 0
      ? Math.round((presentToday / totalEmployees) * 100)
      : 0;

    const onboardingRate = totalUsers > 0 
      ? ((activeUsers / totalUsers) * 100).toFixed(1) + '%' 
      : '100%';

    // Compute last 5 months hiring growth dynamically
    const hiringGrowth = [];
    const now = new Date();
    for (let i = 4; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const monthName = d.toLocaleDateString('en-US', { month: 'short' });

      const hiresCount = await prisma.employee.count({
        where: {
          createdAt: {
            gte: startOfMonth,
            lt: endOfMonth,
          },
        },
      });
      hiringGrowth.push({ name: monthName, hires: hiresCount || 0 });
    }

    // Compute HR distribution dynamically
    const activeHR = await prisma.user.count({
      where: { role: { in: ['HR', 'PLATFORM_ADMIN'] }, isActive: true }
    });
    const inactiveHR = await prisma.user.count({
      where: { role: { in: ['HR', 'PLATFORM_ADMIN'] }, isActive: false }
    });
    const totalHR = activeHR + inactiveHR;

    const hrDistribution = [
      { name: 'Active', value: totalHR > 0 ? Math.round((activeHR / totalHR) * 100) : 100, color: '#3BA38B' },
      { name: 'Inactive', value: totalHR > 0 ? Math.round((inactiveHR / totalHR) * 100) : 0, color: '#64748B' },
      { name: 'Pending', value: 0, color: '#F4B860' }
    ];

    res.json({
      success: true,
      data: {
        totalEmployees,
        activeEmployees,
        presentToday,
        pendingLeaves,
        newHires,
        openTasks,
        departments,
        attendanceRate,
        totalAttendanceToday,
        totalHRAdmins,
        activeSessions: activeSessions || 1, // default positive fallback
        onboardingRate,
        hiringGrowth,
        hrDistribution
      },
    });
  } catch (error) {
    console.error('Fetch HR stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to load HR stats.' });
  }
};

// ==========================================
// HR Department Overview
// ==========================================

export const fetchDepartmentOverview = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const departments = await prisma.department.findMany({
      include: {
        _count: { select: { employees: true } },
        employees: {
          select: { status: true },
        },
      },
    });

    const totalEmployees = await prisma.employee.count();

    const mapped = departments.map((dept) => {
      const active = dept.employees.filter((e) => e.status === 'active').length;
      const count = dept._count.employees;
      return {
        id: dept.id,
        name: dept.name,
        code: dept.code,
        count,
        active,
        inactive: count - active,
        percentage: totalEmployees > 0 ? Math.round((count / totalEmployees) * 100) : 0,
      };
    });

    // Employees without a department
    const unassigned = await prisma.employee.count({ where: { departmentId: null } });

    res.json({
      success: true,
      departments: mapped,
      unassigned,
      totalEmployees,
    });
  } catch (error) {
    console.error('Fetch department overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to load department data.' });
  }
};

// ==========================================
// HR Leave Overview
// ==========================================

export const fetchLeaveOverview = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const [pending, approved, rejected, total] = await Promise.all([
      prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
      prisma.leaveRequest.count({ where: { status: 'APPROVED' } }),
      prisma.leaveRequest.count({ where: { status: 'REJECTED' } }),
      prisma.leaveRequest.count(),
    ]);

    // Type breakdown
    const leaveTypes = await prisma.leaveRequest.groupBy({
      by: ['type'],
      _count: { type: true },
      orderBy: { _count: { type: 'desc' } },
    });

    // Recent leave requests
    const recent = await prisma.leaveRequest.findMany({
      take: 8,
      orderBy: { appliedOn: 'desc' },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            designation: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    const mappedRecent = recent.map((lr) => ({
      id: lr.id,
      employeeName: `${lr.employee.firstName} ${lr.employee.lastName}`,
      designation: lr.employee.designation || 'Employee',
      department: lr.employee.department?.name || 'General',
      type: lr.type,
      fromDate: lr.fromDate.toISOString(),
      toDate: lr.toDate.toISOString(),
      reason: lr.reason,
      status: lr.status,
      appliedOn: lr.appliedOn.toISOString(),
    }));

    res.json({
      success: true,
      data: {
        pending,
        approved,
        rejected,
        total,
        leaveTypes: leaveTypes.map((lt) => ({ type: lt.type, count: lt._count.type })),
        recent: mappedRecent,
      },
    });
  } catch (error) {
    console.error('Fetch leave overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to load leave data.' });
  }
};

// ==========================================
// HR Employee List (paginated)
// ==========================================

export const fetchHREmployees = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const {
    search = '',
    status = '',
    department = '',
    page = '1',
    limit = '10',
  } = req.query;

  const pageInt = parseInt(page as string, 10);
  const limitInt = parseInt(limit as string, 10);
  const skip = (pageInt - 1) * limitInt;

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { firstName: { contains: search as string, mode: 'insensitive' } },
      { lastName: { contains: search as string, mode: 'insensitive' } },
      { employeeCode: { contains: search as string, mode: 'insensitive' } },
      { designation: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  if (status) {
    where.status = status as string;
  }

  if (department) {
    where.department = { name: { contains: department as string, mode: 'insensitive' } };
  }

  try {
    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip,
        take: limitInt,
        orderBy: { createdAt: 'desc' },
        include: {
          department: { select: { name: true } },
          office: { select: { name: true } },
          user: { select: { email: true, isActive: true } },
          _count: {
            select: {
              leaveRequests: true,
              assignedTasks: true,
              attendances: true,
            },
          },
        },
      }),
      prisma.employee.count({ where }),
    ]);

    const mapped = employees.map((emp) => ({
      id: emp.id,
      employeeCode: emp.employeeCode,
      firstName: emp.firstName,
      lastName: emp.lastName,
      fullName: `${emp.firstName} ${emp.lastName}`,
      designation: emp.designation || 'Employee',
      status: emp.status,
      department: emp.department?.name || 'Unassigned',
      office: emp.office?.name || 'Remote',
      email: emp.user?.email || null,
      isActive: emp.user?.isActive ?? true,
      leaveCount: emp._count.leaveRequests,
      taskCount: emp._count.assignedTasks,
      attendanceCount: emp._count.attendances,
      joinedAt: emp.createdAt.toISOString(),
    }));

    res.json({
      success: true,
      employees: mapped,
      total,
      page: pageInt,
      limit: limitInt,
      totalPages: Math.ceil(total / limitInt),
    });
  } catch (error) {
    console.error('Fetch HR employees error:', error);
    res.status(500).json({ success: false, message: 'Failed to load employee list.' });
  }
};

// ==========================================
// HR Attendance Trend (last 7 days)
// ==========================================

export const fetchAttendanceTrend = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const days = 7;
    const results = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });

      const [present, absent, late, onLeave] = await Promise.all([
        prisma.attendance.count({ where: { date: dateStr, status: 'PRESENT' } }),
        prisma.attendance.count({ where: { date: dateStr, status: 'ABSENT' } }),
        prisma.attendance.count({ where: { date: dateStr, status: 'LATE' } }),
        prisma.attendance.count({ where: { date: dateStr, status: 'LEAVE' } }),
      ]);

      results.push({ date: dateStr, day: dayName, present, absent, late, onLeave });
    }

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Fetch attendance trend error:', error);
    res.status(500).json({ success: false, message: 'Failed to load attendance trend.' });
  }
};

// ==========================================
// HR Recent Activity (tasks + leaves)
// ==========================================

export const fetchHRActivity = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const [recentTasks, recentLeaves] = await Promise.all([
      prisma.task.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { firstName: true, lastName: true, designation: true } },
        },
      }),
      prisma.leaveRequest.findMany({
        take: 5,
        where: { status: 'PENDING' },
        orderBy: { appliedOn: 'desc' },
        include: {
          employee: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    const activity = [
      ...recentTasks.map((t) => ({
        id: `task-${t.id}`,
        type: 'task' as const,
        title: t.title,
        description: `Assigned to ${t.assignedTo.firstName} ${t.assignedTo.lastName}`,
        status: t.status,
        priority: t.priority,
        date: t.createdAt.toISOString(),
      })),
      ...recentLeaves.map((l) => ({
        id: `leave-${l.id}`,
        type: 'leave' as const,
        title: `${l.type} Leave Request`,
        description: `${l.employee.firstName} ${l.employee.lastName} — ${l.reason}`,
        status: l.status,
        priority: null,
        date: l.appliedOn.toISOString(),
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 8);

    res.json({ success: true, activity });
  } catch (error) {
    console.error('Fetch HR activity error:', error);
    res.status(500).json({ success: false, message: 'Failed to load HR activity.' });
  }
};
