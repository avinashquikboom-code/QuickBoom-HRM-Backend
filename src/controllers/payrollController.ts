import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import payrollService from '../services/payrollService';
import { prisma } from '../utils/db';
import { getIstMonthRange } from '../utils/commissionHelper';
import { numToWords } from '../services/payrollAutomationService';
import { sendHRNotification, notifyEmployee } from '../utils/hrNotificationHelper';
import { buildPayslipEarningLines } from '../utils/salaryGross';
import { absentDeductionLabel, attendanceSummaryPdfContent } from '../utils/attendanceSummaryPdf';
import { generateSalarySlipPdfStream } from '../utils/salarySlipPdfGenerator';

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
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const view = await payrollService.resolveFullPayslipView(payslip, payslip.employee);

    const pdfDoc = generateSalarySlipPdfStream({
      employeeName: view.employeeName || payslip.employeeName,
      employeeCode: view.employeeCode || payslip.employeeCode,
      designation: view.designation || payslip.designation,
      department: view.department || payslip.department,
      officeName: view.officeName || payslip.officeName,
      month: monthNum,
      year: yearNum,
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
      commissionEarned: view.commissionEarned,
      isCommissionEligible: view.isCommissionEligible,
      netSalary: view.netSalary,
      totalTakeHomePay: view.totalTakeHomePay,
      netInWords: view.netInWords,
      attendanceSummary: view.attendanceSummary,
    });

    const chunks: Buffer[] = [];
    pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      const safeName = (view.employeeName || payslip.employeeName).replace(/\s+/g, '_');
      const monthLabel = `${MONTH_NAMES[monthNum - 1]}_${yearNum}`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="payslip_${view.employeeCode || payslip.employeeCode}_${safeName}_${monthLabel}.pdf"`);
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

    const transition = await prisma.payslip.updateMany({
      where: { id: parseInt(payslipIdStr), status: { notIn: ['Paid', 'PAID', 'paid'] } },
      data: {
        status: 'Approved',
        updatedAt: new Date()
      }
    });
    const payslip = await prisma.payslip.findUnique({ where: { id: parseInt(payslipIdStr) } });
    if (!payslip || !transition.count) {
      res.status(payslip ? 409 : 404).json({ success: false, message: payslip ? 'Paid payslips cannot be changed.' : 'Payslip not found.' });
      return;
    }
    await payrollService.notifyPublishedPayslip(payslip.employeeId, payslip.month, payslip.year);


    // 1. Notify Employee
    await notifyEmployee({
      employeeId: payslip.employeeId,
      title: 'Salary Approved',
      message: `Your salary for ${payslip.month}/${payslip.year} has been approved.`,
      category: 'PAYROLL',
      actionType: 'SALARY_APPROVED',
      deduplicate: true,
      actionId: `${payslip.employeeId}-${payslip.month}-${payslip.year}`,
    }).catch(() => {});

    // 2. Notify Authorized HR/Admin Team
    await sendHRNotification({
      title: 'Salary Approved',
      message: `Payslip #${payslip.id} for employee #${payslip.employeeId} (${payslip.month}/${payslip.year}) has been approved.`,
      category: 'PAYROLL',
      actionType: 'SALARY_APPROVED',
      actionId: `${payslip.employeeId}-${payslip.month}-${payslip.year}`,
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

    const transition = await prisma.payslip.updateMany({
      where: { id: parseInt(payslipIdStr), status: { notIn: ['Paid', 'PAID', 'paid'] } },
      data: {
        status: 'Rejected',
        updatedAt: new Date()
      }
    });
    const payslip = await prisma.payslip.findUnique({ where: { id: parseInt(payslipIdStr) } });
    if (!payslip || !transition.count) {
      res.status(payslip ? 409 : 404).json({ success: false, message: payslip ? 'Paid payslips cannot be changed.' : 'Payslip not found.' });
      return;
    }


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
        year: parseInt(year),
        status: { notIn: ['Paid', 'PAID', 'paid'] }
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

    await payrollService.notifyPublishedPayslip(parseInt(employeeId), parseInt(month), parseInt(year));

    // 1. Notify Affected Employee
    notifyEmployee({
      employeeId: parseInt(employeeId),
      title: 'Salary Approved',
      message: `Your salary for ${month}/${year} has been approved.`,
      category: 'PAYROLL',
      actionType: 'SALARY_APPROVED',
      deduplicate: true,
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

async function applyAdvanceRecoveryForPaidPayslip(tx: any, employeeId: number, advanceDeduction: number): Promise<void> {
  if (!advanceDeduction || advanceDeduction <= 0) return;
  let remainingToRecover = advanceDeduction;
  const advances = await tx.salaryAdvance.findMany({
    where: {
      wallet: { employeeId },
      status: 'APPROVED',
      remainingAmount: { gt: 0 }
    },
    orderBy: { approvedAt: 'asc' }
  });
  for (const adv of advances) {
    if (remainingToRecover <= 0) break;
    const rec = Math.min(remainingToRecover, adv.remainingAmount);
    remainingToRecover -= rec;
    const newRemaining = Math.max(0, Math.round((adv.remainingAmount - rec) * 100) / 100);
    const newPaid = Math.round(((adv.paidAmount || 0) + rec) * 100) / 100;
    const newPaidEmis = (adv.paidEmis || 0) + 1;
    await tx.salaryAdvance.update({
      where: { id: adv.id },
      data: {
        remainingAmount: newRemaining,
        paidAmount: newPaid,
        paidEmis: newPaidEmis,
      }
    });
  }
}

// The successful conditional update owns both recovery and the notification event.
async function markPayslipPaid(p: { id: number; employeeId: number; month: number; year: number; advanceDeduction: number }) {
  const changed = await prisma.$transaction(async tx => {
    // Serialize recovery for different periods of the same employee too.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${p.employeeId})`;
    const claim = await tx.payslip.updateMany({
      where: { id: p.id, status: { in: ['Approved', 'APPROVED'] } },
      data: { status: 'Paid', updatedAt: new Date() },
    });
    if (!claim.count) return false;
    await applyAdvanceRecoveryForPaidPayslip(tx, p.employeeId, p.advanceDeduction);
    return true;
  });
  if (!changed) return false;
  // Disbursement and Paid are the same transition in this workflow.
  await notifyEmployee({
    employeeId: p.employeeId, title: 'Salary Paid',
    message: `Your salary for ${p.month}/${p.year} has been marked as paid.`,
    category: 'PAYROLL', actionType: 'SALARY_PAID',
    actionId: `${p.employeeId}-${p.month}-${p.year}`, deduplicate: true,
    extraData: { payslipId: String(p.id), month: String(p.month), year: String(p.year), status: 'PAID' },
  });
  return true;
}

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

    let paidCount = 0;
    for (const p of approvedPayslips) if (await markPayslipPaid(p)) paidCount++;
    if (paidCount > 0) {
      // 2. Notify Authorized HR/Admin Team
      await sendHRNotification({
        title: 'Salary Paid',
        message: `Salary disbursement completed for ${paidCount} employee(s) for ${currentMonth}/${currentYear}.`,
        category: 'PAYROLL',
        actionType: 'SALARY_PAID',
        actionId: `${currentMonth}-${currentYear}`,
        requiredModuleId: 'pa-payroll',
    }).catch(err => console.error('[HR Notification] Bulk disburse notice error:', err));

    }

    res.json({
      success: true,
      message: `Disbursement completed successfully! Processed ${paidCount} payslips.`
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

    const targetPayslips = await prisma.payslip.findMany({ where: whereClause });
    if (targetPayslips.length === 0) {
      res.status(404).json({ success: false, message: 'No matching payslip found.', errorCode: 'PAYSLIP_NOT_FOUND' });
      return;
    }
    if (targetPayslips.some(p => !['APPROVED', 'PAID'].includes(p.status.toUpperCase()))) {
      res.status(409).json({ success: false, message: 'Payslip must be approved before disbursement.' });
      return;
    }
    const paidPayslips = [];
    for (const p of targetPayslips) if (await markPayslipPaid(p)) paidPayslips.push(p);
    // Use persisted recipient/period, even when only payslipId was supplied.
    for (const p of paidPayslips) {
      // 2. Notify Authorized HR/Admin Team
      await sendHRNotification({
        title: 'Salary Paid',
        message: `Salary marked as Paid for employee #${p.employeeId} (${p.month}/${p.year}).`,
        category: 'PAYROLL',
        actionType: 'SALARY_PAID',
        actionId: `${p.employeeId}-${p.month}-${p.year}`,
        employeeId: p.employeeId,
        requiredModuleId: 'pa-payroll',
    }).catch(err => console.error('[HR Notification] Disburse notice error:', err));

    }

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

export const getExtraAttendancePayRule = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const settings = await prisma.systemSetting.findFirst();
    const payrollConfig = (settings?.payroll as any) || {};
    const extraAttendancePay = payrollConfig.extraAttendancePay || {
      enabled: false,
      type: 'PER_DAY_RATE',
      rateMultiplier: 1.0,
      fixedAmount: 0,
      minimumPresentDays: 30,
    };

    res.json({
      success: true,
      data: extraAttendancePay,
    });
  } catch (error) {
    console.error('getExtraAttendancePayRule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve extra attendance pay rule.',
    });
  }
};

export const updateExtraAttendancePayRule = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { enabled, type, rateMultiplier, fixedAmount, minimumPresentDays } = req.body || {};

    const validatedRule = {
      enabled: Boolean(enabled),
      type: type === 'FIXED_AMOUNT' ? 'FIXED_AMOUNT' : 'PER_DAY_RATE',
      rateMultiplier: Number.isFinite(Number(rateMultiplier)) && Number(rateMultiplier) >= 0 ? Number(rateMultiplier) : 1.0,
      fixedAmount: Number.isFinite(Number(fixedAmount)) && Number(fixedAmount) >= 0 ? Number(fixedAmount) : 0,
      minimumPresentDays: Number.isFinite(Number(minimumPresentDays)) && Number(minimumPresentDays) >= 0 ? Number(minimumPresentDays) : 30,
    };

    let settings = await prisma.systemSetting.findFirst();
    const currentPayroll = (settings?.payroll as any) || {};
    const updatedPayroll = {
      ...currentPayroll,
      extraAttendancePay: validatedRule,
    };

    if (settings) {
      await prisma.systemSetting.update({
        where: { id: settings.id },
        data: { payroll: updatedPayroll },
      });
    } else {
      await prisma.systemSetting.create({
        data: {
          id: 1,
          payroll: updatedPayroll,
        },
      });
    }

    res.json({
      success: true,
      message: 'Extra attendance pay rule updated successfully.',
      data: validatedRule,
    });
  } catch (error) {
    console.error('updateExtraAttendancePayRule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update extra attendance pay rule.',
    });
  }
};