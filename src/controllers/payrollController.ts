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

    const results = [];
    
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
      res.status(400).json({
        success: false,
        message: 'Employee ID, month, and year are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;
    const monthNum = parseInt(Array.isArray(month) ? month[0] : month);
    const yearNum = parseInt(Array.isArray(year) ? year[0] : year);

    const payslip = await prisma.payslip.findUnique({
      where: {
        employeeId_month_year: {
          employeeId: parseInt(employeeIdStr),
          month: monthNum,
          year: yearNum
        }
      },
      include: {
        employee: {
          include: {
            department: true,
            office: true
          }
        }
      }
    });

    if (!payslip) {
      res.status(404).json({
        success: false,
        message: 'Payslip not found.',
        errorCode: 'PAYSLIP_NOT_FOUND'
      });
      return;
    }

    // Generate real PDF using pdfmake
    const PdfPrinter = require('pdfmake');
    const pdfFonts = require('pdfmake/build/vfs_fonts');
    
    const printer = new PdfPrinter(pdfFonts);
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    
    const grossSalary = payslip.baseSalary + payslip.allowance;
    
    const docDefinition = {
      content: [
        {
          text: 'SALARY SLIP',
          style: 'header',
          alignment: 'center',
          margin: [0, 0, 0, 20]
        },
        {
          columns: [
            {
              text: [
                { text: 'Employee Name: ', bold: true },
                `${payslip.employeeName}\n`,
                { text: 'Employee Code: ', bold: true },
                `${payslip.employeeCode}\n`,
                { text: 'Department: ', bold: true },
                `${payslip.department || 'N/A'}\n`,
                { text: 'Designation: ', bold: true },
                `${payslip.designation || 'N/A'}`
              ],
              width: '50%'
            },
            {
              text: [
                { text: 'Month: ', bold: true },
                `${monthNames[monthNum - 1]} ${yearNum}\n`,
                { text: 'Office: ', bold: true },
                `${payslip.officeName || 'N/A'}\n`,
                { text: 'Pay Date: ', bold: true },
                `${new Date().toLocaleDateString()}\n`,
                { text: 'Status: ', bold: true },
                `${payslip.status}`
              ],
              width: '50%',
              alignment: 'right'
            }
          ],
          margin: [0, 0, 0, 30]
        },
        {
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: 515, y1: 0, lineWidth: 1, lineColor: '#cccccc' }
          ],
          margin: [0, 0, 0, 20]
        },
        {
          text: 'EARNINGS',
          style: 'subheader',
          margin: [0, 0, 0, 10]
        },
        {
          table: {
            headerRows: 1,
            widths: ['*', 'auto'],
            body: [
              [
                { text: 'Description', style: 'tableHeader' },
                { text: 'Amount', style: 'tableHeader' }
              ],
              [
                'Base Salary',
                `₹${payslip.baseSalary.toFixed(2)}`
              ],
              [
                'Allowances',
                `₹${payslip.allowance.toFixed(2)}`
              ],
              [
                { text: 'Total Earnings', bold: true },
                { text: `₹${grossSalary.toFixed(2)}`, bold: true }
              ]
            ]
          },
          layout: {
            hLineWidth: (i: number) => i === 0 || i === 3 ? 1 : 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#e0e0e0',
            vLineColor: () => '#e0e0e0',
            paddingLeft: () => 10,
            paddingRight: () => 10,
            paddingTop: () => 8,
            paddingBottom: () => 8
          },
          margin: [0, 0, 0, 20]
        },
        {
          text: 'DEDUCTIONS',
          style: 'subheader',
          margin: [0, 0, 0, 10]
        },
        {
          table: {
            headerRows: 1,
            widths: ['*', 'auto'],
            body: [
              [
                { text: 'Description', style: 'tableHeader' },
                { text: 'Amount', style: 'tableHeader' }
              ],
              [
                'Total Deductions',
                `₹${payslip.deductions.toFixed(2)}`
              ]
            ]
          },
          layout: {
            hLineWidth: (i: number) => i === 0 || i === 2 ? 1 : 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#e0e0e0',
            vLineColor: () => '#e0e0e0',
            paddingLeft: () => 10,
            paddingRight: () => 10,
            paddingTop: () => 8,
            paddingBottom: () => 8
          },
          margin: [0, 0, 0, 20]
        },
        {
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: 515, y1: 0, lineWidth: 2, lineColor: '#3BA38B' }
          ],
          margin: [0, 0, 0, 15]
        },
        {
          columns: [
            {
              text: [
                { text: 'Gross Salary: ', bold: true },
                `₹${grossSalary.toFixed(2)}\n`,
                { text: 'Total Deductions: ', bold: true },
                `₹${payslip.deductions.toFixed(2)}`
              ],
              width: '50%'
            },
            {
              text: [
                { text: 'NET SALARY: ', bold: true, fontSize: 14, color: '#3BA38B' },
                { text: `₹${payslip.netSalary.toFixed(2)}`, bold: true, fontSize: 16, color: '#3BA38B' }
              ],
              width: '50%',
              alignment: 'right'
            }
          ],
          margin: [0, 0, 0, 30]
        },
        {
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: 515, y1: 0, lineWidth: 1, lineColor: '#cccccc' }
          ],
          margin: [0, 0, 0, 20]
        },
        {
          text: 'NET SALARY IN WORDS',
          style: 'subheader',
          margin: [0, 0, 0, 10]
        },
        {
          text: payslip.netInWords || 'N/A',
          style: 'netInWords',
          margin: [0, 0, 0, 30]
        },
        {
          text: 'This is a computer-generated payslip and does not require a physical signature.',
          style: 'footer',
          alignment: 'center',
          margin: [0, 30, 0, 0]
        }
      ],
      styles: {
        header: {
          fontSize: 24,
          bold: true,
          color: '#3BA38B'
        },
        subheader: {
          fontSize: 14,
          bold: true,
          color: '#333333',
          margin: [0, 15, 0, 5]
        },
        tableHeader: {
          fontSize: 11,
          bold: true,
          color: '#ffffff',
          fillColor: '#3BA38B'
        },
        netInWords: {
          fontSize: 11,
          color: '#666666',
          fontStyle: 'italic'
        },
        footer: {
          fontSize: 9,
          color: '#666666',
          italics: true
        }
      },
      defaultStyle: {
        font: 'Roboto',
        fontSize: 10
      },
      pageMargins: [40, 60, 40, 60]
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    const chunks: Buffer[] = [];
    pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="payslip_${employeeIdStr}_${monthNum}_${yearNum}.pdf"`);
      res.send(pdfBuffer);
    });
    
    pdfDoc.end();
  } catch (error) {
    console.error('Generate payslip PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate payslip PDF.',
      errorCode: 'GENERATE_PAYSLIP_PDF_ERROR'
    });
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