import { Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import payrollService, { payslipComponentData } from '../../services/payrollService';
import { getIstMonthRange } from '../../utils/commissionHelper';
import { numToWords } from '../../services/payrollAutomationService';
import { buildPayslipEarningLines } from '../../utils/salaryGross';
import { absentDeductionLabel, attendanceSummaryPdfContent } from '../../utils/attendanceSummaryPdf';
import { generateSalarySlipPdfStream } from '../../utils/salarySlipPdfGenerator';
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


    const rawPayslips = await prisma.payslip.findMany({
      where: { employeeId: employee.id },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' }
      ]
    });

    const toPayslipView = async (ps: (typeof rawPayslips)[number]) => {
      return await payrollService.resolveFullPayslipView(ps, employee);
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

    // Fetch employee salary structure for reference if needed
    const employeeWithSalary = await prisma.employee.findUnique({
      where: { id: payslip.employeeId },
      include: { salaryStructure: true, office: true, department: true, user: true }
    });

    // SINGLE SOURCE OF TRUTH: Get the fully resolved view object
    const view = await payrollService.resolveFullPayslipView(payslip, employeeWithSalary);

    const pdfDoc = generateSalarySlipPdfStream({
      employeeName: view.employeeName || payslip.employeeName,
      employeeCode: view.employeeCode || payslip.employeeCode,
      designation: view.designation || payslip.designation,
      department: view.department || payslip.department,
      officeName: view.officeName || payslip.officeName,
      month: payslip.month,
      year: payslip.year,
      paymentStatus: view.paymentStatus || payslip.status,
      documentId: view.documentId,
      totalCalendarDays: view.totalCalendarDays,
      earnings: view.earnings,
      extraHolidayPayout: view.extraHolidayPayout,
      extraWeeklyOffPayout: view.extraWeeklyOffPayout,
      deductionsObj: view.deductionsObj,
      absentDays: view.absentDays,
      halfDays: view.halfDays,
      unpaidLeaveDays: view.unpaidLeaveDays,
      expenseCategories: view.expenseCategories,
      expenseReimbursement: view.expenseReimbursement,
      totalReimbursements: view.totalReimbursements,
      commissionEarned: view.commissionEarned,
      rkdIncentive: view.rkdIncentive,
      rkdReferences: view.rkdReferences,
      rkdRequests: view.rkdRequests,
      isCommissionEligible: view.isCommissionEligible,
      netSalary: view.netSalary,
      totalTakeHomePay: view.totalTakeHomePay,
      netInWords: view.netInWords,
      attendanceSummary: view.attendanceSummary,
    });

    const safeName = (view.employeeName || payslip.employeeName).replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=SalarySlip_${view.employeeCode || payslip.employeeCode}_${safeName}_${payslip.year}_${payslip.month}.pdf`);

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

// Fetch date-wise salary breakdown for the logged-in employee (Mobile)
export const getMyDateWiseSalaryBreakdown = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month, year, employeeId: qEmpId } = req.query;

    let targetEmployeeId: number | null = null;
    const isHrOrAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'HR', 'STORE_MANAGER'].includes(req.user?.role || '');

    if (qEmpId && isHrOrAdmin && !isNaN(Number(qEmpId))) {
      targetEmployeeId = Number(qEmpId);
    } else if (req.user?.id) {
      const emp = await prisma.employee.findFirst({
        where: { userId: req.user.id },
      });
      if (emp) {
        targetEmployeeId = emp.id;
      }
    }

    if (!targetEmployeeId) {
      res.status(404).json({
        success: false,
        message: 'No employee record linked to this account.',
      });
      return;
    }

    const now = new Date();
    const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istTime);
    let targetYear = istDate.getUTCFullYear();
    let targetMonth = istDate.getUTCMonth() + 1;

    if (year && !isNaN(Number(year))) {
      targetYear = Number(year);
    }
    if (month && !isNaN(Number(month))) {
      targetMonth = Number(month);
    }

    const { dateWiseSalaryService } = await import('../../services/dateWiseSalaryService');
    const result = await dateWiseSalaryService.getDateWiseBreakdown(targetEmployeeId, targetMonth, targetYear);

    res.json({
      success: true,
      data: result,
      summary: result.summary,
      dates: result.dates,
    });
  } catch (error: any) {
    console.error('Get date-wise salary breakdown error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Failed to fetch date-wise salary breakdown',
    });
  }
};

