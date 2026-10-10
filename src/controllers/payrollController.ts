import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import payrollService from '../services/payrollService';
import { prisma } from '../utils/db';
import { getIstMonthRange } from '../utils/commissionHelper';
import { numToWords } from '../services/payrollAutomationService';
import { sendHRNotification, notifyEmployee } from '../utils/hrNotificationHelper';

// ==========================================
// Enhanced Payroll Controller
// ==========================================

export const calculateEmployeePayroll = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, month, year } = req.body;

    if (!employeeId || !month || !year) {
      res.status(400).json({
        success: false,
        message: 'Employee ID, month, and year are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const calculation = await payrollService.calculatePayroll(
      parseInt(employeeId),
      parseInt(month),
      parseInt(year)
    );

    res.json({
      success: true,
      message: 'Payroll calculated successfully.',
      calculation
    });
  } catch (error) {
    console.error('Calculate employee payroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate payroll.',
      errorCode: 'CALCULATE_PAYROLL_ERROR'
    });
  }
};

export const processPayrollRun = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeIds, month, year, runName } = req.body;

    if (!employeeIds || !Array.isArray(employeeIds) || !month || !year) {
      res.status(400).json({
        success: false,
        message: 'Employee IDs array, month, and year are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const run = await payrollService.processPayrollRun(
      employeeIds.map(id => parseInt(id)),
      parseInt(month),
      parseInt(year),
      runName
    );

    // 1. Notify each affected employee (strictly isolated to their own account)
    for (const empId of employeeIds) {
      notifyEmployee({
        employeeId: parseInt(empId),
        title: 'Salary Slip Available',
        message: `Your salary slip for ${month}/${year} is now available.`,
        category: 'PAYROLL',
        actionType: 'SALARY_GENERATED',
        actionId: `${empId}-${month}-${year}`,
      }).catch(() => {});
    }

    // 2. Notify Authorized HR/Admin Team
    sendHRNotification({
      title: 'Salary Generated',
      message: `Payroll run "${runName || `Payroll-${month}/${year}`}" processed for ${employeeIds.length} employee(s).`,
      category: 'PAYROLL',
      actionType: 'SALARY_GENERATED',
      actionId: String(run?.id || `${month}-${year}`),
      requiredModuleId: 'pa-payroll',
    }).catch(err => console.error('[HR Notification] Salary generated notice error:', err));

    res.json({
      success: true,
      message: 'Payroll run processed successfully.',
      run
    });
  } catch (error) {
    console.error('Process payroll run error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payroll run.',
      errorCode: 'PROCESS_PAYROLL_RUN_ERROR'
    });
  }
};

export const getSalaryStructure = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const { effectiveDate } = req.query as { effectiveDate?: string };
    
    const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;
    const targetEmployeeId = parseInt(employeeIdStr);
    
    const date = effectiveDate ? new Date(effectiveDate) : new Date();

    const structure = await payrollService.getSalaryStructure(targetEmployeeId, date);

    res.json({
      success: true,
      structure
    });
  } catch (error) {
    console.error('Get salary structure error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get salary structure.',
      errorCode: 'GET_SALARY_STRUCTURE_ERROR'
    });
  }
};

export const updateSalaryStructure = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const structureData = req.body;

    if (!employeeId) {
      res.status(400).json({
        success: false,
        message: 'Employee ID is required.',
        errorCode: 'MISSING_EMPLOYEE_ID'
      });
      return;
    }

    const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;
    const structure = await payrollService.updateSalaryStructure(
      parseInt(employeeIdStr),
      structureData
    );

    res.json({
      success: true,
      message: 'Salary structure updated successfully.',
      structure
    });
  } catch (error) {
    console.error('Update salary structure error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update salary structure.',
      errorCode: 'UPDATE_SALARY_STRUCTURE_ERROR'
    });
  }
};

export const getPayrollStatistics = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month, year } = req.query as { month?: string, year?: string };
    
    const targetMonth = month ? parseInt(month) : undefined;
    const targetYear = year ? parseInt(year) : undefined;

    const stats = await payrollService.getPayrollStats(targetMonth, targetYear);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get payroll statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payroll statistics.',
      errorCode: 'GET_PAYROLL_STATS_ERROR'
    });
  }
};

export const getPayrollRuns = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { limit = '50' } = req.query as { limit: string };
    const limitNum = parseInt(limit) || 50;

    const runs = await payrollService.getPayrollRuns(limitNum);

    res.json({
      success: true,
      data: runs || [],
      runs: runs || []
    });
  } catch (error) {
    console.error('Get payroll runs error:', error);
    res.json({
      success: true,
      data: [],
      runs: [],
      message: 'No payroll runs found.'
    });
  }
};

export const bulkUpdateSalaryStructures = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { structures } = req.body;

    if (!structures || !Array.isArray(structures)) {
      res.status(400).json({
        success: false,
        message: 'Structures array is required.',
        errorCode: 'MISSING_STRUCTURES'
      });
      return;
    }

    const results: any[] = [];
    
    for (const structureData of structures) {
      try {
        const result = await payrollService.updateSalaryStructure(
          structureData.employeeId,
          structureData
        );
        results.push({ success: true, structure: result });
      } catch (error) {
        results.push({ 
          success: false, 
          employeeId: structureData.employeeId, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    res.json({
      success: true,
      message: 'Bulk salary structures processed.',
      results
    });
  } catch (error) {
    console.error('Bulk update salary structures error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update salary structures.',
      errorCode: 'BULK_UPDATE_SALARY_STRUCTURES_ERROR'
    });
  }
};

export const getEmployeePayrollHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const { limit = '12' } = req.query as { limit: string };
    
    const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;
    const limitNum = parseInt(limit);

    const payslips = await prisma.payslip.findMany({
      where: {
        employeeId: parseInt(employeeIdStr)
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' }
      ],
      take: limitNum
    });
    const transformedHistory = payslips.map(ps => {
      const grossSalary = Math.round((ps.baseSalary + ps.allowance) * 100) / 100;
      return {
        ...ps,
        grossSalary,
        netPay: ps.netSalary,
        netTakeHomePay: ps.netSalary,
        commissionEarned: ps.commissionEarned || 0,
        extraPayout: (ps.extraHolidayPayout || 0) + (ps.extraWeeklyOffPayout || 0),
        presentDays: ps.presentDays || 0,
        absentDays: ps.absentDays || 0,
        halfDays: ps.halfDays || 0,
        paidLeaveDays: ps.paidLeaveDays || 0,
        unpaidLeaveDays: ps.unpaidLeaveDays || 0,
        holidayCount: ps.holidayCount || 0,
        weeklyOffCount: ps.weeklyOffCount || 0,
        holidayWorkedCount: ps.holidayWorkedCount || 0,
        weeklyOffWorkedCount: ps.weeklyOffWorkedCount || 0,
        dailySalary: ps.dailySalary || 0,
        workingDays: ps.workingDays || 26,
        totalCalendarDays: ps.totalCalendarDays || new Date(ps.year, ps.month, 0).getDate()
      };
    });

    res.json({
      success: true,
      payslips: transformedHistory,
      history: transformedHistory,
      data: transformedHistory,
      records: transformedHistory
    });
  } catch (error) {
    console.error('Get employee payroll history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payroll history.',
      errorCode: 'GET_PAYROLL_HISTORY_ERROR'
    });
  }
};

export const generatePayslipPDF = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, month, year } = req.params;
    if (!employeeId || !month || !year) {
      res.status(400).json({ success: false, message: 'Employee ID, month, and year are required.', errorCode: 'MISSING_REQUIRED_FIELDS' });
      return;
    }
    const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;
    const monthNum = parseInt(Array.isArray(month) ? month[0] : month);
    const yearNum  = parseInt(Array.isArray(year)  ? year[0]  : year);
    const payslip = await prisma.payslip.findUnique({
      where: { employeeId_month_year: { employeeId: parseInt(employeeIdStr), month: monthNum, year: yearNum } },
      include: { employee: { include: { department: true, office: true, salaryStructure: true } } }
    });
    if (!payslip) {
      res.status(404).json({ success: false, message: 'Payslip not found.', errorCode: 'PAYSLIP_NOT_FOUND' });
      return;
    }
    const PRIMARY      = '#14B8A6';
    const PRIMARY_DARK = '#0D9488';
    const PdfPrinter = require('pdfmake');
    const printer = new PdfPrinter({
      Roboto: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
    });
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const view = await payrollService.resolveFullPayslipView(payslip, payslip.employee);
    const earnings = view.earnings;
    const extraPayout = (view.extraHolidayPayout || 0) + (view.extraWeeklyOffPayout || 0);
    const grossEarnings = view.grossEarnings || 0;
    const generatedOn = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const monthLabel  = `${MONTH_NAMES[monthNum - 1]} ${yearNum}`;
    const paymentStatus = view.paymentStatus || 'PENDING';
    const statusColor = paymentStatus === 'PAID' ? '#059669' : '#D97706';
    const fmt = (n: number) => `\u20b9${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtDed = (n: number) => `-\u20b9${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const totalDaysInMonth = view.totalCalendarDays || new Date(yearNum, monthNum, 0).getDate();
    const isCommissionEligible = Boolean(view.isCommissionEligible);
    const commissionEarned = isCommissionEligible ? (view.commissionEarned || 0) : 0;
    const advanceDeduction = view.advanceDeduction || 0;
    const pf = view.pf || 0;
    const esic = view.esic || 0;
    const absentDeduction = view.absentDeduction || 0;
    const halfDayDeduction = view.halfDayDeduction || 0;
    const leaveDeduction = view.leaveDeduction || 0;
    const otherDeductions = view.otherDeductions || 0;
    const deductions = view.totalDeductions || 0;
    const expenseCategories: Record<string, number> = view.expenseCategories || {};
    const expenseReimbursement = view.expenseReimbursement || 0;
    const netSalary = view.netSalary || 0;
    const totalTakeHomePay = view.totalTakeHomePay || 0;
    const dailySalary = view.dailySalary || 0;

    const earningsTableBody: any[] = [
      [{ text: 'Description', style: 'colHeader' }, { text: 'Amount (\u20b9)', style: 'colHeader', alignment: 'right' }],
      [{ text: 'Basic Salary', fontSize: 9, color: '#111827', fillColor: '#F9FAFB' }, { text: fmt(earnings.baseSalary), fontSize: 9, alignment: 'right', color: '#111827', fillColor: '#F9FAFB' }],
    ];

    if ((earnings.hra || 0) > 0) {
      earningsTableBody.push([
        { text: 'House Rent Allowance (HRA)', fontSize: 9, color: '#111827' },
        { text: fmt(earnings.hra), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if ((earnings.medicalAllowance || 0) > 0) {
      earningsTableBody.push([
        { text: 'Medical Allowance', fontSize: 9, color: '#111827' },
        { text: fmt(earnings.medicalAllowance), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if ((earnings.travelAllowance || 0) > 0) {
      earningsTableBody.push([
        { text: 'Travel Allowance', fontSize: 9, color: '#111827' },
        { text: fmt(earnings.travelAllowance), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    const fallbackAllowances = (!earnings.medicalAllowance && !earnings.travelAllowance)
      ? (earnings.travelMedicalAllowance || 0)
      : 0;
    if (fallbackAllowances > 0) {
      earningsTableBody.push([
        { text: 'Allowances (Travel/Medical)', fontSize: 9, color: '#111827' },
        { text: fmt(fallbackAllowances), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if ((earnings.specialAllowance || 0) > 0) {
      earningsTableBody.push([
        { text: 'Special Allowance', fontSize: 9, color: '#111827' },
        { text: fmt(earnings.specialAllowance), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if ((earnings.bonus || 0) > 0) {
      earningsTableBody.push([
        { text: 'Bonus', fontSize: 9, color: '#111827' },
        { text: fmt(earnings.bonus), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if ((earnings.incentive || 0) > 0) {
      earningsTableBody.push([
        { text: 'Incentive', fontSize: 9, color: '#111827' },
        { text: fmt(earnings.incentive), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if (extraPayout > 0) {
      earningsTableBody.push([
        { text: 'Holiday / Weekly Off Payout', fontSize: 9, color: '#111827' },
        { text: fmt(extraPayout), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }

    earningsTableBody.push([
      { text: 'Gross Earnings', fontSize: 9, bold: true, color: '#059669', fillColor: '#ECFDF5' },
      { text: fmt(grossEarnings), fontSize: 9, bold: true, alignment: 'right', color: '#059669', fillColor: '#ECFDF5' }
    ]);

    const deductionsTableBody: any[] = [
      [{ text: 'Description', style: 'colHeader' }, { text: 'Amount (\u20b9)', style: 'colHeader', alignment: 'right' }]
    ];

    if (advanceDeduction > 0) {
      deductionsTableBody.push([
        { text: 'Advance Salary', fontSize: 9, color: '#111827' },
        { text: fmtDed(advanceDeduction), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if (pf > 0) {
      deductionsTableBody.push([
        { text: 'Provident Fund (PF)', fontSize: 9, color: '#111827' },
        { text: fmtDed(pf), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if (esic > 0) {
      deductionsTableBody.push([
        { text: 'ESIC / Tax', fontSize: 9, color: '#111827' },
        { text: fmtDed(esic), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if (absentDeduction > 0) {
      deductionsTableBody.push([
        { text: `Absent Deduction (${view.absentDays || 0} days)`, fontSize: 9, color: '#111827' },
        { text: fmtDed(absentDeduction), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if (halfDayDeduction > 0) {
      deductionsTableBody.push([
        { text: `Half Day Deduction (${view.halfDays || 0} half days)`, fontSize: 9, color: '#111827' },
        { text: fmtDed(halfDayDeduction), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if (leaveDeduction > 0) {
      deductionsTableBody.push([
        { text: `Leave Deduction (${view.unpaidLeaveDays || 0} unpaid leaves)`, fontSize: 9, color: '#111827' },
        { text: fmtDed(leaveDeduction), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }
    if (otherDeductions > 0) {
      deductionsTableBody.push([
        { text: 'Other Deductions', fontSize: 9, color: '#111827' },
        { text: fmtDed(otherDeductions), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    }

    if (deductionsTableBody.length === 1) {
      deductionsTableBody.push([
        { text: 'Advance Salary', fontSize: 9, color: '#6B7280' },
        { text: fmtDed(0), fontSize: 9, alignment: 'right', color: '#6B7280' }
      ]);
    }

    deductionsTableBody.push([
      { text: 'Total Deductions', fontSize: 9, bold: true, color: '#DC2626', fillColor: '#FEF2F2' },
      { text: fmtDed(deductions), fontSize: 9, bold: true, alignment: 'right', color: '#DC2626', fillColor: '#FEF2F2' }
    ]);

    const catEntries = Object.entries(expenseCategories);
    const reimbursementsTableBody: any[] = [
      [{ text: 'Description', style: 'colHeader' }, { text: 'Amount (\u20b9)', style: 'colHeader', alignment: 'right' }]
    ];

    if (catEntries.length > 0) {
      for (const [cat, amt] of catEntries) {
        reimbursementsTableBody.push([
          { text: `${cat} Expense`, fontSize: 9, color: '#111827' },
          { text: fmt(amt), fontSize: 9, alignment: 'right', color: '#111827' }
        ]);
      }
    } else if (expenseReimbursement > 0) {
      reimbursementsTableBody.push([
        { text: 'Approved Expenses', fontSize: 9, color: '#111827' },
        { text: fmt(expenseReimbursement), fontSize: 9, alignment: 'right', color: '#111827' }
      ]);
    } else {
      reimbursementsTableBody.push([
        { text: 'No Expenses / Reimbursements', fontSize: 9, color: '#6B7280', italics: true },
        { text: fmt(0), fontSize: 9, alignment: 'right', color: '#6B7280' }
      ]);
    }

    reimbursementsTableBody.push([
      { text: 'Total Reimbursements', fontSize: 9, bold: true, color: '#047857', fillColor: '#ECFDF5' },
      { text: fmt(expenseReimbursement), fontSize: 9, bold: true, alignment: 'right', color: '#047857', fillColor: '#ECFDF5' }
    ]);


    const docDefinition: any = {
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 56],
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: 'HOPKID Portal  \u2022  Confidential  \u2022  Computer Generated', fontSize: 8, color: '#9CA3AF', alignment: 'left' },
          { text: `Generated on ${generatedOn}  \u2022  Page ${currentPage} of ${pageCount}`, fontSize: 8, color: '#9CA3AF', alignment: 'right' },
        ],
        margin: [36, 0, 36, 0],
      }),
      content: [
        // Header banner
        { canvas: [
          { type: 'rect', x: -36, y: -36, w: 595, h: 90, color: PRIMARY },
          { type: 'rect', x: -36, y: 54,  w: 595, h: 6,  color: PRIMARY_DARK },
        ]},
        { columns: [
          { stack: [
            { text: 'HOPKID Portal', fontSize: 9, color: 'white', opacity: 0.7, margin: [0, -80, 0, 2] },
            { text: 'SALARY SLIP', fontSize: 20, bold: true, color: 'white', margin: [0, 0, 0, 2] },
            { text: `${view.employeeName || payslip.employeeName}  \u2022  ${view.employeeCode || payslip.employeeCode}  \u2022  ${view.department || payslip.department || '\u2014'}`, fontSize: 9, color: 'white', opacity: 0.85 },
          ]},
          { stack: [
            { text: monthLabel, fontSize: 12, bold: true, color: 'white', alignment: 'right', margin: [0, -78, 0, 4] },
            { text: view.officeName || payslip.officeName || '\u2014', fontSize: 9, color: 'white', opacity: 0.75, alignment: 'right' },
            { text: view.designation || payslip.designation || '\u2014', fontSize: 9, color: 'white', opacity: 0.75, alignment: 'right' },
          ]},
        ], margin: [0, 0, 0, 20] },
        // Stat cards
        { columns: [
          { stack: [{ text: fmt(grossEarnings), fontSize: 14, bold: true, color: PRIMARY, alignment: 'center' }, { text: 'GROSS EARNINGS', fontSize: 7, bold: true, color: '#6B7280', alignment: 'center', margin: [0,2,0,0] }], margin: [0,0,6,0] },
          { stack: [{ text: fmt(deductions),  fontSize: 14, bold: true, color: '#DC2626', alignment: 'center' }, { text: 'DEDUCTIONS',  fontSize: 7, bold: true, color: '#6B7280', alignment: 'center', margin: [0,2,0,0] }], margin: [0,0,6,0] },
          { stack: [{ text: fmt(netSalary),   fontSize: 14, bold: true, color: '#059669', alignment: 'center' }, { text: 'NET SALARY',  fontSize: 7, bold: true, color: '#6B7280', alignment: 'center', margin: [0,2,0,0] }], margin: [0,0,6,0] },
          ...(commissionEarned > 0 ? [{ stack: [{ text: fmt(commissionEarned), fontSize: 14, bold: true, color: '#0F766E', alignment: 'center' }, { text: 'COMMISSION', fontSize: 7, bold: true, color: '#6B7280', alignment: 'center', margin: [0,2,0,0] }], margin: [0,0,6,0] }] : []),
          ...(expenseReimbursement > 0 ? [{ stack: [{ text: fmt(expenseReimbursement), fontSize: 14, bold: true, color: '#0D9488', alignment: 'center' }, { text: 'REIMBURSEMENTS', fontSize: 7, bold: true, color: '#6B7280', alignment: 'center', margin: [0,2,0,0] }], margin: [0,0,6,0] }] : []),
          { stack: [{ text: fmt(totalTakeHomePay), fontSize: 14, bold: true, color: '#047857', alignment: 'center' }, { text: 'TAKE-HOME PAY', fontSize: 7, bold: true, color: '#6B7280', alignment: 'center', margin: [0,2,0,0] }] },
        ], margin: [0,0,0,16] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1, lineColor: '#E5E7EB' }], margin: [0,0,0,16] },
        // Employee info
        { columns: [
          { stack: [
            { text: 'EMPLOYEE DETAILS', fontSize: 8, bold: true, color: PRIMARY, margin: [0,0,0,6] },
            { text: [{ text: 'Name: ', bold: true, fontSize: 8 },        { text: view.employeeName || payslip.employeeName,        fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Code: ', bold: true, fontSize: 8 },        { text: view.employeeCode || payslip.employeeCode,        fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Designation: ', bold: true, fontSize: 8 }, { text: view.designation || payslip.designation || '\u2014', fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Department: ', bold: true, fontSize: 8 },  { text: view.department || payslip.department  || '\u2014', fontSize: 8, color: '#374151' }] },
          ], width: '50%' },
          { stack: [
            { text: 'PAY PERIOD DETAILS', fontSize: 8, bold: true, color: PRIMARY, margin: [0,0,0,6] },
            { text: [{ text: 'Month: ',               bold: true, fontSize: 8 }, { text: monthLabel,                  fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Office: ',              bold: true, fontSize: 8 }, { text: view.officeName || payslip.officeName || '\u2014', fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Total Days of Month: ', bold: true, fontSize: 8 }, { text: `${totalDaysInMonth} Days`,  fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Pay Date: ',            bold: true, fontSize: 8 }, { text: generatedOn,                 fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Status: ',              bold: true, fontSize: 8 }, { text: paymentStatus, fontSize: 8, bold: true, color: statusColor }] },
          ], width: '50%' },
        ], margin: [0,0,0,16] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.5, lineColor: '#E5E7EB' }], margin: [0,0,0,16] },
        // Attendance Summary Section
        { text: 'Attendance Summary', bold: true, fontSize: 11, color: '#111827', margin: [0,0,0,8] },
        { table: {
            widths: ['*', 'auto', '*', 'auto'],
            body: [
              [
                { text: 'Total Calendar Days', fontSize: 8, color: '#4B5563' }, { text: `${view.totalCalendarDays || totalDaysInMonth}`, fontSize: 8, bold: true },
                { text: 'Scheduled Working Days', fontSize: 8, color: '#4B5563' }, { text: `${view.workingDays || 26}`, fontSize: 8, bold: true }
              ],
              [
                { text: 'Present Days', fontSize: 8, color: '#4B5563' }, { text: `${view.presentDays || 0}`, fontSize: 8, bold: true, color: '#059669' },
                { text: 'Half Days', fontSize: 8, color: '#4B5563' }, { text: `${view.halfDays || 0}`, fontSize: 8, bold: true, color: '#D97706' }
              ],
              [
                { text: 'Paid Leave', fontSize: 8, color: '#4B5563' }, { text: `${view.paidLeaveDays || 0}`, fontSize: 8, bold: true },
                { text: 'Unpaid Leave', fontSize: 8, color: '#4B5563' }, { text: `${view.unpaidLeaveDays || 0}`, fontSize: 8, bold: true, color: '#DC2626' }
              ],
              [
                { text: 'Absent Days', fontSize: 8, color: '#4B5563' }, { text: `${view.absentDays || 0}`, fontSize: 8, bold: true, color: '#DC2626' },
                { text: 'Holidays (Not Worked)', fontSize: 8, color: '#4B5563' }, { text: `${view.holidayCount || 0}`, fontSize: 8, bold: true }
              ],
              [
                { text: 'Weekly Offs', fontSize: 8, color: '#4B5563' }, { text: `${view.weeklyOffCount || 0}`, fontSize: 8, bold: true },
                { text: 'Holiday Worked', fontSize: 8, color: '#4B5563' }, { text: `${view.holidayWorkedCount || 0}`, fontSize: 8, bold: true, color: PRIMARY }
              ],
              [
                { text: 'Weekly Off Worked', fontSize: 8, color: '#4B5563' }, { text: `${view.weeklyOffWorkedCount || 0}`, fontSize: 8, bold: true, color: PRIMARY },
                { text: 'Daily Salary', fontSize: 8, color: '#4B5563' }, { text: fmt(dailySalary), fontSize: 8, bold: true }
              ]
            ]
          },
          layout: 'lightHorizontalLines',
          margin: [0,0,0,16]
        },
        // Earnings
        { text: 'Earnings', bold: true, fontSize: 11, color: '#111827', margin: [0,0,0,8] },
        { table: { headerRows: 1, widths: ['*', 120],
            body: earningsTableBody,
          },
          layout: { hLineWidth: (i: number) => i <= 1 ? 1.5 : 0.5, vLineWidth: () => 0, hLineColor: (i: number) => i <= 1 ? PRIMARY : '#F3F4F6', paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
          margin: [0,0,0,16],
        },
        // Deductions
        { text: 'Deductions', bold: true, fontSize: 11, color: '#111827', margin: [0,0,0,8] },
        { table: { headerRows: 1, widths: ['*', 120],
            body: deductionsTableBody,
          },
          layout: { hLineWidth: (i: number) => i <= 1 ? 1.5 : 0.5, vLineWidth: () => 0, hLineColor: (i: number) => i <= 1 ? PRIMARY : '#F3F4F6', paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
          margin: [0,0,0,16],
        },
        // Reimbursements / Expenses
        { text: 'Reimbursements / Expenses', bold: true, fontSize: 11, color: '#111827', margin: [0,0,0,8] },
        { table: { headerRows: 1, widths: ['*', 120],
            body: reimbursementsTableBody,
          },
          layout: { hLineWidth: (i: number) => i <= 1 ? 1.5 : 0.5, vLineWidth: () => 0, hLineColor: (i: number) => i <= 1 ? PRIMARY : '#F3F4F6', paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
          margin: [0,0,0,20],
        },
        // Net salary box
        { canvas: [{ type: 'rect', x: 0, y: 0, w: 523, h: 58, color: '#F0FDFA', r: 2 }, { type: 'rect', x: 0, y: 0, w: 6, h: 58, color: PRIMARY }] },
        { columns: [
          { stack: [
            { text: `Net Salary: ${fmt(netSalary)} ${commissionEarned > 0 ? `+ Commission: ${fmt(commissionEarned)} ` : ''}${expenseReimbursement > 0 ? `+ Reimbursements: ${fmt(expenseReimbursement)}` : ''}`, fontSize: 8, color: '#4B5563', margin: [0,-52,0,2] },
            { text: 'TOTAL TAKE-HOME PAY', fontSize: 9, bold: true, color: '#111827', margin: [0,0,0,2] },
            { text: view.netInWords || `${numToWords(Math.round(totalTakeHomePay))} Rupees Only`, fontSize: 8, color: '#374151', italics: true },
          ], margin: [14,0,0,0] },
          { text: fmt(totalTakeHomePay), fontSize: 18, bold: true, color: PRIMARY, alignment: 'right', margin: [0,-52,0,0] },
        ], margin: [0,0,0,24] },
        // Disclaimer
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.5, lineColor: '#E5E7EB' }], margin: [0,4,0,10] },
        { text: 'This is a system-generated salary slip and does not require a physical signature. For any discrepancy, please contact the HR department.', fontSize: 8, color: '#9CA3AF', italics: true, alignment: 'center' },
      ],
      styles: { colHeader: { fontSize: 8, bold: true, color: 'white', fillColor: PRIMARY } },
      defaultStyle: { font: 'Roboto', fontSize: 10 },
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const chunks: Buffer[] = [];
    pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const safeName = payslip.employeeName.replace(/\s+/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="payslip_${payslip.employeeCode}_${safeName}_${monthLabel.replace(' ','_')}.pdf"`);
      res.send(pdfBuffer);
    });
    pdfDoc.end();
  } catch (error) {
    console.error('Generate payslip PDF error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate payslip PDF.', errorCode: 'GENERATE_PAYSLIP_PDF_ERROR' });
  }
};

export const approvePayslip = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { payslipId } = req.params;
    const { notes } = req.body;

    if (!payslipId) {
      res.status(400).json({
        success: false,
        message: 'Payslip ID is required.',
        errorCode: 'MISSING_PAYSLIP_ID'
      });
      return;
    }

    const payslipIdStr = Array.isArray(payslipId) ? payslipId[0] : payslipId;

    const payslip = await prisma.payslip.update({
      where: { id: parseInt(payslipIdStr) },
      data: {
        status: 'Approved',
        updatedAt: new Date()
      }
    });

    // 1. Notify Employee
    notifyEmployee({
      employeeId: payslip.employeeId,
      title: 'Salary Approved',
      message: `Your salary for ${payslip.month}/${payslip.year} has been approved.`,
      category: 'PAYROLL',
      actionType: 'SALARY_APPROVED',
      actionId: String(payslip.id),
    }).catch(() => {});

    // 2. Notify Authorized HR/Admin Team
    sendHRNotification({
      title: 'Salary Approved',
      message: `Payslip #${payslip.id} for employee #${payslip.employeeId} (${payslip.month}/${payslip.year}) has been approved.`,
      category: 'PAYROLL',
      actionType: 'SALARY_APPROVED',
      actionId: String(payslip.id),
      employeeId: payslip.employeeId,
      requiredModuleId: 'pa-payroll',
    }).catch(err => console.error('[HR Notification] Payslip approve notice error:', err));

    res.json({
      success: true,
      message: 'Payslip approved successfully.',
      payslip
    });
  } catch (error) {
    console.error('Approve payslip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve payslip.',
      errorCode: 'APPROVE_PAYSLIP_ERROR'
    });
  }
};

export const rejectPayslip = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { payslipId } = req.params;
    const { reason } = req.body;

    if (!payslipId) {
      res.status(400).json({
        success: false,
        message: 'Payslip ID is required.',
        errorCode: 'MISSING_PAYSLIP_ID'
      });
      return;
    }

    const payslipIdStr = Array.isArray(payslipId) ? payslipId[0] : payslipId;

    const payslip = await prisma.payslip.update({
      where: { id: parseInt(payslipIdStr) },
      data: {
        status: 'Rejected',
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Payslip rejected successfully.',
      payslip
    });
  } catch (error) {
    console.error('Reject payslip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject payslip.',
      errorCode: 'REJECT_PAYSLIP_ERROR'
    });
  }
};

export const getPayrollDashboard = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month, year } = req.query as { month?: string, year?: string };
    
    const now = new Date();
    const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istTime);
    let targetYear = istDate.getUTCFullYear();
    let targetMonth = istDate.getUTCMonth() + 1;

    if (month && String(month).includes('-')) {
      const parts = String(month).split('-');
      targetYear = parseInt(parts[0], 10);
      targetMonth = parseInt(parts[1], 10);
    } else {
      if (year && !isNaN(parseInt(String(year), 10))) targetYear = parseInt(String(year), 10);
      if (month && !isNaN(parseInt(String(month), 10))) targetMonth = parseInt(String(month), 10);
    }

    // Get comprehensive dashboard data
    const stats = await payrollService.getPayrollStats(targetMonth, targetYear);
    const recentRuns = await payrollService.getPayrollRuns(5);
    
    // Get pending approvals
    const pendingApprovals = await prisma.payslip.count({
      where: {
        status: 'Pending',
        month: targetMonth,
        year: targetYear
      }
    });

    // Get recent payroll activities
    const recentActivities = await prisma.payslip.findMany({
      where: {
        month: targetMonth,
        year: targetYear
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: 10
    });

    const dashboard = {
      stats,
      recentRuns,
      pendingApprovals,
      recentActivities,
      month: targetMonth,
      year: targetYear
    };

    res.json({
      success: true,
      dashboard
    });
  } catch (error) {
    console.error('Get payroll dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payroll dashboard.',
      errorCode: 'GET_PAYROLL_DASHBOARD_ERROR'
    });
  }
};

// Admin-specific endpoints for frontend
export const getAdminPayrollStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month, year } = req.query as { month?: string, year?: string };
    
    const now = new Date();
    const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istTime);
    let targetYear = istDate.getUTCFullYear();
    let targetMonth = istDate.getUTCMonth() + 1;

    if (month && String(month).includes('-')) {
      const parts = String(month).split('-');
      targetYear = parseInt(parts[0], 10);
      targetMonth = parseInt(parts[1], 10);
    } else {
      if (year && !isNaN(parseInt(String(year), 10))) targetYear = parseInt(String(year), 10);
      if (month && !isNaN(parseInt(String(month), 10))) targetMonth = parseInt(String(month), 10);
    }

    const stats = await payrollService.getPayrollStats(targetMonth, targetYear);
    
    // Transform to match frontend expectations
    const transformedStats = {
      mtdVolume: stats.summary?.total_net_salary || 0,
      disbursed: stats.summary?.disbursed_amount || 0,
      pending: stats.summary?.pending_amount !== undefined ? stats.summary?.pending_amount : (stats.summary?.total_net_salary || 0),
      totalGrossSalary: stats.summary?.total_gross_salary || 0,
      totalDeductions: stats.summary?.total_deductions || 0,
      paidCount: stats.summary?.paid_count || 0,
      pendingCount: stats.summary?.pending_count || 0,
      errors: 0
    };

    // Get trend data for 5 months leading up to target month
    const trendData = [];
    for (let i = 4; i >= 0; i--) {
      const trendDate = new Date(targetYear, targetMonth - 1 - i, 1);
      const m = trendDate.getMonth() + 1;
      const y = trendDate.getFullYear();
      const monthStats = await payrollService.getPayrollStats(m, y);
      trendData.push({
        name: trendDate.toLocaleDateString('en-US', { month: 'short' }),
        amount: monthStats.summary?.total_net_salary || 0,
        trend: 0
      });
    }

    res.json({
      success: true,
      stats: transformedStats,
      trend: trendData
    });
  } catch (error) {
    console.error('Get admin payroll stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get admin payroll stats.',
      errorCode: 'GET_ADMIN_PAYROLL_STATS_ERROR'
    });
  }
};

export const getAdminPayrollRuns = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { limit = '50' } = req.query as { limit: string };
    const limitNum = parseInt(limit) || 50;

    const runs = await payrollService.getPayrollRuns(limitNum);
    
    // Transform to match frontend expectations
    const transformedRuns = (runs || []).map(run => ({
      id: run.id,
      company: 'System Generated',
      employees: run.totalEmployees || 0,
      totalAmount: `₹${(run.totalAmount || 0).toLocaleString('en-IN')}`,
      status: run.status || 'COMPLETED',
      date: run.startedAt ? new Date(run.startedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'
    }));

    res.json({
      success: true,
      data: transformedRuns,
      runs: transformedRuns
    });
  } catch (error) {
    console.error('Get admin payroll runs error:', error);
    res.json({
      success: true,
      data: [],
      runs: [],
      message: 'No payroll runs found.'
    });
  }
};

export const getAdminPayrollSlips = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month } = req.query as { month?: string };
    
    let whereClause: any = {};
    let targetMonth: number | null = null;
    let targetYear: number | null = null;

    if (!month || month === 'current') {
      const now = new Date();
      const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
      const istDate = new Date(istTime);
      targetMonth = istDate.getUTCMonth() + 1;
      targetYear = istDate.getUTCFullYear();
      whereClause = { month: targetMonth, year: targetYear };
    } else if (month !== 'ALL') {
      const [year, monthNum] = month.split('-').map(Number);
      if (year && monthNum) {
        targetMonth = monthNum;
        targetYear = year;
        whereClause = { month: monthNum, year: year };
      }
    }

    let slips = await prisma.payslip.findMany({
      where: whereClause,
      include: {
        employee: {
          include: {
            department: true,
            office: true,
            salaryStructure: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // If querying a specific month/year and 0 payslips exist, auto-generate payroll for all active employees
    if (slips.length === 0 && targetMonth !== null && targetYear !== null) {
      console.log(`ℹ️ [PayslipManager] No payslips found for ${targetMonth}/${targetYear}. Auto-generating payroll...`);
      await payrollService.autoGenerateMonthlyPayroll(targetMonth, targetYear);

      slips = await prisma.payslip.findMany({
        where: whereClause,
        include: {
          employee: {
            include: {
              department: true,
              office: true,
              salaryStructure: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
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

    // Transform to match frontend expectations safely
    const transformedSlips = await Promise.all(slips.map(async (slip) => {
      return await payrollService.resolveFullPayslipView(slip, slip.employee);
    }));

    res.json({
      success: true,
      slips: transformedSlips,
      data: transformedSlips,
      records: transformedSlips,
      total: transformedSlips.length
    });
  } catch (error) {
    console.error('Get admin payroll slips error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get admin payroll slips.',
      errorCode: 'GET_ADMIN_PAYROLL_SLIPS_ERROR'
    });
  }
};

export const approveAdminPayslip = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, month, year } = req.body;

    if (!employeeId || !month || !year) {
      res.status(400).json({
        success: false,
        message: 'Employee ID, month, and year are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    // Update payslip status
    const payslip = await prisma.payslip.updateMany({
      where: {
        employeeId: parseInt(employeeId),
        month: parseInt(month),
        year: parseInt(year)
      },
      data: {
        status: 'Approved',
        updatedAt: new Date()
      }
    });

    if (payslip.count === 0) {
      res.status(404).json({
        success: false,
        message: 'Payslip not found.',
        errorCode: 'PAYSLIP_NOT_FOUND'
      });
      return;
    }

    // 1. Notify Affected Employee
    notifyEmployee({
      employeeId: parseInt(employeeId),
      title: 'Salary Approved',
      message: `Your salary for ${month}/${year} has been approved.`,
      category: 'PAYROLL',
      actionType: 'SALARY_APPROVED',
      actionId: `${employeeId}-${month}-${year}`,
    }).catch(() => {});

    // 2. Notify Authorized HR/Admin Team
    sendHRNotification({
      title: 'Salary Approved',
      message: `Salary slip for employee #${employeeId} (${month}/${year}) has been approved.`,
      category: 'PAYROLL',
      actionType: 'SALARY_APPROVED',
      actionId: `${employeeId}-${month}-${year}`,
      employeeId: parseInt(employeeId),
      requiredModuleId: 'pa-payroll',
    }).catch(err => console.error('[HR Notification] Salary approve notice error:', err));

    res.json({
      success: true,
      message: 'Salary slip approved and generated successfully!'
    });
  } catch (error) {
    console.error('Approve admin payslip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve salary slip.',
      errorCode: 'APPROVE_ADMIN_PAYSLIP_ERROR'
    });
  }
};

export const bulkDisbursePayroll = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month, year } = req.body || {};
    const currentMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year) : new Date().getFullYear();

    const approvedPayslips = await prisma.payslip.findMany({
      where: {
        month: currentMonth,
        year: currentYear,
        status: { in: ['Approved', 'APPROVED'] }
      }
    });

    // Update status to Paid
    await prisma.payslip.updateMany({
      where: {
        month: currentMonth,
        year: currentYear,
        status: { in: ['Approved', 'APPROVED'] }
      },
      data: {
        status: 'Paid',
        updatedAt: new Date()
      }
    });

    // 1. Notify Each Affected Employee
    for (const p of approvedPayslips) {
      notifyEmployee({
        employeeId: p.employeeId,
        title: 'Salary Paid',
        message: `Your salary for ${p.month}/${p.year} has been marked as paid.`,
        category: 'PAYROLL',
        actionType: 'SALARY_PAID',
        actionId: String(p.id),
      }).catch(() => {});
    }

    // 2. Notify Authorized HR/Admin Team
    sendHRNotification({
      title: 'Salary Paid',
      message: `Salary disbursement completed for ${approvedPayslips.length} employee(s) for ${currentMonth}/${currentYear}.`,
      category: 'PAYROLL',
      actionType: 'SALARY_PAID',
      actionId: `${currentMonth}-${currentYear}`,
      requiredModuleId: 'pa-payroll',
    }).catch(err => console.error('[HR Notification] Bulk disburse notice error:', err));

    res.json({
      success: true,
      message: `Disbursement completed successfully! Processed ${approvedPayslips.length} payslips.`
    });
  } catch (error) {
    console.error('Bulk disburse payroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk disbursement.',
      errorCode: 'BULK_DISBURSE_PAYROLL_ERROR'
    });
  }
};

export const disburseAdminPayslip = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { payslipId, employeeId, month, year } = req.body || {};
    let whereClause: any = {};
    if (payslipId) {
      whereClause.id = parseInt(payslipId);
    } else if (employeeId && month && year) {
      whereClause.employeeId = parseInt(employeeId);
      whereClause.month = parseInt(month);
      whereClause.year = parseInt(year);
    } else {
      res.status(400).json({
        success: false,
        message: 'Payslip ID or (employeeId, month, year) are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const updateRes = await prisma.payslip.updateMany({
      where: whereClause,
      data: {
        status: 'Paid',
        updatedAt: new Date()
      }
    });

    if (updateRes.count === 0) {
      res.status(404).json({
        success: false,
        message: 'No matching payslip found to disburse.',
        errorCode: 'PAYSLIP_NOT_FOUND'
      });
      return;
    }

    // 1. Notify Affected Employee
    if (employeeId) {
      notifyEmployee({
        employeeId: parseInt(employeeId),
        title: 'Salary Paid',
        message: `Your salary for ${month || ''}/${year || ''} has been marked as paid.`,
        category: 'PAYROLL',
        actionType: 'SALARY_PAID',
        actionId: String(payslipId || employeeId),
      }).catch(() => {});
    }

    // 2. Notify Authorized HR/Admin Team
    sendHRNotification({
      title: 'Salary Paid',
      message: `Salary marked as Paid for employee #${employeeId || payslipId} (${month || ''}/${year || ''}).`,
      category: 'PAYROLL',
      actionType: 'SALARY_PAID',
      actionId: String(payslipId || employeeId),
      employeeId: employeeId ? parseInt(employeeId) : undefined,
      requiredModuleId: 'pa-payroll',
    }).catch(err => console.error('[HR Notification] Disburse notice error:', err));

    res.json({
      success: true,
      message: 'Salary marked as Paid and disbursed successfully!'
    });
  } catch (error) {
    console.error('Disburse admin payslip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disburse salary.',
      errorCode: 'DISBURSE_ADMIN_PAYSLIP_ERROR'
    });
  }
};