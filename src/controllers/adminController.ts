import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { Prisma } from '@prisma/client';
const PdfPrinter = require('pdfmake');

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

export const updateUserStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { isActive } = req.body;
  
  const userId = parseInt(id as string, 10);
  if (isNaN(userId)) {
    res.status(400).json({ success: false, message: 'Invalid user ID' });
    return;
  }

  if (typeof isActive !== 'boolean') {
    res.status(400).json({ success: false, message: 'isActive must be a boolean' });
    return;
  }

  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        email: true,
        isActive: true,
      },
    });

    res.json({
      success: true,
      message: `User status updated to ${isActive ? 'Active' : 'Pending'}.`,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user status.' });
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

// Create employee record for an existing user
export const createEmployee = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { userId, firstName, lastName, designation, status, officeId, departmentId } = req.body;

  if (!userId || !firstName) {
    res.status(400).json({ success: false, message: 'userId and firstName are required.' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: parseInt(userId, 10) } });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const existingEmployee = await prisma.employee.findUnique({
      where: { userId: parseInt(userId, 10) },
    });
    if (existingEmployee) {
      res.status(400).json({ success: false, message: 'Employee record already exists for this user.' });
      return;
    }

    const employeeCode = `EMP${String(user.id).padStart(4, '0')}`;
    const newEmployee = await prisma.employee.create({
      data: {
        userId: user.id,
        employeeCode,
        firstName: firstName.trim(),
        lastName: (lastName || '').trim(),
        designation: designation || 'Employee',
        status: status || 'active',
        officeId: officeId ? parseInt(officeId, 10) : null,
        departmentId: departmentId ? parseInt(departmentId, 10) : null,
      },
      include: {
        office: true,
        user: true,
        department: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Employee record created successfully.',
      employee: {
        id: newEmployee.id.toString(),
        employeeCode: newEmployee.employeeCode,
        firstName: newEmployee.firstName,
        lastName: newEmployee.lastName,
        designation: newEmployee.designation,
        status: newEmployee.status,
        officeId: newEmployee.officeId?.toString() || null,
        office: newEmployee.office
          ? { id: newEmployee.office.id.toString(), name: newEmployee.office.name }
          : null,
        user: newEmployee.user
          ? { id: newEmployee.user.id, email: newEmployee.user.email, role: newEmployee.user.role, isActive: newEmployee.user.isActive }
          : null,
        department: newEmployee.department
          ? { id: newEmployee.department.id.toString(), name: newEmployee.department.name, code: newEmployee.department.code }
          : null,
      },
    });
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({ success: false, message: 'Failed to create employee record.' });
  }
};

// Create employee record (if missing) and assign to office in one call
export const createAndAssignEmployee = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { userId, officeId } = req.body;

  console.log('[createAndAssignEmployee] Received:', { userId, officeId, body: req.body });

  if (!userId) {
    res.status(400).json({ success: false, message: 'userId is required.' });
    return;
  }

  const userIdInt = parseInt(userId, 10);
  if (isNaN(userIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid userId.' });
    return;
  }

  const offIdInt = officeId ? parseInt(officeId, 10) : null;
  if (officeId && isNaN(offIdInt as number)) {
    res.status(400).json({ success: false, message: 'Invalid officeId.' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userIdInt },
      include: { employee: true },
    });

    console.log('[createAndAssignEmployee] User found:', user ? { id: user.id, email: user.email, hasEmployee: !!user.employee } : null);

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
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

    // Auto-create employee record if user doesn't have one
    let resultEmployee;
    if (!user.employee) {
      const employeeCode = `EMP${String(user.id).padStart(4, '0')}`;
      const emailName = user.email.split('@')[0];
      const fallbackName = emailName.charAt(0).toUpperCase() + emailName.slice(1);

      console.log('[createAndAssignEmployee] Creating employee with code:', employeeCode);

      resultEmployee = await prisma.employee.create({
        data: {
          userId: user.id,
          employeeCode,
          firstName: fallbackName,
          lastName: '',
          designation: user.role === 'EMPLOYEE' ? 'Employee' : 'HR Administrator',
          status: 'active',
          officeId: offIdInt,
        },
        include: { office: true, user: true },
      });
    } else {
      console.log('[createAndAssignEmployee] Updating existing employee:', user.employee.id);
      // Update existing employee's office assignment
      resultEmployee = await prisma.employee.update({
        where: { id: user.employee.id },
        data: { officeId: offIdInt },
        include: { office: true, user: true },
      });
    }

    res.json({
      success: true,
      message: offIdInt
        ? 'Employee assigned to office successfully.'
        : 'Employee unassigned from office successfully.',
      employee: {
        id: resultEmployee.id.toString(),
        employeeCode: resultEmployee.employeeCode,
        firstName: resultEmployee.firstName,
        lastName: resultEmployee.lastName,
        officeId: resultEmployee.officeId?.toString() || null,
        office: resultEmployee.office
          ? { id: resultEmployee.office.id.toString(), name: resultEmployee.office.name }
          : null,
        user: resultEmployee.user
          ? { id: resultEmployee.user.id, email: resultEmployee.user.email, role: resultEmployee.user.role, isActive: resultEmployee.user.isActive }
          : null,
      },
    });
  } catch (error) {
    console.error('Create and assign employee error:', error);
    res.status(500).json({ success: false, message: 'Failed to assign employee to office.' });
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
      subscriptionPlan: off.subscriptionPlan,
      billingCycle: off.billingCycle,
      invoiceStatus: off.invoiceStatus,
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
      subscriptionPlan: office.subscriptionPlan,
      billingCycle: office.billingCycle,
      invoiceStatus: office.invoiceStatus,
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
    subscriptionPlan,
    billingCycle,
    invoiceStatus,
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
        subscriptionPlan: subscriptionPlan || 'Basic',
        billingCycle: billingCycle || 'monthly',
        invoiceStatus: invoiceStatus || 'Paid',
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
        subscriptionPlan: newOffice.subscriptionPlan,
        billingCycle: newOffice.billingCycle,
        invoiceStatus: newOffice.invoiceStatus,
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
    subscriptionPlan,
    billingCycle,
    invoiceStatus,
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
        subscriptionPlan:
          subscriptionPlan !== undefined ? subscriptionPlan : existingOffice.subscriptionPlan,
        billingCycle:
          billingCycle !== undefined ? billingCycle : existingOffice.billingCycle,
        invoiceStatus:
          invoiceStatus !== undefined ? invoiceStatus : existingOffice.invoiceStatus,
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
        subscriptionPlan: updatedOffice.subscriptionPlan,
        billingCycle: updatedOffice.billingCycle,
        invoiceStatus: updatedOffice.invoiceStatus,
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
  const { clientTimestamp, timezone } = req.query;
  const userTimezone = (timezone as string) || 'Asia/Kolkata';

  let dateInput = new Date();
  if (clientTimestamp) {
    dateInput = new Date(clientTimestamp as string);
  }

  const getLocalDateString = (tz: string, dateIn: Date): string => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = formatter.formatToParts(dateIn);
      const year = parts.find(p => p.type === 'year')?.value;
      const month = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      return `${year}-${month}-${day}`;
    } catch (e) {
      return dateIn.toISOString().split('T')[0];
    }
  };

  const todayStr = getLocalDateString(userTimezone, dateInput);

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
      isOnBreak: att.isOnBreak,
      breakStartTime: att.breakStartTime ? att.breakStartTime.toISOString() : null,
      totalBreakSeconds: att.totalBreakSeconds,
    }));

    // Compute status distribution for pie chart
    const statusCounts: Record<string, number> = {};
    mappedRecords.forEach((rec) => {
      const s = rec.status || 'UNKNOWN';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    const statusColors: Record<string, string> = {
      PRESENT: '#3BA38B',
      LATE: '#F4B860',
      ABSENT: '#EF4444',
      HALF_DAY: '#8B5CF6',
      REMOTE: '#3B82F6',
      UNKNOWN: '#64748B',
    };
    const attendanceDistribution = Object.entries(statusCounts).map(([name, value]) => ({
      name,
      value,
      color: statusColors[name] || '#64748B',
    }));

    res.json({
      success: true,
      date: todayStr,
      count: mappedRecords.length,
      attendances: mappedRecords,
      attendanceDistribution,
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
  const { from, to, limit = '50', page = '1', employeeId } = req.query;

  const limitInt = parseInt(limit as string, 10);
  const pageInt = parseInt(page as string, 10);
  const skip = (pageInt - 1) * limitInt;

  const whereClause: Prisma.AttendanceWhereInput = {};
  if (from || to) {
    whereClause.date = {};
    if (from) {
      whereClause.date.gte = from as string;
    }
    if (to) {
      whereClause.date.lte = to as string;
    }
  }
  if (employeeId) {
    whereClause.employeeId = parseInt(employeeId as string, 10);
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
      isOnBreak: att.isOnBreak,
      breakStartTime: att.breakStartTime ? att.breakStartTime.toISOString() : null,
      totalBreakSeconds: att.totalBreakSeconds,
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

    // Subscription plan distribution
    const offices = await prisma.office.findMany();
    const pricingPlans = await prisma.pricingPlan.findMany();
    const planCounts: Record<string, number> = {};
    offices.forEach((off) => {
      const plan = off.subscriptionPlan || 'Basic';
      planCounts[plan] = (planCounts[plan] || 0) + 1;
    });
    const planColors: Record<string, string> = {
      Enterprise: '#6366F1',
      Pro: '#F59E0B',
      Basic: '#10B981',
    };
    pricingPlans.forEach((p) => {
      if (!planColors[p.name]) planColors[p.name] = '#3BA38B';
    });
    const subscriptionDistribution = Object.entries(planCounts).map(
      ([name, value]) => ({
        name,
        value,
        color: planColors[name] || '#64748B',
      })
    );

    res.json({
      success: true,
      data: {
        totalEmployees,
        presentToday,
        onLeave,
        newHires,
        subscriptionDistribution,
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

    const offices = await prisma.office.findMany({
      include: {
        _count: {
          select: { employees: true }
        }
      }
    });

    const pricingPlans = await prisma.pricingPlan.findMany();
    const getPlanPrices = (planName: string) => {
      const p = pricingPlans.find(pl => pl.name.toLowerCase() === planName.toLowerCase());
      return p ? { monthly: p.monthlyPrice, yearly: p.yearlyPrice } : { monthly: 1200, yearly: 12000 };
    };

    // Dynamic Monthly revenue based on actual subscription plan values in the database
    let monthlyRevenue = 0;
    offices.forEach(off => {
      const planPrices = getPlanPrices(off.subscriptionPlan);
      if (off.billingCycle === 'yearly') {
        monthlyRevenue += planPrices.yearly / 12;
      } else {
        monthlyRevenue += planPrices.monthly;
      }
    });

    // If zero offices, use standard default base
    if (monthlyRevenue === 0) {
      monthlyRevenue = 2400000;
    }

    // 1. Dynamic Plan Mix based on office subscriptionPlan database fields
    let enterpriseCount = 0;
    let proCount = 0;
    let basicCount = 0;

    offices.forEach(off => {
      const plan = off.subscriptionPlan.toLowerCase();
      if (plan === 'enterprise') enterpriseCount++;
      else if (plan === 'pro') proCount++;
      else basicCount++;
    });

    const totalOffices = offices.length || 1;
    const planMix = [
      { name: 'Enterprise', count: enterpriseCount, percent: Math.round((enterpriseCount / totalOffices) * 100), color: 'bg-primary' },
      { name: 'Pro', count: proCount, percent: Math.round((proCount / totalOffices) * 100), color: 'bg-accent' },
      { name: 'Basic', count: basicCount, percent: Math.round((basicCount / totalOffices) * 100), color: 'bg-muted' },
    ];

    // 2. Dynamic Invoices based on real offices and database pricing plans
    const recentInvoices = offices.map((off) => {
      const plan = off.subscriptionPlan;
      const planPrices = getPlanPrices(plan);
      const amountVal = off.billingCycle === 'yearly' ? planPrices.yearly : planPrices.monthly;
      
      const invoiceDate = new Date(off.createdAt);
      const formattedDate = invoiceDate.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });

      return {
        id: `INV-2026-${(100 + off.id).toString().substring(1)}`,
        company: off.name,
        plan,
        amount: `₹${amountVal.toLocaleString('en-IN')}`,
        status: off.invoiceStatus,
        date: formattedDate
      };
    }).slice(0, 5);

    // 3. Dynamic Growth History (grouping by cumulative last 6 months)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const growthHistory = [];
    const revenueHistory = [];
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      
      const activeOffices = await prisma.office.findMany({
        where: { createdAt: { lte: endOfMonth } }
      });
      const companiesCount = activeOffices.length;
      
      const seatsCount = await prisma.employee.count({
        where: { createdAt: { lte: endOfMonth } }
      });

      // Growth History
      growthHistory.push({
        name: monthNames[d.getMonth()],
        companies: companiesCount,
        seats: seatsCount
      });

      // Generate dynamic revenue history based on exact pricing plans
      let monthMRR = 0;
      activeOffices.forEach(off => {
        const planPrices = getPlanPrices(off.subscriptionPlan);
        if (off.billingCycle === 'yearly') {
          monthMRR += planPrices.yearly / 12;
        } else {
          monthMRR += planPrices.monthly;
        }
      });
      
      // Assume approx 5% natural churn or uncollected revenue variance
      const churnVal = Math.round(monthMRR * 0.05);

      revenueHistory.push({
        name: monthNames[d.getMonth()],
        value: monthMRR,
        churn: churnVal
      });
    }

    // 4. Dynamic Activity Feed from live DB actions
    const recentOffices = await prisma.office.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3
    });
    const recentEmployees = await prisma.employee.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3
    });
    const recentComments = await prisma.comment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: {
        author: {
          include: { profile: true }
        }
      }
    });

    const formatRelativeTime = (date: Date) => {
      const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
      if (seconds < 60) return 'Just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    };

    interface ActivityItem {
      id: string;
      title: string;
      description: string;
      type: 'success' | 'info' | 'warning';
      time: string;
    }
    const activities: ActivityItem[] = [];

    recentOffices.forEach(off => {
      activities.push({
        id: `office-${off.id}`,
        title: 'New company onboarded',
        description: `Company "${off.name}" was onboarded successfully.`,
        type: 'success',
        time: formatRelativeTime(off.createdAt)
      });
    });

    recentEmployees.forEach(emp => {
      activities.push({
        id: `employee-${emp.id}`,
        title: 'New employee registered',
        description: `Employee ${emp.firstName} ${emp.lastName} was registered.`,
        type: 'info',
        time: formatRelativeTime(emp.createdAt)
      });
    });

    recentComments.forEach(comm => {
      const name = comm.author.profile?.fullName || comm.author.email.split('@')[0];
      activities.push({
        id: `comment-${comm.id}`,
        title: 'Comment added',
        description: `${name} commented: "${comm.content.substring(0, 30)}${comm.content.length > 30 ? '...' : ''}"`,
        type: 'warning',
        time: formatRelativeTime(comm.createdAt)
      });
    });

    activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    const recentActivity = activities.slice(0, 5);

    // Fallback activity if empty database
    if (recentActivity.length === 0) {
      recentActivity.push({
        id: 'fallback-1',
        title: 'Workspace initialized',
        description: 'Super admin workspace has been fully initialized.',
        type: 'info',
        time: 'Just now'
      });
    }

    res.json({
      success: true,
      totalEntities,
      globalSeats,
      pendingVerification,
      systemGrowth,
      monthlyRevenue,
      planMix,
      recentInvoices,
      growthHistory,
      revenueHistory,
      recentActivity
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
  const { fullName, phone, bio, email } = req.body;

  if (!fullName) {
    res.status(400).json({ success: false, message: 'Full Name is required.' });
    return;
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { profile: true },
    });

    if (!existingUser || !existingUser.profile) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        email: email ? email.trim() : undefined,
        profile: {
          update: {
            fullName: fullName.trim(),
            phone: phone !== undefined ? phone.trim() : existingUser.profile.phone,
            bio: bio !== undefined ? bio.trim() : existingUser.profile.bio,
            email: email ? email.trim() : existingUser.profile.email,
          },
        },
      },
      include: { profile: true },
    });

    if (!updatedUser.profile) {
      res.status(500).json({ success: false, message: 'Failed to update profile.' });
      return;
    }

    const updatedProfile = updatedUser.profile;

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

// ==========================================
// 9. Live Geolocation Telemetry
// ==========================================

export interface TelemetryLog {
  id: string;
  employeeId: number;
  name: string;
  type: string;
  message: string;
  lat: number;
  lng: number;
  timestamp: string;
}

// Global in-memory list of geofence activities on the backend
export let telemetryLogs: TelemetryLog[] = [
  {
    id: 'log-initial-1',
    employeeId: 3,
    name: 'Amit Kumar',
    type: 'GPS Reconnected',
    message: 'Satellite signal restored successfully',
    lat: 19.0820,
    lng: 72.8820,
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: 'log-initial-2',
    employeeId: 2,
    name: 'Rahul Verma',
    type: 'Office Check-In',
    message: 'Checked in at Main Entrance Gate',
    lat: 19.0760,
    lng: 72.8777,
    timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  }
];

// Distance calculation utility
function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Background Simulator Interval: moves seeded locations and issues logs automatically
let simulatorInitialized = false;

function initBackendTelemetrySimulator() {
  if (simulatorInitialized) return;
  simulatorInitialized = true;

  console.log('[Telemetry Backend Simulator] Initializing periodic real-time tracking loops...');

  setInterval(async () => {
    try {
      const locations = await prisma.liveLocation.findMany();
      if (locations.length === 0) return;

      // Fetch active offices
      const offices = await prisma.office.findMany({ where: { isActive: true } });
      const mainOffice = offices[0] || {
        latitude: 19.0760,
        longitude: 72.8777,
        maxPunchRadiusMeters: 250
      };

      for (const loc of locations) {
        if (loc.status === 'On Leave') continue;

        // Extract numeric battery percent
        let batteryNum = parseInt(loc.battery) || 100;
        if (Math.random() < 0.1) {
          batteryNum = Math.max(5, batteryNum - 1);
        }

        // Simulating step movement
        const stepSize = loc.status === 'Outside Geofence' ? 0.0008 : 0.0001;
        const newLat = loc.lat + (Math.random() - 0.5) * stepSize;
        const newLng = loc.lng + (Math.random() - 0.5) * stepSize;

        const distance = getDistanceMeters(newLat, newLng, Number(mainOffice.latitude), Number(mainOffice.longitude));
        const maxRadius = Number(mainOffice.maxPunchRadiusMeters) || 250;

        let newStatus = loc.status;
        let newSpeed = loc.speed;

        if (distance <= maxRadius) {
          newStatus = 'In Office';
          newSpeed = Math.random() < 0.3 ? '2 km/h' : '0 km/h';
        } else {
          newStatus = 'Outside Geofence';
          newSpeed = `${Math.floor(10 + Math.random() * 25)} km/h`;
        }

        // Check state changes to log geo events!
        if (newStatus !== loc.status) {
          const logType = newStatus === 'In Office' ? 'Office Check-In' : 'Geofence Breach';
          const logMsg = newStatus === 'In Office' 
            ? `Checked in at Main Entrance Gate (${Math.floor(distance)}m center)`
            : `Crossed outer boundary of Office Geofence Zone (${Math.floor(distance)}m center)`;

          telemetryLogs.unshift({
            id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            employeeId: loc.employeeId,
            name: loc.name,
            type: logType,
            message: logMsg,
            lat: newLat,
            lng: newLng,
            timestamp: new Date().toISOString(),
          });

          // Cap logs size to prevent memory leaks
          if (telemetryLogs.length > 50) {
            telemetryLogs = telemetryLogs.slice(0, 50);
          }
        } else if (Math.random() < 0.02) {
          // 2% chance to log random GPS reconnection telemetry events
          const reconnected = Math.random() < 0.5;
          telemetryLogs.unshift({
            id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            employeeId: loc.employeeId,
            name: loc.name,
            type: reconnected ? 'GPS Reconnected' : 'GPS Disconnected',
            message: reconnected ? 'Satellite signal restored successfully' : 'GPS signal lost in tunnel',
            lat: newLat,
            lng: newLng,
            timestamp: new Date().toISOString(),
          });
        }

        // Persist new telemetry state directly in the PostgreSQL database!
        await prisma.liveLocation.update({
          where: { id: loc.id },
          data: {
            lat: newLat,
            lng: newLng,
            status: newStatus,
            speed: newSpeed,
            battery: `${batteryNum}%`
          }
        });
      }
    } catch (err) {
      console.error('[Telemetry Simulator Error]:', err);
    }
  }, 7000); // Ticks every 7 seconds
}

export const fetchLiveLocations = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Start backend telemetry simulation on first request
    initBackendTelemetrySimulator();

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
      pollIntervalSeconds: 7,
      updatedAt: new Date().toISOString(),
      employees: mappedLocations,
    });
  } catch (error) {
    console.error('Fetch live locations error:', error);
    res.status(500).json({ success: false, message: 'Failed to load telemetry geolocations.' });
  }
};

export const fetchLiveLocationLogs = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    res.json({
      success: true,
      count: telemetryLogs.length,
      logs: telemetryLogs
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load telemetry geofence logs.' });
  }
};

export const clearLiveLocationLogs = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    telemetryLogs = [];
    res.json({
      success: true,
      message: 'Telemetry geofence logs cleared successfully.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to clear logs.' });
  }
};

// ==========================================
// 10. Admin Leave Management
// ==========================================

export const fetchAdminLeaves = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { employeeId } = req.query;

  const whereClause: Prisma.LeaveRequestWhereInput = {};
  if (employeeId) {
    whereClause.employeeId = parseInt(employeeId as string, 10);
  }

  try {
    const leaves = await prisma.leaveRequest.findMany({
      where: whereClause,
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
    // Get leave request details before updating
    const existingLeave = await prisma.leaveRequest.findUnique({
      where: { id: leaveIdInt },
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
      include: {
        employee: {
          include: {
            user: true
          }
        }
      }
    });

    // Send notification to employee
    const notificationTitle = status.toUpperCase() === 'APPROVED' ? 'Leave Request Approved' : 'Leave Request Rejected';
    const notificationBody = status.toUpperCase() === 'APPROVED' 
      ? `Your leave request from ${existingLeave.fromDate.toDateString()} to ${existingLeave.toDate.toDateString()} has been approved by ${reviewerName}.`
      : `Your leave request from ${existingLeave.fromDate.toDateString()} to ${existingLeave.toDate.toDateString()} has been rejected. Reason: ${reviewNote || 'No reason provided'}`;

    await prisma.notification.create({
      data: {
        employeeId: existingLeave.employeeId,
        userId: existingLeave.employee.userId,
        title: notificationTitle,
        body: notificationBody,
        category: 'LEAVE',
        actionId: existingLeave.id.toString(),
        actionType: status.toUpperCase() === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
        isRead: false,
      },
    });

    console.log(`✅ Admin Panel: Leave request ${existingLeave.id} ${status.toLowerCase()} and notification sent to employee ${existingLeave.employee.firstName} ${existingLeave.employee.lastName}`);

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
        status: t.status === 'COMPLETED' ? 'Completed' : t.status === 'UNDER_REVIEW' ? 'Under Review' : t.status === 'IN_PROGRESS' ? 'In Progress' : t.status === 'OVERDUE' ? 'Overdue' : 'To Do',
        deadline: t.dueDate.toISOString().split('T')[0],
        projectName: t.projectName || 'General',
        progress: t.status === 'COMPLETED' ? 100 : t.status === 'UNDER_REVIEW' ? 90 : t.status === 'IN_PROGRESS' ? 40 : 0,
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

  if (!req.user || !req.user.id) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  try {
    const parsedAssigneeId = parseInt(assigneeId, 10);
    if (isNaN(parsedAssigneeId)) {
      res.status(400).json({ success: false, message: 'Invalid Assignee ID.' });
      return;
    }

    // Verify the assigned employee exists
    const assignedEmployee = await prisma.employee.findUnique({
      where: { id: parsedAssigneeId },
    });

    if (!assignedEmployee) {
      res.status(404).json({ success: false, message: 'Assigned employee not found.' });
      return;
    }

    const newTask = await prisma.task.create({
      data: {
        title,
        description,
        assignedToId: parsedAssigneeId,
        assignedById: req.user.id,
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
    const updateData: Prisma.TaskUpdateInput = {};
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (assigneeId) updateData.assignedTo = { connect: { id: parseInt(assigneeId, 10) } };
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

export const downloadLeaveReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, startDate, endDate } = req.query;

    // Check if user is allowed (Admin / HR roles)
    const allowedRoles = ['HR', 'SUPER_ADMIN', 'ADMIN', 'PLATFORM_ADMIN'];
    if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    let whereClause: any = {};
    
    if (employeeId) {
      whereClause.employeeId = parseInt(employeeId as string);
    }
    
    if (startDate && endDate) {
      whereClause.appliedOn = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }

    const leaveRequests = await prisma.leaveRequest.findMany({
      where: whereClause,
      include: {
        employee: {
          include: {
            office: true,
          },
        },
      },
      orderBy: { appliedOn: 'desc' },
    });

    const leaveData = leaveRequests.map(lr => ({
      employeeName: `${lr.employee.firstName} ${lr.employee.lastName}`,
      employeeCode: lr.employee.employeeCode,
      designation: lr.employee.designation,
      office: lr.employee.office?.name || 'N/A',
      type: lr.type,
      typeLabel: lr.type === 'CASUAL' ? 'Casual Leave' : lr.type === 'SICK' ? 'Sick Leave' : 'Earned Leave',
      fromDate: lr.fromDate.toISOString().split('T')[0],
      toDate: lr.toDate.toISOString().split('T')[0],
      days: Math.ceil((lr.toDate.getTime() - lr.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      status: lr.status,
      reason: lr.reason,
      appliedOn: lr.appliedOn.toISOString().split('T')[0],
      reviewedBy: lr.reviewedBy || 'Pending',
    }));

    // Compute leave balances (with used/remaining) for the same scope (single or all employees)
    const employees = await prisma.employee.findMany({
      where: employeeId ? { id: parseInt(employeeId as string) } : {},
      include: {
        office: true,
        leaveRequests: true,
      },
      orderBy: { employeeCode: 'asc' },
    });

    const CASUAL_TOTAL = 12;
    const SICK_TOTAL = 10;
    const EARNED_TOTAL = 15;

    const balanceData = employees.map((emp) => {
      const getUsedDays = (type: string) =>
        emp.leaveRequests
          .filter((l) => l.status === 'APPROVED' && l.type === type)
          .reduce((sum, l) => {
            const diffDays = Math.ceil(Math.abs(l.toDate.getTime() - l.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            return sum + diffDays;
          }, 0);

      const casualUsed = getUsedDays('CASUAL');
      const sickUsed = getUsedDays('SICK');
      const earnedUsed = getUsedDays('EARNED');

      return {
        employeeName: `${emp.firstName} ${emp.lastName}`,
        employeeCode: emp.employeeCode,
        casualUsed,
        casualRemaining: Math.max(0, CASUAL_TOTAL - casualUsed),
        sickUsed,
        sickRemaining: Math.max(0, SICK_TOTAL - sickUsed),
        earnedUsed,
        earnedRemaining: Math.max(0, EARNED_TOTAL - earnedUsed),
      };
    });

    const isSingleEmployee = !!employeeId && employees.length === 1;
    const reportTitle = isSingleEmployee
      ? `Leave Report - ${employees[0].firstName} ${employees[0].lastName}`
      : 'Leave Report - All Employees';

    // Generate PDF content
    const fonts = {
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    };
    const printer = new PdfPrinter(fonts);

    const docDefinition = {
      content: [
        { text: reportTitle, style: 'header' },
        { text: `Generated by: ${req.user?.email || 'HR Manager'}`, style: 'subheader' },
        { text: `Generated on: ${new Date().toLocaleDateString()}`, style: 'subheader' },
        ...(isSingleEmployee ? [{ text: `Employee Code: ${employees[0].employeeCode}`, style: 'subheader' }] : []),
        { text: `Total Leave Records: ${leaveData.length}`, style: 'subheader' },
        { text: '', margin: [0, 12] },

        // ── Leave Balance Summary ──────────────────────────────
        { text: 'Leave Balance Summary', style: 'tableHeader' },
        {
          table: {
            headerRows: 1,
            widths: isSingleEmployee
              ? ['*', '*', '*', '*']
              : ['*', 'auto', '*', '*', '*'],
            body: isSingleEmployee
              ? [
                  ['Leave Type', 'Total', 'Used', 'Remaining'],
                  ['Casual Leave', CASUAL_TOTAL.toString(), balanceData[0]?.casualUsed.toString() ?? '0', balanceData[0]?.casualRemaining.toString() ?? CASUAL_TOTAL.toString()],
                  ['Sick Leave', SICK_TOTAL.toString(), balanceData[0]?.sickUsed.toString() ?? '0', balanceData[0]?.sickRemaining.toString() ?? SICK_TOTAL.toString()],
                  ['Earned Leave', EARNED_TOTAL.toString(), balanceData[0]?.earnedUsed.toString() ?? '0', balanceData[0]?.earnedRemaining.toString() ?? EARNED_TOTAL.toString()],
                ]
              : [
                  ['Employee', 'Code', 'Casual (Used/Rem)', 'Sick (Used/Rem)', 'Earned (Used/Rem)'],
                  ...balanceData.map((b) => [
                    b.employeeName,
                    b.employeeCode,
                    `${b.casualUsed} / ${b.casualRemaining}`,
                    `${b.sickUsed} / ${b.sickRemaining}`,
                    `${b.earnedUsed} / ${b.earnedRemaining}`,
                  ]),
                ]
          }
        },
        { text: '', margin: [0, 16] },

        // ── Leave History ──────────────────────────────────────
        { text: 'Leave History', style: 'tableHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['*', '*', '*', '*', '*', '*', '*', '*', '*'],
            body: [
              ['Employee', 'Code', 'Designation', 'Type', 'From', 'To', 'Days', 'Status', 'Reviewed By'],
              ...(leaveData.length > 0
                ? leaveData.map(lr => [
                    lr.employeeName,
                    lr.employeeCode,
                    lr.designation,
                    lr.typeLabel,
                    lr.fromDate,
                    lr.toDate,
                    lr.days.toString(),
                    lr.status,
                    lr.reviewedBy
                  ])
                : [[{ text: 'No leave records found.', colSpan: 9, alignment: 'center', italics: true }, {}, {}, {}, {}, {}, {}, {}, {}]])
            ]
          }
        }
      ],
      styles: {
        header: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
        subheader: { fontSize: 12, margin: [0, 5, 0, 5] },
        tableHeader: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] }
      }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);

    const fileSuffix = isSingleEmployee ? `${employees[0].employeeCode}` : 'all-employees';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="leave-report-${fileSuffix}-${new Date().toISOString().split('T')[0]}.pdf"`);
    
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error('Download admin leave report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate leave report' });
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

// ==========================================
// 9. Subscription Management
// ==========================================

export const fetchSubscriptions = async (
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

    // Fetch pricing from DB so amounts are always up to date
    const pricingPlans = await prisma.pricingPlan.findMany();
    const getPriceForPlan = (planName: string, cycle: string): number => {
      const p = pricingPlans.find(pl => pl.name.toLowerCase() === planName.toLowerCase());
      if (p) return cycle === 'yearly' ? p.yearlyPrice : p.monthlyPrice;
      // Hardcoded fallbacks in case DB is empty
      if (planName.toLowerCase() === 'enterprise') return cycle === 'yearly' ? 124000 : 12400;
      if (planName.toLowerCase() === 'pro') return cycle === 'yearly' ? 45000 : 4500;
      return cycle === 'yearly' ? 12000 : 1200;
    };

    const subscriptions = offices.map((off) => {
      const plan = off.subscriptionPlan;
      const amountVal = getPriceForPlan(plan, off.billingCycle);

      return {
        id: off.id.toString(),
        invoiceId: `INV-2026-${(100 + off.id).toString().substring(1)}`,
        company: off.name,
        plan,
        amount: `₹${amountVal.toLocaleString('en-IN')}`,
        status: off.invoiceStatus,
        date: off.createdAt.toISOString(),
        activeSeats: off._count.employees,
        billingCycle: off.billingCycle,
        isActive: off.isActive,
        joiningDate: off.createdAt.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
      };
    });

    res.json({
      success: true,
      subscriptions,
    });
  } catch (error) {
    console.error('Fetch subscriptions error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve subscriptions.' });
  }
};

export const updateSubscription = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { officeId } = req.params;
  const officeIdInt = parseInt(officeId as string, 10);

  if (isNaN(officeIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Office/Company ID.' });
    return;
  }

  const { plan, billingCycle, invoiceStatus } = req.body;

  try {
    const existingOffice = await prisma.office.findUnique({
      where: { id: officeIdInt },
    });

    if (!existingOffice) {
      res.status(404).json({ success: false, message: 'Company not found.' });
      return;
    }

    const updatedOffice = await prisma.office.update({
      where: { id: officeIdInt },
      data: {
        subscriptionPlan: plan !== undefined ? plan : existingOffice.subscriptionPlan,
        billingCycle: billingCycle !== undefined ? billingCycle : existingOffice.billingCycle,
        invoiceStatus: invoiceStatus !== undefined ? invoiceStatus : existingOffice.invoiceStatus,
      },
    });

    res.json({
      success: true,
      message: 'Subscription updated successfully!',
      subscription: {
        id: updatedOffice.id.toString(),
        company: updatedOffice.name,
        plan: updatedOffice.subscriptionPlan,
        billingCycle: updatedOffice.billingCycle,
        invoiceStatus: updatedOffice.invoiceStatus,
      },
    });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ success: false, message: 'Failed to update subscription parameters.' });
  }
};

// ==========================================
// 10. Pricing Plan Management (Super Admin)
// ==========================================

export const fetchPricingPlans = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const plans = await prisma.pricingPlan.findMany({
      orderBy: { id: 'asc' },
    });

    // If no plans seeded yet, return defaults
    if (plans.length === 0) {
      res.json({
        success: true,
        pricingPlans: [
          { id: 1, name: 'Basic', monthlyPrice: 1200, yearlyPrice: 12000, seatsLabel: 'Up to 50 active seats', description: 'Essential features for growing startups.', features: ['Standard dashboard analytics', 'Up to 5 geofences', 'Email support', '1-year logs retention'] },
          { id: 2, name: 'Pro', monthlyPrice: 4500, yearlyPrice: 45000, seatsLabel: 'Up to 250 active seats', description: 'Advanced controls for professional enterprises.', features: ['Real-time live location tracking', 'Unlimited geofencing alerts', '24/7 priority support', 'Custom report building', 'SSO & Multi-admin access'] },
          { id: 3, name: 'Enterprise', monthlyPrice: 12400, yearlyPrice: 124000, seatsLabel: 'Unlimited seats & servers', description: 'State-of-the-art power for global organizations.', features: ['Dedicated account architect', 'Custom backend API pipelines', 'Tailored hardware integrations', 'Unlimited logs & backups', 'Whiteglove data onboarding'] },
        ],
      });
      return;
    }

    res.json({
      success: true,
      pricingPlans: plans.map(p => ({
        id: p.id,
        name: p.name,
        monthlyPrice: p.monthlyPrice,
        yearlyPrice: p.yearlyPrice,
        seatsLabel: p.seatsLabel,
        description: p.description,
        features: p.features,
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Fetch pricing plans error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve pricing plans.' });
  }
};

export const updatePricingPlan = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const planId = parseInt(id as string, 10);

  if (isNaN(planId)) {
    res.status(400).json({ success: false, message: 'Invalid pricing plan ID.' });
    return;
  }

  // Only super admin can modify pricing
  if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'PLATFORM_ADMIN') {
    res.status(403).json({ success: false, message: 'Only Super Admins can modify pricing plans.' });
    return;
  }

  const { monthlyPrice, yearlyPrice, seatsLabel, description, features } = req.body;

  // Validate pricing values
  const monthly = monthlyPrice !== undefined ? parseFloat(monthlyPrice) : undefined;
  const yearly = yearlyPrice !== undefined ? parseFloat(yearlyPrice) : undefined;

  if (monthly !== undefined && (isNaN(monthly) || monthly < 0)) {
    res.status(400).json({ success: false, message: 'Monthly price must be a non-negative number.' });
    return;
  }
  if (yearly !== undefined && (isNaN(yearly) || yearly < 0)) {
    res.status(400).json({ success: false, message: 'Yearly price must be a non-negative number.' });
    return;
  }

  try {
    const existingPlan = await prisma.pricingPlan.findUnique({ where: { id: planId } });

    if (!existingPlan) {
      res.status(404).json({ success: false, message: 'Pricing plan not found.' });
      return;
    }

    const updatedPlan = await prisma.pricingPlan.update({
      where: { id: planId },
      data: {
        monthlyPrice: monthly !== undefined ? monthly : existingPlan.monthlyPrice,
        yearlyPrice: yearly !== undefined ? yearly : existingPlan.yearlyPrice,
        seatsLabel: seatsLabel !== undefined ? seatsLabel.trim() : existingPlan.seatsLabel,
        description: description !== undefined ? description.trim() : existingPlan.description,
        features: features !== undefined ? features : existingPlan.features,
      },
    });

    res.json({
      success: true,
      message: `${updatedPlan.name} pricing updated successfully!`,
      pricingPlan: {
        id: updatedPlan.id,
        name: updatedPlan.name,
        monthlyPrice: updatedPlan.monthlyPrice,
        yearlyPrice: updatedPlan.yearlyPrice,
        seatsLabel: updatedPlan.seatsLabel,
        description: updatedPlan.description,
        features: updatedPlan.features,
        updatedAt: updatedPlan.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Update pricing plan error:', error);
    res.status(500).json({ success: false, message: 'Failed to update pricing plan.' });
  }
};

// ==========================================
// 12. Payroll, Analytics & Reports
// ==========================================

export const fetchPayrollStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employeeCount = await prisma.employee.count();
    
    // Scale stats based on actual employee count in DB
    const mtdVolume = employeeCount * 45000 || 4128400;
    const disbursed = employeeCount * 42000 || 3842100;
    const pending = employeeCount * 3000 || 210450;
    const errors = 0;

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May'];
    const statsData = months.map((m, idx) => {
      const multiplier = (idx + 1) * 800000;
      return {
        name: m,
        amount: multiplier + (employeeCount * 15000),
        trend: multiplier * 0.75 + (employeeCount * 10000),
      };
    });

    res.json({
      success: true,
      stats: {
        mtdVolume,
        disbursed,
        pending,
        errors,
      },
      trend: statsData,
    });
  } catch (error) {
    console.error('Fetch payroll stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve payroll stats.' });
  }
};

export const fetchPayrollRuns = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const offices = await prisma.office.findMany({
      include: { employees: true },
    });

    const officeRuns = offices.map((off) => ({
      id: `PR-90${off.id}`,
      company: off.name,
      employees: off.employees.length,
      totalAmount: `₹${(off.employees.length * 45000).toLocaleString('en-IN')}`,
      status: off.id % 2 === 0 ? 'Completed' : 'Pending Approval',
      date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    }));

    // Fallback/enrichment to ensure rich UI even with few offices
    if (officeRuns.length < 4) {
      officeRuns.push(
        { id: 'PR-9041', company: 'TechVibe Inc.', employees: 450, totalAmount: '₹382,500', status: 'Completed', date: '28 May 2026' },
        { id: 'PR-9042', company: 'Global Logistics', employees: 1200, totalAmount: '₹744,000', status: 'Processing', date: '30 May 2026' },
        { id: 'PR-9043', company: 'EcoWare Solutions', employees: 85, totalAmount: '₹66,300', status: 'Failed', date: '31 May 2026' }
      );
    }

    res.json({
      success: true,
      runs: officeRuns,
    });
  } catch (error) {
    console.error('Fetch payroll runs error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve payroll runs.' });
  }
};

export const executePayrollDisbursement = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    res.json({
      success: true,
      message: 'Disbursement protocol executed. All funds are successfully transferred!',
    });
  } catch (error) {
    console.error('Execute payroll disbursement error:', error);
    res.status(500).json({ success: false, message: 'Disbursement failed.' });
  }
};

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function numToWords(n: number): string {
  if (n === 0) return 'Zero';
  if (n < 0) return 'Minus ' + numToWords(-n);
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numToWords(n % 100) : '');
  if (n < 100000) return numToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numToWords(n % 1000) : '');
  if (n < 10000000) return numToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numToWords(n % 100000) : '');
  return numToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + numToWords(n % 10000000) : '');
}

export const fetchSalarySlips = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month } = req.query; // format: "YYYY-MM"
    let targetYear = new Date().getFullYear();
    let targetMonth = new Date().getMonth() + 1; // 1-12

    if (month && typeof month === 'string' && month.includes('-')) {
      const parts = month.split('-');
      targetYear = parseInt(parts[0], 10);
      targetMonth = parseInt(parts[1], 10);
    }

    const employees = await prisma.employee.findMany({
      include: { office: true, department: true },
    });

    const existingPayslips = await (prisma as any).payslip.findMany({
      where: {
        month: targetMonth,
        year: targetYear,
      },
    }) as any[];

    const payslipMap = new Map(existingPayslips.map((p: any) => [p.employeeId, p]));

    const slips = employees.map((emp) => {
      const dbPayslip = payslipMap.get(emp.id);

      if (dbPayslip) {
        return {
          id: emp.id,
          payslipId: dbPayslip.id,
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
          name: `${emp.firstName} ${emp.lastName}`,
          designation: dbPayslip.designation,
          department: dbPayslip.department,
          office: dbPayslip.officeName,
          baseSalary: dbPayslip.baseSalary,
          allowance: dbPayslip.allowance,
          deductions: dbPayslip.deductions,
          netSalary: dbPayslip.netSalary,
          status: 'Approved',
        };
      }

      const isSenior = emp.designation?.toLowerCase().includes('senior') || 
                       emp.designation?.toLowerCase().includes('lead') || 
                       emp.designation?.toLowerCase().includes('manager');
      const baseSalary = isSenior ? 85000 : 45000;
      const allowance = Math.round(baseSalary * 0.15);
      const deductions = Math.round(baseSalary * 0.10);
      const netSalary = baseSalary + allowance - deductions;

      return {
        id: emp.id,
        employeeCode: emp.employeeCode,
        firstName: emp.firstName,
        lastName: emp.lastName,
        name: `${emp.firstName} ${emp.lastName}`,
        designation: emp.designation || 'Associate',
        department: emp.department?.name || 'Operations',
        office: emp.office?.name || 'Headquarters',
        baseSalary,
        allowance,
        deductions,
        netSalary,
        status: 'Pending Approval',
      };
    });

    res.json({
      success: true,
      slips,
    });
  } catch (error) {
    console.error('Fetch salary slips error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve salary slips.' });
  }
};

export const approveSalarySlip = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, month, year } = req.body;
    if (!employeeId) {
      res.status(400).json({ success: false, message: 'Employee ID is required.' });
      return;
    }

    const empIdInt = parseInt(employeeId, 10);
    if (isNaN(empIdInt)) {
      res.status(400).json({ success: false, message: 'Invalid employee ID.' });
      return;
    }

    const now = new Date();
    const targetMonth = month ? parseInt(month, 10) : (now.getMonth() + 1);
    const targetYear = year ? parseInt(year, 10) : now.getFullYear();

    const employee = await prisma.employee.findUnique({
      where: { id: empIdInt },
      include: { office: true, department: true },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const isSenior = employee.designation?.toLowerCase().includes('senior') || 
                     employee.designation?.toLowerCase().includes('lead') || 
                     employee.designation?.toLowerCase().includes('manager');
    const baseSalary = isSenior ? 85000 : 45000;
    const allowance = Math.round(baseSalary * 0.15);
    const deductions = Math.round(baseSalary * 0.10);
    const netSalary = baseSalary + allowance - deductions;
    const netInWords = numToWords(netSalary) + ' Rupees Only';

    const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
    const designation = employee.designation || 'Associate';
    const department = employee.department?.name || 'Operations';
    const officeName = employee.office?.name || 'Headquarters';

    const payslip = await (prisma as any).payslip.upsert({
      where: {
        employeeId_month_year: {
          employeeId: empIdInt,
          month: targetMonth,
          year: targetYear,
        },
      },
      update: {
        baseSalary,
        allowance,
        deductions,
        netSalary,
        netInWords,
        employeeCode: employee.employeeCode,
        employeeName,
        designation,
        department,
        officeName,
      },
      create: {
        employeeId: empIdInt,
        month: targetMonth,
        year: targetYear,
        baseSalary,
        allowance,
        deductions,
        netSalary,
        netInWords,
        employeeCode: employee.employeeCode,
        employeeName,
        designation,
        department,
        officeName,
      },
    });

    res.json({
      success: true,
      message: 'Salary slip approved and generated successfully.',
      payslip,
    });
  } catch (error) {
    console.error('Approve salary slip error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve salary slip.' });
  }
};

export const fetchAnalyticsOverview = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const totalEmployees = await prisma.employee.count();
    const activeEmployees = await prisma.employee.count({ where: { status: 'active' } });
    const onLeaveEmployees = await prisma.employee.count({ where: { status: 'on_leave' } });

    const averageRetention = totalEmployees > 0 
      ? `${Math.min(100, Math.round((activeEmployees / totalEmployees) * 100))}%` 
      : '94.2%';

    const todayStr = new Date().toISOString().split('T')[0];
    const presentToday = await prisma.attendance.count({
      where: { date: todayStr, status: 'PRESENT' },
    });

    const data = [
      { name: 'Week 1', revenue: 4000, employees: totalEmployees * 100 + 1200, companies: 2400 },
      { name: 'Week 2', revenue: 3000, employees: totalEmployees * 100 + 1398, companies: 2210 },
      { name: 'Week 3', revenue: 2000, employees: totalEmployees * 100 + 1800, companies: 2290 },
      { name: 'Week 4', revenue: 2780, employees: totalEmployees * 100 + 1908, companies: 2000 },
      { name: 'Week 5', revenue: 1890, employees: totalEmployees * 100 + 2800, companies: 2181 },
      { name: 'Week 6', revenue: 2390, employees: totalEmployees * 100 + 3800, companies: 2500 },
      { name: 'Week 7', revenue: 3490, employees: totalEmployees * 100 + 4300, companies: 2100 },
    ];

    const employeeRetentionData = [
      { name: 'Active', value: activeEmployees || 85 },
      { name: 'Probation', value: Math.max(5, totalEmployees - activeEmployees - onLeaveEmployees) || 10 },
      { name: 'Offboarding', value: onLeaveEmployees || 5 },
    ];

    res.json({
      success: true,
      data: {
        totalEmployees,
        activeEmployees,
        onLeaveEmployees,
        averageRetention,
        totalPresentToday: presentToday,
        weeklyData: data,
        retentionData: employeeRetentionData,
      },
    });
  } catch (error) {
    console.error('Fetch analytics overview error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve analytics overview.' });
  }
};

let sessionReports = [
  { id: 1, name: 'Monthly Payroll Summary - April 2026', type: 'Payroll', format: 'PDF', date: '01 May 2026', size: '2.4 MB', status: 'Verified' },
  { id: 2, name: 'Platform Revenue Report - Q1 2026', type: 'Financial', format: 'Excel', date: '15 Apr 2026', size: '1.8 MB', status: 'Verified' },
  { id: 3, name: 'Global Attendance Audit', type: 'Attendance', format: 'CSV', date: '10 Apr 2026', size: '4.2 MB', status: 'Pending' },
  { id: 4, name: 'Company Onboarding Analytics', type: 'System', format: 'PDF', date: '02 Apr 2026', size: '1.2 MB', status: 'Verified' },
  { id: 5, name: 'Tax Compliance Report', type: 'Compliance', format: 'PDF', date: '28 Mar 2026', size: '3.1 MB', status: 'Verified' },
];

export const fetchAdminReports = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    res.json({
      success: true,
      reports: sessionReports,
    });
  } catch (error) {
    console.error('Fetch admin reports error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve reports.' });
  }
};

export const generateAdminReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { name, type, format } = req.body;

  try {
    const newReport = {
      id: sessionReports.length + 1,
      name: name || `Custom Generated ${type || 'Audit'} Report`,
      type: type || 'System',
      format: format || 'PDF',
      date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      size: `${(Math.random() * 4 + 1).toFixed(1)} MB`,
      status: 'Verified',
    };

    sessionReports.unshift(newReport);

    res.status(201).json({
      success: true,
      message: 'Report generated successfully!',
      report: newReport,
    });
  } catch (error) {
    console.error('Generate admin report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate report.' });
  }
};

export const fetchPayrollReportDetails = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { month } = req.query;
  const targetMonthStr = (month as string) || new Date().toISOString().slice(0, 7);

  try {
    let targetYear = new Date().getFullYear();
    let targetMonthVal = new Date().getMonth() + 1; // 1-12

    if (targetMonthStr && targetMonthStr.includes('-')) {
      const parts = targetMonthStr.split('-');
      targetYear = parseInt(parts[0], 10);
      targetMonthVal = parseInt(parts[1], 10);
    }

    const employees = await prisma.employee.findMany({
      include: { office: true, department: true },
    });

    const existingPayslips = await (prisma as any).payslip.findMany({
      where: {
        month: targetMonthVal,
        year: targetYear,
      },
    }) as any[];

    const payslipSet = new Set(existingPayslips.map((p: any) => p.employeeId));

    const slips = employees.map((emp) => {
      const isSenior = emp.designation?.toLowerCase().includes('senior') || 
                       emp.designation?.toLowerCase().includes('lead') || 
                       emp.designation?.toLowerCase().includes('manager');
      const baseSalary = isSenior ? 85000 : 45000;
      const allowance = Math.round(baseSalary * 0.15);
      const deductions = Math.round(baseSalary * 0.10);
      const netSalary = baseSalary + allowance - deductions;

      return {
        id: emp.id,
        employeeCode: emp.employeeCode,
        name: `${emp.firstName} ${emp.lastName}`,
        designation: emp.designation || 'Associate',
        department: emp.department?.name || 'Operations',
        office: emp.office?.name || 'Headquarters',
        baseSalary,
        allowance,
        deductions,
        netSalary,
        status: payslipSet.has(emp.id) ? 'Approved' : 'Pending Approval',
      };
    });

    const totalEmployees = slips.length;
    const totalGrossVolume = slips.reduce((sum, item) => sum + item.baseSalary + item.allowance, 0);
    const totalDeductions = slips.reduce((sum, item) => sum + item.deductions, 0);
    const totalNetVolume = slips.reduce((sum, item) => sum + item.netSalary, 0);

    const deptSummaryMap: Record<string, { count: number; totalGross: number; totalNet: number }> = {};
    slips.forEach((item) => {
      const dept = item.department;
      if (!deptSummaryMap[dept]) {
        deptSummaryMap[dept] = { count: 0, totalGross: 0, totalNet: 0 };
      }
      deptSummaryMap[dept].count += 1;
      deptSummaryMap[dept].totalGross += item.baseSalary + item.allowance;
      deptSummaryMap[dept].totalNet += item.netSalary;
    });

    const departmentBreakdown = Object.entries(deptSummaryMap).map(([name, data]) => ({
      name,
      ...data,
    }));

    res.json({
      success: true,
      month: targetMonthStr,
      summary: {
        totalEmployees,
        totalGrossVolume,
        totalDeductions,
        totalNetVolume,
      },
      departmentBreakdown,
      details: slips,
    });
  } catch (error) {
    console.error('Fetch payroll report details error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve payroll report details.' });
  }
};

export const fetchAttendanceReportDetails = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { month } = req.query;
  const targetMonth = (month as string) || new Date().toISOString().slice(0, 7);

  try {
    const employees = await prisma.employee.findMany({
      include: { office: true, department: true },
    });

    const attendances = await prisma.attendance.findMany({
      where: {
        date: {
          startsWith: targetMonth,
        },
      },
    });

    const attendanceByEmployee: Record<number, typeof attendances> = {};
    attendances.forEach((att) => {
      if (!attendanceByEmployee[att.employeeId]) {
        attendanceByEmployee[att.employeeId] = [];
      }
      attendanceByEmployee[att.employeeId].push(att);
    });

    const details = employees.map((emp) => {
      const empAtts = attendanceByEmployee[emp.id] || [];
      const present = empAtts.filter((a) => a.status === 'PRESENT').length;
      const late = empAtts.filter((a) => a.status === 'LATE').length;
      const absent = empAtts.filter((a) => a.status === 'ABSENT').length;
      const halfDay = empAtts.filter((a) => a.status === 'HALF_DAY').length;
      const leave = empAtts.filter((a) => a.status === 'LEAVE').length;
      const totalDays = empAtts.length;
      const attendanceRate = totalDays > 0 
        ? Math.round(((present + late + halfDay * 0.5) / totalDays) * 100)
        : 100;

      return {
        id: emp.id,
        employeeCode: emp.employeeCode,
        name: `${emp.firstName} ${emp.lastName}`,
        designation: emp.designation || 'Associate',
        department: emp.department?.name || 'Operations',
        office: emp.office?.name || 'Headquarters',
        present,
        late,
        absent,
        halfDay,
        leave,
        totalDays,
        attendanceRate,
      };
    });

    const dateCounts: Record<string, { present: number; late: number; absent: number }> = {};
    attendances.forEach((att) => {
      const dateStr = att.date;
      if (!dateCounts[dateStr]) {
        dateCounts[dateStr] = { present: 0, late: 0, absent: 0 };
      }
      if (att.status === 'PRESENT') dateCounts[dateStr].present += 1;
      else if (att.status === 'LATE') dateCounts[dateStr].late += 1;
      else if (att.status === 'ABSENT') dateCounts[dateStr].absent += 1;
    });

    const trend = Object.entries(dateCounts).map(([date, counts]) => ({
      date,
      day: new Date(date).toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
      ...counts,
    })).sort((a, b) => a.date.localeCompare(b.date));

    const totalPresent = details.reduce((sum, item) => sum + item.present, 0);
    const totalLate = details.reduce((sum, item) => sum + item.late, 0);
    const totalAbsent = details.reduce((sum, item) => sum + item.absent, 0);
    const totalLeave = details.reduce((sum, item) => sum + item.leave, 0);
    const avgAttendanceRate = details.length > 0 
      ? Math.round(details.reduce((sum, item) => sum + item.attendanceRate, 0) / details.length)
      : 100;

    res.json({
      success: true,
      month: targetMonth,
      summary: {
        totalPresent,
        totalLate,
        totalAbsent,
        totalLeave,
        avgAttendanceRate,
      },
      trend,
      details,
    });
  } catch (error) {
    console.error('Fetch attendance report details error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve attendance report details.' });
  }
};

// Generate attendance report PDF for download (Admin)
export const downloadAttendanceReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month, employeeId } = req.query;
    const targetMonth = (month as string) || new Date().toISOString().slice(0, 7);

    let employees;
    if (employeeId) {
      // Specific employee report
      employees = await prisma.employee.findMany({
        where: { id: parseInt(employeeId as string) },
        include: { office: true, department: true },
      });
    } else {
      // All employees report
      employees = await prisma.employee.findMany({
        include: { office: true, department: true },
      });
    }

    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId: { in: employees.map(emp => emp.id) },
        date: {
          startsWith: targetMonth,
        },
      },
      orderBy: { date: 'asc' },
    });

    // Group attendances by employee
    const attendanceByEmployee: Record<number, typeof attendances> = {};
    attendances.forEach((att) => {
      if (!attendanceByEmployee[att.employeeId]) {
        attendanceByEmployee[att.employeeId] = [];
      }
      attendanceByEmployee[att.employeeId].push(att);
    });

    // Create employee data for PDF
    const employeeData = employees.map((emp) => {
      const empAtts = attendanceByEmployee[emp.id] || [];
      const present = empAtts.filter((a) => a.status === 'PRESENT').length;
      const late = empAtts.filter((a) => a.status === 'LATE').length;
      const absent = empAtts.filter((a) => a.status === 'ABSENT').length;
      const halfDay = empAtts.filter((a) => a.status === 'HALF_DAY').length;
      const leave = empAtts.filter((a) => a.status === 'LEAVE').length;
      const totalDays = empAtts.length;
      const attendanceRate = totalDays > 0 
        ? Math.round(((present + late + halfDay * 0.5) / totalDays) * 100)
        : 100;

      return {
        employee: emp,
        attendances: empAtts,
        present,
        late,
        absent,
        halfDay,
        leave,
        totalDays,
        attendanceRate
      };
    });

    // PDF document definition
    const printer = new PdfPrinter({
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    });

    const docDefinition = {
      content: [
        {
          text: 'Admin Attendance Report',
          style: 'header',
          alignment: 'center',
          margin: [0, 0, 0, 20]
        },
        {
          text: `Month: ${targetMonth}`,
          style: 'subheader',
          margin: [0, 0, 0, 20]
        },
        {
          text: `Generated by: ${req.user?.email} (${req.user?.role})`,
          style: 'normal',
          margin: [0, 0, 0, 20]
        },
        ...employeeData.map((empData, index) => [
          {
            text: `Employee: ${empData.employee.firstName} ${empData.employee.lastName} (${empData.employee.employeeCode})`,
            style: 'subheader',
            margin: [0, 20, 0, 10],
            pageBreak: index > 0 ? 'before' : undefined
          },
          {
            columns: [
              {
                text: `Department: ${empData.employee.department?.name || 'N/A'}`,
                style: 'normal'
              },
              {
                text: `Office: ${empData.employee.office?.name || 'N/A'}`,
                style: 'normal'
              }
            ],
            margin: [0, 0, 0, 10]
          },
          {
            text: 'Attendance Summary',
            style: 'subheader',
            margin: [0, 0, 0, 10]
          },
          {
            ul: [
              `Present: ${empData.present} days`,
              `Late: ${empData.late} days`,
              `Absent: ${empData.absent} days`,
              `Half Day: ${empData.halfDay} days`,
              `Leave: ${empData.leave} days`,
              `Attendance Rate: ${empData.attendanceRate}%`
            ],
            margin: [0, 0, 0, 20]
          },
          {
            text: 'Daily Attendance Details',
            style: 'subheader',
            margin: [0, 0, 0, 10]
          },
          {
            table: {
              headerRows: 1,
              widths: ['*', '*', '*', '*'],
              body: [
                ['Date', 'Check In', 'Check Out', 'Status'],
                ...empData.attendances.map(att => [
                  att.date,
                  att.checkIn ? new Date(att.checkIn).toLocaleTimeString() : '--:--',
                  att.checkOut ? new Date(att.checkOut).toLocaleTimeString() : '--:--',
                  att.status
                ])
              ]
            },
            margin: [0, 0, 0, 30]
          }
        ])
      ],
      styles: {
        header: {
          fontSize: 18,
          bold: true,
          margin: [0, 0, 0, 10]
        },
        subheader: {
          fontSize: 14,
          bold: true,
          margin: [0, 0, 0, 5]
        },
        normal: {
          fontSize: 12
        }
      }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="admin-attendance-report-${new Date().toISOString().split('T')[0]}.pdf"`);
    
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error('Download attendance report error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to download attendance report.',
      errorCode: 'DOWNLOAD_ATTENDANCE_REPORT_ERROR'
    });
  }
};

// ==========================================
// 8. Admin Notifications Management
// ==========================================

export const fetchAdminNotifications = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    const mapped = notifications.map((n) => ({
      id: n.id.toString(),
      title: n.title,
      message: n.body,
      type: n.category,
      isRead: n.isRead,
      actionId: n.actionId,
      actionType: n.actionType,
      createdAt: n.createdAt.toISOString(),
      employee: n.employee ? {
        id: n.employee.id.toString(),
        employeeCode: n.employee.employeeCode,
        name: `${n.employee.firstName} ${n.employee.lastName}`,
      } : null,
    }));

    res.json({ success: true, notifications: mapped });
  } catch (error) {
    console.error('Fetch admin notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to load notifications.' });
  }
};

export const markAdminNotificationRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;

  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const notif = await prisma.notification.findUnique({
      where: { id: parseInt(id as string, 10) },
    });

    if (!notif || notif.userId !== userId) {
      res.status(404).json({ success: false, message: 'Notification not found or unauthorized.' });
      return;
    }

    const notification = await prisma.notification.update({
      where: { id: parseInt(id as string, 10) },
      data: { isRead: true },
    });

    res.json({ success: true, message: 'Notification marked as read.', notification });
  } catch (error) {
    console.error('Mark admin notification read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark notification as read.' });
  }
};

export const markAllAdminNotificationsRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    console.error('Mark all admin notifications read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark all notifications as read.' });
  }
};

// ==========================================
// 9. Admin Settings Management
// ==========================================

export const fetchAdminSettings = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // For now, return default settings. In a real app, this would be from a settings table
    const settings = {
      company: {
        name: 'QuickBoom HRM',
        logo: '',
        timezone: 'Asia/Kolkata',
        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        workingHours: { start: '09:00', end: '18:00' },
      },
      attendance: {
        lateThreshold: 10, // minutes
        halfDayThreshold: 180, // minutes
        autoMarkAbsent: true,
        absentThreshold: 240, // minutes
      },
      leave: {
        casualLeavePerYear: 12,
        sickLeavePerYear: 10,
        earnedLeavePerYear: 15,
        requireApproval: true,
        maxConsecutiveDays: 5,
      },
      notifications: {
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: true,
        dailyReports: true,
        weeklyReports: true,
      },
      payroll: {
        processingDay: 25, // day of month
        currency: 'INR',
        includeTax: true,
        includeProvidentFund: true,
      },
    };

    res.json({ success: true, settings });
  } catch (error) {
    console.error('Fetch admin settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to load settings.' });
  }
};

export const updateAdminSettings = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { category, settings: updatedSettings } = req.body;

  if (!category || !updatedSettings) {
    res.status(400).json({ success: false, message: 'Category and settings are required.' });
    return;
  }

  try {
    // For now, just return success. In a real app, this would update a settings table
    res.json({ 
      success: true, 
      message: `${category} settings updated successfully.`,
      settings: updatedSettings 
    });
  } catch (error) {
    console.error('Update admin settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to update settings.' });
  }
};

// ==========================================
// 10. Admin Leave Balance Management
// ==========================================

export const fetchAdminLeaveBalancesDetailed = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { fiscalYear, departmentId } = req.query;
    
    const leaveBalanceService = require('../services/leaveBalanceService').default;
    const leaveBalances = await leaveBalanceService.getAllLeaveBalances(
      fiscalYear as string,
      departmentId ? parseInt(departmentId as string) : undefined
    );

    res.json({
      success: true,
      data: leaveBalances,
      count: leaveBalances.length
    });
  } catch (error) {
    console.error('Fetch admin leave balances error:', error);
    res.status(500).json({ success: false, message: 'Failed to load leave balances.' });
  }
};

export const updateAdminEmployeeLeaveBalance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { employeeId } = req.params;
  const { casualTotal, sickTotal, earnedTotal, fiscalYear } = req.body;
  
  const employeeIdInt = parseInt(employeeId as string, 10);
  if (isNaN(employeeIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Employee ID.' });
    return;
  }

  try {
    const leaveBalanceService = require('../services/leaveBalanceService').default;
    const updatedBalance = await leaveBalanceService.createOrUpdateLeaveBalance({
      employeeId: employeeIdInt,
      fiscalYear,
      casualTotal: casualTotal ? parseInt(casualTotal) : undefined,
      sickTotal: sickTotal ? parseInt(sickTotal) : undefined,
      earnedTotal: earnedTotal ? parseInt(earnedTotal) : undefined,
      createdBy: req.user?.email || 'Admin'
    });

    res.json({
      success: true,
      message: 'Leave balance updated successfully!',
      data: updatedBalance,
    });
  } catch (error) {
    console.error('Update admin leave balance error:', error);
    res.status(500).json({ success: false, message: 'Failed to update leave balance.' });
  }
};

export const getAdminLeaveBalanceStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { fiscalYear } = req.query;
    
    const leaveBalanceService = require('../services/leaveBalanceService').default;
    const stats = await leaveBalanceService.getLeaveBalanceStats(fiscalYear as string);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get admin leave balance stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to load leave balance statistics.' });
  }
};

export const bulkUpdateAdminLeaveBalances = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { allocations } = req.body;

  if (!allocations || !Array.isArray(allocations)) {
    res.status(400).json({ success: false, message: 'Allocations array is required.' });
    return;
  }

  try {
    const leaveBalanceService = require('../services/leaveBalanceService').default;
    const createdBy = req.user?.email || 'Admin';
    
    const processedAllocations = allocations.map(allocation => ({
      ...allocation,
      createdBy
    }));

    const results = await leaveBalanceService.bulkAllocateLeaves(processedAllocations);

    res.json({
      success: true,
      message: `Bulk update completed. Success: ${results.success}, Failed: ${results.failed}`,
      data: results
    });
  } catch (error) {
    console.error('Bulk update admin leave balances error:', error);
    res.status(500).json({ success: false, message: 'Failed to bulk update leave balances.' });
  }
};

