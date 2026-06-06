import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import reportsService from '../services/reportsService';
import { prisma } from '../utils/db';

// ==========================================
// Reports Controller
// ==========================================

export const generateReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { reportType, dateRange, filters, format, includeCharts, groupBy } = req.body;

    if (!reportType || !dateRange || !dateRange.startDate || !dateRange.endDate) {
      res.status(400).json({
        success: false,
        message: 'Report type and date range are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const config = {
      reportType,
      dateRange: {
        startDate: new Date(dateRange.startDate),
        endDate: new Date(dateRange.endDate)
      },
      filters,
      format: format || 'json',
      includeCharts: includeCharts || false,
      groupBy
    };

    let reportData;
    switch (reportType) {
      case 'attendance':
        reportData = await reportsService.generateAttendanceReport(config);
        break;
      case 'leave':
        reportData = await reportsService.generateLeaveReport(config);
        break;
      case 'payroll':
        reportData = await reportsService.generatePayrollReport(config);
        break;
      case 'expense':
        reportData = await reportsService.generateExpenseReport(config);
        break;
      case 'employee':
        reportData = await reportsService.generateEmployeeReport(config);
        break;
      default:
        res.status(400).json({
          success: false,
          message: 'Invalid report type.',
          errorCode: 'INVALID_REPORT_TYPE'
        });
        return;
    }

    // Save report to database
    const savedReport = await prisma.$queryRaw`
      INSERT INTO reports (
        id, name, type, generated_at, generated_by, date_range_start, date_range_end, data, metadata, created_at, updated_at
      ) VALUES (
        ${reportData.id}, ${reportData.name}, ${reportData.type}, ${reportData.generatedAt}, ${reportData.generatedBy},
        ${reportData.dateRange.startDate}, ${reportData.dateRange.endDate}, ${JSON.stringify(reportData.data)}, 
        ${JSON.stringify(reportData.metadata)}, NOW(), NOW()
      )
      RETURNING id, name, type, generated_at as "generatedAt", generated_by as "generatedBy", date_range_start as "dateRangeStart", date_range_end as "dateRangeEnd"
    `;

    res.json({
      success: true,
      message: 'Report generated successfully.',
      report: reportData,
      savedReport
    });
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate report.',
      errorCode: 'GENERATE_REPORT_ERROR'
    });
  }
};

export const getReports = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { reportType, limit = '50', offset = '0' } = req.query as { reportType?: string, limit: string, offset: string };

    const whereClause = reportType ? `WHERE type = '${reportType}'` : '';
    const limitNum = parseInt(limit);
    const offsetNum = parseInt(offset);

    const reports = await prisma.$queryRaw`
      SELECT 
        id, name, type, generated_at as "generatedAt", generated_by as "generatedBy",
        date_range_start as "dateRangeStart", date_range_end as "dateRangeEnd",
        metadata, created_at as "createdAt"
      FROM reports 
      ${whereClause}
      ORDER BY generated_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `;

    const totalCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM reports ${whereClause}
    ` as any[];

    res.json({
      success: true,
      reports,
      pagination: {
        total: parseInt(totalCount[0]?.count || '0'),
        limit: limitNum,
        offset: offsetNum
      }
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get reports.',
      errorCode: 'GET_REPORTS_ERROR'
    });
  }
};

export const getReportById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const reportIdStr = Array.isArray(id) ? id[0] : id;

    const report = await prisma.$queryRaw`
      SELECT 
        id, name, type, generated_at as "generatedAt", generated_by as "generatedBy",
        date_range_start as "dateRangeStart", date_range_end as "dateRangeEnd",
        data, metadata, created_at as "createdAt", updated_at as "updatedAt"
      FROM reports 
      WHERE id = ${reportIdStr}
    ` as any[];

    if (report.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Report not found.',
        errorCode: 'REPORT_NOT_FOUND'
      });
      return;
    }

    res.json({
      success: true,
      report: report[0]
    });
  } catch (error) {
    console.error('Get report by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get report.',
      errorCode: 'GET_REPORT_BY_ID_ERROR'
    });
  }
};

export const deleteReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const reportIdStr = Array.isArray(id) ? id[0] : id;

    await prisma.$queryRaw`
      DELETE FROM reports WHERE id = ${reportIdStr}
    `;

    res.json({
      success: true,
      message: 'Report deleted successfully.'
    });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete report.',
      errorCode: 'DELETE_REPORT_ERROR'
    });
  }
};

export const downloadReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { format = 'pdf' } = req.query;
    const reportIdStr = Array.isArray(id) ? id[0] : id;
    const formatStr = Array.isArray(format) ? format[0] : format as string;

    const report = await prisma.$queryRaw`
      SELECT 
        id, name, type, generated_at as "generatedAt", generated_by as "generatedBy",
        date_range_start as "dateRangeStart", date_range_end as "dateRangeEnd",
        data, metadata
      FROM reports 
      WHERE id = ${reportIdStr}
    ` as any[];

    if (report.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Report not found.',
        errorCode: 'REPORT_NOT_FOUND'
      });
      return;
    }

    const reportData = report[0];

    // Generate file based on format
    let fileName: string;
    let mimeType: string;
    let fileBuffer: Buffer;

    switch (String(formatStr).toLowerCase()) {
      case 'pdf':
        fileName = `${(reportData.name || 'report').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        mimeType = 'application/pdf';
        fileBuffer = await generatePDF(reportData);
        break;
      case 'excel':
        fileName = `${(reportData.name || 'report').replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileBuffer = await generateExcel(reportData);
        break;
      case 'json':
        fileName = `${(reportData.name || 'report').replace(/[^a-zA-Z0-9]/g, '_')}.json`;
        mimeType = 'application/json';
        fileBuffer = Buffer.from(JSON.stringify(reportData, null, 2));
        break;
      default:
        res.status(400).json({
          success: false,
          message: 'Unsupported format.',
          errorCode: 'UNSUPPORTED_FORMAT'
        });
        return;
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(fileBuffer);
  } catch (error) {
    console.error('Download report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download report.',
      errorCode: 'DOWNLOAD_REPORT_ERROR'
    });
  }
};

export const getReportTemplates = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const templates = [
      {
        id: 'attendance_monthly',
        name: 'Monthly Attendance Report',
        type: 'attendance',
        description: 'Detailed attendance report for a specific month',
        defaultFilters: {
          groupBy: 'employee',
          includeCharts: true
        }
      },
      {
        id: 'leave_quarterly',
        name: 'Quarterly Leave Report',
        type: 'leave',
        description: 'Leave analysis for a quarter',
        defaultFilters: {
          groupBy: 'department',
          includeCharts: true
        }
      },
      {
        id: 'payroll_monthly',
        name: 'Monthly Payroll Report',
        type: 'payroll',
        description: 'Payroll summary for a specific month',
        defaultFilters: {
          groupBy: 'department',
          includeCharts: true
        }
      },
      {
        id: 'expense_monthly',
        name: 'Monthly Expense Report',
        type: 'expense',
        description: 'Expense report for a specific month',
        defaultFilters: {
          groupBy: 'category',
          includeCharts: true
        }
      },
      {
        id: 'employee_master',
        name: 'Employee Master Report',
        type: 'employee',
        description: 'Complete employee information',
        defaultFilters: {
          groupBy: 'department',
          includeCharts: true
        }
      }
    ];

    res.json({
      success: true,
      templates
    });
  } catch (error) {
    console.error('Get report templates error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get report templates.',
      errorCode: 'GET_REPORT_TEMPLATES_ERROR'
    });
  }
};

export const scheduleReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { name, reportType, schedule, config, recipients } = req.body;

    if (!name || !reportType || !schedule) {
      res.status(400).json({
        success: false,
        message: 'Name, report type, and schedule are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    // Save scheduled report
    const scheduledReport = await prisma.$queryRaw`
      INSERT INTO scheduled_reports (
        name, report_type, schedule, config, recipients, is_active, created_by, created_at, updated_at
      ) VALUES (
        ${name}, ${reportType}, ${JSON.stringify(schedule)}, ${JSON.stringify(config)}, 
        ${JSON.stringify(recipients)}, true, ${req.user?.email || 'System'}, NOW(), NOW()
      )
      RETURNING id, name, report_type as "reportType", schedule, config, recipients, is_active as "isActive", created_at as "createdAt"
    ` as any[];

    res.json({
      success: true,
      message: 'Report scheduled successfully.',
      scheduledReport: scheduledReport[0]
    });
  } catch (error) {
    console.error('Schedule report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule report.',
      errorCode: 'SCHEDULE_REPORT_ERROR'
    });
  }
};

export const getScheduledReports = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const scheduledReports = await prisma.$queryRaw`
      SELECT 
        id, name, report_type as "reportType", schedule, config, recipients, is_active as "isActive",
        created_by as "createdBy", created_at as "createdAt", updated_at as "updatedAt"
      FROM scheduled_reports 
      ORDER BY created_at DESC
    `;

    res.json({
      success: true,
      scheduledReports
    });
  } catch (error) {
    console.error('Get scheduled reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get scheduled reports.',
      errorCode: 'GET_SCHEDULED_REPORTS_ERROR'
    });
  }
};

// Helper methods for file generation
async function generatePDF(reportData: any): Promise<Buffer> {
  // Implementation for PDF generation
  // This would typically use a library like PDFKit or Puppeteer
  return Buffer.from('PDF content placeholder');
}

async function generateExcel(reportData: any): Promise<Buffer> {
  // Implementation for Excel generation
  // This would typically use a library like xlsx or exceljs
  return Buffer.from('Excel content placeholder');
}
