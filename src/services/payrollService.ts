import { prisma } from '../utils/db';
import { firebaseNotificationService } from './firebaseNotificationService';
import { getIstMonthRange } from '../utils/commissionHelper';
const { getWebSocketInstance } = require('../utils/websocketSingleton');

export interface PayrollCalculation {
  employeeId: number;
  month: number;
  year: number;
  baseSalary: number;
  monthlySalary: number;
  dailySalary: number;
  allowance: number;
  deductions: number;
  statutoryDeductions: number;
  policyDeductions: number;
  overtime: number;
  bonus: number;
  netSalary: number;
  grossSalary: number;
  workingDays: number;
  totalCalendarDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  holidayCount: number;
  weeklyOffCount: number;
  holidayWorkedCount: number;
  weeklyOffWorkedCount: number;
  halfDayDeduction: number;
  leaveDeduction: number; // unpaid leave deduction
  absentDeduction: number;
  advanceDeduction: number;
  expenseReimbursement: number;
  approvedExpenses: number;
  expensesByCategory?: Array<{ category: string; amount: number }>;
  expenseCategories?: Record<string, number>;
  extraHolidayPayout: number;
  extraWeeklyOffPayout: number;
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
  monthlySalary: number;
  grossSalary: number;
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
   * Calculate payroll for an employee with attendance-driven logic & status priority
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

      // Monthly & Base Salary
      const monthlySalary = salaryStructure.monthlySalary || salaryStructure.grossSalary || (salaryStructure.baseSalary + salaryStructure.hra + salaryStructure.medical + salaryStructure.conveyance + salaryStructure.special) || salaryStructure.baseSalary || 12000;
      const baseSalary = salaryStructure.baseSalary || monthlySalary;
      const totalAllowance = (salaryStructure.hra || 0) + (salaryStructure.medical || 0) + (salaryStructure.conveyance || 0) + (salaryStructure.special || 0);

      // Get attendance breakdown data for the month
      const attendanceData = await this.getAttendanceData(employeeId, month, year, employee.office);

      const workingDays = attendanceData.workingDays || 26;
      const totalCalendarDays = attendanceData.totalCalendarDays || new Date(year, month, 0).getDate();

      // Daily Salary formula: Monthly Salary / Scheduled Working Days
      const dailySalary = Math.round((monthlySalary / workingDays) * 100) / 100;

      // Attendance Deductions (decimal-safe)
      const absentDeduction = Math.round((attendanceData.absentDays * dailySalary) * 100) / 100;
      const halfDayDeduction = Math.round((attendanceData.halfDays * 0.5 * dailySalary) * 100) / 100;
      const unpaidLeaveDeduction = Math.round((attendanceData.unpaidLeaveDays * dailySalary) * 100) / 100;

      // Extra Payouts for Holiday / Weekly-Off Work (default multiplier 1.0x)
      const extraHolidayPayout = Math.round((attendanceData.holidayWorkedCount * dailySalary * 1.0) * 100) / 100;
      const extraWeeklyOffPayout = Math.round((attendanceData.weeklyOffWorkedCount * dailySalary * 1.0) * 100) / 100;

      // Calculate overtime & bonus (if any)
      const overtime = this.calculateOvertime(attendanceData, salaryStructure);
      const bonus = await this.calculateBonus(employeeId, month, year);

      // Fetch commission earned strictly for this month (IST boundaries)
      const monthRange = getIstMonthRange(year, month);
      const monthStart = monthRange.monthStart;
      const monthEnd = monthRange.monthEnd;

      const commAggregate = await prisma.commissionTransaction.aggregate({
        where: {
          employeeId,
          createdAt: { gte: monthStart, lte: monthEnd },
          status: { in: ['PENDING', 'APPROVED', 'PAID'] }
        },
        _sum: { commissionAmount: true }
      });
      const commissionEarned = commAggregate._sum?.commissionAmount || 0;

      // Fetch approved expenses for this month
      const approvedExpenseRecords = await prisma.expense.findMany({
        where: {
          employeeId,
          status: 'APPROVED',
          date: { gte: monthStart, lte: monthEnd }
        }
      });
      const expenseCategories: Record<string, number> = {};
      let totalApprovedExpenses = 0;
      for (const exp of approvedExpenseRecords) {
        const cat = exp.category || 'Other';
        const amt = exp.amount || 0;
        totalApprovedExpenses += amt;
        expenseCategories[cat] = Math.round(((expenseCategories[cat] || 0) + amt) * 100) / 100;
      }
      const approvedExpenses = Math.round(totalApprovedExpenses * 100) / 100;
      const expensesByCategory = Object.entries(expenseCategories).map(([category, amount]) => ({
        category,
        amount,
      }));

      // Gross Salary: Regular Monthly Salary + Extra Payouts + Bonus + Overtime + Commission + Approved Expenses
      const grossSalary = Math.round((monthlySalary + extraHolidayPayout + extraWeeklyOffPayout + bonus + overtime + commissionEarned + approvedExpenses) * 100) / 100;

      // Calculate statutory deductions
      const statutoryDeductions = this.calculateDeductions(grossSalary, salaryStructure);

      // Calculate policy-based deductions
      const policyDeductions = await this.applyPolicyDeductions(employeeId, attendanceData, grossSalary);

      // Advance salary deduction calculation
      const activeAdvances = await prisma.salaryAdvance.findMany({
        where: {
          wallet: { employeeId },
          status: 'APPROVED',
          remainingAmount: { gt: 0 },
          OR: [
            { approvedAt: { lte: monthEnd } },
            { approvedAt: null, requestedOn: { lte: monthEnd } },
            { approvedAt: null, createdAt: { lte: monthEnd } }
          ]
        },
        orderBy: { approvedAt: 'asc' }
      });

      let advanceDeduction = 0;
      for (const adv of activeAdvances) {
        const standardEmi = adv.monthlyEmi > 0 
          ? adv.monthlyEmi 
          : (adv.months > 0 ? Math.round((adv.amount / adv.months) * 100) / 100 : adv.amount);
        const remaining = adv.remainingAmount > 0 ? adv.remainingAmount : Math.max(0, adv.amount - (adv.paidAmount || 0));
        advanceDeduction += Math.min(standardEmi, remaining);
      }
      advanceDeduction = Math.round(advanceDeduction * 100) / 100;

      // Total Deductions
      const totalDeductions = Math.round((statutoryDeductions + policyDeductions + absentDeduction + halfDayDeduction + unpaidLeaveDeduction + advanceDeduction) * 100) / 100;

      // Net Salary
      const netSalary = Math.round((grossSalary - totalDeductions) * 100) / 100;

      const calculation: PayrollCalculation = {
        employeeId,
        month,
        year,
        baseSalary,
        monthlySalary,
        dailySalary,
        allowance: totalAllowance,
        deductions: totalDeductions,
        statutoryDeductions,
        policyDeductions,
        overtime,
        bonus,
        netSalary,
        grossSalary,
        workingDays,
        totalCalendarDays,
        presentDays: attendanceData.presentDays,
        absentDays: attendanceData.absentDays,
        leaveDays: attendanceData.paidLeaveDays + attendanceData.unpaidLeaveDays,
        halfDays: attendanceData.halfDays,
        paidLeaveDays: attendanceData.paidLeaveDays,
        unpaidLeaveDays: attendanceData.unpaidLeaveDays,
        holidayCount: attendanceData.holidayCount,
        weeklyOffCount: attendanceData.weeklyOffCount,
        holidayWorkedCount: attendanceData.holidayWorkedCount,
        weeklyOffWorkedCount: attendanceData.weeklyOffWorkedCount,
        halfDayDeduction,
        leaveDeduction: unpaidLeaveDeduction,
        absentDeduction,
        advanceDeduction,
        expenseReimbursement: approvedExpenses,
        approvedExpenses,
        expensesByCategory,
        expenseCategories,
        extraHolidayPayout,
        extraWeeklyOffPayout,
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
   * Automatically generate payroll for completed period with strict idempotency (no duplicates)
   */
  async autoGenerateMonthlyPayroll(month: number, year: number): Promise<{ processed: number; skipped: number; totalAmount: number }> {
    try {
      const activeEmployees = await prisma.employee.findMany({
        where: { status: { in: ['ACTIVE', 'active'] } }
      });

      let processed = 0;
      let skipped = 0;
      let totalAmount = 0;

      for (const emp of activeEmployees) {
        // Idempotency check: Check if payslip already exists for this period
        const existingPayslip = await prisma.payslip.findUnique({
          where: {
            employeeId_month_year: {
              employeeId: emp.id,
              month,
              year
            }
          }
        });

        if (existingPayslip) {
          skipped++;
          console.log(`ℹ️ [AutoPayroll] Payslip for employee #${emp.id} (${emp.employeeCode}) for ${month}/${year} already exists. Skipping.`);
          continue;
        }

        const calc = await this.calculatePayroll(emp.id, month, year);
        await this.savePayslip(calc);
        await this.sendPayrollNotification(emp.id, calc);
        processed++;
        totalAmount += calc.netSalary;
      }

      console.log(`✅ [AutoPayroll] Completed for ${month}/${year}: Processed ${processed}, Skipped ${skipped}. Total Net Volume: ₹${totalAmount}`);
      return { processed, skipped, totalAmount };
    } catch (error) {
      console.error('Auto generate monthly payroll error:', error);
      throw error;
    }
  }

  /**
   * Get salary structure for an employee
   */
  async getSalaryStructure(employeeId: number, effectiveDate: Date): Promise<SalaryStructure> {
    try {
      let structure = await prisma.salaryStructure.findUnique({
        where: { employeeId }
      });

      if (!structure) {
        structure = await prisma.salaryStructure.upsert({
          where: { employeeId },
          update: {},
          create: {
            employeeId,
            basicSalary: 10000,
            hra: 2000,
            medicalAllowance: 500,
            travelAllowance: 1000,
            specialAllowance: 0,
            monthlySalary: 13500,
            grossSalary: 13500,
            salaryAdvanceLimit: 25000,
          }
        });
      }

      const basic = structure.basicSalary || structure.monthlySalary || 0;
      const gross = structure.grossSalary || structure.monthlySalary || basic;
      const pf = structure.pfEnabled ? basic * (structure.employeePfRate / 100) : 0;
      const esi = structure.esicEnabled ? gross * (structure.employeeEsicRate / 100) : 0;

      return {
        id: structure.id,
        employeeId: structure.employeeId,
        baseSalary: basic,
        monthlySalary: structure.monthlySalary || gross,
        grossSalary: gross,
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
        monthlySalary: 0,
        grossSalary: 0,
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
        monthlySalary: structure.monthlySalary || grossSalary,
        grossSalary,
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
        if (st === 'approved' || st === 'paid') {
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
   * Day-by-day attendance & leave & holiday classification with deterministic priority
   */
  private async getAttendanceData(employeeId: number, month: number, year: number, office?: any): Promise<any> {
    try {
      const monthRange = getIstMonthRange(year, month);
      const totalCalendarDays = new Date(year, month, 0).getDate();
      const startDateStr = monthRange.startDateStr;
      const endDateStr = monthRange.endDateStr;

      const startDate = monthRange.monthStart;
      const endDate = monthRange.monthEnd;

      // Fetch attendance records for month
      const attendanceRecords = await prisma.attendance.findMany({
        where: {
          employeeId,
          date: { gte: startDateStr, lte: endDateStr }
        }
      });

      // Fetch holidays for month
      const holidays = await prisma.holiday.findMany({
        where: {
          date: { gte: startDate, lte: endDate }
        }
      });

      // Fetch approved leave requests for employee covering month
      const approvedLeaves = await prisma.leaveRequest.findMany({
        where: {
          employeeId,
          status: 'APPROVED',
          fromDate: { lte: endDate },
          toDate: { gte: startDate }
        }
      });

      const toIstYmd = (d: Date | string) => {
        const dt = new Date(d);
        const ist = new Date(dt.getTime() + 5.5 * 60 * 60 * 1000);
        return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
      };

      const officeWorkingDays = office?.workingDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      let scheduledWorkingDays = 0;
      let presentDays = 0;
      let halfDays = 0;
      let paidLeaveDays = 0;
      let unpaidLeaveDays = 0;
      let absentDays = 0;
      let holidayCount = 0;
      let weeklyOffCount = 0;
      let holidayWorkedCount = 0;
      let weeklyOffWorkedCount = 0;
      let lateMarks = 0;

      for (let day = 1; day <= totalCalendarDays; day++) {
        const dayStr = String(day).padStart(2, '0');
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${dayStr}`;
        const dateObj = new Date(year, month - 1, day, 12, 0, 0);
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

        const isWeeklyOff = !officeWorkingDays.includes(dayName);
        const isHoliday = holidays.some(h => {
          const hStr = toIstYmd(h.date);
          return hStr === dateStr;
        });

        const att = attendanceRecords.find(a => a.date === dateStr);
        const leave = approvedLeaves.find(l => {
          const fStr = toIstYmd(l.fromDate);
          const tStr = toIstYmd(l.toDate);
          return fStr <= dateStr && dateStr <= tStr;
        });

        // 9-Tier Deterministic Priority Classification
        if (isHoliday) {
          if (att && (att.checkIn || att.status === 'PRESENT' || att.status === 'HOLIDAY_WORKED')) {
            holidayWorkedCount++;
          } else {
            holidayCount++;
          }
        } else if (isWeeklyOff) {
          if (att && (att.checkIn || att.status === 'PRESENT' || att.status === 'WEEKLY_OFF_WORKED')) {
            weeklyOffWorkedCount++;
          } else {
            weeklyOffCount++;
          }
        } else {
          // Scheduled Working Day
          scheduledWorkingDays++;

          if (att) {
            if (att.status === 'PRESENT') {
              presentDays++;
              if (att.checkIn && office?.workingHoursStart) {
                const checkInTime = new Date(att.checkIn).toTimeString().slice(0, 5);
                if (checkInTime > office.workingHoursStart) {
                  lateMarks++;
                }
              }
            } else if (att.status === 'HALF_DAY') {
              halfDays++;
            } else if (att.status === 'LEAVE' || att.status === 'PAID') {
              if (leave && (leave.type === 'UNPAID' || leave.type === 'LOP' || leave.leaveCategory === 'UNPAID')) {
                unpaidLeaveDays++;
              } else {
                paidLeaveDays++;
              }
            } else if (att.status === 'ABSENT') {
              if (leave) {
                if (leave.type === 'UNPAID' || leave.type === 'LOP' || leave.leaveCategory === 'UNPAID') {
                  unpaidLeaveDays++;
                } else {
                  paidLeaveDays++;
                }
              } else {
                absentDays++;
              }
            } else {
              presentDays++;
            }
          } else if (leave) {
            if (leave.type === 'UNPAID' || leave.type === 'LOP' || leave.leaveCategory === 'UNPAID') {
              unpaidLeaveDays++;
            } else {
              paidLeaveDays++;
            }
          } else {
            absentDays++;
          }
        }
      }

      const finalWorkingDays = scheduledWorkingDays > 0 ? scheduledWorkingDays : (totalCalendarDays - weeklyOffCount - holidayCount) || 26;

      return {
        workingDays: finalWorkingDays,
        totalCalendarDays,
        presentDays,
        absentDays,
        halfDays,
        paidLeaveDays,
        unpaidLeaveDays,
        holidayCount,
        weeklyOffCount,
        holidayWorkedCount,
        weeklyOffWorkedCount,
        lateMarks,
        overtimeHours: 0
      };
    } catch (error) {
      console.error('Get attendance data error:', error);
      throw error;
    }
  }

  private calculateOvertime(attendanceData: any, salaryStructure: SalaryStructure): number {
    return 0;
  }

  private async calculateBonus(employeeId: number, month: number, year: number): Promise<number> {
    return 0;
  }

  private calculateDeductions(grossSalary: number, structure: SalaryStructure): number {
    let deductions = 0;

    // Statutory deductions
    deductions += structure.pf || 0;
    deductions += structure.esi || 0;
    deductions += structure.professionalTax || 0;
    deductions += structure.tds || 0;

    return deductions;
  }

  private async applyPolicyDeductions(employeeId: number, attendanceData: any, grossSalary: number): Promise<number> {
    try {
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
            { departmentId: null, officeId: null }
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
        deduction = this.calculateLeaveDeduction(policy, attendanceData.unpaidLeaveDays, grossSalary);
        break;
      case 'ABSENT':
        deduction = this.calculateAbsentDeduction(policy, attendanceData.absentDays, grossSalary);
        break;
    }

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
          presentDays: calculation.presentDays,
          absentDays: calculation.absentDays,
          halfDays: calculation.halfDays,
          paidLeaveDays: calculation.paidLeaveDays,
          unpaidLeaveDays: calculation.unpaidLeaveDays,
          holidayCount: calculation.holidayCount,
          weeklyOffCount: calculation.weeklyOffCount,
          holidayWorkedCount: calculation.holidayWorkedCount,
          weeklyOffWorkedCount: calculation.weeklyOffWorkedCount,
          extraHolidayPayout: calculation.extraHolidayPayout,
          extraWeeklyOffPayout: calculation.extraWeeklyOffPayout,
          dailySalary: calculation.dailySalary,
          workingDays: calculation.workingDays,
          totalCalendarDays: calculation.totalCalendarDays,
          commissionEarned: calculation.commissionEarned,
          advanceDeduction: calculation.advanceDeduction,
          expenseReimbursement: calculation.expenseReimbursement,
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
          advanceDeduction: calculation.advanceDeduction,
          expenseReimbursement: calculation.expenseReimbursement,
          status: 'Approved',
          employeeCode: empCode,
          employeeName: empName,
          designation: desigName,
          department: deptName,
          officeName: offName,
          presentDays: calculation.presentDays,
          absentDays: calculation.absentDays,
          halfDays: calculation.halfDays,
          paidLeaveDays: calculation.paidLeaveDays,
          unpaidLeaveDays: calculation.unpaidLeaveDays,
          holidayCount: calculation.holidayCount,
          weeklyOffCount: calculation.weeklyOffCount,
          holidayWorkedCount: calculation.holidayWorkedCount,
          weeklyOffWorkedCount: calculation.weeklyOffWorkedCount,
          extraHolidayPayout: calculation.extraHolidayPayout,
          extraWeeklyOffPayout: calculation.extraWeeklyOffPayout,
          dailySalary: calculation.dailySalary,
          workingDays: calculation.workingDays,
          totalCalendarDays: calculation.totalCalendarDays,
          commissionEarned: calculation.commissionEarned,
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