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

    // Base / Registered gross salary from salaryStructure
    const baseSalary = employee.salaryStructure?.grossSalary ||
      employee.salaryStructure?.monthlySalary ||
      employee.salaryStructure?.basicSalary ||
      10000;

    const bonus = employee.salaryStructure?.bonus || 0;
    const incentive = employee.salaryStructure?.incentive || 0;

    // Month date range
    const monthStart = new Date(targetYear, targetMonth - 1, 1);
    const monthEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
    const monthPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    const totalWorkingDays = 26;

    // 1. Commission Amount THIS MONTH ONLY
    const commissionTxns = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: targetEmployeeId,
        createdAt: { gte: monthStart, lte: monthEnd },
        status: { notIn: ['REJECTED', 'CANCELLED'] }
      }
    });
    const commissionAmount = commissionTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);

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
    const presentDays = presentRecords.length;

    const halfDays = attendances.filter(a =>
      a.status === 'HALF_DAY' || (a as any).halfDay === true || (a as any).isHalfDay === true
    ).length;

    // 3. Leave deductions THIS MONTH
    const leaveRequests = await prisma.leaveRequest.findMany({
      where: {
        employeeId: targetEmployeeId,
        status: { notIn: ['APPROVED', 'CANCELLED'] },
        fromDate: { gte: monthStart },
        toDate: { lte: monthEnd }
      }
    });
    const leaveDays = leaveRequests.length;

    const dailyRate = baseSalary / totalWorkingDays;
    const grossRatio = Math.min(1.0, presentDays / totalWorkingDays);
    const calculatedGross = Math.round((grossRatio * baseSalary) + commissionAmount + bonus + incentive);

    const halfDayDeduction = halfDays * (dailyRate / 2);
    const leaveDeduction = leaveDays * dailyRate;
    const totalDeductions = Math.round(halfDayDeduction + leaveDeduction);

    const calculatedNet = Math.max(0, calculatedGross - totalDeductions);

    const displayGross = calculatedGross > 0 ? calculatedGross : baseSalary + bonus + incentive;
    const displayNet = calculatedNet > 0 ? calculatedNet : Math.max(0, displayGross - totalDeductions);

    const employeeName = `${employee.firstName} ${employee.lastName}`.trim();

    res.json({
      success: true,
      data: {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        name: employeeName,
        base_salary: baseSalary,
        present_days: presentDays,
        half_days: halfDays,
        leave_days: leaveDays,
        commission_amount: commissionAmount,
        bonus: bonus,
        incentive: incentive,
        gross: displayGross,
        deductions: totalDeductions,
        net: displayNet,
        grossSalary: displayGross,
        netSalary: displayNet,
        registeredSalary: baseSalary,
        month: targetMonth,
        year: targetYear,
      }
    });
  } catch (error) {
    console.error('Get salary slip error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate salary slip.' });
  }
};

// GET /api/salary/structure?employeeId=
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
      return {
        id: ss?.id || emp.id,
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
        designation: emp.designation || 'Staff',
        officeName: emp.office?.name || 'N/A',
        departmentName: emp.department?.name || 'N/A',
        monthlySalary: ss?.monthlySalary || 0,
        grossSalary: ss?.grossSalary || 0,
        basicSalary: ss?.basicSalary || 0,
        hra: ss?.hra || 0,
        medicalAllowance: ss?.medicalAllowance || 0,
        travelAllowance: ss?.travelAllowance || 0,
        specialAllowance: ss?.specialAllowance || 0,
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

// PATCH /api/salary/structure/:id
export const updateSalaryStructureById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      monthlySalary,
      grossSalary,
      basicSalary,
      hra,
      medicalAllowance,
      travelAllowance,
      specialAllowance,
      incentive,
      bonus,
      pfEnabled,
      esicEnabled,
    } = req.body;

    const targetIdInt = parseInt(String(id), 10);

    // Try finding by SalaryStructure.id or Employee.id
    let salaryStruct = await prisma.salaryStructure.findFirst({
      where: {
        OR: [
          { id: isNaN(targetIdInt) ? undefined : targetIdInt },
          { employeeId: isNaN(targetIdInt) ? undefined : targetIdInt },
        ],
      },
    });

    let employeeId = salaryStruct?.employeeId;

    if (!employeeId && !isNaN(targetIdInt)) {
      const emp = await prisma.employee.findUnique({ where: { id: targetIdInt } });
      if (emp) employeeId = emp.id;
    }

    if (!employeeId) {
      res.status(404).json({ success: false, message: 'Employee/Salary Structure not found.' });
      return;
    }

    const dataToUpdate: any = {};
    if (monthlySalary !== undefined) dataToUpdate.monthlySalary = parseFloat(monthlySalary);
    if (grossSalary !== undefined) dataToUpdate.grossSalary = parseFloat(grossSalary);
    if (basicSalary !== undefined) dataToUpdate.basicSalary = parseFloat(basicSalary);
    if (hra !== undefined) dataToUpdate.hra = parseFloat(hra);
    if (medicalAllowance !== undefined) dataToUpdate.medicalAllowance = parseFloat(medicalAllowance);
    if (travelAllowance !== undefined) dataToUpdate.travelAllowance = parseFloat(travelAllowance);
    if (specialAllowance !== undefined) dataToUpdate.specialAllowance = parseFloat(specialAllowance);
    if (incentive !== undefined) dataToUpdate.incentive = parseFloat(incentive);
    if (bonus !== undefined) dataToUpdate.bonus = parseFloat(bonus);
    if (pfEnabled !== undefined) dataToUpdate.pfEnabled = Boolean(pfEnabled);
    if (esicEnabled !== undefined) dataToUpdate.esicEnabled = Boolean(esicEnabled);

    const updatedStructure = await prisma.salaryStructure.upsert({
      where: { employeeId },
      update: dataToUpdate,
      create: {
        employeeId,
        monthlySalary: dataToUpdate.monthlySalary || 0,
        grossSalary: dataToUpdate.grossSalary || 0,
        basicSalary: dataToUpdate.basicSalary || 0,
        hra: dataToUpdate.hra || 0,
        medicalAllowance: dataToUpdate.medicalAllowance || 0,
        travelAllowance: dataToUpdate.travelAllowance || 0,
        specialAllowance: dataToUpdate.specialAllowance || 0,
        incentive: dataToUpdate.incentive || 0,
        bonus: dataToUpdate.bonus || 0,
        pfEnabled: dataToUpdate.pfEnabled || false,
        esicEnabled: dataToUpdate.esicEnabled || false,
      },
    });

    res.json({
      success: true,
      message: 'Salary structure updated successfully.',
      structure: updatedStructure,
    });
  } catch (error) {
    console.error('Update salary structure error:', error);
    res.status(500).json({ success: false, message: 'Failed to update salary structure.' });
  }
};
