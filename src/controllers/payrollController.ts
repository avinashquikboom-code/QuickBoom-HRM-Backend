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

    // Generate PDF (placeholder implementation)
    const pdfBuffer = Buffer.from('PDF payslip content placeholder');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip_${employeeIdStr}_${monthNum}_${yearNum}.pdf"`);
    res.send(pdfBuffer);
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