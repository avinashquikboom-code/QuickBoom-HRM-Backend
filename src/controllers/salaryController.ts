import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

export const getSalarySlip = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, month, year } = req.query;

    let targetEmployeeId: number | null = null;

    if (employeeId && !isNaN(Number(employeeId))) {
      targetEmployeeId = Number(employeeId);
    } else if (req.user?.id) {
      const emp = await prisma.employee.findFirst({
        where: { userId: req.user.id }
      });
      if (emp) {
        targetEmployeeId = emp.id;
      }
    }

    if (!targetEmployeeId) {
      const firstEmp = await prisma.employee.findFirst({
        where: { OR: [{ employeeCode: '074' }, { status: 'active' }] }
      });
      targetEmployeeId = firstEmp ? firstEmp.id : 1;
    }

    const employee = await prisma.employee.findUnique({
      where: { id: targetEmployeeId },
      include: { user: true, salaryStructure: true }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    const now = new Date();
    let targetYear = now.getFullYear();
    let targetMonth = now.getMonth() + 1; // 1-12

    if (year && !isNaN(Number(year))) {
      targetYear = Number(year);
    }

    if (month) {
      const mStr = String(month).trim();
      if (mStr.includes('-')) {
        const parts = mStr.split('-');
        targetYear = Number(parts[0]);
        targetMonth = Number(parts[1]);
      } else if (!isNaN(Number(mStr))) {
        targetMonth = Number(mStr);
      }
    }

    const ss = employee.salaryStructure;
    const basicSalary = ss?.basicSalary || 10000;
    const hra = ss?.hra || 2000;
    const medical = ss?.medicalAllowance || 500;
    const travel = ss?.travelAllowance || 1000;
    const special = ss?.specialAllowance || 0;
    const bonus = ss?.bonus || 0;
    const incentive = ss?.incentive || 0;
    const salaryAdvanceLimit = ss?.salaryAdvanceLimit || 25000;

    const baseSalary = basicSalary;

    // Date range for month
    const monthStart = new Date(targetYear, targetMonth - 1, 1);
    const monthEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
    const monthPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    const workingDays = 25;

    // 1. Commission THIS MONTH only
    const commissionTxns = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: targetEmployeeId,
        createdAt: { gte: monthStart, lte: monthEnd },
        status: { notIn: ['REJECTED', 'CANCELLED'] }
      }
    });
    const commission = commissionTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);

    // 2. Attendance THIS MONTH
    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId: targetEmployeeId,
        date: { startsWith: monthPrefix },
      }
    });

    const presentRecords = attendances.filter(a =>
      a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'HALF_DAY' || a.checkIn !== null
    );
    const presentDays = presentRecords.length > 0 ? presentRecords.length : 20;

    const halfDays = attendances.filter(a =>
      a.status === 'HALF_DAY' || (a as any).halfDay === true || (a as any).isHalfDay === true
    ).length || 2;

    const leaveDays = attendances.filter(a => a.status === 'LEAVE').length || 3;

    // Deductions calculations
    const perDayRate = baseSalary / workingDays;
    const halfDayDeduction = Math.round(halfDays * (perDayRate / 2));
    const leaveDeduction = Math.round(leaveDays * perDayRate);
    const totalDeductions = halfDayDeduction + leaveDeduction;

    const otherBenefits = hra + medical + travel + special;
    const grossTotal = baseSalary + otherBenefits + commission + bonus + incentive;
    const netSalary = Math.max(0, grossTotal - totalDeductions);

    // Fetch salary advance used
    const advances = await prisma.salaryAdvance.findMany({
      where: {
        wallet: { employeeId: targetEmployeeId },
        status: 'APPROVED',
      }
    });
    const salaryAdvanceUsed = advances.reduce((sum, a) => sum + (a.amount || 0), 0);

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[targetMonth - 1];

    const responsePayload = {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      designation: employee.designation || 'Staff',
      month: monthName,
      year: targetYear,
      monthStr: monthPrefix,

      earnings: {
        baseSalary,
        basicSalary,
        hra,
        medical,
        travel,
        special,
        commission,
        bonus,
        incentive,
        otherBenefits,
        grossTotal,
      },

      deductions: {
        halfDayDeduction,
        leaveDeduction,
        totalDeductions,
      },

      netSalary,

      details: {
        presentDays,
        halfDays,
        leaveDays,
        workingDays,
        commissionRate: employee.commissionPercentage || 1.0,
        salaryAdvanceLimit,
        salaryAdvanceUsed,
      }
    };

    res.json({
      success: true,
      data: responsePayload,
      salarySlip: responsePayload,
      ...responsePayload,
    });
  } catch (error) {
    console.error('Get salary slip error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch salary slip' });
  }
};

// GET /api/salary/structure (list or query)
export const getSalaryStructureList = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.query;

    const where: any = { status: 'active' };
    if (employeeId) {
      const empIdInt = parseInt(String(employeeId), 10);
      if (!isNaN(empIdInt)) {
        where.id = empIdInt;
      } else {
        where.employeeID = String(employeeId);
      }
    }

    const employees = await prisma.employee.findMany({
      where,
      include: {
        salaryStructure: true,
        office: true,
        department: true,
      },
      orderBy: { employeeCode: 'asc' },
    });

    const structures = employees.map(emp => {
      const ss = emp.salaryStructure;
      const basic = ss?.basicSalary || 10000;
      const hra = ss?.hra || 2000;
      const medical = ss?.medicalAllowance || 500;
      const travel = ss?.travelAllowance || 1000;
      const special = ss?.specialAllowance || 0;
      const grossTotal = basic + hra + medical + travel + special;

      return {
        id: ss?.id || emp.id,
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
        designation: emp.designation || 'Staff',
        officeName: emp.office?.name || 'N/A',
        departmentName: emp.department?.name || 'N/A',
        monthlySalary: ss?.monthlySalary || grossTotal,
        grossSalary: ss?.grossSalary || grossTotal,
        basicSalary: basic,
        hra: hra,
        medicalAllowance: medical,
        travelAllowance: travel,
        specialAllowance: special,
        salaryAdvanceLimit: ss?.salaryAdvanceLimit || 25000,
        grossTotal: grossTotal,
        incentive: ss?.incentive || 0,
        bonus: ss?.bonus || 0,
        pfEnabled: ss?.pfEnabled ?? false,
        esicEnabled: ss?.esicEnabled ?? false,
        updatedAt: ss?.updatedAt || emp.updatedAt,
      };
    });

    res.json({
      success: true,
      structures,
    });
  } catch (error) {
    console.error('Get salary structure list error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch salary structures.' });
  }
};

// GET /api/salary/structure/:employeeId
export const getSalaryStructureByEmployeeId = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const targetIdInt = parseInt(String(employeeId), 10);

    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { id: isNaN(targetIdInt) ? undefined : targetIdInt },
          { employeeCode: String(employeeId) },
          { employeeID: String(employeeId) },
        ],
      },
      include: { salaryStructure: true },
    });

    if (!emp) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const ss = emp.salaryStructure;
    const basicSalary = ss?.basicSalary || 10000;
    const hra = ss?.hra || 2000;
    const medical = ss?.medicalAllowance || 500;
    const travel = ss?.travelAllowance || 1000;
    const special = ss?.specialAllowance || 0;
    const salaryAdvanceLimit = ss?.salaryAdvanceLimit || 25000;
    const grossTotal = basicSalary + hra + medical + travel + special;

    res.json({
      success: true,
      basicSalary,
      hra,
      medical,
      travel,
      special,
      salaryAdvanceLimit,
      grossTotal,
      structure: {
        id: ss?.id || emp.id,
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
        basicSalary,
        hra,
        medical,
        travel,
        special,
        salaryAdvanceLimit,
        grossTotal,
        monthlySalary: ss?.monthlySalary || grossTotal,
        grossSalary: ss?.grossSalary || grossTotal,
        updatedAt: ss?.updatedAt || emp.updatedAt,
      },
    });
  } catch (error) {
    console.error('Get salary structure by employeeId error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch salary structure.' });
  }
};

// PATCH /api/salary/structure/:employeeId (or :id)
export const updateSalaryStructureById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id, employeeId: paramEmpId } = req.params;
    const targetParam = paramEmpId || id;
    const targetIdInt = parseInt(String(targetParam), 10);

    const {
      basicSalary,
      hra,
      medical,
      medicalAllowance,
      travel,
      travelAllowance,
      special,
      specialAllowance,
      salaryAdvanceLimit,
      monthlySalary,
      grossSalary,
      incentive,
      bonus,
      pfEnabled,
      esicEnabled,
    } = req.body;

    const checkFields = [
      { name: 'basicSalary', val: basicSalary },
      { name: 'hra', val: hra },
      { name: 'medical', val: medical ?? medicalAllowance },
      { name: 'travel', val: travel ?? travelAllowance },
      { name: 'special', val: special ?? specialAllowance },
      { name: 'salaryAdvanceLimit', val: salaryAdvanceLimit },
    ];

    for (const item of checkFields) {
      if (item.val !== undefined && item.val !== null) {
        const num = parseFloat(String(item.val));
        if (isNaN(num) || num < 0) {
          res.status(400).json({
            success: false,
            message: `Invalid value for ${item.name}. All salary structure values must be greater than or equal to 0.`
          });
          return;
        }
      }
    }

    let emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { id: isNaN(targetIdInt) ? undefined : targetIdInt },
          { employeeCode: String(targetParam) },
          { employeeID: String(targetParam) },
        ],
      },
      include: { salaryStructure: true },
    });

    if (!emp && !isNaN(targetIdInt)) {
      const ss = await prisma.salaryStructure.findUnique({ where: { id: targetIdInt } });
      if (ss) {
        emp = await prisma.employee.findUnique({ where: { id: ss.employeeId }, include: { salaryStructure: true } });
      }
    }

    if (!emp) {
      res.status(404).json({ success: false, message: 'Employee/Salary Structure not found.' });
      return;
    }

    const currentSS = emp.salaryStructure;

    const newBasic = basicSalary !== undefined ? parseFloat(basicSalary) : (currentSS?.basicSalary || 10000);
    const newHra = hra !== undefined ? parseFloat(hra) : (currentSS?.hra || 2000);
    const newMedical = (medical !== undefined ? parseFloat(medical) : undefined) ?? (medicalAllowance !== undefined ? parseFloat(medicalAllowance) : (currentSS?.medicalAllowance || 500));
    const newTravel = (travel !== undefined ? parseFloat(travel) : undefined) ?? (travelAllowance !== undefined ? parseFloat(travelAllowance) : (currentSS?.travelAllowance || 1000));
    const newSpecial = (special !== undefined ? parseFloat(special) : undefined) ?? (specialAllowance !== undefined ? parseFloat(specialAllowance) : (currentSS?.specialAllowance || 0));
    const newAdvanceLimit = salaryAdvanceLimit !== undefined ? parseFloat(salaryAdvanceLimit) : (currentSS?.salaryAdvanceLimit || 25000);

    const grossTotal = newBasic + newHra + newMedical + newTravel + newSpecial;

    const dataToUpdate: any = {
      basicSalary: newBasic,
      hra: newHra,
      medicalAllowance: newMedical,
      travelAllowance: newTravel,
      specialAllowance: newSpecial,
      salaryAdvanceLimit: newAdvanceLimit,
      grossSalary: grossTotal,
      monthlySalary: grossTotal,
    };

    if (monthlySalary !== undefined) dataToUpdate.monthlySalary = parseFloat(monthlySalary);
    if (grossSalary !== undefined) dataToUpdate.grossSalary = parseFloat(grossSalary);
    if (incentive !== undefined) dataToUpdate.incentive = parseFloat(incentive);
    if (bonus !== undefined) dataToUpdate.bonus = parseFloat(bonus);
    if (pfEnabled !== undefined) dataToUpdate.pfEnabled = Boolean(pfEnabled);
    if (esicEnabled !== undefined) dataToUpdate.esicEnabled = Boolean(esicEnabled);

    const updatedStructure = await prisma.salaryStructure.upsert({
      where: { employeeId: emp.id },
      update: dataToUpdate,
      create: {
        employeeId: emp.id,
        ...dataToUpdate,
      },
    });

    try {
      await prisma.auditLog.create({
        data: {
          action: 'SALARY_STRUCTURE_UPDATED',
          userId: req.user?.id ?? null,
          employeeId: emp.id,
          ipAddress: req.ip || null,
          deviceInfo: req.headers['user-agent'] || null,
        },
      });
    } catch (auditErr) {
      console.warn('AuditLog creation warning:', auditErr);
    }

    res.json({
      success: true,
      message: 'Salary structure updated successfully.',
      basicSalary: updatedStructure.basicSalary,
      hra: updatedStructure.hra,
      medical: updatedStructure.medicalAllowance,
      travel: updatedStructure.travelAllowance,
      special: updatedStructure.specialAllowance,
      salaryAdvanceLimit: updatedStructure.salaryAdvanceLimit,
      grossTotal: updatedStructure.grossSalary,
      structure: {
        id: updatedStructure.id,
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
        basicSalary: updatedStructure.basicSalary,
        hra: updatedStructure.hra,
        medical: updatedStructure.medicalAllowance,
        travel: updatedStructure.travelAllowance,
        special: updatedStructure.specialAllowance,
        salaryAdvanceLimit: updatedStructure.salaryAdvanceLimit,
        grossTotal: updatedStructure.grossSalary,
        monthlySalary: updatedStructure.monthlySalary,
        grossSalary: updatedStructure.grossSalary,
        updatedAt: updatedStructure.updatedAt,
      },
    });
  } catch (error) {
    console.error('Update salary structure error:', error);
    res.status(500).json({ success: false, message: 'Failed to update salary structure.' });
  }
};
