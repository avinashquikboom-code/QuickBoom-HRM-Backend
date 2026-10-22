import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { getEffectiveUserPermissions, DEFAULT_EMPLOYEE_PERMISSIONS } from '../utils/permissionHelper';
import payrollService from '../services/payrollService';
import { computeGrossSalary, mapStructureGrossFields } from '../utils/salaryGross';

export const getSalarySlip = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, month, year } = req.query;

    if (!req.user?.id) {
      res.status(401).json({ success: false, message: 'Unauthorized' }); return;
    }
    if ((employeeId !== undefined && (typeof employeeId !== 'string' || !/^[1-9]\d*$/.test(employeeId))) ||
        (month !== undefined && (typeof month !== 'string' || !/^(?:\d{1,2}|\d{4}-\d{1,2})$/.test(month))) ||
        (year !== undefined && (typeof year !== 'string' || !/^\d{4}$/.test(year)))) {
      res.status(400).json({ success: false, message: 'Invalid employee or payroll period.' }); return;
    }
    const ownEmployee = await prisma.employee.findFirst({ where: { userId: req.user.id } });
    const targetEmployeeId = employeeId ? Number(employeeId) : ownEmployee?.id;
    if (!targetEmployeeId) {
      res.status(404).json({ success: false, message: 'Employee profile not found' }); return;
    }
    if (!Number.isSafeInteger(targetEmployeeId) || targetEmployeeId > 2147483647) {
      res.status(400).json({ success: false, message: 'Invalid employee ID.' }); return;
    }
    const isPayrollReviewer = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN', 'STORE_MANAGER'].includes(req.user.role);
    if (!isPayrollReviewer && targetEmployeeId !== ownEmployee?.id) {
      res.status(403).json({ success: false, message: 'You may only view your own salary slip.' }); return;
    }

    const employee = await prisma.employee.findUnique({
      where: { id: targetEmployeeId },
      include: { user: true, salaryStructure: true, office: true, department: true }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    const ss = employee.salaryStructure;

    // Fetch permissions
    const perms = employee.userId ? await getEffectiveUserPermissions(employee.userId) : DEFAULT_EMPLOYEE_PERMISSIONS;

    // Check canViewSalary for employee requests (allow viewing own wallet/slip)
    if (req.user && req.user.role === 'EMPLOYEE' && employee.userId !== req.user.id && perms.canViewSalary === false) {
      res.status(403).json({ success: false, message: 'Access denied: Salary slip viewing disabled by HR.' });
      return;
    }

    const now = new Date();
    const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istTime);
    let targetYear = istDate.getUTCFullYear();
    let targetMonth = istDate.getUTCMonth() + 1; // 1-12

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

    if (!Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12 ||
        !Number.isInteger(targetYear) || targetYear < 1900 || targetYear > 9999) {
      res.status(400).json({ success: false, message: 'Invalid payroll period.' }); return;
    }

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[targetMonth - 1];
    const monthPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

    let dbPayslip = await prisma.payslip.findFirst({
      where: {
        employeeId: targetEmployeeId,
        month: targetMonth,
        year: targetYear,
      },
    });

    const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
    const slipSource = dbPayslip ?? {
      employeeId: targetEmployeeId,
      month: targetMonth,
      year: targetYear,
      status: 'PENDING',
      employeeCode: employee.employeeCode,
      employeeName,
      designation: employee.designation || 'Staff',
      department: employee.department?.name || 'General',
      officeName: employee.office?.name || 'Main Office',
      baseSalary: 0,
      allowance: 0,
      deductions: 0,
      netSalary: 0,
    };

    const view = await payrollService.resolveFullPayslipView(slipSource, employee);

    const salaryAdvanceLimit = ss?.salaryAdvanceLimit !== undefined && ss?.salaryAdvanceLimit !== null
      ? ss.salaryAdvanceLimit
      : 0;

    const activeAdvances = await prisma.salaryAdvance.findMany({
      where: {
        wallet: { employeeId: targetEmployeeId },
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });
    const pendingAdvance = activeAdvances
      .filter((a) => a.status === 'PENDING')
      .reduce((sum, a) => sum + (a.amount || 0), 0);
    const approvedAdvanceRemaining = activeAdvances
      .filter((a) => a.status === 'APPROVED')
      .reduce((sum, a) => sum + (a.remainingAmount > 0 ? a.remainingAmount : 0), 0);
    const salaryAdvanceUsed = pendingAdvance + approvedAdvanceRemaining;
    const salaryAdvanceRemaining = Math.max(0, salaryAdvanceLimit - salaryAdvanceUsed);

    const responsePayload = {
      ...view,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName,
      designation: employee.designation || view.designation || 'Staff',
      officeName: employee.office?.name || view.officeName || 'Main Office',
      departmentName: employee.department?.name || view.department || 'General',
      department: employee.department?.name || view.department || 'General',
      month: monthName,
      year: targetYear,
      monthStr: monthPrefix,
      payPeriod: view.payPeriod || `${monthName} ${targetYear}`,
      details: {
        presentDays: view.presentDays,
        absentDays: view.absentDays,
        halfDays: view.halfDays,
        paidLeaveDays: view.paidLeaveDays,
        unpaidLeaveDays: view.unpaidLeaveDays,
        holidayCount: view.holidayCount,
        weeklyOffCount: view.weeklyOffCount,
        holidayWorkedCount: view.holidayWorkedCount,
        weeklyOffWorkedCount: view.weeklyOffWorkedCount,
        workingDays: view.workingDays,
        totalCalendarDays: view.totalCalendarDays,
        dailySalary: view.dailySalary,
        commissionRate: employee.commissionPercentage ?? 0,
        salaryAdvanceLimit,
        salaryAdvanceUsed,
        salaryAdvanceRemaining,
        advanceDeduction: view.advanceDeduction,
      },
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
      const mapped = mapStructureGrossFields(ss ?? {});

      return {
        id: ss?.id || emp.id,
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
        designation: emp.designation || 'Staff',
        officeName: emp.office?.name || 'N/A',
        departmentName: emp.department?.name || 'N/A',
        ...mapped,
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

// GET /api/salary/structure/me or /api/mobile/salary/structure (own salary structure)
export const getMySalaryStructure = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ success: false, message: 'Authentication required.' });
      return;
    }

    const emp = await prisma.employee.findFirst({
      where: { userId: user.id },
      include: { salaryStructure: true }
    });

    if (!emp) {
      res.status(404).json({ success: false, message: 'Employee record not found.' });
      return;
    }

    let ss = emp.salaryStructure;
    if (!ss) {
      ss = await prisma.salaryStructure.upsert({
        where: { employeeId: emp.id },
        update: {},
        create: {
          employeeId: emp.id,
          basicSalary: 10000,
          hra: 2000,
          medicalAllowance: 500,
          travelAllowance: 1000,
          specialAllowance: 0,
          monthlySalary: 13500,
          grossSalary: 13500,
          salaryAdvanceLimit: 0,
        }
      });
    }

    const mapped = mapStructureGrossFields(ss);
    const payload = {
      id: ss.id,
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
      ...mapped,
      medical: mapped.medicalAllowance,
      travel: mapped.travelAllowance,
      special: mapped.specialAllowance,
      pfEnabled: ss.pfEnabled,
      employeePfRate: ss.employeePfRate,
      employerPfRate: ss.employerPfRate,
      esicEnabled: ss.esicEnabled,
      employeeEsicRate: ss.employeeEsicRate,
      employerEsicRate: ss.employerEsicRate,
      updatedAt: ss.updatedAt,
    };

    res.json({
      success: true,
      data: payload,
      basicSalary: mapped.basicSalary,
      hra: mapped.hra,
      medical: mapped.medicalAllowance,
      travel: mapped.travelAllowance,
      special: mapped.specialAllowance,
      incentive: mapped.incentive,
      bonus: mapped.bonus,
      salaryAdvanceLimit: mapped.salaryAdvanceLimit,
      grossTotal: mapped.grossTotal,
      structure: payload,
    });
  } catch (error) {
    console.error('Get my salary structure error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch salary structure.' });
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

    let ss = emp.salaryStructure;
    if (!ss) {
      ss = await prisma.salaryStructure.upsert({
        where: { employeeId: emp.id },
        update: {},
        create: {
          employeeId: emp.id,
          basicSalary: 10000,
          hra: 2000,
          medicalAllowance: 500,
          travelAllowance: 1000,
          specialAllowance: 0,
          monthlySalary: 13500,
          grossSalary: 13500,
          salaryAdvanceLimit: 0,
        }
      });
    }

    const mapped = mapStructureGrossFields(ss);
    const payload = {
      id: ss.id,
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
      ...mapped,
      medical: mapped.medicalAllowance,
      travel: mapped.travelAllowance,
      special: mapped.specialAllowance,
      pfEnabled: ss.pfEnabled,
      employeePfRate: ss.employeePfRate,
      employerPfRate: ss.employerPfRate,
      esicEnabled: ss.esicEnabled,
      employeeEsicRate: ss.employeeEsicRate,
      employerEsicRate: ss.employerEsicRate,
      updatedAt: ss.updatedAt,
    };

    res.json({
      success: true,
      data: payload,
      basicSalary: mapped.basicSalary,
      hra: mapped.hra,
      medical: mapped.medicalAllowance,
      travel: mapped.travelAllowance,
      special: mapped.specialAllowance,
      incentive: mapped.incentive,
      bonus: mapped.bonus,
      salaryAdvanceLimit: mapped.salaryAdvanceLimit,
      grossTotal: mapped.grossTotal,
      structure: payload,
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

    // Prioritize exact employeeCode or employeeID before falling back to numeric internal id
    let emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: String(targetParam) },
          { employeeID: String(targetParam) },
        ],
      },
      include: { salaryStructure: true },
    });

    if (!emp && !isNaN(targetIdInt)) {
      emp = await prisma.employee.findUnique({
        where: { id: targetIdInt },
        include: { salaryStructure: true },
      });
    }

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
    console.log(`[SalaryStructure Update] Employee ID: ${emp.id} (${emp.employeeCode})`);
    console.log(`[SalaryStructure Update] Request body:`, req.body);
    console.log(`[SalaryStructure Update] DB values before update:`, currentSS);

    const newBasic = basicSalary !== undefined ? parseFloat(basicSalary) : (currentSS?.basicSalary || 0);
    const newHra = hra !== undefined ? parseFloat(hra) : (currentSS?.hra || 0);
    const newMedical = (medical !== undefined ? parseFloat(medical) : undefined) ?? (medicalAllowance !== undefined ? parseFloat(medicalAllowance) : (currentSS?.medicalAllowance || 0));
    const newTravel = (travel !== undefined ? parseFloat(travel) : undefined) ?? (travelAllowance !== undefined ? parseFloat(travelAllowance) : (currentSS?.travelAllowance || 0));
    const newSpecial = (special !== undefined ? parseFloat(special) : undefined) ?? (specialAllowance !== undefined ? parseFloat(specialAllowance) : (currentSS?.specialAllowance || 0));
    const newIncentive = incentive !== undefined ? parseFloat(incentive) : (currentSS?.incentive || 0);
    const newBonus = bonus !== undefined ? parseFloat(bonus) : (currentSS?.bonus || 0);
    const newAdvanceLimit = salaryAdvanceLimit !== undefined && salaryAdvanceLimit !== null && salaryAdvanceLimit !== ''
      ? (Number.isFinite(parseFloat(salaryAdvanceLimit)) ? parseFloat(salaryAdvanceLimit) : 0)
      : (currentSS?.salaryAdvanceLimit ?? 0);

    const grossTotal = computeGrossSalary({
      basicSalary: newBasic,
      hra: newHra,
      medicalAllowance: newMedical,
      travelAllowance: newTravel,
      specialAllowance: newSpecial,
      incentive: newIncentive,
      bonus: newBonus,
    });

    console.log(`[SalaryStructure Update] Component sum: Basic(${newBasic}) + HRA(${newHra}) + Med(${newMedical}) + Trv(${newTravel}) + Spc(${newSpecial}) + Inc(${newIncentive}) + Bns(${newBonus}) = ₹${grossTotal}`);
    console.log(`[SalaryStructure Update] Calculated Gross Total: ₹${grossTotal}`);

    const dataToUpdate: any = {
      basicSalary: newBasic,
      hra: newHra,
      medicalAllowance: newMedical,
      travelAllowance: newTravel,
      specialAllowance: newSpecial,
      incentive: newIncentive,
      bonus: newBonus,
      salaryAdvanceLimit: newAdvanceLimit,
      grossSalary: grossTotal,
      monthlySalary: grossTotal,
    };

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

    // Synchronize wallet advanceLimit
    try {
      await prisma.wallet.updateMany({
        where: { employeeId: emp.id },
        data: { advanceLimit: newAdvanceLimit },
      });
    } catch (wErr) {
      console.warn('Wallet advanceLimit sync warning:', wErr);
    }

    // Re-calculate and update current month payslip (only if unfinalized/not PAID)
    try {
      const now = new Date();
      const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
      const istDate = new Date(istTime);
      const curMonth = istDate.getUTCMonth() + 1;
      const curYear = istDate.getUTCFullYear();

      const existingSlip = await prisma.payslip.findUnique({
        where: {
          employeeId_month_year: {
            employeeId: emp.id,
            month: curMonth,
            year: curYear
          }
        }
      });
      if (existingSlip && String(existingSlip.status || '').toUpperCase() !== 'PAID') {
        const calc = await payrollService.calculatePayroll(emp.id, curMonth, curYear);
        await payrollService.savePayslip(calc);
        console.log(`[SalaryStructure Update] Re-calculated and updated payslip for emp #${emp.id} for ${curMonth}/${curYear}`);
      }
    } catch (slipSyncErr) {
      console.warn(`[SalaryStructure Update] Failed to sync current month payslip for emp #${emp.id}:`, slipSyncErr);
    }

    console.log(`[SalaryStructure Update] DB values after update:`, updatedStructure);

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
      incentive: updatedStructure.incentive,
      bonus: updatedStructure.bonus,
      grossTotal: updatedStructure.grossSalary,
      structure: {
        id: updatedStructure.id,
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
        ...mapStructureGrossFields(updatedStructure),
        medical: updatedStructure.medicalAllowance,
        travel: updatedStructure.travelAllowance,
        special: updatedStructure.specialAllowance,
        updatedAt: updatedStructure.updatedAt,
      },
    });
  } catch (error) {
    console.error('Update salary structure error:', error);
    res.status(500).json({ success: false, message: 'Failed to update salary structure.' });
  }
};

// GET /api/salary/date-wise
export const getDateWiseSalaryBreakdown = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, month, year } = req.query;

    let targetEmployeeId: number | null = null;
    const isHrOrAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'HR', 'STORE_MANAGER'].includes(req.user?.role || '');

    if (employeeId && isHrOrAdmin && !isNaN(Number(employeeId))) {
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

    const now = new Date();
    const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istTime);
    let targetYear = istDate.getUTCFullYear();
    let targetMonth = istDate.getUTCMonth() + 1;

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

    const { dateWiseSalaryService } = await import('../services/dateWiseSalaryService');
    const result = await dateWiseSalaryService.getDateWiseBreakdown(targetEmployeeId, targetMonth, targetYear);

    res.json({
      success: true,
      data: result,
      summary: result.summary,
      dates: result.dates,
    });
  } catch (error: any) {
    console.error('Get salary date-wise error:', error);
    res.status(500).json({ success: false, message: error?.message || 'Failed to fetch date-wise salary breakdown' });
  }
};

