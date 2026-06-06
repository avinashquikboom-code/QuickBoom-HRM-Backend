import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import databaseValidationService from '../services/databaseValidationService';

// ==========================================
// Database Validation Controller
// ==========================================

export const runFullValidation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const result = await databaseValidationService.runFullValidation();

    res.json({
      success: true,
      message: 'Database validation completed.',
      result
    });
  } catch (error) {
    console.error('Run full validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to run database validation.',
      errorCode: 'RUN_VALIDATION_ERROR'
    });
  }
};

export const getDatabaseStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const stats = await databaseValidationService.getDatabaseStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get database stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get database statistics.',
      errorCode: 'GET_DATABASE_STATS_ERROR'
    });
  }
};

export const cleanupOrphanedRecords = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const result = await databaseValidationService.cleanupOrphanedRecords();

    res.json({
      success: true,
      message: 'Orphaned records cleanup completed.',
      result
    });
  } catch (error) {
    console.error('Cleanup orphaned records error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup orphaned records.',
      errorCode: 'CLEANUP_ORPHANED_RECORDS_ERROR'
    });
  }
};

export const validateTableIntegrity = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tableName } = req.params;
    const tableNameStr = Array.isArray(tableName) ? tableName[0] : tableName;

    if (!tableNameStr) {
      res.status(400).json({
        success: false,
        message: 'Table name is required.',
        errorCode: 'MISSING_TABLE_NAME'
      });
      return;
    }

    // Run specific table validation
    const result = await databaseValidationService.runFullValidation();
    
    // Filter results for specific table
    const tableSpecificErrors = result.errors.filter(error => 
      error.toLowerCase().includes(tableNameStr.toLowerCase())
    );
    const tableSpecificWarnings = result.warnings.filter(warning => 
      warning.toLowerCase().includes(tableNameStr.toLowerCase())
    );

    res.json({
      success: true,
      tableName: tableNameStr,
      errors: tableSpecificErrors,
      warnings: tableSpecificWarnings,
      isValid: tableSpecificErrors.length === 0
    });
  } catch (error) {
    console.error('Validate table integrity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate table integrity.',
      errorCode: 'VALIDATE_TABLE_INTEGRITY_ERROR'
    });
  }
};

export const getDataQualityReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const validation = await databaseValidationService.runFullValidation();
    const stats = await databaseValidationService.getDatabaseStats();

    const report = {
      summary: {
        overallHealth: validation.isValid ? 'HEALTHY' : 'NEEDS_ATTENTION',
        totalIssues: validation.errors.length + validation.warnings.length,
        criticalIssues: validation.errors.length,
        warnings: validation.warnings.length,
        lastChecked: new Date()
      },
      dataQuality: {
        completeness: {
          score: validation.summary.totalChecks > 0 ? 
            (validation.summary.passedChecks / validation.summary.totalChecks) * 100 : 0,
          issues: validation.errors.filter(e => e.includes('missing') || e.includes('required'))
        },
        consistency: {
          score: validation.errors.filter(e => e.includes('inconsistent')).length === 0 ? 100 : 50,
          issues: validation.errors.filter(e => e.includes('inconsistent'))
        },
        integrity: {
          score: stats.dataIntegrity.orphanedRecords === 0 ? 100 : 50,
          orphanedRecords: stats.dataIntegrity.orphanedRecords,
          duplicateRecords: stats.dataIntegrity.duplicateRecords,
          missingReferences: stats.dataIntegrity.missingReferences
        }
      },
      recommendations: generateRecommendations(validation, stats)
    };

    res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('Get data quality report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate data quality report.',
      errorCode: 'GET_DATA_QUALITY_REPORT_ERROR'
    });
  }
};

export const getValidationHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // This would typically query a validation history table
    // For now, return mock data
    const history = [
      {
        id: 1,
        runAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        status: 'COMPLETED',
        totalChecks: 15,
        passedChecks: 13,
        failedChecks: 2,
        warnings: 3,
        duration: 1250
      },
      {
        id: 2,
        runAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        status: 'COMPLETED',
        totalChecks: 15,
        passedChecks: 14,
        failedChecks: 1,
        warnings: 2,
        duration: 1180
      }
    ];

    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Get validation history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get validation history.',
      errorCode: 'GET_VALIDATION_HISTORY_ERROR'
    });
  }
};

export const scheduleValidation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { frequency, enabled } = req.body;

    if (!frequency) {
      res.status(400).json({
        success: false,
        message: 'Frequency is required.',
        errorCode: 'MISSING_FREQUENCY'
      });
      return;
    }

    // This would typically save to a validation schedule table
    const schedule = {
      id: Date.now(),
      frequency,
      enabled: enabled !== false,
      lastRun: null,
      nextRun: calculateNextRun(frequency),
      createdBy: req.user?.email || 'System'
    };

    res.json({
      success: true,
      message: 'Validation schedule updated successfully.',
      schedule
    });
  } catch (error) {
    console.error('Schedule validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule validation.',
      errorCode: 'SCHEDULE_VALIDATION_ERROR'
    });
  }
};

export const exportValidationReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { format = 'json' } = req.query as { format: string };
    const formatStr = format;

    const validation = await databaseValidationService.runFullValidation();
    const stats = await databaseValidationService.getDatabaseStats();

    const report = {
      generatedAt: new Date(),
      validation,
      stats,
      summary: {
        totalIssues: validation.errors.length + validation.warnings.length,
        criticalIssues: validation.errors.length,
        warnings: validation.warnings.length,
        overallHealth: validation.isValid ? 'HEALTHY' : 'NEEDS_ATTENTION'
      }
    };

    switch (formatStr.toLowerCase()) {
      case 'json':
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="validation-report.json"');
        res.send(report);
        break;
      case 'csv':
        // Convert to CSV format
        const csvData = convertToCSV(report);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="validation-report.csv"');
        res.send(csvData);
        break;
      default:
        res.status(400).json({
          success: false,
          message: 'Unsupported format.',
          errorCode: 'UNSUPPORTED_FORMAT'
        });
    }
  } catch (error) {
    console.error('Export validation report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export validation report.',
      errorCode: 'EXPORT_VALIDATION_REPORT_ERROR'
    });
  }
};

// Helper functions
function generateRecommendations(validation: any, stats: any): string[] {
  const recommendations: string[] = [];

  if (validation.errors.length > 0) {
    recommendations.push('Address critical data integrity issues immediately');
  }

  if (stats.dataIntegrity.orphanedRecords > 0) {
    recommendations.push('Run cleanup process to remove orphaned records');
  }

  if (stats.dataIntegrity.duplicateRecords > 0) {
    recommendations.push('Review and resolve duplicate records');
  }

  if (validation.warnings.length > 5) {
    recommendations.push('Consider implementing data quality monitoring');
  }

  if (stats.performance.largeTables.length > 0) {
    recommendations.push('Consider archiving old data from large tables');
  }

  return recommendations;
}

function calculateNextRun(frequency: string): Date {
  const now = new Date();
  
  switch (frequency.toLowerCase()) {
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case 'monthly':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

function convertToCSV(report: any): string {
  const headers = ['Category', 'Issue', 'Severity', 'Count', 'Description'];
  const rows: string[][] = [];

  // Add errors
  report.validation.errors.forEach((error: string) => {
    rows.push(['Error', error, 'Critical', '1', error]);
  });

  // Add warnings
  report.validation.warnings.forEach((warning: string) => {
    rows.push(['Warning', warning, 'Medium', '1', warning]);
  });

  const csvContent = [
    headers.join(','),
    ...rows.map((row: string[]) => row.map((cell: string) => `"${cell}"`).join(','))
  ].join('\n');

  return csvContent;
}
