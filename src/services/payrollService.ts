import { prisma } from '../utils/db';
const { getWebSocketInstance } = require('../utils/websocketSingleton');

export interface PayrollCalculation {
  employeeId: number;
  month: number;
  year: number;
  baseSalary: number;
  allowance: number;
  deductions: number;
  overtime: number;
  bonus: number;
  netSalary: number;
  grossSalary: number;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  overtimeHours: number;
}

export interface PayrollRun {
  id: string;
  name: string;
  month: number;
  year: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  totalEmployees: number;
  processedEmployees: number;
  totalAmount: number;
  processedAmount: number;
  startedAt: Date;
  completedAt?: Date;
  createdBy: string;
  errors?: string[];
}

export interface SalaryStructure {
  id: number;
  employeeId: number;
  baseSalary: number;
  hra: number;
  da: number;
  conveyance: number;
  medical: number;
  special: number;
  pf: number;
  esi: number;
  professionalTax: number;
  tds: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
  isActive: boolean;
}

class PayrollService {
  /**
   * Calculate payroll for an employee
   */
  async calculatePayroll(employeeId: number, month: number, year: number): Promise<PayrollCalculation> {
    try {
      // Get employee information
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: {
          department: true,
          office: true
        }
      });

      if (!employee) {
        throw new Error('Employee not found');
      }

      // Get salary structure
      const salaryStructure = await this.getSalaryStructure(employeeId, new Date(year, month - 1, 1));

      // Get attendance data for the month
      const attendanceData = await this.getAttendanceData(employeeId, month, year);

      // Calculate salary based on present days
      // Formula: (baseSalary / workingDays) * presentDays
      const dailySalary = salaryStructure.baseSalary / attendanceData.workingDays;
      const calculatedBaseSalary = dailySalary * attendanceData.presentDays;

      // Calculate allowance (pro-rated based on present days)
      const totalAllowance = salaryStructure.hra + salaryStructure.da + salaryStructure.conveyance + salaryStructure.medical + salaryStructure.special;
      const dailyAllowance = totalAllowance / attendanceData.workingDays;
      const calculatedAllowance = dailyAllowance * attendanceData.presentDays;
      
      // Calculate overtime
      const overtime = this.calculateOvertime(attendanceData, salaryStructure);
      
      // Calculate bonus (if any)
      const bonus = await this.calculateBonus(employeeId, month, year);
      
      // Calculate gross salary
      const grossSalary = calculatedBaseSalary + calculatedAllowance + overtime + bonus;
      
      // Calculate statutory deductions
      const statutoryDeductions = this.calculateDeductions(grossSalary, salaryStructure, attendanceData);
      
      // Calculate policy-based deductions (late marks, leaves, absences)
      const policyDeductions = await this.applyPolicyDeductions(employeeId, attendanceData, grossSalary);
      
      // Total deductions
      const deductions = statutoryDeductions + policyDeductions;
      
      // Calculate net salary
      const netSalary = grossSalary - deductions;

      const calculation: PayrollCalculation = {
        employeeId,
        month,
        year,
        baseSalary: calculatedBaseSalary,
        allowance: calculatedAllowance,
        deductions,
        overtime,
        bonus,
        netSalary,
        grossSalary,
        workingDays: attendanceData.workingDays,
        presentDays: attendanceData.presentDays,
        absentDays: attendanceData.absentDays,
        leaveDays: attendanceData.leaveDays,
        overtimeHours: attendanceData.overtimeHours
      };

      return calculation;
    } catch (error) {
      console.error('Calculate payroll error:', error);
      throw error;
    }
  }

  /**
   * Process payroll for multiple employees
   */
  async processPayrollRun(employeeIds: number[], month: number, year: number, runName?: string): Promise<PayrollRun> {
    try {
      const runId = `run_${Date.now()}`;
      const run: PayrollRun = {
        id: runId,
        name: runName || `Payroll Run - ${month}/${year}`,
        month,
        year,
        status: 'PROCESSING',
        totalEmployees: employeeIds.length,
        processedEmployees: 0,
        totalAmount: 0,
        processedAmount: 0,
        startedAt: new Date(),
        createdBy: 'System'
      };

      const errors: string[] = [];
      let processedCount = 0;
      let totalAmount = 0;

      // Process each employee
      for (const employeeId of employeeIds) {
        try {
          const calculation = await this.calculatePayroll(employeeId, month, year);
          
          // Save payslip
          await this.savePayslip(calculation);
          
          processedCount++;
          totalAmount += calculation.netSalary;

          // Send notification to employee
          await this.sendPayrollNotification(employeeId, calculation);

        } catch (error) {
          console.error(`Error processing payroll for employee ${employeeId}:`, error);
          errors.push(`Employee ${employeeId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Update run status
      run.processedEmployees = processedCount;
      run.totalAmount = totalAmount;
      run.processedAmount = totalAmount;
      run.status = errors.length > 0 ? 'COMPLETED' : 'COMPLETED';
      run.completedAt = new Date();
      run.errors = errors;

      // Broadcast completion
      try {
        await getWebSocketInstance().broadcastNotification(0, {
          title: 'Payroll Run Completed',
          body: `Payroll run for ${month}/${year} has been completed. Processed ${processedCount}/${employeeIds.length} employees.`,
          type: 'payroll_run_completed',
          runId: run.id,
          processedCount,
          totalAmount
        });
      } catch (wsError) {
        console.error('❌ Failed to broadcast payroll run update:', wsError);
      }

      return run;
    } catch (error) {
      console.error('Process payroll run error:', error);
      throw error;
    }
  }

  /**
   * Get salary structure for an employee
   */
  async getSalaryStructure(employeeId: number, effectiveDate: Date): Promise<SalaryStructure> {
    try {
      const structure = await prisma.$queryRaw`
        SELECT * FROM salary_structure 
        WHERE employee_id = ${employeeId} 
        AND effective_from <= ${effectiveDate}
        AND (effective_to IS NULL OR effective_to >= ${effectiveDate})
        AND is_active = true
        ORDER BY effective_from DESC
        LIMIT 1
      ` as SalaryStructure[];

      if (structure.length === 0) {
        // Return default structure
        return {
          id: 0,
          employeeId,
          baseSalary: 0,
          hra: 0,
          da: 0,
          conveyance: 0,
          medical: 0,
          special: 0,
          pf: 0,
          esi: 0,
          professionalTax: 0,
          tds: 0,
          effectiveFrom: new Date(),
          isActive: true
        };
      }

      return structure[0];
    } catch (error) {
      console.error('Get salary structure error:', error);
      throw error;
    }
  }

  /**
   * Update salary structure
   */
  async updateSalaryStructure(employeeId: number, structureData: Partial<SalaryStructure>): Promise<SalaryStructure> {
    try {
      // Deactivate existing structures
      await prisma.$queryRaw`
        UPDATE salary_structure 
        SET is_active = false, updated_at = NOW()
        WHERE employee_id = ${employeeId}
      `;

      // Create new structure
      const newStructure = await prisma.$queryRaw`
        INSERT INTO salary_structure (
          employee_id, base_salary, hra, da, conveyance, medical, special,
          pf, esi, professional_tax, tds, effective_from, is_active, created_at, updated_at
        ) VALUES (
          ${employeeId}, ${structureData.baseSalary || 0}, ${structureData.hra || 0}, 
          ${structureData.da || 0}, ${structureData.conveyance || 0}, ${structureData.medical || 0},
          ${structureData.special || 0}, ${structureData.pf || 0}, ${structureData.esi || 0},
          ${structureData.professionalTax || 0}, ${structureData.tds || 0}, 
          ${structureData.effectiveFrom || new Date()}, true, NOW(), NOW()
        )
        RETURNING id, employee_id as "employeeId", base_salary as "baseSalary", hra, da, conveyance, medical, special,
                  pf, esi, professional_tax as "professionalTax", tds, effective_from as "effectiveFrom",
                  effective_to as "effectiveTo", is_active as "isActive", created_at as "createdAt"
      ` as SalaryStructure[];

      return newStructure[0];
    } catch (error) {
      console.error('Update salary structure error:', error);
      throw error;
    }
  }

  /**
   * Get payroll statistics
   */
  async getPayrollStats(month?: number, year?: number): Promise<any> {
    try {
      const targetMonth = month || new Date().getMonth() + 1;
      const targetYear = year || new Date().getFullYear();

      const stats = await prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_payslips,
          SUM(net_salary) as total_net_salary,
          SUM(base_salary) as total_base_salary,
          SUM(allowance) as total_allowance,
          SUM(deductions) as total_deductions,
          AVG(net_salary) as avg_net_salary,
          COUNT(CASE WHEN status = 'Approved' THEN 1 END) as approved_payslips,
          COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending_payslips
        FROM payslip 
        WHERE month = ${targetMonth} AND year = ${targetYear}
      ` as any[];

      const departmentStats = await prisma.$queryRaw`
        SELECT 
          d.name as department,
          COUNT(*) as employee_count,
          SUM(p.net_salary) as total_salary,
          AVG(p.net_salary) as avg_salary
        FROM payslip p
        JOIN employee e ON p.employee_id = e.id
        JOIN department d ON e.department_id = d.id
        WHERE p.month = ${targetMonth} AND p.year = ${targetYear}
        GROUP BY d.name
        ORDER BY total_salary DESC
      ` as any[];

      return {
        summary: stats[0] || {},
        departmentStats,
        month: targetMonth,
        year: targetYear
      };
    } catch (error) {
      console.error('Get payroll stats error:', error);
      throw error;
    }
  }

  /**
   * Get payroll runs history
   */
  async getPayrollRuns(limit: number = 50): Promise<PayrollRun[]> {
    try {
      const runs = await prisma.$queryRaw`
        SELECT * FROM payroll_runs 
        ORDER BY started_at DESC 
        LIMIT ${limit}
      ` as PayrollRun[];

      return runs;
    } catch (error) {
      console.error('Get payroll runs error:', error);
      throw error;
    }
  }

  /**
   * Helper methods
   */
  private async getAttendanceData(employeeId: number, month: number, year: number): Promise<any> {
    try {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      const attendance = await prisma.attendance.findMany({
        where: {
          employeeId,
          date: {
            gte: startDate.toISOString(),
            lte: endDate.toISOString()
          }
        }
      });

      // Get holidays for the month
      const holidays = await prisma.holiday.findMany({
        where: {
          date: {
            gte: startDate.toISOString(),
            lte: endDate.toISOString()
          }
        }
      });

      // Get employee's office to calculate actual working days
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: { office: true }
      });

      const office = employee?.office;
      const workingDaysInMonth = office?.workingDays?.length || 5; // Default to 5 days
      const totalDaysInMonth = new Date(year, month, 0).getDate();
      
      // Calculate actual working days (excluding weekends and holidays)
      let actualWorkingDays = 0;
      for (let day = 1; day <= totalDaysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        const isWorkingDay = office?.workingDays?.includes(dayName) || false;
        const isHoliday = holidays.some(h => new Date(h.date).toDateString() === date.toDateString());
        
        if (isWorkingDay && !isHoliday) {
          actualWorkingDays++;
        }
      }

      const presentDays = attendance.filter(a => a.status === 'PRESENT').length;
      const absentDays = attendance.filter(a => a.status === 'ABSENT').length;
      const leaveDays = attendance.filter(a => a.status === 'LEAVE').length;
      
      // Count late marks (check-in after office start time)
      const officeStartTime = office?.workingHoursStart || '09:00';
      const lateMarks = attendance.filter(a => {
        if (a.checkIn && a.status === 'PRESENT') {
          const checkInTime = new Date(a.checkIn).toTimeString().slice(0, 5);
          return checkInTime > officeStartTime;
        }
        return false;
      }).length;
      
      // Calculate overtime hours (placeholder)
      const overtimeHours = 0;

      return {
        workingDays: actualWorkingDays,
        totalDaysInMonth,
        presentDays,
        absentDays,
        leaveDays,
        lateMarks,
        holidays: holidays.length,
        overtimeHours
      };
    } catch (error) {
      console.error('Get attendance data error:', error);
      throw error;
    }
  }

  private calculateOvertime(attendanceData: any, salaryStructure: SalaryStructure): number {
    // Placeholder for overtime calculation
    // This would typically be based on overtime hours and overtime rate
    return 0;
  }

  private async calculateBonus(employeeId: number, month: number, year: number): Promise<number> {
    // Placeholder for bonus calculation
    // This could be based on performance, company policy, etc.
    return 0;
  }

  private calculateDeductions(grossSalary: number, structure: SalaryStructure, attendanceData: any): number {
    let deductions = 0;

    // Statutory deductions
    deductions += structure.pf || 0;
    deductions += structure.esi || 0;
    deductions += structure.professionalTax || 0;
    deductions += structure.tds || 0;

    // Attendance-based deductions
    const absentDays = attendanceData.absentDays;
    const dailySalary = grossSalary / attendanceData.workingDays;
    deductions += absentDays * dailySalary * 0.5; // 50% deduction for absent days

    return deductions;
  }

  private async applyPolicyDeductions(employeeId: number, attendanceData: any, grossSalary: number): Promise<number> {
    try {
      // Get applicable policies for the employee
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: {
          branch: true,
          department: true,
          office: true
        }
      });

      if (!employee) return 0;

      const policies = await prisma.deductionPolicy.findMany({
        where: {
          isActive: true,
          OR: [
            { branchId: employee.branchId },
            { departmentId: employee.departmentId },
            { officeId: employee.officeId },
            { branchId: null, departmentId: null, officeId: null } // Global policies
          ]
        }
      });

      let policyDeductions = 0;

      for (const policy of policies) {
        const deduction = await this.calculatePolicyDeduction(policy, attendanceData, grossSalary);
        policyDeductions += deduction;
      }

      return policyDeductions;
    } catch (error) {
      console.error('Apply policy deductions error:', error);
      return 0;
    }
  }

  private async calculatePolicyDeduction(policy: any, attendanceData: any, grossSalary: number): Promise<number> {
    let deduction = 0;

    switch (policy.type) {
      case 'LATE_MARK':
        deduction = this.calculateLateMarkDeduction(policy, attendanceData.lateMarks, grossSalary);
        break;
      case 'LEAVE':
        deduction = this.calculateLeaveDeduction(policy, attendanceData.leaveDays, grossSalary);
        break;
      case 'ABSENT':
        deduction = this.calculateAbsentDeduction(policy, attendanceData.absentDays, grossSalary);
        break;
    }

    // Apply max deduction if set
    if (policy.maxDeduction && deduction > policy.maxDeduction) {
      deduction = policy.maxDeduction;
    }

    return deduction;
  }

  private calculateLateMarkDeduction(policy: any, lateMarks: number, grossSalary: number): number {
    const { deductionType, deductionValue } = policy;

    switch (deductionType) {
      case 'FIXED_AMOUNT':
        return lateMarks * deductionValue;
      case 'PERCENTAGE':
        return grossSalary * (deductionValue / 100);
      case 'PER_DAY':
        return lateMarks * deductionValue;
      default:
        return 0;
    }
  }

  private calculateLeaveDeduction(policy: any, leaveDays: number, grossSalary: number): number {
    const { deductionType, deductionValue } = policy;

    switch (deductionType) {
      case 'FIXED_AMOUNT':
        return leaveDays * deductionValue;
      case 'PERCENTAGE':
        return grossSalary * (deductionValue / 100);
      case 'PER_DAY':
        return leaveDays * deductionValue;
      default:
        return 0;
    }
  }

  private calculateAbsentDeduction(policy: any, absentDays: number, grossSalary: number): number {
    const { deductionType, deductionValue } = policy;

    switch (deductionType) {
      case 'FIXED_AMOUNT':
        return absentDays * deductionValue;
      case 'PERCENTAGE':
        return grossSalary * (deductionValue / 100);
      case 'PER_DAY':
        return absentDays * deductionValue;
      default:
        return 0;
    }
  }

  private async savePayslip(calculation: PayrollCalculation): Promise<void> {
    try {
      await prisma.payslip.upsert({
        where: {
          employeeId_month_year: {
            employeeId: calculation.employeeId,
            month: calculation.month,
            year: calculation.year
          }
        },
        update: {
          baseSalary: calculation.baseSalary,
          allowance: calculation.allowance,
          deductions: calculation.deductions,
          netSalary: calculation.netSalary,
          status: 'Approved',
          updatedAt: new Date()
        },
        create: {
          employeeId: calculation.employeeId,
          month: calculation.month,
          year: calculation.year,
          baseSalary: calculation.baseSalary,
          allowance: calculation.allowance,
          deductions: calculation.deductions,
          netSalary: calculation.netSalary,
          status: 'Approved',
          employeeCode: '',
          employeeName: '',
          designation: '',
          department: '',
          officeName: '',
          netInWords: '',
          createdAt: new Date()
        }
      });
    } catch (error) {
      console.error('Save payslip error:', error);
      throw error;
    }
  }

  private async sendPayrollNotification(employeeId: number, calculation: PayrollCalculation): Promise<void> {
    try {
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: { user: true }
      });

      if (employee && employee.user) {
        await prisma.notification.create({
          data: {
            employeeId,
            userId: employee.user.id,
            title: 'Payslip Generated',
            body: `Your payslip for ${calculation.month}/${calculation.year} has been generated. Net salary: ₹${calculation.netSalary}`,
            category: 'PAYROLL',
            actionId: `${employeeId}-${calculation.month}-${calculation.year}`,
            actionType: 'PAYSLIP_GENERATED'
          }
        });

        // Broadcast real-time update
        try {
          await getWebSocketInstance().broadcastNotification(employeeId, {
            title: 'Payslip Generated',
            body: `Your payslip for ${calculation.month}/${calculation.year} is now available.`,
            type: 'payslip_generated',
            employeeId,
            month: calculation.month,
            year: calculation.year
          });
        } catch (wsError) {
          console.error('❌ Failed to broadcast payslip notification:', wsError);
        }
      }
    } catch (error) {
      console.error('Send payroll notification error:', error);
    }
  }
}

export default new PayrollService();