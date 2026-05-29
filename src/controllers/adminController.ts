import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

// ==========================================
// 1. User Management
// ==========================================

export const fetchPlatformUsers = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      include: {
        profile: true,
        employee: {
          include: {
            office: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mappedUsers = users.map((user) => {
      const emailName = user.email.split('@')[0];
      const fallbackName =
        emailName.charAt(0).toUpperCase() + emailName.slice(1);

      return {
        id: user.id,
        name: user.profile?.fullName || fallbackName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        registeredAt: user.createdAt.toISOString(),
        hasEmployeeProfile: !!user.employee,
        employee: user.employee
          ? {
              id: user.employee.id,
              employeeCode: user.employee.employeeCode,
              firstName: user.employee.firstName,
              lastName: user.employee.lastName,
              designation: user.employee.designation,
              status: user.employee.status,
              office: user.employee.office
                ? {
                    id: user.employee.office.id,
                    name: user.employee.office.name,
                  }
                : null,
            }
          : null,
      };
    });

    const totalCount = mappedUsers.length;
    const withProfileCount = mappedUsers.filter((u) => u.hasEmployeeProfile).length;

    res.json({
      success: true,
      count: totalCount,
      withEmployeeProfile: withProfileCount,
      employees: mappedUsers,
    });
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({ success: false, message: 'Failed to load users.' });
  }
};

// ==========================================
// 2. Employee Management
// ==========================================

export const fetchEmployees = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employees = await prisma.employee.findMany({
      include: {
        office: true,
        user: true,
        department: true,
      },
      orderBy: { employeeCode: 'asc' },
    });

    const mappedEmployees = employees.map((emp) => ({
      id: emp.id.toString(),
      employeeCode: emp.employeeCode,
      firstName: emp.firstName,
      lastName: emp.lastName,
      designation: emp.designation,
      status: emp.status,
      officeId: emp.officeId?.toString() || null,
      office: emp.office
        ? {
            id: emp.office.id.toString(),
            name: emp.office.name,
            latitude: emp.office.latitude,
            longitude: emp.office.longitude,
            idealRadiusMeters: emp.office.idealRadiusMeters,
            maxPunchRadiusMeters: emp.office.maxPunchRadiusMeters,
          }
        : null,
      user: emp.user
        ? {
            id: emp.user.id,
            email: emp.user.email,
            role: emp.user.role,
            isActive: emp.user.isActive,
          }
        : null,
      department: emp.department
        ? {
            id: emp.department.id.toString(),
            name: emp.department.name,
            code: emp.department.code,
          }
        : null,
    }));

    const count = mappedEmployees.length;
    const registeredCount = mappedEmployees.filter((e) => e.user !== null).length;

    res.json({
      success: true,
      count,
      registeredCount,
      employees: mappedEmployees,
    });
  } catch (error) {
    console.error('Fetch employees error:', error);
    res.status(500).json({ success: false, message: 'Failed to load employees.' });
  }
};

// ==========================================
// 3. Office Management CRUD
// ==========================================

export const fetchOffices = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const offices = await prisma.office.findMany({
      include: {
        _count: {
          select: { employees: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mappedOffices = offices.map((off) => ({
      id: off.id.toString(),
      name: off.name,
      code: off.code,
      address: off.address,
      latitude: off.latitude.toString(),
      longitude: off.longitude.toString(),
      idealRadiusMeters: off.idealRadiusMeters,
      maxPunchRadiusMeters: off.maxPunchRadiusMeters,
      isActive: off.isActive,
      createdAt: off.createdAt.toISOString(),
      updatedAt: off.updatedAt.toISOString(),
      _count: {
        employees: off._count.employees,
      },
    }));

    res.json({
      success: true,
      offices: mappedOffices,
    });
  } catch (error) {
    console.error('Fetch offices error:', error);
    res.status(500).json({ success: false, message: 'Failed to load offices.' });
  }
};

export const fetchOfficeById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const officeIdInt = parseInt(id as string, 10);

  if (isNaN(officeIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Office ID.' });
    return;
  }

  try {
    const office = await prisma.office.findUnique({
      where: { id: officeIdInt },
      include: {
        employees: true,
        _count: {
          select: { employees: true },
        },
      },
    });

    if (!office) {
      res.status(404).json({ success: false, message: 'Office not found.' });
      return;
    }

    const mappedOffice = {
      id: office.id.toString(),
      name: office.name,
      code: office.code,
      address: office.address,
      latitude: office.latitude.toString(),
      longitude: office.longitude.toString(),
      idealRadiusMeters: office.idealRadiusMeters,
      maxPunchRadiusMeters: office.maxPunchRadiusMeters,
      isActive: office.isActive,
      createdAt: office.createdAt.toISOString(),
      updatedAt: office.updatedAt.toISOString(),
      _count: {
        employees: office._count.employees,
      },
      employees: office.employees.map((emp) => ({
        id: emp.id.toString(),
        employeeCode: emp.employeeCode,
        firstName: emp.firstName,
        lastName: emp.lastName,
        designation: emp.designation,
      })),
    };

    res.json({
      success: true,
      office: mappedOffice,
    });
  } catch (error) {
    console.error('Fetch office by ID error:', error);
    res.status(500).json({ success: false, message: 'Failed to load office details.' });
  }
};

export const createOffice = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const {
    name,
    code,
    address,
    latitude,
    longitude,
    idealRadiusMeters,
    maxPunchRadiusMeters,
    isActive,
  } = req.body;

  if (!name || !address || latitude === undefined || longitude === undefined) {
    res.status(400).json({
      success: false,
      message: 'Name, address, latitude, and longitude are required.',
    });
    return;
  }

  try {
    const newOffice = await prisma.office.create({
      data: {
        name: name.trim(),
        code: code ? code.trim() : null,
        address: address.trim(),
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        idealRadiusMeters: parseFloat(idealRadiusMeters || '25.0'),
        maxPunchRadiusMeters: parseFloat(maxPunchRadiusMeters || '50.0'),
        isActive: isActive !== undefined ? !!isActive : true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Office created successfully!',
      office: {
        id: newOffice.id.toString(),
        name: newOffice.name,
        code: newOffice.code,
        address: newOffice.address,
        latitude: newOffice.latitude.toString(),
        longitude: newOffice.longitude.toString(),
        idealRadiusMeters: newOffice.idealRadiusMeters,
        maxPunchRadiusMeters: newOffice.maxPunchRadiusMeters,
        isActive: newOffice.isActive,
        createdAt: newOffice.createdAt.toISOString(),
        updatedAt: newOffice.updatedAt.toISOString(),
        _count: { employees: 0 },
      },
    });
  } catch (error) {
    console.error('Create office error:', error);
    res.status(500).json({ success: false, message: 'Failed to create office.' });
  }
};

export const updateOffice = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const officeIdInt = parseInt(id as string, 10);

  if (isNaN(officeIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Office ID.' });
    return;
  }

  const {
    name,
    code,
    address,
    latitude,
    longitude,
    idealRadiusMeters,
    maxPunchRadiusMeters,
    isActive,
  } = req.body;

  try {
    const existingOffice = await prisma.office.findUnique({
      where: { id: officeIdInt },
    });

    if (!existingOffice) {
      res.status(404).json({ success: false, message: 'Office not found.' });
      return;
    }

    const updatedOffice = await prisma.office.update({
      where: { id: officeIdInt },
      data: {
        name: name !== undefined ? name.trim() : existingOffice.name,
        code: code !== undefined ? (code ? code.trim() : null) : existingOffice.code,
        address: address !== undefined ? address.trim() : existingOffice.address,
        latitude: latitude !== undefined ? parseFloat(latitude) : existingOffice.latitude,
        longitude: longitude !== undefined ? parseFloat(longitude) : existingOffice.longitude,
        idealRadiusMeters:
          idealRadiusMeters !== undefined
            ? parseFloat(idealRadiusMeters)
            : existingOffice.idealRadiusMeters,
        maxPunchRadiusMeters:
          maxPunchRadiusMeters !== undefined
            ? parseFloat(maxPunchRadiusMeters)
            : existingOffice.maxPunchRadiusMeters,
        isActive: isActive !== undefined ? !!isActive : existingOffice.isActive,
      },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    });

    res.json({
      success: true,
      message: 'Office updated successfully!',
      office: {
        id: updatedOffice.id.toString(),
        name: updatedOffice.name,
        code: updatedOffice.code,
        address: updatedOffice.address,
        latitude: updatedOffice.latitude.toString(),
        longitude: updatedOffice.longitude.toString(),
        idealRadiusMeters: updatedOffice.idealRadiusMeters,
        maxPunchRadiusMeters: updatedOffice.maxPunchRadiusMeters,
        isActive: updatedOffice.isActive,
        createdAt: updatedOffice.createdAt.toISOString(),
        updatedAt: updatedOffice.updatedAt.toISOString(),
        _count: {
          employees: updatedOffice._count.employees,
        },
      },
    });
  } catch (error) {
    console.error('Update office error:', error);
    res.status(500).json({ success: false, message: 'Failed to update office.' });
  }
};

export const deleteOffice = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const officeIdInt = parseInt(id as string, 10);

  if (isNaN(officeIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Office ID.' });
    return;
  }

  try {
    const existingOffice = await prisma.office.findUnique({
      where: { id: officeIdInt },
    });

    if (!existingOffice) {
      res.status(404).json({ success: false, message: 'Office not found.' });
      return;
    }

    await prisma.office.delete({
      where: { id: officeIdInt },
    });

    res.json({
      success: true,
      message: 'Office deleted successfully!',
    });
  } catch (error) {
    console.error('Delete office error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete office.' });
  }
};

// ==========================================
// 4. Employee Geofence Assignment
// ==========================================

export const assignEmployeeToOffice = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { employeeId } = req.params;
  const { officeId } = req.body;

  const empIdInt = parseInt(employeeId as string, 10);
  if (isNaN(empIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Employee ID.' });
    return;
  }

  // officeId is optional (representing unassignment if not provided)
  const offIdInt = officeId ? parseInt(officeId, 10) : null;

  try {
    const employee = await prisma.employee.findUnique({
      where: { id: empIdInt },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    if (offIdInt !== null) {
      const office = await prisma.office.findUnique({
        where: { id: offIdInt },
      });

      if (!office) {
        res.status(404).json({ success: false, message: 'Specified office not found.' });
        return;
      }
    }

    const updatedEmployee = await prisma.employee.update({
      where: { id: empIdInt },
      data: { officeId: offIdInt },
      include: { office: true },
    });

    res.json({
      success: true,
      message: offIdInt
        ? 'Employee assigned to office geofence successfully.'
        : 'Employee unassigned from office geofence successfully.',
      employee: {
        id: updatedEmployee.id.toString(),
        employeeCode: updatedEmployee.employeeCode,
        firstName: updatedEmployee.firstName,
        lastName: updatedEmployee.lastName,
        officeId: updatedEmployee.officeId?.toString() || null,
        office: updatedEmployee.office
          ? {
              id: updatedEmployee.office.id.toString(),
              name: updatedEmployee.office.name,
              latitude: updatedEmployee.office.latitude,
              longitude: updatedEmployee.office.longitude,
              idealRadiusMeters: updatedEmployee.office.idealRadiusMeters,
              maxPunchRadiusMeters: updatedEmployee.office.maxPunchRadiusMeters,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Assign employee error:', error);
    res.status(500).json({ success: false, message: 'Failed to update geofence assignment.' });
  }
};

// ==========================================
// 5. Attendance Operations
// ==========================================

export const fetchTodayAttendance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const attendances = await prisma.attendance.findMany({
      where: { date: todayStr },
      include: {
        employee: true,
        office: true,
      },
      orderBy: { checkIn: 'desc' },
    });

    const mappedRecords = attendances.map((att) => ({
      id: att.id,
      date: att.date,
      checkIn: att.checkIn ? att.checkIn.toISOString() : null,
      checkOut: att.checkOut ? att.checkOut.toISOString() : null,
      status: att.status,
      notes: att.notes,
      employee: {
        id: att.employee.id,
        employeeCode: att.employee.employeeCode,
        firstName: att.employee.firstName,
        lastName: att.employee.lastName,
        designation: att.employee.designation,
      },
      office: att.office
        ? {
            id: att.office.id,
            name: att.office.name,
          }
        : null,
    }));

    res.json({
      success: true,
      date: todayStr,
      count: mappedRecords.length,
      attendances: mappedRecords,
    });
  } catch (error) {
    console.error('Fetch today attendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to load today\'s attendance.' });
  }
};

export const fetchAttendanceHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { from, to, limit = '50', page = '1' } = req.query;

  const limitInt = parseInt(limit as string, 10);
  const pageInt = parseInt(page as string, 10);
  const skip = (pageInt - 1) * limitInt;

  const whereClause: any = {};
  if (from || to) {
    whereClause.date = {};
    if (from) {
      whereClause.date.gte = from as string;
    }
    if (to) {
      whereClause.date.lte = to as string;
    }
  }

  try {
    const total = await prisma.attendance.count({ where: whereClause });

    const records = await prisma.attendance.findMany({
      where: whereClause,
      include: {
        employee: true,
        office: true,
      },
      orderBy: { date: 'desc' },
      skip,
      take: limitInt,
    });

    const mappedRecords = records.map((att) => ({
      id: att.id,
      date: att.date,
      checkIn: att.checkIn ? att.checkIn.toISOString() : null,
      checkOut: att.checkOut ? att.checkOut.toISOString() : null,
      status: att.status,
      notes: att.notes,
      employee: {
        id: att.employee.id,
        employeeCode: att.employee.employeeCode,
        firstName: att.employee.firstName,
        lastName: att.employee.lastName,
        designation: att.employee.designation,
      },
      office: att.office
        ? {
            id: att.office.id,
            name: att.office.name,
          }
        : null,
    }));

    res.json({
      success: true,
      from: from || null,
      to: to || null,
      page: pageInt,
      limit: limitInt,
      total,
      records: mappedRecords,
    });
  } catch (error) {
    console.error('Fetch attendance history error:', error);
    res.status(500).json({ success: false, message: 'Failed to load attendance history.' });
  }
};

// ==========================================
// 6. Commenting Operations
// ==========================================

export const fetchComments = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { entityType, entityId } = req.query;

  if (!entityType || !entityId) {
    res.status(400).json({
      success: false,
      message: 'entityType and entityId query params are required.',
    });
    return;
  }

  try {
    const comments = await prisma.comment.findMany({
      where: {
        entityType: entityType as string,
        entityId: entityId as string,
      },
      include: {
        author: {
          include: { profile: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mappedComments = comments.map((comm) => {
      const emailName = comm.author.email.split('@')[0];
      const fallbackName =
        emailName.charAt(0).toUpperCase() + emailName.slice(1);

      return {
        id: comm.id,
        entityType: comm.entityType,
        entityId: comm.entityId,
        content: comm.content,
        createdAt: comm.createdAt.toISOString(),
        updatedAt: comm.updatedAt.toISOString(),
        author: {
          id: comm.author.id,
          email: comm.author.email,
          fullName: comm.author.profile?.fullName || fallbackName,
          avatarUrl: comm.author.profile?.avatarUrl || null,
        },
      };
    });

    res.json({
      success: true,
      count: mappedComments.length,
      comments: mappedComments,
    });
  } catch (error) {
    console.error('Fetch comments error:', error);
    res.status(500).json({ success: false, message: 'Failed to load comments.' });
  }
};

export const createComment = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { entityType, entityId, content } = req.body;

  if (!entityType || !entityId || !content) {
    res.status(400).json({
      success: false,
      message: 'entityType, entityId, and content are required.',
    });
    return;
  }

  try {
    const newComment = await prisma.comment.create({
      data: {
        entityType,
        entityId: entityId.toString(),
        content: content.trim(),
        authorId: req.user!.id,
      },
      include: {
        author: {
          include: { profile: true },
        },
      },
    });

    const emailName = newComment.author.email.split('@')[0];
    const fallbackName =
      emailName.charAt(0).toUpperCase() + emailName.slice(1);

    res.status(201).json({
      success: true,
      message: 'Comment added successfully!',
      comment: {
        id: newComment.id,
        entityType: newComment.entityType,
        entityId: newComment.entityId,
        content: newComment.content,
        createdAt: newComment.createdAt.toISOString(),
        updatedAt: newComment.updatedAt.toISOString(),
        author: {
          id: newComment.author.id,
          email: newComment.author.email,
          fullName: newComment.author.profile?.fullName || fallbackName,
          avatarUrl: newComment.author.profile?.avatarUrl || null,
        },
      },
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ success: false, message: 'Failed to add comment.' });
  }
};

export const deleteComment = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const commentIdInt = parseInt(id as string, 10);

  if (isNaN(commentIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Comment ID.' });
    return;
  }

  try {
    const existingComment = await prisma.comment.findUnique({
      where: { id: commentIdInt },
    });

    if (!existingComment) {
      res.status(404).json({ success: false, message: 'Comment not found.' });
      return;
    }

    // Admins can delete comments, but users can only delete their own
    if (
      existingComment.authorId !== req.user!.id &&
      req.user!.role !== 'SUPER_ADMIN' &&
      req.user!.role !== 'ADMIN'
    ) {
      res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this comment.',
      });
      return;
    }

    await prisma.comment.delete({
      where: { id: commentIdInt },
    });

    res.json({
      success: true,
      message: 'Comment deleted successfully!',
    });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete comment.' });
  }
};

// ==========================================
// 7. Statistics & Dashboards
// ==========================================

export const fetchDashboardStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const totalEmployees = await prisma.employee.count();

    const presentToday = await prisma.attendance.count({
      where: {
        date: todayStr,
        status: 'PRESENT',
      },
    });

    const onLeave = await prisma.employee.count({
      where: { status: 'on_leave' },
    });

    // Mock count new hires within last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const newHires = await prisma.employee.count({
      where: {
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    res.json({
      success: true,
      data: {
        totalEmployees,
        presentToday,
        onLeave,
        newHires,
      },
    });
  } catch (error) {
    console.error('Fetch dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to compute dashboard metrics.' });
  }
};

export const fetchCompanyStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const totalEntities = await prisma.office.count();
    const globalSeats = await prisma.employee.count();
    
    // Count inactive employees as pending verification
    const pendingVerification = await prisma.employee.count({
      where: { status: 'INACTIVE' },
    });

    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const officesThisMonth = await prisma.office.count({
      where: { createdAt: { gte: startOfThisMonth } }
    });

    const officesBeforeThisMonth = await prisma.office.count({
      where: { createdAt: { lt: startOfThisMonth } }
    });

    let systemGrowth = '+18.7%';
    if (officesBeforeThisMonth > 0) {
      const growthPercent = (officesThisMonth / officesBeforeThisMonth) * 100;
      systemGrowth = `+${growthPercent.toFixed(1)}%`;
    } else if (officesThisMonth > 0) {
      systemGrowth = '+100.0%';
    }

    // Dynamic Monthly revenue based on actual seats (₹500 per employee seat + base)
    const monthlyRevenue = globalSeats * 500 + 120000;

    res.json({
      success: true,
      totalEntities,
      globalSeats,
      pendingVerification,
      systemGrowth,
      monthlyRevenue,
    });
  } catch (error) {
    console.error('Fetch company stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to compute company statistics.' });
  }
};

// ==========================================
// 8. Admin Self Profile Management
// ==========================================

export const fetchAdminProfile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { profile: true },
    });

    if (!user || !user.profile) {
      res.status(404).json({ success: false, message: 'Admin profile not found.' });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      profile: {
        id: user.profile.id,
        userId: user.profile.userId,
        email: user.profile.email,
        fullName: user.profile.fullName,
        phone: user.profile.phone,
        avatarUrl: user.profile.avatarUrl,
        timezone: user.profile.timezone,
        timezoneLabel: user.profile.timezoneLabel,
        bio: user.profile.bio,
        createdAt: user.profile.createdAt.toISOString(),
        updatedAt: user.profile.updatedAt.toISOString(),
        security: {
          twoFactorEnabled: user.profile.twoFactorEnabled,
          twoFactorStatus: user.profile.twoFactorStatus,
          lastLoginAt: user.profile.lastLoginAt.toISOString(),
          lastLoginLocation: user.profile.lastLoginLocation,
          clearanceLevel: user.profile.clearanceLevel,
          clearanceLabel: user.profile.clearanceLabel,
        },
      },
    });
  } catch (error) {
    console.error('Fetch profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to load profile.' });
  }
};

export const updateAdminProfile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { fullName, phone, bio } = req.body;

  if (!fullName) {
    res.status(400).json({ success: false, message: 'Full Name is required.' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { profile: true },
    });

    if (!user || !user.profile) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: user.profile.id },
      data: {
        fullName: fullName.trim(),
        phone: phone !== undefined ? phone.trim() : user.profile.phone,
        bio: bio !== undefined ? bio.trim() : user.profile.bio,
      },
    });

    res.json({
      success: true,
      message: 'Profile updated successfully!',
      profile: {
        id: updatedProfile.id,
        userId: updatedProfile.userId,
        email: updatedProfile.email,
        fullName: updatedProfile.fullName,
        phone: updatedProfile.phone,
        avatarUrl: updatedProfile.avatarUrl,
        timezone: updatedProfile.timezone,
        timezoneLabel: updatedProfile.timezoneLabel,
        bio: updatedProfile.bio,
        createdAt: updatedProfile.createdAt.toISOString(),
        updatedAt: updatedProfile.updatedAt.toISOString(),
        security: {
          twoFactorEnabled: updatedProfile.twoFactorEnabled,
          twoFactorStatus: updatedProfile.twoFactorStatus,
          lastLoginAt: updatedProfile.lastLoginAt.toISOString(),
          lastLoginLocation: updatedProfile.lastLoginLocation,
          clearanceLevel: updatedProfile.clearanceLevel,
          clearanceLabel: updatedProfile.clearanceLabel,
        },
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
};

export const uploadAdminAvatar = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { avatarUrl, imageBase64 } = req.body;

  let urlToSave = avatarUrl;

  // If base64 is provided, we can simulate saving it or just store the base64 data string
  if (imageBase64) {
    urlToSave = imageBase64;
  }

  if (!urlToSave) {
    res.status(400).json({ success: false, message: 'Avatar image is required.' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { profile: true },
    });

    if (!user || !user.profile) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: user.profile.id },
      data: { avatarUrl: urlToSave },
    });

    res.json({
      success: true,
      message: 'Avatar uploaded successfully!',
      profile: {
        id: updatedProfile.id,
        userId: updatedProfile.userId,
        email: updatedProfile.email,
        fullName: updatedProfile.fullName,
        phone: updatedProfile.phone,
        avatarUrl: updatedProfile.avatarUrl,
        timezone: updatedProfile.timezone,
        timezoneLabel: updatedProfile.timezoneLabel,
        bio: updatedProfile.bio,
        createdAt: updatedProfile.createdAt.toISOString(),
        updatedAt: updatedProfile.updatedAt.toISOString(),
        security: {
          twoFactorEnabled: updatedProfile.twoFactorEnabled,
          twoFactorStatus: updatedProfile.twoFactorStatus,
          lastLoginAt: updatedProfile.lastLoginAt.toISOString(),
          lastLoginLocation: updatedProfile.lastLoginLocation,
          clearanceLevel: updatedProfile.clearanceLevel,
          clearanceLabel: updatedProfile.clearanceLabel,
        },
      },
    });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload avatar.' });
  }
};

export const removeAdminAvatar = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { profile: true },
    });

    if (!user || !user.profile) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: user.profile.id },
      data: { avatarUrl: '/favicon.svg' },
    });

    res.json({
      success: true,
      message: 'Avatar removed successfully!',
      profile: {
        id: updatedProfile.id,
        userId: updatedProfile.userId,
        email: updatedProfile.email,
        fullName: updatedProfile.fullName,
        phone: updatedProfile.phone,
        avatarUrl: updatedProfile.avatarUrl,
        timezone: updatedProfile.timezone,
        timezoneLabel: updatedProfile.timezoneLabel,
        bio: updatedProfile.bio,
        createdAt: updatedProfile.createdAt.toISOString(),
        updatedAt: updatedProfile.updatedAt.toISOString(),
        security: {
          twoFactorEnabled: updatedProfile.twoFactorEnabled,
          twoFactorStatus: updatedProfile.twoFactorStatus,
          lastLoginAt: updatedProfile.lastLoginAt.toISOString(),
          lastLoginLocation: updatedProfile.lastLoginLocation,
          clearanceLevel: updatedProfile.clearanceLevel,
          clearanceLabel: updatedProfile.clearanceLabel,
        },
      },
    });
  } catch (error) {
    console.error('Remove avatar error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove avatar.' });
  }
};

// ==========================================
// 9. Live Geolocation Telemetry
// ==========================================

export const fetchLiveLocations = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const locations = await prisma.liveLocation.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    const mappedLocations = locations.map((loc) => ({
      employeeId: loc.employeeId,
      name: loc.name,
      role: loc.role,
      lat: loc.lat,
      lng: loc.lng,
      status: loc.status,
      speed: loc.speed,
      battery: loc.battery,
    }));

    res.json({
      success: true,
      count: mappedLocations.length,
      pollIntervalSeconds: 15,
      updatedAt: new Date().toISOString(),
      employees: mappedLocations,
    });
  } catch (error) {
    console.error('Fetch live locations error:', error);
    res.status(500).json({ success: false, message: 'Failed to load telemetry geolocations.' });
  }
};

// ==========================================
// 10. Admin Leave Management
// ==========================================

export const fetchAdminLeaves = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const leaves = await prisma.leaveRequest.findMany({
      include: {
        employee: true,
      },
      orderBy: { appliedOn: 'desc' },
    });

    res.json({
      success: true,
      leaves: leaves.map((l) => ({
        id: l.id.toString(),
        employeeId: l.employeeId.toString(),
        employeeName: l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : 'Unassigned',
        department: 'Engineering', // fallback default department label
        type: l.type === 'CASUAL' ? 'Casual Leave' : l.type === 'SICK' ? 'Sick Leave' : l.type === 'EARNED' ? 'Earned Leave' : 'Paid Leave',
        startDate: l.fromDate.toISOString().split('T')[0],
        endDate: l.toDate.toISOString().split('T')[0],
        reason: l.reason,
        status: l.status === 'APPROVED' ? 'Approved' : l.status === 'REJECTED' ? 'Rejected' : 'Pending',
        appliedOn: l.appliedOn.toISOString(),
        reviewedBy: l.reviewedBy,
        reviewNote: l.reviewNote,
      })),
    });
  } catch (error) {
    console.error('Fetch admin leaves error:', error);
    res.status(500).json({ success: false, message: 'Failed to load leave requests.' });
  }
};

export const updateAdminLeaveStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { status, reviewNote } = req.body; // e.g. "Approved" or "Rejected"
  
  const leaveIdInt = parseInt(id as string, 10);
  if (isNaN(leaveIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Leave ID.' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { profile: true },
    });
    const reviewerName = user?.profile?.fullName || 'HR Manager';

    const updated = await prisma.leaveRequest.update({
      where: { id: leaveIdInt },
      data: {
        status: status.toUpperCase() === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        reviewedBy: reviewerName,
        reviewNote: reviewNote || 'Processed by Administrator',
      },
    });

    res.json({
      success: true,
      message: `Leave request ${status.toLowerCase()} successfully!`,
      leave: updated,
    });
  } catch (error) {
    console.error('Update leave status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update leave request.' });
  }
};

export const fetchAdminLeaveBalances = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employees = await prisma.employee.findMany({
      include: {
        leaveRequests: true,
      }
    });

    const balances = employees.map((emp) => {
      const getUsedDays = (type: string) => {
        return emp.leaveRequests
          .filter((l) => l.status === 'APPROVED' && l.type === type)
          .reduce((sum, l) => {
            const diffTime = Math.abs(l.toDate.getTime() - l.fromDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
            return sum + diffDays;
          }, 0);
      };

      const casualUsed = getUsedDays('CASUAL');
      const sickUsed = getUsedDays('SICK');
      const earnedUsed = getUsedDays('EARNED');

      return {
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        casual: Math.max(0, 12 - casualUsed),
        sick: Math.max(0, 10 - sickUsed),
        earned: Math.max(0, 15 - earnedUsed),
        paid: 15,
      };
    });

    res.json({
      success: true,
      balances,
    });
  } catch (error) {
    console.error('Fetch leave balances error:', error);
    res.status(500).json({ success: false, message: 'Failed to load leave balances.' });
  }
};

// ==========================================
// 11. Admin Task Management
// ==========================================

export const fetchAdminTasks = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tasks = await prisma.task.findMany({
      include: {
        assignedTo: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      tasks: tasks.map((t) => ({
        id: t.id.toString(),
        title: t.title,
        description: t.description,
        assignee: t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : 'Unassigned',
        assigneeId: t.assignedToId?.toString() ?? '',
        priority: t.priority.toLowerCase() === 'high' ? 'High' : t.priority.toLowerCase() === 'medium' ? 'Medium' : 'Low',
        status: t.status === 'COMPLETED' ? 'Completed' : t.status === 'IN_PROGRESS' ? 'In Progress' : t.status === 'OVERDUE' ? 'Overdue' : 'To Do',
        deadline: t.dueDate.toISOString().split('T')[0],
        projectName: t.projectName || 'General',
        progress: t.status === 'COMPLETED' ? 100 : t.status === 'IN_PROGRESS' ? 50 : 0,
      })),
    });
  } catch (error) {
    console.error('Fetch admin tasks error:', error);
    res.status(500).json({ success: false, message: 'Failed to load tasks.' });
  }
};

export const createAdminTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { title, description, assigneeId, priority, deadline, projectName } = req.body;

  if (!title || !description || !assigneeId || !deadline) {
    res.status(400).json({ success: false, message: 'Title, description, assignee, and deadline are required.' });
    return;
  }

  try {
    const parsedAssigneeId = parseInt(assigneeId, 10);
    if (isNaN(parsedAssigneeId)) {
      res.status(400).json({ success: false, message: 'Invalid Assignee ID.' });
      return;
    }

    const newTask = await prisma.task.create({
      data: {
        title,
        description,
        assignedToId: parsedAssigneeId,
        assignedById: req.user!.id,
        projectName: projectName || 'General',
        dueDate: new Date(deadline),
        status: 'TODO',
        priority: (priority || 'medium').toUpperCase(),
      },
    });

    res.status(201).json({
      success: true,
      message: 'Task created successfully!',
      task: newTask,
    });
  } catch (error) {
    console.error('Create admin task error:', error);
    res.status(500).json({ success: false, message: 'Failed to create task.' });
  }
};

export const updateAdminTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { title, description, assigneeId, priority, deadline, projectName, status, progress } = req.body;

  const taskIdInt = parseInt(id as string, 10);
  if (isNaN(taskIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Task ID.' });
    return;
  }

  try {
    const updateData: any = {};
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (assigneeId) updateData.assignedToId = parseInt(assigneeId, 10);
    if (projectName) updateData.projectName = projectName;
    if (deadline) updateData.dueDate = new Date(deadline);
    if (priority) updateData.priority = priority.toUpperCase();
    
    if (status) {
      updateData.status = status.toUpperCase().replace(' ', '_');
    } else if (progress !== undefined) {
      updateData.status = progress === 100 ? 'COMPLETED' : progress > 0 ? 'IN_PROGRESS' : 'TODO';
    }

    const updated = await prisma.task.update({
      where: { id: taskIdInt },
      data: updateData,
    });

    res.json({
      success: true,
      message: 'Task updated successfully!',
      task: updated,
    });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ success: false, message: 'Failed to update task.' });
  }
};

export const deleteAdminTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const taskIdInt = parseInt(id as string, 10);

  if (isNaN(taskIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Task ID.' });
    return;
  }

  try {
    await prisma.task.delete({
      where: { id: taskIdInt },
    });

    res.json({
      success: true,
      message: 'Task deleted successfully!',
    });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete task.' });
  }
};

export const createAdminLeaveRequest = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { employeeId, type, fromDate, toDate, reason } = req.body;

  if (!employeeId || !type || !fromDate || !toDate || !reason) {
    res.status(400).json({ success: false, message: 'All fields are required.' });
    return;
  }

  try {
    const empIdInt = parseInt(employeeId, 10);
    if (isNaN(empIdInt)) {
      res.status(400).json({ success: false, message: 'Invalid Employee ID.' });
      return;
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: empIdInt,
        type: type.toUpperCase().replace(' LEAVE', ''),
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
        reason: reason.trim(),
        status: 'PENDING',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Leave request submitted successfully!',
      leave,
    });
  } catch (error) {
    console.error('Create admin leave request error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit leave request.' });
  }
};
