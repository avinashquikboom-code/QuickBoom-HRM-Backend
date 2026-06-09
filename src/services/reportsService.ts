import { prisma } from '../utils/db';
import { getWebSocketInstance } from '../utils/websocketSingleton';

export interface ReportConfig {
  reportType: 'attendance' | 'leave' | 'payroll' | 'expense' | 'employee' | 'performance';
  dateRange: {
    startDate: Date;
    endDate: Date;
  };
  filters?: {
    departmentId?: number;
    employeeId?: number;
    officeId?: number;
    status?: string;
    leaveType?: string;
  };
  format: 'pdf' | 'excel' | 'json';
  includeCharts?: boolean;
  groupBy?: 'department' | 'employee' | 'month' | 'week';
}

export interface ReportData {
  id: string;
  name: string;
  type: string;
  generatedAt: Date;
  generatedBy: string;
  dateRange: {
    startDate: Date;
    endDate: Date;
  };
  data: any;
  metadata: {
    totalRecords: number;
    summary: any;
    charts?: any[];
  };
}

class ReportsService {
  /**
   * Generate attendance report
   */
  async generateAttendanceReport(config: ReportConfig): Promise<ReportData> {
    try {
      const { startDate, endDate } = config.dateRange;
      const { departmentId, employeeId, officeId } = config.filters || {};

      // Build where clause
      const whereClause: any = {
        date: {
          gte: startDate,
          lte: endDate
        }
      };

      if (employeeId) {
        whereClause.employeeId = employeeId;
      }

      if (departmentId || officeId) {
        whereClause.employee = {};
        if (departmentId) {
          whereClause.employee.departmentId = departmentId;
        }
        if (officeId) {
          whereClause.employee.officeId = officeId;
        }
      }

      // Fetch attendance data
      const attendanceData = await prisma.attendance.findMany({
        where: whereClause,
        include: {
          employee: {
            include: {
              department: true,
              office: true
            }
          }
        },
        orderBy: [
          { date: 'asc' },
          { employee: { firstName: 'asc' } }
        ]
      });

      // Calculate summary statistics
      const summary = {
        totalEmployees: new Set(attendanceData.map(a => a.employeeId)).size,
        totalDays: attendanceData.length,
        presentDays: attendanceData.filter(a => a.status === 'PRESENT').length,
        absentDays: attendanceData.filter(a => a.status === 'ABSENT').length,
        lateDays: attendanceData.filter(a => a.notes?.includes('LATE')).length,
        halfDays: attendanceData.filter(a => a.notes?.includes('HALF')).length,
        averageWorkHours: this.calculateAverageWorkHours(attendanceData),
        attendanceRate: this.calculateAttendanceRate(attendanceData)
      };

      // Group data based on configuration
      let groupedData = attendanceData;
      if (config.groupBy) {
        groupedData = this.groupAttendanceData(attendanceData, config.groupBy);
      }

      // Generate charts if requested
      let charts = [];
      if (config.includeCharts) {
        charts = await this.generateAttendanceCharts(attendanceData, config.groupBy);
      }

      const reportData: ReportData = {
        id: `report_${Date.now()}`,
        name: `Attendance Report - ${startDate.toDateString()} to ${endDate.toDateString()}`,
        type: 'attendance',
        generatedAt: new Date(),
        generatedBy: 'System',
        dateRange: { startDate, endDate },
        data: groupedData,
        metadata: {
          totalRecords: attendanceData.length,
          summary,
          charts
        }
      };

      return reportData;
    } catch (error) {
      console.error('Generate attendance report error:', error);
      throw error;
    }
  }

  /**
   * Generate leave report
   */
  async generateLeaveReport(config: ReportConfig): Promise<ReportData> {
    try {
      const { startDate, endDate } = config.dateRange;
      const { departmentId, employeeId, status, leaveType } = config.filters || {};

      // Build where clause
      const whereClause: any = {
        appliedOn: {
          gte: startDate,
          lte: endDate
        }
      };

      if (employeeId) {
        whereClause.employeeId = employeeId;
      }

      if (departmentId) {
        whereClause.employee = { departmentId };
      }

      if (status) {
        whereClause.status = status;
      }

      if (leaveType) {
        whereClause.type = leaveType;
      }

      // Fetch leave data
      const leaveData = await prisma.leaveRequest.findMany({
        where: whereClause,
        include: {
          employee: {
            include: {
              department: true,
              office: true
            }
          }
        },
        orderBy: [
          { appliedOn: 'desc' },
          { employee: { firstName: 'asc' } }
        ]
      });

      // Calculate summary statistics
      const summary = {
        totalRequests: leaveData.length,
        approvedRequests: leaveData.filter(l => l.status === 'APPROVED').length,
        rejectedRequests: leaveData.filter(l => l.status === 'REJECTED').length,
        pendingRequests: leaveData.filter(l => l.status === 'PENDING').length,
        averageProcessingTime: this.calculateAverageProcessingTime(leaveData),
        leaveByType: this.groupByLeaveType(leaveData),
        leaveByDepartment: this.groupByDepartment(leaveData)
      };

      // Group data based on configuration
      let groupedData = leaveData;
      if (config.groupBy) {
        groupedData = this.groupLeaveData(leaveData, config.groupBy);
      }

      // Generate charts if requested
      let charts = [];
      if (config.includeCharts) {
        charts = await this.generateLeaveCharts(leaveData, config.groupBy);
      }

      const reportData: ReportData = {
        id: `report_${Date.now()}`,
        name: `Leave Report - ${startDate.toDateString()} to ${endDate.toDateString()}`,
        type: 'leave',
        generatedAt: new Date(),
        generatedBy: 'System',
        dateRange: { startDate, endDate },
        data: groupedData,
        metadata: {
          totalRecords: leaveData.length,
          summary,
          charts
        }
      };

      return reportData;
    } catch (error) {
      console.error('Generate leave report error:', error);
      throw error;
    }
  }

  /**
   * Generate payroll report
   */
  async generatePayrollReport(config: ReportConfig): Promise<ReportData> {
    try {
      const { startDate, endDate } = config.dateRange;
      const { departmentId, employeeId } = config.filters || {};

      // Build where clause
      const whereClause: any = {
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      };

      if (employeeId) {
        whereClause.employeeId = employeeId;
      }

      if (departmentId) {
        whereClause.employee = { departmentId };
      }

      // Fetch payroll data
      const payrollData = await prisma.payslip.findMany({
        where: whereClause,
        include: {
          employee: {
            include: {
              department: true,
              office: true
            }
          }
        },
        orderBy: [
          { createdAt: 'desc' },
          { employee: { firstName: 'asc' } }
        ]
      });

      // Calculate summary statistics
      const summary = {
        totalPayslips: payrollData.length,
        totalGrossSalary: payrollData.reduce((sum, p) => sum + (p.baseSalary || 0), 0),
        totalNetSalary: payrollData.reduce((sum, p) => sum + (p.netSalary || 0), 0),
        totalDeductions: payrollData.reduce((sum, p) => sum + (p.deductions || 0), 0),
        averageGrossSalary: payrollData.length > 0 ? payrollData.reduce((sum, p) => sum + (p.baseSalary || 0), 0) / payrollData.length : 0,
        averageNetSalary: payrollData.length > 0 ? payrollData.reduce((sum, p) => sum + (p.netSalary || 0), 0) / payrollData.length : 0,
        payrollByDepartment: this.groupPayrollByDepartment(payrollData)
      };

      // Group data based on configuration
      let groupedData = payrollData;
      if (config.groupBy) {
        groupedData = this.groupPayrollData(payrollData, config.groupBy);
      }

      // Generate charts if requested
      let charts = [];
      if (config.includeCharts) {
        charts = await this.generatePayrollCharts(payrollData, config.groupBy);
      }

      const reportData: ReportData = {
        id: `report_${Date.now()}`,
        name: `Payroll Report - ${startDate.toDateString()} to ${endDate.toDateString()}`,
        type: 'payroll',
        generatedAt: new Date(),
        generatedBy: 'System',
        dateRange: { startDate, endDate },
        data: groupedData,
        metadata: {
          totalRecords: payrollData.length,
          summary,
          charts
        }
      };

      return reportData;
    } catch (error) {
      console.error('Generate payroll report error:', error);
      throw error;
    }
  }

  /**
   * Generate expense report
   */
  async generateExpenseReport(config: ReportConfig): Promise<ReportData> {
    try {
      const { startDate, endDate } = config.dateRange;
      const { departmentId, employeeId } = config.filters || {};

      // Build where clause
      const whereClause: any = {
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      };

      if (employeeId) {
        whereClause.employeeId = employeeId;
      }

      if (departmentId) {
        whereClause.employee = { departmentId };
      }

      // Fetch expense data
      const expenseData = await prisma.expense.findMany({
        where: whereClause,
        include: {
          employee: {
            include: {
              department: true,
              office: true
            }
          }
        },
        orderBy: [
          { createdAt: 'desc' },
          { employee: { firstName: 'asc' } }
        ]
      });

      // Calculate summary statistics
      const summary = {
        totalExpenses: expenseData.length,
        totalAmount: expenseData.reduce((sum, e) => sum + e.amount, 0),
        averageAmount: expenseData.length > 0 ? expenseData.reduce((sum, e) => sum + e.amount, 0) / expenseData.length : 0,
        expensesByCategory: this.groupExpensesByCategory(expenseData),
        expensesByDepartment: this.groupExpensesByDepartment(expenseData),
        approvedExpenses: expenseData.filter(e => e.status === 'APPROVED').length,
        pendingExpenses: expenseData.filter(e => e.status === 'PENDING').length,
        rejectedExpenses: expenseData.filter(e => e.status === 'REJECTED').length
      };

      // Group data based on configuration
      let groupedData = expenseData;
      if (config.groupBy) {
        groupedData = this.groupExpenseData(expenseData, config.groupBy);
      }

      // Generate charts if requested
      let charts = [];
      if (config.includeCharts) {
        charts = await this.generateExpenseCharts(expenseData, config.groupBy);
      }

      const reportData: ReportData = {
        id: `report_${Date.now()}`,
        name: `Expense Report - ${startDate.toDateString()} to ${endDate.toDateString()}`,
        type: 'expense',
        generatedAt: new Date(),
        generatedBy: 'System',
        dateRange: { startDate, endDate },
        data: groupedData,
        metadata: {
          totalRecords: expenseData.length,
          summary,
          charts
        }
      };

      return reportData;
    } catch (error) {
      console.error('Generate expense report error:', error);
      throw error;
    }
  }

  /**
   * Generate employee report
   */
  async generateEmployeeReport(config: ReportConfig): Promise<ReportData> {
    try {
      const { departmentId, officeId } = config.filters || {};

      // Build where clause
      const whereClause: any = {};

      if (departmentId) {
        whereClause.departmentId = departmentId;
      }

      if (officeId) {
        whereClause.officeId = officeId;
      }

      // Fetch employee data
      const employeeData = await prisma.employee.findMany({
        where: whereClause,
        include: {
          department: true,
          office: true,
          user: {
            select: {
              email: true,
              role: true
            }
          },
          _count: {
            select: {
              attendances: true,
              leaveRequests: true,
              expenses: true,
              payslips: true
            }
          }
        },
        orderBy: [
          { firstName: 'asc' },
          { lastName: 'asc' }
        ]
      });

      // Calculate summary statistics
      const summary = {
        totalEmployees: employeeData.length,
        activeEmployees: employeeData.filter(e => e.status === 'active').length,
        inactiveEmployees: employeeData.filter(e => e.status === 'inactive').length,
        employeesByDepartment: this.groupEmployeesByDepartment(employeeData),
        employeesByOffice: this.groupEmployeesByOffice(employeeData),
        employeesByRole: this.groupEmployeesByRole(employeeData)
      };

      // Group data based on configuration
      let groupedData = employeeData;
      if (config.groupBy) {
        groupedData = this.groupEmployeeData(employeeData, config.groupBy);
      }

      // Generate charts if requested
      let charts = [];
      if (config.includeCharts) {
        charts = await this.generateEmployeeCharts(employeeData, config.groupBy);
      }

      const reportData: ReportData = {
        id: `report_${Date.now()}`,
        name: `Employee Report - ${new Date().toDateString()}`,
        type: 'employee',
        generatedAt: new Date(),
        generatedBy: 'System',
        dateRange: { startDate: new Date(), endDate: new Date() },
        data: groupedData,
        metadata: {
          totalRecords: employeeData.length,
          summary,
          charts
        }
      };

      return reportData;
    } catch (error) {
      console.error('Generate employee report error:', error);
      throw error;
    }
  }

  /**
   * Helper methods for calculations
   */
  private calculateAverageWorkHours(attendanceData: any[]): number {
    const validRecords = attendanceData.filter(a => a.checkIn && a.checkOut);
    if (validRecords.length === 0) return 0;

    const totalHours = validRecords.reduce((sum, record) => {
      const checkIn = new Date(record.checkIn);
      const checkOut = new Date(record.checkOut);
      const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
      return sum + hours;
    }, 0);

    return Math.round((totalHours / validRecords.length) * 100) / 100;
  }

  private calculateAttendanceRate(attendanceData: any[]): number {
    if (attendanceData.length === 0) return 0;
    const presentDays = attendanceData.filter(a => a.status === 'PRESENT').length;
    return Math.round((presentDays / attendanceData.length) * 100 * 100) / 100;
  }

  private calculateAverageProcessingTime(leaveData: any[]): number {
    const processedLeaves = leaveData.filter(l => l.reviewedAt);
    if (processedLeaves.length === 0) return 0;

    const totalTime = processedLeaves.reduce((sum, leave) => {
      const appliedOn = new Date(leave.appliedOn);
      const reviewedAt = new Date(leave.reviewedAt);
      return sum + (reviewedAt.getTime() - appliedOn.getTime());
    }, 0);

    return Math.round((totalTime / processedLeaves.length) / (1000 * 60 * 60 * 24) * 100) / 100;
  }

  private groupByLeaveType(leaveData: any[]): Record<string, number> {
    return leaveData.reduce((acc, leave) => {
      acc[leave.type] = (acc[leave.type] || 0) + 1;
      return acc;
    }, {});
  }

  private groupByDepartment(data: any[]): Record<string, number> {
    return data.reduce((acc, item) => {
      const deptName = item.employee?.department?.name || 'Unknown';
      acc[deptName] = (acc[deptName] || 0) + 1;
      return acc;
    }, {});
  }

  private groupPayrollByDepartment(payrollData: any[]): Record<string, number> {
    return payrollData.reduce((acc, payslip) => {
      const deptName = payslip.employee?.department?.name || 'Unknown';
      acc[deptName] = (acc[deptName] || 0) + (payslip.grossSalary || 0);
      return acc;
    }, {});
  }

  private groupExpensesByCategory(expenseData: any[]): Record<string, number> {
    return expenseData.reduce((acc, expense) => {
      acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
      return acc;
    }, {});
  }

  private groupExpensesByDepartment(expenseData: any[]): Record<string, number> {
    return expenseData.reduce((acc, expense) => {
      const deptName = expense.employee?.department?.name || 'Unknown';
      acc[deptName] = (acc[deptName] || 0) + expense.amount;
      return acc;
    }, {});
  }

  private groupEmployeesByDepartment(employeeData: any[]): Record<string, number> {
    return employeeData.reduce((acc, employee) => {
      const deptName = employee.department?.name || 'Unknown';
      acc[deptName] = (acc[deptName] || 0) + 1;
      return acc;
    }, {});
  }

  private groupEmployeesByOffice(employeeData: any[]): Record<string, number> {
    return employeeData.reduce((acc, employee) => {
      const officeName = employee.office?.name || 'Unknown';
      acc[officeName] = (acc[officeName] || 0) + 1;
      return acc;
    }, {});
  }

  private groupEmployeesByRole(employeeData: any[]): Record<string, number> {
    return employeeData.reduce((acc, employee) => {
      const role = employee.user?.role || 'Unknown';
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {});
  }

  // Placeholder methods for grouping and chart generation
  private groupAttendanceData(data: any[], groupBy: string): any[] {
    // Implementation for grouping attendance data
    return data;
  }

  private groupLeaveData(data: any[], groupBy: string): any[] {
    // Implementation for grouping leave data
    return data;
  }

  private groupPayrollData(data: any[], groupBy: string): any[] {
    // Implementation for grouping payroll data
    return data;
  }

  private groupExpenseData(data: any[], groupBy: string): any[] {
    // Implementation for grouping expense data
    return data;
  }

  private groupEmployeeData(data: any[], groupBy: string): any[] {
    // Implementation for grouping employee data
    return data;
  }

  private async generateAttendanceCharts(data: any[], groupBy?: string): Promise<any[]> {
    // Implementation for generating attendance charts
    return [];
  }

  private async generateLeaveCharts(data: any[], groupBy?: string): Promise<any[]> {
    // Implementation for generating leave charts
    return [];
  }

  private async generatePayrollCharts(data: any[], groupBy?: string): Promise<any[]> {
    // Implementation for generating payroll charts
    return [];
  }

  private async generateExpenseCharts(data: any[], groupBy?: string): Promise<any[]> {
    // Implementation for generating expense charts
    return [];
  }

  private async generateEmployeeCharts(data: any[], groupBy?: string): Promise<any[]> {
    // Implementation for generating employee charts
    return [];
  }
}

export default new ReportsService();
