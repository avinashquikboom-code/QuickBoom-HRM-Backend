import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import payrollService from '../services/payrollService';
import { prisma } from '../utils/db';

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
    const limitNum = parseInt(limit);

    const runs = await payrollService.getPayrollRuns(limitNum);

    res.json({
      success: true,
      runs
    });
  } catch (error) {
    console.error('Get payroll runs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payroll runs.',
      errorCode: 'GET_PAYROLL_RUNS_ERROR'
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

    res.json({
      success: true,
      payslips
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
      include: { employee: { include: { department: true, office: true } } }
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
    const grossSalary = payslip.baseSalary + payslip.allowance;
    const netSalary   = payslip.netSalary;
    const deductions  = payslip.deductions;
    const generatedOn = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const monthLabel  = `${MONTH_NAMES[monthNum - 1]} ${yearNum}`;
    const statusColor = payslip.status === 'PAID' ? '#059669' : payslip.status === 'PENDING' ? '#D97706' : '#6B7280';
    const fmt = (n: number) => `\u20b9${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    const docDefinition: any = {
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 56],
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: 'HRM Portal  \u2022  Confidential  \u2022  Computer Generated', fontSize: 8, color: '#9CA3AF', alignment: 'left' },
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
            { text: 'HRM Portal', fontSize: 9, color: 'white', opacity: 0.7, margin: [0, -80, 0, 2] },
            { text: 'SALARY SLIP', fontSize: 20, bold: true, color: 'white', margin: [0, 0, 0, 2] },
            { text: `${payslip.employeeName}  \u2022  ${payslip.employeeCode}  \u2022  ${payslip.department || '\u2014'}`, fontSize: 9, color: 'white', opacity: 0.85 },
          ]},
          { stack: [
            { text: monthLabel, fontSize: 12, bold: true, color: 'white', alignment: 'right', margin: [0, -78, 0, 4] },
            { text: payslip.officeName || '\u2014', fontSize: 9, color: 'white', opacity: 0.75, alignment: 'right' },
            { text: payslip.designation || '\u2014', fontSize: 9, color: 'white', opacity: 0.75, alignment: 'right' },
          ]},
        ], margin: [0, 0, 0, 20] },
        // Stat cards
        { columns: [
          { stack: [{ text: fmt(grossSalary), fontSize: 15, bold: true, color: PRIMARY, alignment: 'center' }, { text: 'GROSS SALARY', fontSize: 7, bold: true, color: '#6B7280', alignment: 'center', margin: [0,2,0,0] }], margin: [0,0,8,0] },
          { stack: [{ text: fmt(deductions),  fontSize: 15, bold: true, color: '#DC2626', alignment: 'center' }, { text: 'DEDUCTIONS',  fontSize: 7, bold: true, color: '#6B7280', alignment: 'center', margin: [0,2,0,0] }], margin: [0,0,8,0] },
          { stack: [{ text: fmt(netSalary),   fontSize: 15, bold: true, color: '#059669', alignment: 'center' }, { text: 'NET SALARY',  fontSize: 7, bold: true, color: '#6B7280', alignment: 'center', margin: [0,2,0,0] }], margin: [0,0,8,0] },
          { stack: [{ text: payslip.status,   fontSize: 12, bold: true, color: statusColor, alignment: 'center' }, { text: 'STATUS', fontSize: 7, bold: true, color: '#6B7280', alignment: 'center', margin: [0,2,0,0] }] },
        ], margin: [0,0,0,16] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1, lineColor: '#E5E7EB' }], margin: [0,0,0,16] },
        // Employee info
        { columns: [
          { stack: [
            { text: 'EMPLOYEE DETAILS', fontSize: 8, bold: true, color: PRIMARY, margin: [0,0,0,6] },
            { text: [{ text: 'Name: ', bold: true, fontSize: 8 },        { text: payslip.employeeName,        fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Code: ', bold: true, fontSize: 8 },        { text: payslip.employeeCode,        fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Designation: ', bold: true, fontSize: 8 }, { text: payslip.designation || '\u2014', fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Department: ', bold: true, fontSize: 8 },  { text: payslip.department  || '\u2014', fontSize: 8, color: '#374151' }] },
          ], width: '50%' },
          { stack: [
            { text: 'PAY PERIOD', fontSize: 8, bold: true, color: PRIMARY, margin: [0,0,0,6] },
            { text: [{ text: 'Month: ',    bold: true, fontSize: 8 }, { text: monthLabel,                  fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Office: ',   bold: true, fontSize: 8 }, { text: payslip.officeName || '\u2014', fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Pay Date: ', bold: true, fontSize: 8 }, { text: generatedOn,                 fontSize: 8, color: '#374151' }] },
            { text: [{ text: 'Status: ',   bold: true, fontSize: 8 }, { text: payslip.status, fontSize: 8, bold: true, color: statusColor }] },
          ], width: '50%' },
        ], margin: [0,0,0,16] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.5, lineColor: '#E5E7EB' }], margin: [0,0,0,16] },
        // Earnings
        { text: 'Earnings', bold: true, fontSize: 11, color: '#111827', margin: [0,0,0,8] },
        { table: { headerRows: 1, widths: ['*', 120],
            body: [
              [{ text: 'Description', style: 'colHeader' }, { text: 'Amount (\u20b9)', style: 'colHeader', alignment: 'right' }],
              [{ text: 'Basic Salary',    fontSize: 9, color: '#111827', fillColor: '#F9FAFB' }, { text: fmt(payslip.baseSalary),  fontSize: 9, alignment: 'right', color: '#111827', fillColor: '#F9FAFB' }],
              [{ text: 'Allowances',      fontSize: 9, color: '#111827' },                       { text: fmt(payslip.allowance),   fontSize: 9, alignment: 'right', color: '#111827' }],
              [{ text: 'Total Earnings',  fontSize: 9, bold: true, color: PRIMARY, fillColor: '#F0FDFA' }, { text: fmt(grossSalary), fontSize: 9, bold: true, alignment: 'right', color: PRIMARY, fillColor: '#F0FDFA' }],
            ],
          },
          layout: { hLineWidth: (i: number) => i <= 1 ? 1.5 : 0.5, vLineWidth: () => 0, hLineColor: (i: number) => i <= 1 ? PRIMARY : '#F3F4F6', paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
          margin: [0,0,0,16],
        },
        // Deductions
        { text: 'Deductions', bold: true, fontSize: 11, color: '#111827', margin: [0,0,0,8] },
        { table: { headerRows: 1, widths: ['*', 120],
            body: [
              [{ text: 'Description', style: 'colHeader' }, { text: 'Amount (\u20b9)', style: 'colHeader', alignment: 'right' }],
              [{ text: 'Total Deductions', fontSize: 9, bold: true, color: '#DC2626', fillColor: '#FEF2F2' }, { text: fmt(deductions), fontSize: 9, bold: true, alignment: 'right', color: '#DC2626', fillColor: '#FEF2F2' }],
            ],
          },
          layout: { hLineWidth: (i: number) => i <= 1 ? 1.5 : 0.5, vLineWidth: () => 0, hLineColor: (i: number) => i <= 1 ? PRIMARY : '#F3F4F6', paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
          margin: [0,0,0,20],
        },
        // Net salary box
        { canvas: [{ type: 'rect', x: 0, y: 0, w: 523, h: 54, color: '#F0FDFA', r: 2 }, { type: 'rect', x: 0, y: 0, w: 6, h: 54, color: PRIMARY }] },
        { columns: [
          { stack: [
            { text: 'NET SALARY (TAKE HOME)', fontSize: 8, bold: true, color: '#6B7280', margin: [0,-50,0,4] },
            { text: payslip.netInWords || 'N/A', fontSize: 8, color: '#374151', italics: true },
          ], margin: [14,0,0,0] },
          { text: fmt(netSalary), fontSize: 20, bold: true, color: PRIMARY, alignment: 'right', margin: [0,-52,0,0] },
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
    
    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const targetYear = year ? parseInt(year) : new Date().getFullYear();

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
    
    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const targetYear = year ? parseInt(year) : new Date().getFullYear();

    const stats = await payrollService.getPayrollStats(targetMonth, targetYear);
    
    // Transform to match frontend expectations
    const transformedStats = {
      mtdVolume: stats.summary?.total_net_salary || 0,
      disbursed: stats.summary?.total_net_salary || 0,
      pending: stats.summary?.total_net_salary || 0,
      errors: 0
    };

    // Get trend data for last 5 months
    const trendData = [];
    for (let i = 4; i >= 0; i--) {
      const trendMonth = new Date();
      trendMonth.setMonth(trendMonth.getMonth() - i);
      const m = trendMonth.getMonth() + 1;
      const y = trendMonth.getFullYear();
      const monthStats = await payrollService.getPayrollStats(m, y);
      trendData.push({
        name: trendMonth.toLocaleDateString('en-US', { month: 'short' }),
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
    const limitNum = parseInt(limit);

    const runs = await payrollService.getPayrollRuns(limitNum);
    
    // Transform to match frontend expectations
    const transformedRuns = runs.map(run => ({
      id: run.id,
      company: 'System Generated',
      employees: run.totalEmployees,
      totalAmount: `₹${run.totalAmount.toLocaleString('en-IN')}`,
      status: run.status,
      date: new Date(run.startedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    }));

    res.json({
      success: true,
      runs: transformedRuns
    });
  } catch (error) {
    console.error('Get admin payroll runs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get admin payroll runs.',
      errorCode: 'GET_ADMIN_PAYROLL_RUNS_ERROR'
    });
  }
};

export const getAdminPayrollSlips = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month } = req.query as { month?: string };
    
    if (!month) {
      res.status(400).json({
        success: false,
        message: 'Month parameter is required.',
        errorCode: 'MISSING_MONTH'
      });
      return;
    }

    const [year, monthNum] = month.split('-').map(Number);
    
    const slips = await prisma.payslip.findMany({
      where: {
        month: monthNum,
        year: year
      },
      include: {
        employee: {
          include: {
            department: true,
            office: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Transform to match frontend expectations
    const transformedSlips = slips.map(slip => ({
      id: slip.employeeId,
      employeeCode: slip.employee.employeeCode,
      name: `${slip.employee.firstName} ${slip.employee.lastName}`,
      designation: slip.employee.designation || 'Employee',
      department: slip.employee.department?.name || 'General',
      office: slip.employee.office?.name || 'Main Office',
      baseSalary: slip.baseSalary,
      netSalary: slip.netSalary,
      allowance: slip.allowance,
      deductions: slip.deductions,
      status: slip.status === 'Approved' ? 'Approved' : 'Pending Approval'
    }));

    res.json({
      success: true,
      slips: transformedSlips
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
    // Get all approved payslips for current month
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    const approvedPayslips = await prisma.payslip.findMany({
      where: {
        month: currentMonth,
        year: currentYear,
        status: 'Approved'
      }
    });

    // Update status to Paid
    await prisma.payslip.updateMany({
      where: {
        month: currentMonth,
        year: currentYear,
        status: 'Approved'
      },
      data: {
        status: 'Paid',
        updatedAt: new Date()
      }
    });

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