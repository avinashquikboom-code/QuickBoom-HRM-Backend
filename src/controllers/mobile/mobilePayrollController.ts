import { Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import payrollService, { payslipComponentData } from '../../services/payrollService';
import { getIstMonthRange } from '../../utils/commissionHelper';
import { numToWords } from '../../services/payrollAutomationService';
const PdfPrinter = require('pdfmake');

// Primary color for all PDF reports
const PRIMARY_COLOR = '#3BA38B';

const fonts = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

const printer = new PdfPrinter(fonts);

// Fetch all payslips for the logged-in employee
export const getMyPayslips = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { office: true, salaryStructure: true }
    });

    if (!employee) {
      // HopKid employees may not have a local DB record yet — return empty list gracefully
      res.json({
        success: true,
        data: [],
        message: 'No employee record linked to this account.'
      });
      return;
    }

    const calculateScheduledWorkingDays = (year: number, month: number, office: any): number => {
      const calendarDays = new Date(year, month, 0).getDate();
      const officeDays = office?.workingDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      let count = 0;
      for (let d = 1; d <= calendarDays; d++) {
        const dayName = new Date(year, month - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
        if (officeDays.includes(dayName)) count++;
      }
      return count > 0 ? count : 26;
    };

    const rawPayslips = await prisma.payslip.findMany({
      where: { employeeId: employee.id },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' }
      ]
    });

    const toPayslipView = async (ps: (typeof rawPayslips)[number]) => {
      const calendarDays = new Date(ps.year, ps.month, 0).getDate();
      const schedWorkingDays = ps.workingDays || calculateScheduledWorkingDays(ps.year, ps.month, employee.office);

      // Earnings come from the shared backend resolver (same components as the admin payroll)
      const earnings = await payrollService.resolvePayslipEarnings(ps);
      const baseMonthly = earnings.grossEarnings;
      const dSalary = ps.dailySalary || (schedWorkingDays > 0 ? Math.round((baseMonthly / schedWorkingDays) * 100) / 100 : 0);
      const absentDeduction = ps.absentDays ? Math.round((ps.absentDays * dSalary) * 100) / 100 : 0;
      const halfDayDeduction = ps.halfDays ? Math.round((ps.halfDays * 0.5 * dSalary) * 100) / 100 : 0;
      const leaveDeduction = ps.unpaidLeaveDays ? Math.round((ps.unpaidLeaveDays * dSalary) * 100) / 100 : 0;

      let advanceDeduction = ps.advanceDeduction || 0;
      if (advanceDeduction === 0) {
        const monthEnd = new Date(ps.year, ps.month, 0, 23, 59, 59, 999);
        const activeAdvances = await prisma.salaryAdvance.findMany({
          where: {
            wallet: { employeeId: ps.employeeId },
            status: 'APPROVED',
            remainingAmount: { gt: 0 },
            OR: [
              { approvedAt: { lte: monthEnd } },
              { approvedAt: null, requestedOn: { lte: monthEnd } },
              { approvedAt: null, createdAt: { lte: monthEnd } }
            ]
          },
          orderBy: { approvedAt: 'asc' }
        });
        for (const adv of activeAdvances) {
          const standardEmi = adv.monthlyEmi > 0 
            ? adv.monthlyEmi 
            : (adv.months > 0 ? Math.round((adv.amount / adv.months) * 100) / 100 : adv.amount);
          const remaining = adv.remainingAmount > 0 ? adv.remainingAmount : Math.max(0, adv.amount - (adv.paidAmount || 0));
          advanceDeduction += Math.min(standardEmi, remaining);
        }
        advanceDeduction = Math.round(advanceDeduction * 100) / 100;
      }

      // Gross excludes commission; net = gross - deductions. Commission is reported separately.
      const extraPayout = (ps.extraHolidayPayout || 0) + (ps.extraWeeklyOffPayout || 0);
      const grossSalary = Math.round((earnings.grossEarnings + extraPayout) * 100) / 100;

      const ss = employee.salaryStructure;
      const pf = ss?.pfEnabled ? Math.round(earnings.baseSalary * (ss.employeePfRate / 100)) : 0;
      const esic = ss?.esicEnabled ? Math.round(grossSalary * (ss.employeeEsicRate / 100)) : 0;

      const itemizedDeductions = pf + esic + absentDeduction + halfDayDeduction + leaveDeduction + advanceDeduction;

      let cleanDeductions = ps.deductions || 0;
      const isCorrupted = cleanDeductions > 0 && (cleanDeductions - itemizedDeductions > 5000);

      if (cleanDeductions === 0 || isCorrupted) {
        cleanDeductions = itemizedDeductions;
      }

      const netSalary = Math.max(0, Math.round((grossSalary - cleanDeductions) * 100) / 100);
      const totalTakeHomePay = Math.round((netSalary + (ps.commissionEarned || 0) + (ps.expenseReimbursement || 0)) * 100) / 100;
      const otherDeductions = Math.max(0, Math.round((cleanDeductions - itemizedDeductions) * 100) / 100);

      if (isCorrupted || ps.netSalary !== netSalary || ps.deductions !== cleanDeductions || (ps.advanceDeduction || 0) !== advanceDeduction) {
        prisma.payslip.update({
          where: { id: ps.id },
          data: {
            deductions: cleanDeductions,
            netSalary,
            advanceDeduction,
            netInWords: `${numToWords(Math.round(totalTakeHomePay))} Rupees Only`
          }
        }).catch(err => console.warn(`[getMyPayslips] Failed to heal payslip #${ps.id}:`, err));
      }

      const payPeriod = new Date(ps.year, ps.month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const documentId = `HR-PAY-${ps.employeeCode}-${ps.year}${String(ps.month).padStart(2, '0')}`;
      const netInWords = ps.netInWords || `${numToWords(Math.round(totalTakeHomePay))} Rupees Only`;
      const isPaid = ps.status?.toUpperCase() === 'PAID';
      const paymentStatus = isPaid ? 'PAID' : 'PENDING';

      return {
        ...ps,
        status: paymentStatus,
        paymentStatus,
        payrollStatus: ps.status || 'PENDING',
        baseSalary: earnings.baseSalary,
        basicSalary: earnings.baseSalary,
        allowance: earnings.allowance,
        hra: earnings.components.hra,
        travelAllowance: earnings.components.travelAllowance,
        medicalAllowance: earnings.components.medicalAllowance,
        travelMedicalAllowance: (earnings.components.travelAllowance || 0) + (earnings.components.medicalAllowance || 0),
        specialAllowance: earnings.components.specialAllowance,
        incentive: earnings.components.incentive,
        bonus: earnings.components.bonus,
        grossSalary,
        grossEarnings: grossSalary,
        deductions: cleanDeductions,
        totalDeductions: cleanDeductions,
        advanceDeduction,
        advanceSalary: advanceDeduction,
        totalAdvanceSalary: advanceDeduction,
        pf,
        esic,
        absentDeduction,
        halfDayDeduction,
        leaveDeduction,
        otherDeductions,
        otherDeduction: otherDeductions,
        netSalary,
        totalTakeHomePay,
        documentId,
        payPeriod,
        netInWords,
        presentDays: ps.presentDays || 0,
        absentDays: ps.absentDays || 0,
        expenseReimbursement: ps.expenseReimbursement || 0,
        totalReimbursements: ps.expenseReimbursement || 0,
        approvedExpenses: ps.expenseReimbursement || 0,
        approvedExpenseAmount: ps.expenseReimbursement || 0,
        totalExpenses: ps.expenseReimbursement || 0,
        commission: ps.commissionEarned || 0,
        commissionEarned: ps.commissionEarned || 0,
        deductionsObj: {
          deductions: cleanDeductions,
          totalDeductions: cleanDeductions,
          advanceDeduction,
          advanceSalary: advanceDeduction,
          pf,
          esic,
          absentDeduction,
          halfDayDeduction,
          leaveDeduction,
          otherDeductions
        },
        halfDays: ps.halfDays || 0,
        paidLeaveDays: ps.paidLeaveDays || 0,
        unpaidLeaveDays: ps.unpaidLeaveDays || 0,
        holidayCount: ps.holidayCount || 0,
        weeklyOffCount: ps.weeklyOffCount || 0,
        holidayWorkedCount: ps.holidayWorkedCount || 0,
        weeklyOffWorkedCount: ps.weeklyOffWorkedCount || 0,
        extraHolidayPayout: ps.extraHolidayPayout || 0,
        extraWeeklyOffPayout: ps.extraWeeklyOffPayout || 0,
        dailySalary: ps.dailySalary || 0,
        workingDays: schedWorkingDays,
        totalCalendarDays: ps.totalCalendarDays || calendarDays,
        earnings: {
          baseSalary: earnings.baseSalary,
          basicSalary: earnings.baseSalary,
          hra: earnings.components.hra,
          medical: earnings.components.medicalAllowance,
          medicalAllowance: earnings.components.medicalAllowance,
          travel: earnings.components.travelAllowance,
          travelAllowance: earnings.components.travelAllowance,
          travelMedicalAllowance: (earnings.components.travelAllowance || 0) + (earnings.components.medicalAllowance || 0),
          special: earnings.components.specialAllowance,
          specialAllowance: earnings.components.specialAllowance,
          bonus: earnings.components.bonus,
          incentive: earnings.components.incentive,
          grossSalary,
          grossTotal: grossSalary,
          grossEarnings: grossSalary,
          commission: ps.commissionEarned || 0,
          expenseReimbursement: ps.expenseReimbursement || 0,
        }
      };
    };

    let payslips = await Promise.all(rawPayslips.map(toPayslipView));

    if (payslips.length === 0) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      await payrollService.autoGenerateMonthlyPayroll(month, year);

      const updatedRaw = await prisma.payslip.findMany({
        where: { employeeId: employee.id },
        orderBy: [{ year: 'desc' }, { month: 'desc' }]
      });

      payslips = await Promise.all(updatedRaw.map(toPayslipView));
    }

    res.json({
      success: true,
      data: payslips,
      payslips: payslips
    });
  } catch (error: any) {
    console.error('Get my payslips error — userId:', req.user?.id, '| detail:', error?.message ?? error);
    // Return empty list rather than a 500 crash — payslips may simply not exist yet
    res.json({
      success: true,
      data: [],
      _warning: 'Payslips temporarily unavailable.'
    });
  }
};


// Download a payslip as PDF
export const downloadPayslip = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { month, year, employeeId: qEmpId } = req.query;

    let employee = null;
    if (req.user?.id) {
      employee = await prisma.employee.findFirst({
        where: { userId: req.user.id }
      });
    }

    let payslip: any = null;

    if (id && !isNaN(parseInt(id as string, 10))) {
      const payslipId = parseInt(id as string, 10);
      payslip = await prisma.payslip.findUnique({
        where: { id: payslipId },
        include: { employee: true }
      });
    } else if (month && year) {
      const targetEmpId = qEmpId && !isNaN(Number(qEmpId)) ? Number(qEmpId) : employee?.id;
      if (targetEmpId) {
        payslip = await prisma.payslip.findFirst({
          where: {
            employeeId: targetEmpId,
            month: Number(month),
            year: Number(year),
          },
          include: { employee: true }
        });
      }
    }

    // Dynamic fallback if no formal payslip row exists in database yet
    if (!payslip) {
      const targetEmpId = qEmpId && !isNaN(Number(qEmpId)) ? Number(qEmpId) : employee?.id;
      const targetMonth = month ? Number(month) : new Date().getMonth() + 1;
      const targetYear = year ? Number(year) : new Date().getFullYear();

      if (targetEmpId) {
        const emp = await prisma.employee.findUnique({
          where: { id: targetEmpId },
          include: { office: true, department: true }
        });

        if (emp) {
          // Single source of truth: the backend payroll calculation (same one admin uses)
          const calc = await payrollService.calculatePayroll(emp.id, targetMonth, targetYear);
          payslip = {
            id: 0,
            employeeId: emp.id,
            employeeCode: emp.employeeCode,
            employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
            designation: emp.designation || '',
            department: emp.department?.name || '',
            officeName: emp.office?.name || '',
            month: targetMonth,
            year: targetYear,
            baseSalary: calc.baseSalary,
            allowance: calc.allowance,
            deductions: calc.deductions,
            netSalary: calc.netSalary,
            advanceDeduction: calc.advanceDeduction,
            expenseReimbursement: calc.expenseReimbursement,
            presentDays: calc.presentDays,
            absentDays: calc.absentDays,
            halfDays: calc.halfDays,
            paidLeaveDays: calc.paidLeaveDays,
            unpaidLeaveDays: calc.unpaidLeaveDays,
            holidayCount: calc.holidayCount,
            weeklyOffCount: calc.weeklyOffCount,
            holidayWorkedCount: calc.holidayWorkedCount,
            weeklyOffWorkedCount: calc.weeklyOffWorkedCount,
            extraHolidayPayout: calc.extraHolidayPayout,
            extraWeeklyOffPayout: calc.extraWeeklyOffPayout,
            dailySalary: calc.dailySalary,
            workingDays: calc.workingDays,
            totalCalendarDays: calc.totalCalendarDays,
            commissionEarned: calc.commissionEarned,
            ...payslipComponentData(calc),
            netInWords: `${calc.netSalary.toLocaleString('en-IN')} Rupees Only`,
            employee: emp,
          };
        }
      }
    }

    if (!payslip) {
      res.status(404).json({
        success: false,
        message: 'Payslip not found.'
      });
      return;
    }

    // Verify employee authorization: Employees can only download their own payslips
    if (req.user?.role === 'EMPLOYEE') {
      if (employee && employee.id !== payslip.employeeId) {
        res.status(403).json({
          success: false,
          message: 'Unauthorized to download this payslip.'
        });
        return;
      }
    }

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[payslip.month - 1] || 'Unknown';
    const periodLabel = `${monthName} ${payslip.year}`;

    // Fetch employee salary structure
    const employeeWithSalary = await prisma.employee.findUnique({
      where: { id: payslip.employeeId },
      include: { salaryStructure: true }
    });

    const ss = employeeWithSalary?.salaryStructure;

    // Earnings come from the shared backend resolver (same components as the admin payroll)
    const earnings = await payrollService.resolvePayslipEarnings(payslip);
    const basic = earnings.baseSalary;
    const { hra, travelAllowance: ta, medicalAllowance: medical, specialAllowance: special, bonus, incentive } = earnings.components;
    const finalSpecial = special;

    const totalDaysInMonth = new Date(payslip.year, payslip.month, 0).getDate();
    const pf = ss?.pfEnabled ? Math.round(basic * (ss.employeePfRate / 100)) : 0;
    const esic = ss?.esicEnabled ? Math.round((basic + earnings.allowance) * (ss.employeeEsicRate / 100)) : 0;

    const monthRange = getIstMonthRange(payslip.year, payslip.month);
    const monthStart = monthRange.monthStart;
    const monthEnd = monthRange.monthEnd;
    const commAggregate = await prisma.commissionTransaction.aggregate({
      where: {
        employeeId: payslip.employeeId,
        createdAt: { gte: monthStart, lte: monthEnd },
        status: { in: ['PENDING', 'APPROVED', 'PAID'] }
      },
      _sum: { commissionAmount: true }
    });
    const commissionEarned = (commAggregate._sum?.commissionAmount !== undefined && commAggregate._sum?.commissionAmount !== null)
      ? commAggregate._sum.commissionAmount
      : (payslip.commissionEarned || 0);

    // Active Advance Salary deduction calculation
    let advanceDeduction = payslip.advanceDeduction || 0;
    if (advanceDeduction === 0) {
      const activeAdvances = await prisma.salaryAdvance.findMany({
        where: {
          wallet: { employeeId: payslip.employeeId },
          status: 'APPROVED',
          remainingAmount: { gt: 0 },
          OR: [
            { approvedAt: { lte: monthEnd } },
            { approvedAt: null, requestedOn: { lte: monthEnd } },
            { approvedAt: null, createdAt: { lte: monthEnd } }
          ]
        },
        orderBy: { approvedAt: 'asc' }
      });
      for (const adv of activeAdvances) {
        const standardEmi = adv.monthlyEmi > 0 
          ? adv.monthlyEmi 
          : (adv.months > 0 ? Math.round((adv.amount / adv.months) * 100) / 100 : adv.amount);
        const remaining = adv.remainingAmount > 0 ? adv.remainingAmount : Math.max(0, adv.amount - (adv.paidAmount || 0));
        advanceDeduction += Math.min(standardEmi, remaining);
      }
      advanceDeduction = Math.round(advanceDeduction * 100) / 100;
    }

    // Approved Expenses / Reimbursements
    const approvedExpenses = await prisma.expense.findMany({
      where: {
        employeeId: payslip.employeeId,
        status: 'APPROVED',
        date: { gte: monthStart, lte: monthEnd },
      },
      orderBy: { date: 'asc' },
    });
    const expenseCategories: Record<string, number> = {};
    let totalApprovedExpenses = 0;
    for (const exp of approvedExpenses) {
      const cat = exp.category || 'Other';
      const amt = exp.amount || 0;
      totalApprovedExpenses += amt;
      expenseCategories[cat] = Math.round(((expenseCategories[cat] || 0) + amt) * 100) / 100;
    }
    const expenseReimbursement = payslip.expenseReimbursement > 0 
      ? payslip.expenseReimbursement 
      : Math.round(totalApprovedExpenses * 100) / 100;

    const schedWorkingDays = payslip.workingDays || 26;
    const dailySalary = payslip.dailySalary || (schedWorkingDays > 0 ? Math.round((earnings.grossEarnings / schedWorkingDays) * 100) / 100 : 0);
    const absentDeduction = payslip.absentDays ? Math.round((payslip.absentDays * dailySalary) * 100) / 100 : 0;
    const halfDayDeduction = payslip.halfDays ? Math.round((payslip.halfDays * 0.5 * dailySalary) * 100) / 100 : 0;
    const leaveDeduction = payslip.unpaidLeaveDays ? Math.round((payslip.unpaidLeaveDays * dailySalary) * 100) / 100 : 0;

    // Gross Earnings = Basic + salary components (+ extra holiday/weekly-off payouts). Commission stays separate.
    const extraPayout = (payslip.extraHolidayPayout || 0) + (payslip.extraWeeklyOffPayout || 0);
    const grossEarnings = Math.round((earnings.grossEarnings + extraPayout) * 100) / 100;

    // Total Deductions = Statutory + Absent + Half-Day + Leave + Advance Salary + Other
    const itemizedDeductions = pf + esic + absentDeduction + halfDayDeduction + leaveDeduction + advanceDeduction;

    // CORRUPTION GUARD: If stored payslip.deductions far exceeds itemized (by > ₹5,000),
    // it was likely saved with a mis-applied bulk deduction (e.g. PF applied to gross instead of basic).
    // In that case, use the freshly-derived itemized total instead.
    let totalDeductions: number;
    if (payslip.deductions > 0) {
      const excessOverItemized = payslip.deductions - itemizedDeductions;
      if (excessOverItemized > 5000) {
        totalDeductions = itemizedDeductions;
        console.warn(
          `[MobilePayslipPDF] Corrupted deductions for emp=${payslip.employeeId} ${payslip.month}/${payslip.year}: stored=${payslip.deductions}, itemized=${itemizedDeductions}, using itemized`
        );
      } else {
        totalDeductions = payslip.deductions;
      }
    } else {
      totalDeductions = itemizedDeductions;
    }
    const otherDeductions = Math.max(0, Math.round((totalDeductions - itemizedDeductions) * 100) / 100);

    // Net Salary = Gross Earnings - Total Deductions
    const netSalary = Math.max(0, Math.round((grossEarnings - totalDeductions) * 100) / 100);

    // Total Take-Home Pay = Net Salary + Commission + Reimbursements
    const totalTakeHomePay = Math.round((netSalary + (commissionEarned > 0 ? commissionEarned : 0) + expenseReimbursement) * 100) / 100;
    const isPaid = payslip?.status?.toUpperCase() === 'PAID';
    const paymentStatus = isPaid ? 'PAID' : 'PENDING';

    // Build Earnings Items
    const allowances = ta + medical;
    const earningsItems: { name: string; amount: number }[] = [
      { name: 'Basic Salary', amount: basic },
    ];
    if (hra > 0) {
      earningsItems.push({ name: 'House Rent Allowance (HRA)', amount: hra });
    }
    if (allowances > 0) {
      earningsItems.push({ name: 'Allowances (Travel/Medical)', amount: allowances });
    }
    if (finalSpecial > 0) {
      earningsItems.push({ name: 'Special Allowance', amount: finalSpecial });
    }
    if (bonus > 0) {
      earningsItems.push({ name: 'Bonus', amount: bonus });
    }
    if (incentive > 0) {
      earningsItems.push({ name: 'Incentive', amount: incentive });
    }
    if (extraPayout > 0) {
      earningsItems.push({ name: 'Holiday / Weekly Off Payout', amount: extraPayout });
    }
    if (commissionEarned > 0) {
      earningsItems.push({ name: 'Commission', amount: commissionEarned });
    }
    if (earningsItems.length === 1 && earnings.allowance > 0) {
      earningsItems.push({ name: 'Allowances', amount: earnings.allowance });
    }

    const fmt = (n: number) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Build Deductions Items
    const deductionsItems: { name: string; amount: number }[] = [];
    if (advanceDeduction > 0) {
      deductionsItems.push({ name: 'Advance Salary', amount: advanceDeduction });
    }
    if (pf > 0 || ss?.pfEnabled) deductionsItems.push({ name: 'Provident Fund (PF)', amount: pf });
    if (esic > 0 || ss?.esicEnabled) deductionsItems.push({ name: 'ESIC / Tax', amount: esic });
    if (absentDeduction > 0) deductionsItems.push({ name: `Absent (${payslip.absentDays} days)`, amount: absentDeduction });
    if (halfDayDeduction > 0) deductionsItems.push({ name: `Half Day (${payslip.halfDays} half days)`, amount: halfDayDeduction });
    if (leaveDeduction > 0) deductionsItems.push({ name: `Leave (${payslip.unpaidLeaveDays} unpaid leaves)`, amount: leaveDeduction });
    if (otherDeductions > 0) deductionsItems.push({ name: 'Other Deductions', amount: otherDeductions });
    if (deductionsItems.length === 0) {
      deductionsItems.push({ name: 'Advance Salary', amount: 0 });
    }

    const maxRows = Math.max(earningsItems.length, deductionsItems.length);
    const tableRows: any[] = [];
    for (let i = 0; i < maxRows; i++) {
      const earn = earningsItems[i];
      const ded = deductionsItems[i];
      tableRows.push([
        { text: earn ? earn.name : '' },
        { text: earn ? `Rs. ${fmt(earn.amount)}` : '', alignment: 'right' },
        { text: ded ? ded.name : '' },
        { text: ded ? `Rs. ${fmt(ded.amount)}` : '', alignment: 'right' },
      ]);
    }

    const earningsTableBody: any[] = [
      // Table Headers
      [
        { text: 'Earnings', bold: true, fillColor: '#f3f4f6' },
        { text: 'Amount (INR)', bold: true, alignment: 'right', fillColor: '#f3f4f6' },
        { text: 'Deductions', bold: true, fillColor: '#f3f4f6' },
        { text: 'Amount (INR)', bold: true, alignment: 'right', fillColor: '#f3f4f6' }
      ],
      ...tableRows,
      // Totals
      [
        { text: 'Gross Earnings', bold: true, fillColor: '#f9fafb' },
        { text: `Rs. ${fmt(grossEarnings)}`, bold: true, alignment: 'right', fillColor: '#f9fafb' },
        { text: 'Total Deductions', bold: true, fillColor: '#f9fafb' },
        { text: `Rs. ${fmt(totalDeductions)}`, bold: true, alignment: 'right', fillColor: '#f9fafb' }
      ]
    ];

    // Build Reimbursements / Expenses Section Table Body if any expenses exist
    const catEntries = Object.entries(expenseCategories);
    const reimbursementsTableBody: any[] = [
      [
        { text: 'Reimbursement / Expense Category', bold: true, fillColor: '#f3f4f6' },
        { text: 'Amount (INR)', bold: true, alignment: 'right', fillColor: '#f3f4f6' }
      ]
    ];

    if (catEntries.length > 0) {
      for (const [cat, amt] of catEntries) {
        reimbursementsTableBody.push([
          { text: `${cat} Expense` },
          { text: `Rs. ${fmt(amt)}`, alignment: 'right' }
        ]);
      }
    } else if (expenseReimbursement > 0) {
      reimbursementsTableBody.push([
        { text: 'Approved Expenses' },
        { text: `Rs. ${fmt(expenseReimbursement)}`, alignment: 'right' }
      ]);
    } else {
      reimbursementsTableBody.push([
        { text: 'No Expenses / Reimbursements', color: '#6b7280', italics: true },
        { text: `Rs. ${fmt(0)}`, alignment: 'right', color: '#6b7280' }
      ]);
    }

    reimbursementsTableBody.push([
      { text: 'Total Reimbursements', bold: true, fillColor: '#ecfdf5', color: '#047857' },
      { text: `Rs. ${fmt(expenseReimbursement)}`, bold: true, alignment: 'right', fillColor: '#ecfdf5', color: '#047857' }
    ]);

    const docContent: any[] = [
      // Title Header
      { text: 'HOPKID PORTAL', style: 'companyName', alignment: 'center' },
      { text: 'Human Resources · Payroll Division', style: 'companySub', alignment: 'center', margin: [0, 2, 0, 15] },
      
      { text: 'SALARY SLIP', style: 'docTitle', alignment: 'center', margin: [0, 0, 0, 20] },
      
      // Employee details table
      {
        style: 'tableExample',
        table: {
          widths: ['*', '*'],
          body: [
            [
              {
                text: [
                  { text: 'Employee Name: ', bold: true }, payslip.employeeName, '\n',
                  { text: 'Employee Code: ', bold: true }, payslip.employeeCode, '\n',
                  { text: 'Designation:   ', bold: true }, payslip.designation, '\n',
                  { text: 'Department:    ', bold: true }, payslip.department
                ],
                margin: [5, 5, 5, 5]
              },
              {
                text: [
                  { text: 'Office / Branch:     ', bold: true }, payslip.officeName, '\n',
                  { text: 'Pay Period:          ', bold: true }, periodLabel, '\n',
                  { text: 'Total Days of Month: ', bold: true }, `${totalDaysInMonth} Days`, '\n',
                  { text: 'Document ID:         ', bold: true }, `HR-PAY-${payslip.employeeCode}-${payslip.year}${String(payslip.month).padStart(2, '0')}`, '\n',
                  { text: 'Status:              ', bold: true }, paymentStatus
                ],
                margin: [5, 5, 5, 5]
              }
            ]
          ]
        },
        layout: 'lightHorizontalLines'
      },
      
      { text: 'Salary Breakdown', style: 'sectionHeader', margin: [0, 20, 0, 8] },
      
      // Earnings & Deductions Table
      {
        table: {
          widths: ['*', 'auto', '*', 'auto'],
          body: earningsTableBody
        },
        layout: 'grid'
      },

      // Reimbursements Section
      { text: 'Reimbursements / Expenses', style: 'sectionHeader', margin: [0, 16, 0, 8] },
      {
        table: {
          widths: ['*', 'auto'],
          body: reimbursementsTableBody
        },
        layout: 'grid'
      },
      
      // Net pay calculation breakdown & block
      {
        margin: [0, 20, 0, 0],
        table: {
          widths: ['*'],
          body: [
            [
              {
                fillColor: PRIMARY_COLOR,
                color: 'white',
                text: [
                  { text: 'PAYABLE SUMMARY\n', fontSize: 10, bold: true },
                  { text: `Gross Earnings: Rs. ${fmt(grossEarnings)}  |  Less Deductions: Rs. ${fmt(totalDeductions)}  |  Net Salary: Rs. ${fmt(netSalary)}\n`, fontSize: 9 },
                  ...(commissionEarned > 0 ? [{ text: `Add: Commission: +Rs. ${fmt(commissionEarned)}\n`, fontSize: 9, bold: true }] : []),
                  ...(expenseReimbursement > 0 ? [{ text: `Add: Eligible Reimbursements: +Rs. ${fmt(expenseReimbursement)}\n`, fontSize: 9, bold: true }] : []),
                  { text: `\nTOTAL TAKE-HOME PAY\n`, fontSize: 11, bold: true },
                  { text: `INR ${fmt(totalTakeHomePay)}/-\n`, fontSize: 18, bold: true },
                  { text: `In Words: ${payslip.netInWords || `${totalTakeHomePay.toLocaleString('en-IN')} Rupees Only`}`, fontSize: 9, italics: true }
                ],
                alignment: 'center',
                margin: [15, 12, 15, 12]
              }
            ]
          ]
        },
        layout: 'noBorders'
      },
      
      // Footer disclaimer
      { 
        text: 'This is a computer-generated salary slip and does not require a physical signature.', 
        style: 'footerDisclaimer', 
        alignment: 'center', 
        margin: [0, 35, 0, 0] 
      }
    ];

    const docDefinition = {
      content: docContent,
      styles: {
        companyName: { fontSize: 20, bold: true, color: PRIMARY_COLOR },
        companySub: { fontSize: 9, color: '#6b7280' },
        docTitle: { fontSize: 14, bold: true, decoration: 'underline', color: '#111827' },
        sectionHeader: { fontSize: 11, bold: true, color: '#374151' },
        footerDisclaimer: { fontSize: 8, color: '#9ca3af', italics: true }
      },
      defaultStyle: {
        font: 'Roboto',
        fontSize: 10
      }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    const safeName = payslip.employeeName.replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=SalarySlip_${payslip.employeeCode}_${safeName}_${payslip.year}_${payslip.month}.pdf`);
    
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error('Download payslip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download payslip PDF.'
    });
  }
};
