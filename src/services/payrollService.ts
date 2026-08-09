import { prisma } from '../utils/db';
import { firebaseNotificationService } from './firebaseNotificationService';
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
  halfDays: number;
  halfDayDeduction: number;
  leaveDeduction: number;
  commissionEarned: number;
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
      const workingDays = attendanceData.workingDays || 30;
      const dailySalary = salaryStructure.baseSalary / workingDays;
      const calculatedBaseSalary = dailySalary * attendanceData.presentDays;

      // Calculate allowance (pro-rated based on present days)
      const totalAllowance = salaryStructure.hra + salaryStructure.da + salaryStructure.conveyance + salaryStructure.medical + salaryStructure.special;
      const dailyAllowance = totalAllowance / workingDays;
      const calculatedAllowance = dailyAllowance * attendanceData.presentDays;

      // Calculate half-day and leave deductions
      const halfDayDeduction = attendanceData.halfDays * (dailySalary * 0.5);
      const leaveDeduction = attendanceData.leaveDays * dailySalary;
      
      // Calculate overtime
      const overtime = this.calculateOvertime(attendanceData, salaryStructure);
      
      // Calculate bonus (if any)
      const bonus = await this.calculateBonus(employeeId, month, year);

      // Fetch commission earned for this month
      const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
      const commAggregate = await prisma.commissionTransaction.aggregate({
        where: {
          employeeId,
          createdAt: { gte: monthStart, lte: monthEnd },
          status: { in: ['PENDING', 'APPROVED', 'PAID'] }
        },
        _sum: { commissionAmount: true }
      });
      const commissionEarned = commAggregate._sum?.commissionAmount || 0;
      
      // Calculate gross salary
      const grossSalary = calculatedBaseSalary + calculatedAllowance + overtime + bonus + commissionEarned;
      
      // Calculate statutory deductions
      const statutoryDeductions = this.calculateDeductions(grossSalary, salaryStructure, attendanceData);
      
      // Calculate policy-based deductions (late marks, leaves, absences)
      const policyDeductions = await this.applyPolicyDeductions(employeeId, attendanceData, grossSalary);
      
      // Total deductions (including half-day & leave deductions)
      const deductions = statutoryDeductions + policyDeductions + halfDayDeduction + leaveDeduction;
      
      // Calculate net salary
      const netSalary = Math.max(0, grossSalary - deductions);

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
        workingDays,
        presentDays: attendanceData.presentDays,
        absentDays: attendanceData.absentDays,
        leaveDays: attendanceData.leaveDays,
        halfDays: attendanceData.halfDays,
        halfDayDeduction,
        leaveDeduction,
        commissionEarned,
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
      const name = runName || `Payroll Run - ${month}/${year}`;
      let createdRun: any = null;

      try {
        createdRun = await prisma.payrollRun.create({
          data: {
            name,
            month,
            year,
            status: 'PROCESSING',
            totalEmployees: employeeIds.length,
            processedEmployees: 0,
            totalAmount: 0,
            processedAmount: 0,
            startedAt: new Date(),
            createdBy: 'System'
          }
        });
      } catch (dbErr) {
        console.warn('Could not create DB PayrollRun record:', dbErr);
      }

      const runId = createdRun?.id || `run_${Date.now()}`;
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

      const finalStatus = 'COMPLETED';
      const completedAt = new Date();

      if (createdRun) {
        try {
          await prisma.payrollRun.update({
            where: { id: createdRun.id },
            data: {
              processedEmployees: processedCount,
              totalAmount,
              processedAmount: totalAmount,
              status: finalStatus,
              completedAt,
              errors
            }
          });
        } catch (dbErr) {
          console.warn('Could not update DB PayrollRun record:', dbErr);
        }
      }

      const runResult: PayrollRun = {
        id: runId,
        name,
        month,
        year,
        status: finalStatus,
        totalEmployees: employeeIds.length,
        processedEmployees: processedCount,
        totalAmount,
        processedAmount: totalAmount,
        startedAt: createdRun?.startedAt || new Date(),
        completedAt,
        createdBy: 'System',
        errors
      };

      // Broadcast completion
      try {
        await getWebSocketInstance().broadcastNotification(0, {
          title: 'Payroll Run Completed',
          body: `Payroll run for ${month}/${year} has been completed. Processed ${processedCount}/${employeeIds.length} employees.`,
          type: 'payroll_run_completed',
          runId,
          processedCount,
          totalAmount
        });
      } catch (wsError) {
        console.error('❌ Failed to broadcast payroll run update:', wsError);
      }

      return runResult;
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
      const structure = await prisma.salaryStructure.findUnique({
        where: { employeeId }
      });

      if (!structure) {
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

      const basic = structure.basicSalary || structure.monthlySalary || 0;
      const gross = structure.grossSalary || basic;
      const pf = structure.pfEnabled ? basic * (structure.employeePfRate / 100) : 0;
      const esi = structure.esicEnabled ? gross * (structure.employeeEsicRate / 100) : 0;

      return {
        id: structure.id,
        employeeId: structure.employeeId,
        baseSalary: basic,
        hra: structure.hra || 0,
        da: 0,
        conveyance: structure.travelAllowance || 0,
        medical: structure.medicalAllowance || 0,
        special: structure.specialAllowance || 0,
        pf,
        esi,
        professionalTax: 0,
        tds: 0,
        effectiveFrom: structure.createdAt,
        isActive: true
      };
    } catch (error) {
      console.error('Get salary structure error:', error);
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
  }

  /**
   * Update salary structure
   */
  async updateSalaryStructure(employeeId: number, structureData: Partial<SalaryStructure>): Promise<SalaryStructure> {
    try {
      const basicSalary = structureData.baseSalary || 0;
      const hra = structureData.hra || 0;
      const medicalAllowance = structureData.medical || 0;
      const travelAllowance = structureData.conveyance || 0;
      const specialAllowance = structureData.special || 0;
      const grossSalary = basicSalary + hra + medicalAllowance + travelAllowance + specialAllowance;

      const structure = await prisma.salaryStructure.upsert({
        where: { employeeId },
        update: {
          basicSalary,
          hra,
          medicalAllowance,
          travelAllowance,
          specialAllowance,
          grossSalary,
          monthlySalary: grossSalary,
          updatedAt: new Date()
        },
        create: {
          employeeId,
          basicSalary,
          hra,
          medicalAllowance,
          travelAllowance,
          specialAllowance,
          grossSalary,
          monthlySalary: grossSalary,
        }
      });

      const pf = structure.pfEnabled ? basicSalary * (structure.employeePfRate / 100) : 0;
      const esi = structure.esicEnabled ? grossSalary * (structure.employeeEsicRate / 100) : 0;

      return {
        id: structure.id,
        employeeId: structure.employeeId,
        baseSalary: basicSalary,
        hra,
        da: 0,
        conveyance: travelAllowance,
        medical: medicalAllowance,
        special: specialAllowance,
        pf,
        esi,
        professionalTax: 0,
        tds: 0,
        effectiveFrom: structure.createdAt,
        isActive: true
      };
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

      const payslips = await prisma.payslip.findMany({
        where: {
          month: targetMonth,
          year: targetYear
        },
        include: {
          employee: {
            include: {
              department: true
            }
          }
        }
      });

      const total_payslips = payslips.length;
      let total_net_salary = 0;
      let total_base_salary = 0;
      let total_allowance = 0;
      let total_deductions = 0;
      let approved_payslips = 0;
      let pending_payslips = 0;

      const deptMap = new Map<string, { department: string; employee_count: number; total_salary: number }>();

      for (const p of payslips) {
        total_net_salary += p.netSalary || 0;
        total_base_salary += p.baseSalary || 0;
        total_allowance += p.allowance || 0;
        total_deductions += p.deductions || 0;

        const st = p.status?.toLowerCase() || '';
        if (st === 'approved') {
          approved_payslips++;
        } else if (st === 'pending') {
          pending_payslips++;
        }

        const deptName = p.employee?.department?.name || p.department || 'Unassigned';
        const existing = deptMap.get(deptName) || { department: deptName, employee_count: 0, total_salary: 0 };
        existing.employee_count += 1;
        existing.total_salary += (p.netSalary || 0);
        deptMap.set(deptName, existing);
      }

      const avg_net_salary = total_payslips > 0 ? total_net_salary / total_payslips : 0;

      const departmentStats = Array.from(deptMap.values()).map(d => ({
        ...d,
        avg_salary: d.employee_count > 0 ? d.total_salary / d.employee_count : 0
      })).sort((a, b) => b.total_salary - a.total_salary);

      return {
        summary: {
          total_payslips,
          total_net_salary,
          total_base_salary,
          total_allowance,
          total_deductions,
          avg_net_salary,
          approved_payslips,
          pending_payslips
        },
        departmentStats,
        month: targetMonth,
        year: targetYear
      };
    } catch (error) {
      console.error('Get payroll stats error:', error);
      return {
        summary: {
          total_payslips: 0,
          total_net_salary: 0,
          total_base_salary: 0,
          total_allowance: 0,
          total_deductions: 0,
          avg_net_salary: 0,
          approved_payslips: 0,
          pending_payslips: 0
        },
        departmentStats: [],
        month: month || new Date().getMonth() + 1,
        year: year || new Date().getFullYear()
      };
    }
  }

  /**
   * Get payroll runs history
   */
  async getPayrollRuns(limit: number = 50): Promise<PayrollRun[]> {
    try {
      const dbRuns = await prisma.payrollRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: limit
      });

      return dbRuns.map(r => ({
        id: r.id,
        name: r.name,
        month: r.month,
        year: r.year,
        status: r.status as any,
        totalEmployees: r.totalEmployees,
        processedEmployees: r.processedEmployees,
        totalAmount: r.totalAmount,
        processedAmount: r.processedAmount,
        startedAt: r.startedAt,
        completedAt: r.completedAt || undefined,
        createdBy: r.createdBy,
        errors: r.errors
      }));
    } catch (error) {
      console.warn('Get payroll runs error:', error);
      return [];
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
      const leaveDays = attendance.filter(a => a.status === 'LEAVE' || a.status === 'UNPLANNED_LEAVE').length;
      const halfDays = attendance.filter(a => a.status === 'HALF_DAY').length;
      
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
        halfDays,
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
            { departmentId: employee.departmentId },
            { officeId: employee.officeId },
            { departmentId: null, officeId: null } // Global policies
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
      const employee = await prisma.employee.findUnique({
        where: { id: calculation.employeeId },
        include: {
          department: true,
          office: true
        }
      });

      const empCode = employee?.employeeCode || `EMP-${calculation.employeeId}`;
      const empName = employee ? `${employee.firstName} ${employee.lastName}`.trim() : `Employee #${calculation.employeeId}`;
      const desigName = employee?.designation || '';
      const deptName = employee?.department?.name || '';
      const offName = employee?.office?.name || '';

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
          employeeCode: empCode,
          employeeName: empName,
          designation: desigName,
          department: deptName,
          officeName: offName,
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
          employeeCode: empCode,
          employeeName: empName,
          designation: desigName,
          department: deptName,
          officeName: offName,
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

        // Send FCM push notification (outside app)
        firebaseNotificationService.sendAppNotification({
          userId: employee.user.id,
          title: 'Salary Slip Generated',
          body: `Your salary slip for ${calculation.month}/${calculation.year} is now available. Net pay: ₹${calculation.netSalary}`,
          category: 'payroll',
          screen: 'salary_slip',
          type: 'salary',
          actionId: `${employeeId}-${calculation.month}-${calculation.year}`,
        }).catch(err => console.error('Payslip FCM push error:', err));
      }
    } catch (error) {
      console.error('Send payroll notification error:', error);
    }
  }
}

export default new PayrollService();