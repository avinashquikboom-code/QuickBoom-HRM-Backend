import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { getWebSocketInstance } from '../../utils/websocketSingleton';
import { firebaseNotificationService } from '../../services/firebaseNotificationService';

// ==========================================
// HR Dashboard Stats
// ==========================================

export const fetchHRStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  console.log('📊 [HR STATS] Fetch request started');
  console.log('📊 [HR STATS] User:', req.user?.email, 'Role:', req.user?.role);
  
  const todayStr = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  console.log('📊 [HR STATS] Date range:', { todayStr, thirtyDaysAgo: thirtyDaysAgo.toISOString() });

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

    console.log('📊 [HR STATS] Database queries completed');
    console.log('📊 [HR STATS] Raw data:', {
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
    });

    const attendanceRate = totalEmployees > 0
      ? Math.round((presentToday / totalEmployees) * 100)
      : 0;

    const onboardingRate = totalUsers > 0
      ? ((activeUsers / totalUsers) * 100).toFixed(1) + '%'
      : '100%';

    console.log('📊 [HR STATS] Calculated rates:', { attendanceRate, onboardingRate });

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

    console.log('📊 [HR STATS] Final response data:', {
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
      activeSessions: activeSessions || 1,
      onboardingRate,
      hiringGrowth: hiringGrowth.length,
      hrDistribution
    });

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
    
    console.log('📊 [HR STATS] Response sent successfully');
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
  console.log('🏢 [DEPARTMENTS] Fetch department overview started');
  console.log('🏢 [DEPARTMENTS] User:', req.user?.email, 'Role:', req.user?.role);
  
  try {
    console.log('🏢 [DEPARTMENTS] Querying departments with employee counts...');
    const departments = await prisma.department.findMany({
      include: {
        _count: { select: { employees: true } },
        employees: {
          select: { status: true },
        },
      },
    });

    console.log('🏢 [DEPARTMENTS] Found departments:', departments.length);
    departments.forEach(dept => {
      console.log(`🏢 [DEPARTMENTS] - ${dept.name}: ${dept._count.employees} employees`);
    });

    const totalEmployees = await prisma.employee.count();
    console.log('🏢 [DEPARTMENTS] Total employees in system:', totalEmployees);

    const mapped = departments.map((dept) => {
      const active = dept.employees.filter((e) => e.status === 'active').length;
      const count = dept._count.employees;
      const result = {
        id: dept.id,
        name: dept.name,
        code: dept.code,
        count,
        active,
        inactive: count - active,
        percentage: totalEmployees > 0 ? Math.round((count / totalEmployees) * 100) : 0,
      };
      console.log(`🏢 [DEPARTMENTS] Mapped ${dept.name}:`, result);
      return result;
    });

    // Employees without a department
    const unassigned = await prisma.employee.count({ where: { departmentId: null } });
    console.log('🏢 [DEPARTMENTS] Unassigned employees:', unassigned);

    console.log('🏢 [DEPARTMENTS] Final response:', { departments: mapped.length, unassigned, totalEmployees });

    res.json({
      success: true,
      departments: mapped,
      unassigned,
      totalEmployees,
    });
    
    console.log('🏢 [DEPARTMENTS] Department overview response sent successfully');
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
  console.log('📋 [LEAVE OVERVIEW] Fetch leave overview started');
  console.log('📋 [LEAVE OVERVIEW] User:', req.user?.email, 'Role:', req.user?.role);
  
  try {
    console.log('📋 [LEAVE OVERVIEW] Querying leave statistics...');
    const [pending, approved, rejected, total] = await Promise.all([
      prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
      prisma.leaveRequest.count({ where: { status: 'APPROVED' } }),
      prisma.leaveRequest.count({ where: { status: 'REJECTED' } }),
      prisma.leaveRequest.count(),
    ]);

    console.log('📋 [LEAVE OVERVIEW] Leave statistics:', { pending, approved, rejected, total });

    // Type breakdown
    console.log('📋 [LEAVE OVERVIEW] Querying leave type breakdown...');
    const leaveTypes = await prisma.leaveRequest.groupBy({
      by: ['type'],
      _count: { type: true },
      orderBy: { _count: { type: 'desc' } },
    });

    console.log('📋 [LEAVE OVERVIEW] Leave types:', leaveTypes);

    // Recent leave requests
    console.log('📋 [LEAVE OVERVIEW] Querying recent leave requests...');
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

    console.log('📋 [LEAVE OVERVIEW] Found recent leave requests:', recent.length);

    const mappedRecent = recent.map((lr) => {
      const result = {
        id: lr.id,
        employeeName: lr.employee ? `${lr.employee.firstName} ${lr.employee.lastName}` : 'Unknown Employee',
        designation: lr.employee?.designation || 'Employee',
        department: lr.employee?.department?.name || 'General',
        type: lr.type || 'CASUAL',
        fromDate: lr.fromDate ? lr.fromDate.toISOString() : new Date().toISOString(),
        toDate: lr.toDate ? lr.toDate.toISOString() : new Date().toISOString(),
        reason: lr.reason || '',
        status: lr.status || 'PENDING',
        appliedOn: lr.appliedOn ? lr.appliedOn.toISOString() : new Date().toISOString(),
      };
      console.log(`📋 [LEAVE OVERVIEW] Mapped leave request:`, result);
      return result;
    });

    const response = {
      success: true,
      data: {
        pending,
        approved,
        rejected,
        total,
        leaveTypes: leaveTypes.map((lt) => ({ type: lt.type, count: lt._count.type })),
        recent: mappedRecent,
      },
    };

    console.log('📋 [LEAVE OVERVIEW] Final response:', {
      statistics: { pending, approved, rejected, total },
      leaveTypesCount: leaveTypes.length,
      recentRequestsCount: mappedRecent.length
    });

    res.json(response);
    console.log('📋 [LEAVE OVERVIEW] Leave overview response sent successfully');
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
  console.log('👥 [HR EMPLOYEES] Fetch employee list started');
  console.log('👥 [HR EMPLOYEES] User:', req.user?.email, 'Role:', req.user?.role);
  
  const {
    search = '',
    status = '',
    department = '',
    page = '1',
    limit = '10',
  } = req.query;

  console.log('👥 [HR EMPLOYEES] Query params:', { search, status, department, page, limit });

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
    where.departmentId = parseInt(department as string, 10);
  }

  console.log('👥 [HR EMPLOYEES] Built where clause:', where);

  try {
    console.log('👥 [HR EMPLOYEES] Querying employees with pagination...');
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

    console.log('👥 [HR EMPLOYEES] Query results:', { employeesFound: employees.length, totalEmployees: total });

    const mapped = employees.map((emp) => {
      const result = {
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
      };
      console.log(`👥 [HR EMPLOYEES] Mapped employee:`, result);
      return result;
    });

    const response = {
      success: true,
      employees: mapped,
      total,
      page: pageInt,
      limit: limitInt,
      totalPages: Math.ceil(total / limitInt),
    };

    console.log('👥 [HR EMPLOYEES] Final response:', {
      employeesCount: mapped.length,
      total,
      page: pageInt,
      totalPages: Math.ceil(total / limitInt)
    });

    res.json(response);
    console.log('👥 [HR EMPLOYEES] Employee list response sent successfully');
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
    const dates: string[] = [];
    const weekdayNames: Record<string, string> = {};
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dates.push(dateStr);
      weekdayNames[dateStr] = weekdays[d.getDay()];
    }

    const attendances = await prisma.attendance.groupBy({
      by: ['date', 'status'],
      where: {
        date: { in: dates }
      },
      _count: {
        _all: true
      }
    });

    const results = dates.map(dateStr => {
      const dateRecords = attendances.filter(a => a.date === dateStr);
      const present = dateRecords.find(a => a.status === 'PRESENT')?._count._all || 0;
      const absent = dateRecords.find(a => a.status === 'ABSENT')?._count._all || 0;
      const late = dateRecords.find(a => a.status === 'LATE')?._count._all || 0;
      const onLeave = dateRecords.find(a => a.status === 'LEAVE')?._count._all || 0;

      return {
        date: dateStr,
        day: weekdayNames[dateStr],
        present,
        absent,
        late,
        onLeave
      };
    });

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
        description: t.assignedTo ? `Assigned to ${t.assignedTo.firstName} ${t.assignedTo.lastName}` : 'Assigned to Unknown',
        status: t.status,
        priority: t.priority,
        date: t.createdAt ? t.createdAt.toISOString() : new Date().toISOString(),
      })),
      ...recentLeaves.map((l) => ({
        id: `leave-${l.id}`,
        type: 'leave' as const,
        title: `${l.type || 'CASUAL'} Leave Request`,
        description: l.employee ? `${l.employee.firstName} ${l.employee.lastName} — ${l.reason || ''}` : `Unknown — ${l.reason || ''}`,
        status: l.status,
        priority: null,
        date: l.appliedOn ? l.appliedOn.toISOString() : new Date().toISOString(),
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 8);

    res.json({ success: true, activity });
  } catch (error) {
    console.error('Fetch HR activity error:', error);
    res.status(500).json({ success: false, message: 'Failed to load HR activity.' });
  }
};

// ==========================================
// HR Expense Review
// ==========================================

export const fetchHRExpenses = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const expenses = await prisma.expense.findMany({
      orderBy: { submittedOn: 'desc' },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    const mapped = expenses.map((e) => ({
      id: e.id,
      employeeId: e.employee.employeeCode,
      employeeName: `${e.employee.firstName} ${e.employee.lastName}`,
      department: e.employee.department?.name || 'General',
      category: e.category,
      amount: e.amount,
      description: e.description,
      date: e.date.toISOString(),
      status: e.status,
      submittedOn: e.submittedOn.toISOString(),
      reviewedBy: e.reviewedBy,
      reviewNote: e.reviewNote,
      hasReceipt: e.hasReceipt,
    }));

    res.json({ success: true, expenses: mapped });
  } catch (error) {
    console.error('Fetch HR expenses error:', error);
    res.status(500).json({ success: false, message: 'Failed to load expenses.' });
  }
};

export const approveExpense = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { reviewerName, reviewNote } = req.body;

  try {
    const expense = await prisma.expense.update({
      where: { id: parseInt(id as string, 10) },
      data: {
        status: 'APPROVED',
        reviewedBy: reviewerName || req.user?.email || 'HR',
        reviewNote: reviewNote || 'Approved',
      },
    });

    res.json({ success: true, message: 'Expense approved.', expense });
  } catch (error) {
    console.error('Approve expense error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve expense.' });
  }
};

export const rejectExpense = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { reviewerName, reviewNote } = req.body;

  try {
    const expense = await prisma.expense.update({
      where: { id: parseInt(id as string, 10) },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerName || req.user?.email || 'HR',
        reviewNote: reviewNote || 'Rejected',
      },
    });

    res.json({ success: true, message: 'Expense rejected.', expense });
  } catch (error) {
    console.error('Reject expense error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject expense.' });
  }
};

// ==========================================
// HR Leave Review
// ==========================================

export const approveLeave = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { reviewerName, reviewNote } = req.body;

  try {
    // Get leave request details before updating
    const existingLeave = await prisma.leaveRequest.findUnique({
      where: { id: parseInt(id as string, 10) },
      include: {
        employee: {
          include: {
            user: true
          }
        }
      }
    });

    if (!existingLeave) {
      res.status(404).json({ success: false, message: 'Leave request not found.' });
      return;
    }

    // Update leave request status
    const leave = await prisma.leaveRequest.update({
      where: { id: parseInt(id as string, 10) },
      data: {
        status: 'APPROVED',
        reviewedBy: reviewerName || req.user?.email || 'HR',
        reviewNote: reviewNote || 'Approved',
        reviewedAt: new Date(),
      },
      include: {
        employee: {
          include: {
            user: true
          }
        }
      }
    });

    // Send notification to employee
    await prisma.notification.create({
      data: {
        employeeId: leave.employee.id,
        userId: leave.employee.userId,
        title: 'Leave Request Approved',
        body: `Your ${leave.type.toLowerCase()} leave request from ${leave.fromDate.toDateString()} to ${leave.toDate.toDateString()} has been approved by ${reviewerName || 'HR'}.`,
        category: 'LEAVE',
        actionId: leave.id.toString(),
        actionType: 'LEAVE_APPROVED',
        isRead: false,
      },
    });

    console.log(`✅ Leave request ${leave.id} approved and notification sent to employee ${leave.employee.firstName} ${leave.employee.lastName}`);
    
    // Send push notification to employee
    try {
      await firebaseNotificationService.sendNotificationToUser(
        leave.employee.userId!,
        'Leave Request Approved ✅',
        `Your ${leave.type.toLowerCase()} leave request from ${leave.fromDate.toDateString()} to ${leave.toDate.toDateString()} has been approved by ${reviewerName || 'HR'}.`,
        {
          type: 'leave_approved',
          leaveId: leave.id.toString(),
          leaveType: leave.type,
          fromDate: leave.fromDate.toISOString().split('T')[0],
          toDate: leave.toDate.toISOString().split('T')[0],
          reviewedBy: reviewerName || req.user?.email || 'HR',
          actionType: 'LEAVE_APPROVED',
        },
        { priority: { high: true } }
      );
      
      console.log(`📱 Push notification sent for approved leave ${leave.id}`);
    } catch (notificationError) {
      console.error('❌ Failed to send push notification:', notificationError);
    }
    
    // Broadcast real-time leave update to employee
    try {
      await getWebSocketInstance().broadcastLeaveUpdate(leave.employee.id, {
        type: 'leave_approved',
        leaveRequest: {
          id: leave.id.toString(),
          type: leave.type,
          typeLabel: leave.type === 'CASUAL' ? 'Casual Leave' : leave.type === 'SICK' ? 'Sick Leave' : 'Earned Leave',
          fromDate: leave.fromDate.toISOString().split('T')[0],
          toDate: leave.toDate.toISOString().split('T')[0],
          status: 'APPROVED',
          reviewedBy: reviewerName || req.user?.email || 'HR',
          reviewNote: reviewNote || 'Approved',
          days: Math.ceil((leave.toDate.getTime() - leave.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
        },
        timestamp: new Date().toISOString()
      });
      
      // Also broadcast to all HR users that this leave has been processed
      await getWebSocketInstance().broadcastToRole('HR', {
        type: 'leave_request_processed',
        leaveRequest: {
          id: leave.id.toString(),
          employee: {
            id: leave.employee.id.toString(),
            name: `${leave.employee.firstName} ${leave.employee.lastName}`,
            employeeCode: leave.employee.employeeCode,
          },
          type: leave.type,
          status: 'APPROVED',
          reviewedBy: reviewerName || req.user?.email || 'HR',
          processedAt: new Date().toISOString()
        }
      });
      
      console.log(`✅ Real-time notifications sent for approved leave ${leave.id}`);
    } catch (wsError) {
      console.error('❌ Failed to broadcast leave update:', wsError);
    }

    res.json({ success: true, message: 'Leave approved.', leave });
  } catch (error) {
    console.error('Approve leave error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve leave.' });
  }
};

export const rejectLeave = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { reviewerName, reviewNote } = req.body;

  try {
    // Get leave request details before updating
    const existingLeave = await prisma.leaveRequest.findUnique({
      where: { id: parseInt(id as string, 10) },
      include: {
        employee: {
          include: {
            user: true
          }
        }
      }
    });

    if (!existingLeave) {
      res.status(404).json({ success: false, message: 'Leave request not found.' });
      return;
    }

    // Update leave request status
    const leave = await prisma.leaveRequest.update({
      where: { id: parseInt(id as string, 10) },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerName || req.user?.email || 'HR',
        reviewNote: reviewNote || 'Rejected',
        reviewedAt: new Date(),
      },
      include: {
        employee: {
          include: {
            user: true
          }
        }
      }
    });

    // Send notification to employee
    await prisma.notification.create({
      data: {
        employeeId: leave.employee.id,
        userId: leave.employee.userId,
        title: 'Leave Request Rejected',
        body: `Your ${leave.type.toLowerCase()} leave request from ${leave.fromDate.toDateString()} to ${leave.toDate.toDateString()} has been rejected by ${reviewerName || 'HR'}. ${reviewNote ? `Reason: ${reviewNote}` : ''}`,
        category: 'LEAVE',
        actionId: leave.id.toString(),
        actionType: 'LEAVE_REJECTED',
        isRead: false,
      },
    });

    console.log(`❌ Leave request ${leave.id} rejected and notification sent to employee ${leave.employee.firstName} ${leave.employee.lastName}`);
    
    // Send push notification to employee
    try {
      await firebaseNotificationService.sendNotificationToUser(
        leave.employee.userId!,
        'Leave Request Rejected ❌',
        `Your ${leave.type.toLowerCase()} leave request from ${leave.fromDate.toDateString()} to ${leave.toDate.toDateString()} has been rejected by ${reviewerName || 'HR'}. ${reviewNote ? `Reason: ${reviewNote}` : ''}`,
        {
          type: 'leave_rejected',
          leaveId: leave.id.toString(),
          leaveType: leave.type,
          fromDate: leave.fromDate.toISOString().split('T')[0],
          toDate: leave.toDate.toISOString().split('T')[0],
          reviewedBy: reviewerName || req.user?.email || 'HR',
          reviewNote: reviewNote || '',
          actionType: 'LEAVE_REJECTED',
        },
        { priority: { high: true } }
      );
      
      console.log(`📱 Push notification sent for rejected leave ${leave.id}`);
    } catch (notificationError) {
      console.error('❌ Failed to send push notification:', notificationError);
    }
    
    // Broadcast real-time leave update to employee
    try {
      await getWebSocketInstance().broadcastLeaveUpdate(leave.employee.id, {
        type: 'leave_rejected',
        leaveRequest: {
          id: leave.id.toString(),
          type: leave.type,
          typeLabel: leave.type === 'CASUAL' ? 'Casual Leave' : leave.type === 'SICK' ? 'Sick Leave' : 'Earned Leave',
          fromDate: leave.fromDate.toISOString().split('T')[0],
          toDate: leave.toDate.toISOString().split('T')[0],
          status: 'REJECTED',
          reviewedBy: reviewerName || req.user?.email || 'HR',
          reviewNote: reviewNote || 'Rejected',
          days: Math.ceil((leave.toDate.getTime() - leave.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
        },
        timestamp: new Date().toISOString()
      });
      
      // Also broadcast to all HR users that this leave has been processed
      await getWebSocketInstance().broadcastToRole('HR', {
        type: 'leave_request_processed',
        leaveRequest: {
          id: leave.id.toString(),
          employee: {
            id: leave.employee.id.toString(),
            name: `${leave.employee.firstName} ${leave.employee.lastName}`,
            employeeCode: leave.employee.employeeCode,
          },
          type: leave.type,
          status: 'REJECTED',
          reviewedBy: reviewerName || req.user?.email || 'HR',
          processedAt: new Date().toISOString()
        }
      });
      
      console.log(`✅ Real-time notifications sent for rejected leave ${leave.id}`);
    } catch (wsError) {
      console.error('❌ Failed to broadcast leave update:', wsError);
    }

    res.json({ success: true, message: 'Leave rejected.', leave });
  } catch (error) {
    console.error('Reject leave error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject leave.' });
  }
};

// ==========================================
// HR Task Management
// ==========================================

export const fetchHRTasks = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        assignedTo: { select: { firstName: true, lastName: true, id: true } },
        assignedBy: { select: { email: true } },
      },
    });

    const mapped = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      assignedToId: t.assignedToId.toString(),
      assignedToName: `${t.assignedTo.firstName} ${t.assignedTo.lastName}`,
      assignedById: t.assignedById.toString(),
      assignedByName: t.assignedBy.email,
      projectName: t.projectName,
      dueDate: t.dueDate.toISOString(),
      createdAt: t.createdAt.toISOString(),
      status: t.status,
      priority: t.priority,
    }));

    res.json({ success: true, tasks: mapped });
  } catch (error) {
    console.error('Fetch HR tasks error:', error);
    res.status(500).json({ success: false, message: 'Failed to load tasks.' });
  }
};

export const createHRTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const {
    title,
    description,
    assignedToId,
    assignedToName,
    assignedById,
    assignedByName,
    projectName,
    dueDate,
    priority,
  } = req.body;

  if (!title || !assignedToId || !dueDate) {
    res.status(400).json({ success: false, message: 'Title, assignedToId, and dueDate are required.' });
    return;
  }

  if (!req.user || !req.user.id) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  const parsedAssignedToId = parseInt(assignedToId, 10);
  if (isNaN(parsedAssignedToId)) {
    res.status(400).json({ success: false, message: 'Invalid assignedToId.' });
    return;
  }

  // Verify the assigned employee exists
  const assignedEmployee = await prisma.employee.findUnique({
    where: { id: parsedAssignedToId },
  });

  if (!assignedEmployee) {
    res.status(404).json({ success: false, message: 'Assigned employee not found.' });
    return;
  }

  try {
    const task = await prisma.task.create({
      data: {
        title,
        description: description || '',
        assignedToId: parsedAssignedToId,
        assignedById: req.user.id,
        projectName: projectName || 'General',
        dueDate: new Date(dueDate),
        priority: (priority || 'MEDIUM').toUpperCase(),
        status: 'TODO',
      },
    });

    res.json({ success: true, message: 'Task created.', task });
  } catch (error) {
    console.error('Create HR task error:', error);
    res.status(500).json({ success: false, message: 'Failed to create task.' });
  }
};

// ==========================================
// HR Payroll Management
// ==========================================

export const fetchHRPayrollStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employeeCount = await prisma.employee.count();
    const activeEmployees = await prisma.employee.count({ where: { status: 'active' } });
    
    // Calculate total monthly payroll
    const employees = await prisma.employee.findMany({
      include: { user: { include: { profile: true } } },
    });
    
    const totalMonthlyPayroll = employees.reduce((sum, emp) => {
      const salary = emp.user?.profile?.clearanceLevel ?? 65000;
      return sum + salary;
    }, 0);

    const averageSalary = employeeCount > 0 ? totalMonthlyPayroll / employeeCount : 0;

    res.json({
      success: true,
      data: {
        totalEmployees: employeeCount,
        activeEmployees,
        totalMonthlyPayroll,
        averageSalary,
        currency: 'INR',
      },
    });
  } catch (error) {
    console.error('Fetch HR payroll stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve payroll stats.' });
  }
};

export const fetchHRPayrollRuns = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const offices = await prisma.office.findMany({
      include: {
        _count: { select: { employees: true } },
      },
    });

    const payrollRuns = offices.map((office) => ({
      id: office.id,
      officeName: office.name,
      employeeCount: office._count.employees,
      lastRunDate: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString(),
      status: 'completed',
      totalAmount: office._count.employees * 65000,
    }));

    res.json({
      success: true,
      payrollRuns,
    });
  } catch (error) {
    console.error('Fetch HR payroll runs error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve payroll runs.' });
  }
};

// ==========================================
// HR Attendance Correction Management
// ==========================================

export const fetchAttendanceCorrections = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const corrections = await prisma.attendanceCorrection.findMany({
      include: {
        employee: {
          include: {
            user: { select: { email: true } }
          }
        },
        attendance: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const mapped = corrections.map((correction) => ({
      id: correction.id,
      attendanceId: correction.attendanceId,
      employeeId: correction.employeeId,
      employeeName: `${correction.employee.firstName} ${correction.employee.lastName}`,
      employeeEmail: correction.employee.user?.email || 'N/A',
      correctionType: correction.correctionType,
      requestedCheckIn: correction.requestedCheckIn?.toISOString(),
      requestedCheckOut: correction.requestedCheckOut?.toISOString(),
      originalCheckIn: correction.originalCheckIn?.toISOString(),
      originalCheckOut: correction.originalCheckOut?.toISOString(),
      attendanceDate: correction.attendance.date,
      reason: correction.reason,
      status: correction.status,
      requestedBy: correction.requestedBy,
      reviewedBy: correction.reviewedBy,
      reviewedAt: correction.reviewedAt?.toISOString(),
      approvedAt: correction.approvedAt?.toISOString(),
      createdAt: correction.createdAt.toISOString(),
      updatedAt: correction.updatedAt.toISOString()
    }));

    res.json({ success: true, corrections: mapped });
  } catch (error) {
    console.error('Fetch attendance corrections error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance corrections.' });
  }
};

export const approveAttendanceCorrection = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { reviewerName, reviewNote } = req.body;

  try {
    const correction = await prisma.attendanceCorrection.findUnique({
      where: { id: parseInt(id as string, 10) },
      include: {
        employee: { include: { user: true } },
        attendance: true
      }
    });

    if (!correction) {
      res.status(404).json({ success: false, message: 'Attendance correction request not found.' });
      return;
    }

    if (correction.status !== 'PENDING') {
      res.status(400).json({ success: false, message: 'Correction request has already been processed.' });
      return;
    }

    // Update attendance record with corrected times
    const attendanceUpdateData: any = {};
    if (correction.requestedCheckIn && (correction.correctionType === 'CHECK_IN' || correction.correctionType === 'BOTH')) {
      attendanceUpdateData.checkIn = correction.requestedCheckIn;
    }
    if (correction.requestedCheckOut && (correction.correctionType === 'CHECK_OUT' || correction.correctionType === 'BOTH')) {
      attendanceUpdateData.checkOut = correction.requestedCheckOut;
    }

    // Update attendance record
    await prisma.attendance.update({
      where: { id: correction.attendanceId },
      data: attendanceUpdateData
    });

    // Update correction request
    const updatedCorrection = await prisma.attendanceCorrection.update({
      where: { id: parseInt(id as string, 10) },
      data: {
        status: 'APPROVED',
        reviewedBy: reviewerName || req.user?.email || 'HR',
        reviewedAt: new Date(),
        approvedAt: new Date()
      }
    });

    // Send notification to employee
    await prisma.notification.create({
      data: {
        employeeId: correction.employee.id,
        userId: correction.employee.userId,
        title: 'Attendance Correction Approved',
        body: `Your attendance correction request for ${correction.attendance.date} has been approved.`,
        category: 'ATTENDANCE',
        actionId: correction.id.toString(),
        actionType: 'ATTENDANCE_CORRECTION_APPROVED'
      }
    });

    // Broadcast real-time update
    try {
      await getWebSocketInstance().broadcastNotification(correction.employee.id, {
        title: 'Attendance Correction Approved',
        body: `Your attendance correction for ${correction.attendance.date} has been approved.`,
        type: 'attendance_correction_approved',
        attendanceId: correction.attendanceId,
        status: 'APPROVED'
      });
    } catch (wsError) {
      console.error('❌ Failed to broadcast attendance correction update:', wsError);
    }

    console.log(`✅ Attendance correction ${correction.id} approved and notification sent to employee ${correction.employee.firstName} ${correction.employee.lastName}`);

    res.json({ success: true, message: 'Attendance correction approved.', correction: updatedCorrection });
  } catch (error) {
    console.error('Approve attendance correction error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve attendance correction.' });
  }
};

export const rejectAttendanceCorrection = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { reviewerName, reviewNote } = req.body;

  try {
    const correction = await prisma.attendanceCorrection.findUnique({
      where: { id: parseInt(id as string, 10) },
      include: {
        employee: { include: { user: true } },
        attendance: true
      }
    });

    if (!correction) {
      res.status(404).json({ success: false, message: 'Attendance correction request not found.' });
      return;
    }

    if (correction.status !== 'PENDING') {
      res.status(400).json({ success: false, message: 'Correction request has already been processed.' });
      return;
    }

    // Update correction request
    const updatedCorrection = await prisma.attendanceCorrection.update({
      where: { id: parseInt(id as string, 10) },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerName || req.user?.email || 'HR',
        reviewedAt: new Date()
      }
    });

    // Send notification to employee
    await prisma.notification.create({
      data: {
        employeeId: correction.employee.id,
        userId: correction.employee.userId,
        title: 'Attendance Correction Rejected',
        body: `Your attendance correction request for ${correction.attendance.date} has been rejected. ${reviewNote ? `Reason: ${reviewNote}` : ''}`,
        category: 'ATTENDANCE',
        actionId: correction.id.toString(),
        actionType: 'ATTENDANCE_CORRECTION_REJECTED'
      }
    });

    // Broadcast real-time update
    try {
      await getWebSocketInstance().broadcastNotification(correction.employee.id, {
        title: 'Attendance Correction Rejected',
        body: `Your attendance correction for ${correction.attendance.date} has been rejected.`,
        type: 'attendance_correction_rejected',
        attendanceId: correction.attendanceId,
        status: 'REJECTED'
      });
    } catch (wsError) {
      console.error('❌ Failed to broadcast attendance correction update:', wsError);
    }

    console.log(`❌ Attendance correction ${correction.id} rejected and notification sent to employee ${correction.employee.firstName} ${correction.employee.lastName}`);

    res.json({ success: true, message: 'Attendance correction rejected.', correction: updatedCorrection });
  } catch (error) {
    console.error('Reject attendance correction error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject attendance correction.' });
  }
};

// ==========================================
// HR Employee Management
// ==========================================

export const createHREmployee = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { 
    email, 
    firstName, 
    lastName, 
    designation, 
    status = 'active', 
    officeId, 
    departmentId,
    phone = '',
    aadharNumber = '',
    pfNumber = '',
    esicNumber = '',
    isHandicapped = false,
    currentAddress = '',
    permanentAddress = ''
  } = req.body;

  if (!email || !firstName) {
    res.status(400).json({ success: false, message: 'Email and first name are required.' });
    return;
  }

  try {
    // Check if user already exists
    let user = await prisma.user.findUnique({ where: { email } });
    
    if (!user) {
      // Create new user
      const defaultPassword = 'Temp123!@#'; // You might want to generate a random password
      user = await prisma.user.create({
        data: {
          email,
          password: defaultPassword, // In production, hash this password
          role: 'EMPLOYEE',
          isActive: true,
        },
      });
    }

    // Check if employee record already exists
    const existingEmployee = await prisma.employee.findUnique({
      where: { userId: user.id },
    });
    
    if (existingEmployee) {
      res.status(400).json({ success: false, message: 'Employee record already exists for this user.' });
      return;
    }

    // Generate employee code
    const employeeCode = `EMP${String(user.id).padStart(4, '0')}`;

    // Create employee record
    const newEmployee = await prisma.employee.create({
      data: {
        userId: user.id,
        employeeCode,
        firstName: firstName.trim(),
        lastName: (lastName || '').trim(),
        designation: designation || 'Employee',
        status,
        officeId: officeId ? parseInt(officeId, 10) : null,
        departmentId: departmentId ? parseInt(departmentId, 10) : null,
      },
      include: {
        office: true,
        user: {
          select: { email: true, isActive: true }
        },
        department: {
          select: { name: true }
        },
      },
    });

    // Create profile for the employee with new fields
    await prisma.profile.create({
      data: {
        userId: user.id,
        email,
        fullName: `${firstName} ${lastName || ''}`.trim(),
        phone,
        aadharNumber,
        pfNumber,
        esicNumber,
        isHandicapped,
        currentAddress,
        permanentAddress,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Employee created successfully.',
      employee: {
        id: newEmployee.id,
        employeeCode: newEmployee.employeeCode,
        firstName: newEmployee.firstName,
        lastName: newEmployee.lastName,
        fullName: `${newEmployee.firstName} ${newEmployee.lastName || ''}`.trim(),
        designation: newEmployee.designation,
        status: newEmployee.status,
        email: newEmployee.user?.email || '',
        phone,
        aadharNumber,
        pfNumber,
        esicNumber,
        isHandicapped,
        currentAddress,
        permanentAddress,
        department: newEmployee.department?.name || 'Unassigned',
        office: newEmployee.office?.name || 'Remote',
        createdAt: newEmployee.createdAt,
      },
    });
  } catch (error) {
    console.error('Create HR employee error:', error);
    res.status(500).json({ success: false, message: 'Failed to create employee.' });
  }
};

export const updateHREmployee = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { 
    firstName, 
    lastName, 
    designation, 
    status, 
    officeId, 
    departmentId,
    phone,
    aadharNumber,
    pfNumber,
    esicNumber,
    isHandicapped,
    currentAddress,
    permanentAddress
  } = req.body;

  if (!id) {
    res.status(400).json({ success: false, message: 'Employee ID is required.' });
    return;
  }

  try {
    const employeeId = parseInt(id as string, 10);
    
    const updatedEmployee = await prisma.employee.update({
      where: { id: employeeId },
      data: {
        firstName: firstName?.trim(),
        lastName: lastName?.trim(),
        designation,
        status,
        officeId: officeId ? parseInt(officeId, 10) : null,
        departmentId: departmentId ? parseInt(departmentId, 10) : null,
      },
      include: {
        office: true,
        user: {
          select: { email: true, isActive: true }
        },
        department: {
          select: { name: true }
        },
      },
    });

    // Update profile with new fields
    if (updatedEmployee.userId) {
      const profileUpdateData: any = {
        fullName: `${firstName || updatedEmployee.firstName} ${lastName || updatedEmployee.lastName || ''}`.trim(),
      };
      
      if (phone !== undefined) profileUpdateData.phone = phone;
      if (aadharNumber !== undefined) profileUpdateData.aadharNumber = aadharNumber;
      if (pfNumber !== undefined) profileUpdateData.pfNumber = pfNumber;
      if (esicNumber !== undefined) profileUpdateData.esicNumber = esicNumber;
      if (isHandicapped !== undefined) profileUpdateData.isHandicapped = isHandicapped;
      if (currentAddress !== undefined) profileUpdateData.currentAddress = currentAddress;
      if (permanentAddress !== undefined) profileUpdateData.permanentAddress = permanentAddress;

      await prisma.profile.update({
        where: { userId: updatedEmployee.userId },
        data: profileUpdateData,
      });
    }

    res.json({
      success: true,
      message: 'Employee updated successfully.',
      employee: {
        id: updatedEmployee.id,
        employeeCode: updatedEmployee.employeeCode,
        firstName: updatedEmployee.firstName,
        lastName: updatedEmployee.lastName,
        fullName: `${updatedEmployee.firstName} ${updatedEmployee.lastName || ''}`.trim(),
        designation: updatedEmployee.designation,
        status: updatedEmployee.status,
        email: updatedEmployee.user?.email || '',
        phone,
        aadharNumber,
        pfNumber,
        esicNumber,
        isHandicapped,
        currentAddress,
        permanentAddress,
        department: updatedEmployee.department?.name || 'Unassigned',
        office: updatedEmployee.office?.name || 'Remote',
        updatedAt: updatedEmployee.updatedAt,
      },
    });
  } catch (error) {
    console.error('Update HR employee error:', error);
    res.status(500).json({ success: false, message: 'Failed to update employee.' });
  }
};

export const deleteHREmployee = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;

  if (!id) {
    res.status(400).json({ success: false, message: 'Employee ID is required.' });
    return;
  }

  try {
    const employeeId = parseInt(id as string, 10);
    
    // Check if employee exists
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: true },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    // Delete employee (this will cascade delete related records)
    await prisma.employee.delete({
      where: { id: employeeId },
    });

    // Optionally, you might want to deactivate the user instead of deleting
    // await prisma.user.update({
    //   where: { id: employee.userId },
    //   data: { isActive: false },
    // });

    res.json({
      success: true,
      message: 'Employee deleted successfully.',
    });
  } catch (error) {
    console.error('Delete HR employee error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete employee.' });
  }
};

export const fetchHROffices = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const offices = await prisma.office.findMany({
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
      offices,
    });
  } catch (error) {
    console.error('Fetch HR offices error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch offices.' });
  }
};

export const fetchHRDepartments = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const departments = await prisma.department.findMany({
      select: {
        id: true,
        name: true,
        code: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      departments,
    });
  } catch (error) {
    console.error('Fetch HR departments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch departments.' });
  }
};
