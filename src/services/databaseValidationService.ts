import { prisma } from '../utils/db';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    warnings: number;
  };
}

export interface DatabaseStats {
  totalRecords: number;
  tableStats: Record<string, number>;
  dataIntegrity: {
    orphanedRecords: number;
    duplicateRecords: number;
    missingReferences: number;
  };
  performance: {
    largeTables: string[];
    indexedTables: string[];
    slowQueries: string[];
  };
}

export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  category: 'INTEGRITY' | 'CONSISTENCY' | 'PERFORMANCE' | 'SECURITY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  isEnabled: boolean;
  lastRun?: Date;
  status?: 'PASSED' | 'FAILED' | 'WARNING';
}

class DatabaseValidationService {
  /**
   * Run comprehensive database validation
   */
  async runFullValidation(): Promise<ValidationResult> {
    try {
      const result: ValidationResult = {
        isValid: true,
        errors: [],
        warnings: [],
        summary: {
          totalChecks: 0,
          passedChecks: 0,
          failedChecks: 0,
          warnings: 0
        }
      };

      // 1. Check foreign key constraints
      await this.checkForeignKeyConstraints(result);

      // 2. Check data consistency
      await this.checkDataConsistency(result);

      // 3. Check for orphaned records
      await this.checkOrphanedRecords(result);

      // 4. Check duplicate records
      await this.checkDuplicateRecords(result);

      // 5. Check required fields
      await this.checkRequiredFields(result);

      // 6. Check data formats
      await this.checkDataFormats(result);

      // 7. Check business rules
      await this.checkBusinessRules(result);

      // 8. Check performance issues
      await this.checkPerformanceIssues(result);

      // Calculate final status
      result.isValid = result.errors.length === 0;
      result.summary.totalChecks = result.summary.passedChecks + result.summary.failedChecks + result.summary.warnings;

      return result;
    } catch (error) {
      console.error('Database validation error:', error);
      throw error;
    }
  }

  /**
   * Check foreign key constraints
   */
  private async checkForeignKeyConstraints(result: ValidationResult): Promise<void> {
    try {
      result.summary.totalChecks++;

      // Check employee references
      const orphanedAttendances = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM attendance a
        LEFT JOIN employee e ON a.employee_id = e.id
        WHERE e.id IS NULL
      ` as any[];

      const orphanedCount = parseInt(orphanedAttendances[0]?.count || '0');
      if (orphanedCount > 0) {
        result.errors.push(`Found ${orphanedCount} attendance records with invalid employee references`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

      // Check leave request references
      const orphanedLeaveRequests = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM leave_request lr
        LEFT JOIN employee e ON lr.employee_id = e.id
        WHERE e.id IS NULL
      ` as any[];

      const orphanedLeaveCount = parseInt(orphanedLeaveRequests[0]?.count || '0');
      if (orphanedLeaveCount > 0) {
        result.errors.push(`Found ${orphanedLeaveCount} leave request records with invalid employee references`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

      // Check expense references
      const orphanedExpenses = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM expense exp
        LEFT JOIN employee e ON exp.employee_id = e.id
        WHERE e.id IS NULL
      ` as any[];

      const orphanedExpenseCount = parseInt(orphanedExpenses[0]?.count || '0');
      if (orphanedExpenseCount > 0) {
        result.errors.push(`Found ${orphanedExpenseCount} expense records with invalid employee references`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

    } catch (error) {
      console.error('Check foreign key constraints error:', error);
      result.errors.push('Failed to check foreign key constraints');
      result.summary.failedChecks++;
    }
  }

  /**
   * Check data consistency
   */
  private async checkDataConsistency(result: ValidationResult): Promise<void> {
    try {
      result.summary.totalChecks++;

      // Check attendance date consistency
      const inconsistentAttendance = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM attendance 
        WHERE date > CURRENT_DATE
      ` as any[];

      const futureCount = parseInt(inconsistentAttendance[0]?.count || '0');
      if (futureCount > 0) {
        result.warnings.push(`Found ${futureCount} attendance records with future dates`);
        result.summary.warnings++;
      } else {
        result.summary.passedChecks++;
      }

      // Check leave request date consistency
      const inconsistentLeaves = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM leave_request 
        WHERE from_date > to_date
      ` as any[];

      const invalidLeaveCount = parseInt(inconsistentLeaves[0]?.count || '0');
      if (invalidLeaveCount > 0) {
        result.errors.push(`Found ${invalidLeaveCount} leave requests with invalid date ranges`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

      // Check payslip consistency
      const inconsistentPayslips = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM payslip p
        WHERE p.base_salary < 0 OR p.allowance < 0 OR p.deductions < 0 OR p.net_salary < 0
      ` as any[];

      const negativeCount = parseInt(inconsistentPayslips[0]?.count || '0');
      if (negativeCount > 0) {
        result.errors.push(`Found ${negativeCount} payslips with negative values`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

    } catch (error) {
      console.error('Check data consistency error:', error);
      result.errors.push('Failed to check data consistency');
      result.summary.failedChecks++;
    }
  }

  /**
   * Check for orphaned records
   */
  private async checkOrphanedRecords(result: ValidationResult): Promise<void> {
    try {
      result.summary.totalChecks++;

      // Check notifications without users
      const orphanedNotifications = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM notification n
        LEFT JOIN "user" u ON n.user_id = u.id
        WHERE n.user_id IS NOT NULL AND u.id IS NULL
      ` as any[];

      const orphanedNotificationCount = parseInt(orphanedNotifications[0]?.count || '0');
      if (orphanedNotificationCount > 0) {
        result.warnings.push(`Found ${orphanedNotificationCount} notifications with invalid user references`);
        result.summary.warnings++;
      } else {
        result.summary.passedChecks++;
      }

    } catch (error) {
      console.error('Check orphaned records error:', error);
      result.errors.push('Failed to check orphaned records');
      result.summary.failedChecks++;
    }
  }

  /**
   * Check duplicate records
   */
  private async checkDuplicateRecords(result: ValidationResult): Promise<void> {
    try {
      result.summary.totalChecks++;

      // Check duplicate employee codes
      const duplicateEmployeeCodes = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM (
          SELECT employee_code, COUNT(*) as cnt
          FROM employee
          GROUP BY employee_code
          HAVING cnt > 1
        ) duplicates
      ` as any[];

      const duplicateCount = parseInt(duplicateEmployeeCodes[0]?.count || '0');
      if (duplicateCount > 0) {
        result.errors.push(`Found ${duplicateCount} duplicate employee codes`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

      // Check duplicate user emails
      const duplicateEmails = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM (
          SELECT email, COUNT(*) as cnt
          FROM "user"
          GROUP BY email
          HAVING cnt > 1
        ) duplicates
      ` as any[];

      const duplicateEmailCount = parseInt(duplicateEmails[0]?.count || '0');
      if (duplicateEmailCount > 0) {
        result.errors.push(`Found ${duplicateEmailCount} duplicate user emails`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

    } catch (error) {
      console.error('Check duplicate records error:', error);
      result.errors.push('Failed to check duplicate records');
      result.summary.failedChecks++;
    }
  }

  /**
   * Check required fields
   */
  private async checkRequiredFields(result: ValidationResult): Promise<void> {
    try {
      result.summary.totalChecks++;

      // Check employees without required fields
      const employeesMissingFields = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM employee 
        WHERE first_name IS NULL OR first_name = '' 
           OR last_name IS NULL OR last_name = ''
           OR employee_code IS NULL OR employee_code = ''
      ` as any[];

      const missingFieldsCount = parseInt(employeesMissingFields[0]?.count || '0');
      if (missingFieldsCount > 0) {
        result.errors.push(`Found ${missingFieldsCount} employees missing required fields`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

      // Check users without required fields
      const usersMissingFields = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM "user" 
        WHERE email IS NULL OR email = '' 
           OR role IS NULL OR role = ''
      ` as any[];

      const usersMissingCount = parseInt(usersMissingFields[0]?.count || '0');
      if (usersMissingCount > 0) {
        result.errors.push(`Found ${usersMissingCount} users missing required fields`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

    } catch (error) {
      console.error('Check required fields error:', error);
      result.errors.push('Failed to check required fields');
      result.summary.failedChecks++;
    }
  }

  /**
   * Check data formats
   */
  private async checkDataFormats(result: ValidationResult): Promise<void> {
    try {
      result.summary.totalChecks++;

      // Check email formats
      const invalidEmails = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM "user" 
        WHERE email IS NOT NULL 
        AND email NOT LIKE '%@%.%'
      ` as any[];

      const invalidEmailCount = parseInt(invalidEmails[0]?.count || '0');
      if (invalidEmailCount > 0) {
        result.errors.push(`Found ${invalidEmailCount} users with invalid email formats`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

      // Check phone number formats (basic validation)
      const invalidPhones = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM employee 
        WHERE phone IS NOT NULL 
        AND phone NOT REGEXP '^[0-9+()-]+$'
      ` as any[];

      const invalidPhoneCount = parseInt(invalidPhones[0]?.count || '0');
      if (invalidPhoneCount > 0) {
        result.warnings.push(`Found ${invalidPhoneCount} employees with invalid phone formats`);
        result.summary.warnings++;
      } else {
        result.summary.passedChecks++;
      }

    } catch (error) {
      console.error('Check data formats error:', error);
      result.errors.push('Failed to check data formats');
      result.summary.failedChecks++;
    }
  }

  /**
   * Check business rules
   */
  private async checkBusinessRules(result: ValidationResult): Promise<void> {
    try {
      result.summary.totalChecks++;

      // Check employees without users
      const employeesWithoutUsers = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM employee e
        LEFT JOIN "user" u ON e.user_id = u.id
        WHERE u.id IS NULL
      ` as any[];

      const noUserCount = parseInt(employeesWithoutUsers[0]?.count || '0');
      if (noUserCount > 0) {
        result.warnings.push(`Found ${noUserCount} employees without associated user accounts`);
        result.summary.warnings++;
      } else {
        result.summary.passedChecks++;
      }

      // Check users without employees
      const usersWithoutEmployees = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM "user" u
        LEFT JOIN employee e ON u.id = e.user_id
        WHERE u.role NOT IN ('SUPER_ADMIN', 'ADMIN', 'PLATFORM_ADMIN')
        AND e.id IS NULL
      ` as any[];

      const noEmployeeCount = parseInt(usersWithoutEmployees[0]?.count || '0');
      if (noEmployeeCount > 0) {
        result.warnings.push(`Found ${noEmployeeCount} users without associated employee records`);
        result.summary.warnings++;
      } else {
        result.summary.passedChecks++;
      }

      // Check negative attendance durations
      const negativeAttendance = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM attendance 
        WHERE check_in IS NOT NULL 
        AND check_out IS NOT NULL 
        AND check_out < check_in
      ` as any[];

      const negativeAttendanceCount = parseInt(negativeAttendance[0]?.count || '0');
      if (negativeAttendanceCount > 0) {
        result.errors.push(`Found ${negativeAttendanceCount} attendance records with check-out before check-in`);
        result.summary.failedChecks++;
      } else {
        result.summary.passedChecks++;
      }

    } catch (error) {
      console.error('Check business rules error:', error);
      result.errors.push('Failed to check business rules');
      result.summary.failedChecks++;
    }
  }

  /**
   * Check performance issues
   */
  private async checkPerformanceIssues(result: ValidationResult): Promise<void> {
    try {
      result.summary.totalChecks++;

      // Check table sizes
      const largeTables = await prisma.$queryRaw`
        SELECT table_name, 
               ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
        FROM information_schema.tables 
        WHERE table_schema = DATABASE()
        AND table_name IN ('attendance', 'leave_request', 'expense', 'payslip', 'notification')
        ORDER BY size_mb DESC
      ` as any[];

      const veryLargeTables = largeTables.filter((table: any) => table.size_mb > 100);
      if (veryLargeTables.length > 0) {
        result.warnings.push(`Found ${veryLargeTables.length} tables larger than 100MB: ${veryLargeTables.map((t: any) => t.table_name).join(', ')}`);
        result.summary.warnings++;
      } else {
        result.summary.passedChecks++;
      }

    } catch (error) {
      console.error('Check performance issues error:', error);
      result.errors.push('Failed to check performance issues');
      result.summary.failedChecks++;
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<DatabaseStats> {
    try {
      // Get table record counts
      const tableCounts = await prisma.$queryRaw`
        SELECT table_name, table_rows
        FROM information_schema.tables 
        WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
        ORDER BY table_rows DESC
      ` as any[];

      const tableStats: Record<string, number> = {};
      let totalRecords = 0;

      tableCounts.forEach((table: any) => {
        const count = parseInt(table.table_rows || '0');
        tableStats[table.table_name] = count;
        totalRecords += count;
      });

      // Get data integrity stats
      const orphanedRecords = await this.countOrphanedRecords();
      const duplicateRecords = await this.countDuplicateRecords();
      const missingReferences = await this.countMissingReferences();

      // Get performance stats
      const largeTables = await this.getLargeTables();
      const indexedTables = await this.getIndexedTables();
      const slowQueries = await this.getSlowQueries();

      return {
        totalRecords,
        tableStats,
        dataIntegrity: {
          orphanedRecords,
          duplicateRecords,
          missingReferences
        },
        performance: {
          largeTables,
          indexedTables,
          slowQueries
        }
      };
    } catch (error) {
      console.error('Get database stats error:', error);
      throw error;
    }
  }

  /**
   * Count orphaned records
   */
  private async countOrphanedRecords(): Promise<number> {
    try {
      const result = await prisma.$queryRaw`
        SELECT SUM(orphaned_count) as total
        FROM (
          SELECT COUNT(*) as orphaned_count
          FROM attendance a
          LEFT JOIN employee e ON a.employee_id = e.id
          WHERE e.id IS NULL
          UNION ALL
          SELECT COUNT(*) as orphaned_count
          FROM leave_request lr
          LEFT JOIN employee e ON lr.employee_id = e.id
          WHERE e.id IS NULL
          UNION ALL
          SELECT COUNT(*) as orphaned_count
          FROM expense exp
          LEFT JOIN employee e ON exp.employee_id = e.id
          WHERE e.id IS NULL
        ) orphaned_counts
      ` as any[];

      return parseInt(result[0]?.total || '0');
    } catch (error) {
      console.error('Count orphaned records error:', error);
      return 0;
    }
  }

  /**
   * Count duplicate records
   */
  private async countDuplicateRecords(): Promise<number> {
    try {
      const result = await prisma.$queryRaw`
        SELECT SUM(duplicate_count) as total
        FROM (
          SELECT COUNT(*) - COUNT(DISTINCT employee_code) as duplicate_count
          FROM employee
          WHERE employee_code IS NOT NULL
          UNION ALL
          SELECT COUNT(*) - COUNT(DISTINCT email) as duplicate_count
          FROM "user"
          WHERE email IS NOT NULL
        ) duplicate_counts
      ` as any[];

      return parseInt(result[0]?.total || '0');
    } catch (error) {
      console.error('Count duplicate records error:', error);
      return 0;
    }
  }

  /**
   * Count missing references
   */
  private async countMissingReferences(): Promise<number> {
    try {
      const result = await prisma.$queryRaw`
        SELECT SUM(missing_count) as total
        FROM (
          SELECT COUNT(*) as missing_count
          FROM employee e
          WHERE e.user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = e.user_id)
          UNION ALL
          SELECT COUNT(*) as missing_count
          FROM "user" u
          WHERE u.role NOT IN ('SUPER_ADMIN', 'ADMIN', 'PLATFORM_ADMIN')
          AND NOT EXISTS (SELECT 1 FROM employee e WHERE e.user_id = u.id)
        ) missing_counts
      ` as any[];

      return parseInt(result[0]?.total || '0');
    } catch (error) {
      console.error('Count missing references error:', error);
      return 0;
    }
  }

  /**
   * Get large tables
   */
  private async getLargeTables(): Promise<string[]> {
    try {
      const result = await prisma.$queryRaw`
        SELECT table_name
        FROM information_schema.tables 
        WHERE table_schema = DATABASE()
        AND ROUND(((data_length + index_length) / 1024 / 1024), 2) > 50
        ORDER BY ((data_length + index_length) / 1024 / 1024) DESC
      ` as any[];

      return result.map((row: any) => row.table_name);
    } catch (error) {
      console.error('Get large tables error:', error);
      return [];
    }
  }

  /**
   * Get indexed tables
   */
  private async getIndexedTables(): Promise<string[]> {
    try {
      const result = await prisma.$queryRaw`
        SELECT DISTINCT table_name
        FROM information_schema.statistics 
        WHERE table_schema = DATABASE()
        AND index_name != 'PRIMARY'
        ORDER BY table_name
      ` as any[];

      return result.map((row: any) => row.table_name);
    } catch (error) {
      console.error('Get indexed tables error:', error);
      return [];
    }
  }

  /**
   * Get slow queries
   */
  private async getSlowQueries(): Promise<string[]> {
    try {
      // This would typically query the slow query log
      // For now, return empty array as placeholder
      return [];
    } catch (error) {
      console.error('Get slow queries error:', error);
      return [];
    }
  }

  /**
   * Clean up orphaned records
   */
  async cleanupOrphanedRecords(): Promise<{ cleaned: number; errors: string[] }> {
    try {
      const errors: string[] = [];
      let cleaned = 0;

      // Clean up orphaned attendance records
      try {
        const result = await prisma.$queryRaw`
          DELETE FROM attendance 
          WHERE employee_id NOT IN (SELECT id FROM employee)
        `;
        cleaned += parseInt((result as any).affectedRows || '0');
      } catch (error) {
        errors.push('Failed to clean up orphaned attendance records');
      }

      // Clean up orphaned leave requests
      try {
        const result = await prisma.$queryRaw`
          DELETE FROM leave_request 
          WHERE employee_id NOT IN (SELECT id FROM employee)
        `;
        cleaned += parseInt((result as any).affectedRows || '0');
      } catch (error) {
        errors.push('Failed to clean up orphaned leave requests');
      }

      // Clean up orphaned expenses
      try {
        const result = await prisma.$queryRaw`
          DELETE FROM expense 
          WHERE employee_id NOT IN (SELECT id FROM employee)
        `;
        cleaned += parseInt((result as any).affectedRows || '0');
      } catch (error) {
        errors.push('Failed to clean up orphaned expenses');
      }

      return { cleaned, errors };
    } catch (error) {
      console.error('Cleanup orphaned records error:', error);
      throw error;
    }
  }
}

export default new DatabaseValidationService();
