import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { getEffectiveUserPermissions, DEFAULT_EMPLOYEE_PERMISSIONS } from '../utils/permissionHelper';

import payrollService from '../services/payrollService';

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
      include: { user: true, salaryStructure: true, office: true, department: true }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    // Fetch permissions
    const perms = employee.userId ? await getEffectiveUserPermissions(employee.userId) : DEFAULT_EMPLOYEE_PERMISSIONS;

    // Check canViewSalary for employee requests (allow viewing own wallet/slip)
    if (req.user && req.user.role === 'EMPLOYEE' && employee.userId !== req.user.id && perms.canViewSalary === false) {
      res.status(403).json({ success: false, message: 'Access denied: Salary slip viewing disabled by HR.' });
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

    const isCurrentMonth = (targetYear === now.getFullYear() && targetMonth === (now.getMonth() + 1));

    // Use persistent database Payslip record or calculate via PayrollService
    let dbPayslip = await prisma.payslip.findFirst({
      where: {
        employeeId: targetEmployeeId,
        month: targetMonth,
        year: targetYear
      }
    });

    let calcResult: any = null;
    if (!dbPayslip || isCurrentMonth || dbPayslip.baseSalary === 0 || !dbPayslip.netSalary) {
      calcResult = await payrollService.calculatePayroll(targetEmployeeId, targetMonth, targetYear);
    }

    const ss = employee.salaryStructure;
    const baseSalary = (!isCurrentMonth && dbPayslip?.baseSalary && dbPayslip.baseSalary > 0)
      ? dbPayslip.baseSalary
      : (calcResult?.baseSalary && calcResult.baseSalary > 0)
      ? calcResult.baseSalary
      : (ss?.basicSalary || ss?.monthlySalary || 10000);

    const allowance = (!isCurrentMonth && dbPayslip?.allowance !== undefined)
      ? dbPayslip.allowance
      : (calcResult?.allowance ?? (
          (ss?.hra || 0) + (ss?.medicalAllowance || 0) + (ss?.travelAllowance || 0) + (ss?.specialAllowance || 0)
        ));

    const commissionEarned = (calcResult?.commissionEarned !== undefined)
      ? calcResult.commissionEarned
      : (dbPayslip?.commissionEarned ?? 0);

    const presentDays = (calcResult?.presentDays !== undefined) ? calcResult.presentDays : (dbPayslip?.presentDays ?? 0);
    const absentDays = (calcResult?.absentDays !== undefined) ? calcResult.absentDays : (dbPayslip?.absentDays ?? 0);
    const halfDays = (calcResult?.halfDays !== undefined) ? calcResult.halfDays : (dbPayslip?.halfDays ?? 0);
    const paidLeaveDays = (calcResult?.paidLeaveDays !== undefined) ? calcResult.paidLeaveDays : (dbPayslip?.paidLeaveDays ?? 0);
    const unpaidLeaveDays = (calcResult?.unpaidLeaveDays !== undefined) ? calcResult.unpaidLeaveDays : (dbPayslip?.unpaidLeaveDays ?? 0);
    const holidayCount = (calcResult?.holidayCount !== undefined) ? calcResult.holidayCount : (dbPayslip?.holidayCount ?? 0);
    const weeklyOffCount = (calcResult?.weeklyOffCount !== undefined) ? calcResult.weeklyOffCount : (dbPayslip?.weeklyOffCount ?? 0);
    const holidayWorkedCount = (calcResult?.holidayWorkedCount !== undefined) ? calcResult.holidayWorkedCount : (dbPayslip?.holidayWorkedCount ?? 0);
    const weeklyOffWorkedCount = (calcResult?.weeklyOffWorkedCount !== undefined) ? calcResult.weeklyOffWorkedCount : (dbPayslip?.weeklyOffWorkedCount ?? 0);
    const extraHolidayPayout = (calcResult?.extraHolidayPayout !== undefined) ? calcResult.extraHolidayPayout : (dbPayslip?.extraHolidayPayout ?? 0);
    const extraWeeklyOffPayout = (calcResult?.extraWeeklyOffPayout !== undefined) ? calcResult.extraWeeklyOffPayout : (dbPayslip?.extraWeeklyOffPayout ?? 0);

    const workingDays = (calcResult?.workingDays && calcResult.workingDays > 0)
      ? calcResult.workingDays
      : (dbPayslip?.workingDays && dbPayslip.workingDays > 0)
      ? dbPayslip.workingDays
      : 26;

    const dailySalary = (calcResult?.dailySalary && calcResult.dailySalary > 0)
      ? calcResult.dailySalary
      : (dbPayslip?.dailySalary && dbPayslip.dailySalary > 0)
      ? dbPayslip.dailySalary
      : Math.round((baseSalary / workingDays) * 100) / 100;

    const totalCalendarDays = (calcResult?.totalCalendarDays)
      ? calcResult.totalCalendarDays
      : (dbPayslip?.totalCalendarDays ?? new Date(targetYear, targetMonth, 0).getDate());

    const basicSalary = ss?.basicSalary || baseSalary;
    const hra = ss?.hra || 0;
    const medical = ss?.medicalAllowance || 0;
    const travel = ss?.travelAllowance || 0;
    const special = ss?.specialAllowance || 0;
    const bonus = ss?.bonus || 0;
    const incentive = ss?.incentive || 0;
    const salaryAdvanceLimit = ss?.salaryAdvanceLimit !== undefined && ss?.salaryAdvanceLimit !== null
      ? ss.salaryAdvanceLimit
      : 25000;

    const monthStart = new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    // Fetch active salary advances for employee
    const activeAdvances = await prisma.salaryAdvance.findMany({
      where: {
        wallet: { employeeId: targetEmployeeId },
        status: { in: ['PENDING', 'APPROVED'] },
      }
    });
    const pendingAdvance = activeAdvances
      .filter((a) => a.status === 'PENDING')
      .reduce((sum, a) => sum + (a.amount || 0), 0);
    const approvedAdvanceRemaining = activeAdvances
      .filter((a) => a.status === 'APPROVED')
      .reduce((sum, a) => sum + (a.remainingAmount > 0 ? a.remainingAmount : 0), 0);
    const salaryAdvanceUsed = pendingAdvance + approvedAdvanceRemaining;
    const salaryAdvanceRemaining = Math.max(0, salaryAdvanceLimit - salaryAdvanceUsed);

    let advanceDeduction = dbPayslip?.advanceDeduction ?? calcResult?.advanceDeduction ?? 0;
    if (advanceDeduction === 0) {
      const scheduledAdvances = activeAdvances.filter((a) => {
        if (a.status !== 'APPROVED' || a.remainingAmount <= 0) return false;
        const appDate = a.approvedAt || a.requestedOn || a.createdAt;
        return appDate <= monthEnd;
      });
      for (const adv of scheduledAdvances) {
        const installment = adv.monthlyEmi > 0 ? Math.min(adv.monthlyEmi, adv.remainingAmount) : adv.remainingAmount;
        advanceDeduction += installment;
      }
      advanceDeduction = Math.round(advanceDeduction * 100) / 100;
    }

    const approvedExpenseRecords = await prisma.expense.findMany({
      where: {
        employeeId: targetEmployeeId,
        status: 'APPROVED',
        date: { gte: monthStart, lte: monthEnd },
      },
      orderBy: { date: 'asc' },
    });
    const catMap: Record<string, number> = {};
    let totalApprovedExpenses = 0;
    for (const exp of approvedExpenseRecords) {
      const cat = exp.category || 'Other';
      const amt = exp.amount || 0;
      totalApprovedExpenses += amt;
      catMap[cat] = Math.round(((catMap[cat] || 0) + amt) * 100) / 100;
    }
    const expenseCategories = catMap;
    const expensesByCategory = Object.entries(catMap).map(([category, amount]) => ({
      category,
      amount,
    }));

    const expenseReimbursement = (dbPayslip?.expenseReimbursement && dbPayslip.expenseReimbursement > 0)
      ? dbPayslip.expenseReimbursement
      : (calcResult?.expenseReimbursement && calcResult.expenseReimbursement > 0)
      ? calcResult.expenseReimbursement
      : Math.round(totalApprovedExpenses * 100) / 100;
    const approvedExpenseAmount = expenseReimbursement;

    const halfDayDeduction = dbPayslip?.halfDays ? Math.round((dbPayslip.halfDays * 0.5 * dailySalary) * 100) / 100 : (calcResult?.halfDayDeduction ?? Math.round((halfDays * 0.5 * dailySalary) * 100) / 100);
    const leaveDeduction = dbPayslip?.unpaidLeaveDays ? Math.round((dbPayslip.unpaidLeaveDays * dailySalary) * 100) / 100 : (calcResult?.leaveDeduction ?? Math.round((unpaidLeaveDays * dailySalary) * 100) / 100);
    const absentDeduction = dbPayslip?.absentDays ? Math.round((dbPayslip.absentDays * dailySalary) * 100) / 100 : (calcResult?.absentDeduction ?? Math.round((absentDays * dailySalary) * 100) / 100);
    const itemizedDeductions = halfDayDeduction + leaveDeduction + absentDeduction + advanceDeduction;

    const deductions = (!isCurrentMonth && dbPayslip?.deductions !== undefined)
      ? dbPayslip.deductions
      : (calcResult?.deductions ?? Math.round(itemizedDeductions * 100) / 100);

    const otherDeductions = Math.max(0, Math.round((deductions - itemizedDeductions) * 100) / 100);

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[targetMonth - 1];
    const monthPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

    const grossTotal = baseSalary + allowance + (commissionEarned > 0 ? commissionEarned : 0) + (extraHolidayPayout + extraWeeklyOffPayout) + expenseReimbursement;

    const netSalary = (!isCurrentMonth && dbPayslip?.netSalary !== undefined && dbPayslip.netSalary > 0)
      ? dbPayslip.netSalary
      : (calcResult?.netSalary ?? Math.max(0, Math.round((grossTotal - deductions) * 100) / 100));

    const responsePayload = {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      designation: employee.designation || 'Staff',
      officeName: employee.office?.name || 'Main Office',
      departmentName: employee.department?.name || 'General',
      month: monthName,
      year: targetYear,
      monthStr: monthPrefix,

      baseSalary,
      allowance,
      grossSalary: grossTotal,
      advanceDeduction,
      advanceSalary: advanceDeduction,
      totalAdvanceSalary: advanceDeduction,
      halfDayDeduction,
      leaveDeduction,
      absentDeduction,
      otherDeduction: otherDeductions,
      otherDeductions,
      expenseReimbursement,
      approvedExpenseAmount,
      approvedExpenses: expenseReimbursement,
      totalExpenses: expenseReimbursement,
      expenses: expensesByCategory,
      expensesByCategory,
      expenseCategories,
      deductionsTotal: deductions,
      netSalary,

      presentDays,
      absentDays,
      halfDays,
      paidLeaveDays,
      unpaidLeaveDays,
      holidayCount,
      weeklyOffCount,
      holidayWorkedCount,
      weeklyOffWorkedCount,
      extraHolidayPayout,
      extraWeeklyOffPayout,
      dailySalary,
      workingDays,
      totalCalendarDays,

      earnings: {
        baseSalary,
        basicSalary,
        hra,
        medical,
        travel,
        special,
        commission: commissionEarned,
        expenseReimbursement,
        approvedExpenses: expenseReimbursement,
        approvedExpenseAmount: expenseReimbursement,
        expenses: expensesByCategory,
        expensesByCategory,
        expenseCategories,
        extraPayout: extraHolidayPayout + extraWeeklyOffPayout,
        bonus,
        incentive,
        grossTotal,
      },

      deductions: {
        deductions,
        halfDayDeduction,
        leaveDeduction,
        absentDeduction,
        advanceDeduction,
        otherDeduction: otherDeductions,
        otherDeductions,
        totalDeductions: deductions,
      },

      details: {
        presentDays,
        absentDays,
        halfDays,
        paidLeaveDays,
        unpaidLeaveDays,
        holidayCount,
        weeklyOffCount,
        holidayWorkedCount,
        weeklyOffWorkedCount,
        workingDays,
        totalCalendarDays,
        dailySalary,
        commissionRate: employee.commissionPercentage || 1.0,
        salaryAdvanceLimit,
        salaryAdvanceUsed,
        salaryAdvanceRemaining,
        advanceDeduction,
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
      const basic = ss?.basicSalary ?? 0;
      const hra = ss?.hra ?? 0;
      const medical = ss?.medicalAllowance ?? 0;
      const travel = ss?.travelAllowance ?? 0;
      const special = ss?.specialAllowance ?? 0;
      const incentive = ss?.incentive ?? 0;
      const bonus = ss?.bonus ?? 0;
      const calcSum = basic + hra + medical + travel + special + incentive + bonus;
      const grossTotal = ss?.grossSalary && ss.grossSalary > 0 ? ss.grossSalary : (calcSum === 0 && basic > 0 ? basic : calcSum);

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
        salaryAdvanceLimit: ss?.salaryAdvanceLimit ?? 25000,
        grossTotal: grossTotal,
        incentive: incentive,
        bonus: bonus,
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
          salaryAdvanceLimit: 25000,
        }
      });
    }

    const basicSalary = ss.basicSalary;
    const hra = ss.hra;
    const medical = ss.medicalAllowance;
    const travel = ss.travelAllowance;
    const special = ss.specialAllowance;
    const salaryAdvanceLimit = ss.salaryAdvanceLimit;
    const grossTotal = ss.grossSalary || (basicSalary + hra + medical + travel + special);

    const payload = {
      id: ss.id,
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
      basicSalary,
      hra,
      medical,
      medicalAllowance: medical,
      travel,
      travelAllowance: travel,
      special,
      specialAllowance: special,
      salaryAdvanceLimit,
      grossTotal,
      monthlySalary: ss.monthlySalary || grossTotal,
      grossSalary: ss.grossSalary || grossTotal,
      updatedAt: ss.updatedAt,
    };

    res.json({
      success: true,
      data: payload,
      basicSalary,
      hra,
      medical,
      travel,
      special,
      salaryAdvanceLimit,
      grossTotal,
      structure: ss
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
          salaryAdvanceLimit: 25000,
        }
      });
    }

    const basicSalary = ss.basicSalary;
    const hra = ss.hra;
    const medical = ss.medicalAllowance;
    const travel = ss.travelAllowance;
    const special = ss.specialAllowance;
    const salaryAdvanceLimit = ss.salaryAdvanceLimit;
    const grossTotal = ss.grossSalary || (basicSalary + hra + medical + travel + special);

    const payload = {
      id: ss.id,
      employeeId: emp.id,
      employeeCode: emp.employeeCode,
      employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
      basicSalary,
      hra,
      medical,
      medicalAllowance: medical,
      travel,
      travelAllowance: travel,
      special,
      specialAllowance: special,
      salaryAdvanceLimit,
      grossTotal,
      monthlySalary: ss.monthlySalary || grossTotal,
      grossSalary: ss.grossSalary || grossTotal,
      updatedAt: ss.updatedAt,
    };

    res.json({
      success: true,
      data: payload,
      basicSalary,
      hra,
      medical,
      travel,
      special,
      salaryAdvanceLimit,
      grossTotal,
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
    const newAdvanceLimit = salaryAdvanceLimit !== undefined ? parseFloat(salaryAdvanceLimit) : (currentSS?.salaryAdvanceLimit || 25000);

    const calcTotal = newBasic + newHra + newMedical + newTravel + newSpecial + newIncentive + newBonus;
    const grossTotal = calcTotal > 0 ? calcTotal : (newBasic > 0 ? newBasic : 0);

    console.log(`[SalaryStructure Update] Component sum: Basic(${newBasic}) + HRA(${newHra}) + Med(${newMedical}) + Trv(${newTravel}) + Spc(${newSpecial}) + Inc(${newIncentive}) + Bns(${newBonus}) = ₹${calcTotal}`);
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
