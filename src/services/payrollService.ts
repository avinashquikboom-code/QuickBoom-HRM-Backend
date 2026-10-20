import { fixedThirtyDaySalary, lockedPayslip } from '../utils/fixedThirtyDaySalary';
import { prisma } from '../utils/db';
import { firebaseNotificationService } from './firebaseNotificationService';
import { getIstMonthRange } from '../utils/commissionHelper';
import { numToWords } from './payrollAutomationService';
import { computeGrossSalary, mapStructureGrossFields, isCommissionEligibleEmployee, computePayrollSettlement } from '../utils/salaryGross';
import {
  AttendanceClassification,
  AttendanceSummary,
  attendanceSummaryFromClassification,
  attendanceSummaryFromStoredPayslip,
  classifyPayrollAttendance,
  calculateScheduledWorkingDays,
  normalizeDayName,
} from '../utils/attendanceSummary';
const { getWebSocketInstance } = require('../utils/websocketSingleton');

export interface PayrollCalculation {
  employeeId: number;
  month: number;
  year: number;
  baseSalary: number;
  monthlySalary: number;
  fixedGrossSalary?: number;
  dailySalary: number;
  salaryBasisDays?: number;
  standardPayableDays?: number;
  extraAttendanceDays?: number;
  extraAttendancePayout?: number;
  eligibleExtraAttendanceDates?: string[];
  allowance: number;
  deductions: number;
  statutoryDeductions: number;
  policyDeductions: number;
  overtime: number;
  bonus: number;
  netSalary: number;
  grossSalary: number;
  grossEarnings?: number;
  totalTakeHomePay?: number;
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
  additionalEarnings?: number;
  totalEarnings?: number;
  holidayWeeklyOffPay?: number;
  commissionEarned: number;
  isCommissionEligible?: boolean;
  overtimeHours: number;
  attendanceSummary?: AttendanceSummary;
  components: PayslipSalaryComponents;
}

// Per-month snapshot of the salary structure components used to generate a payslip.
export interface PayslipSalaryComponents {
  hra: number;
  travelAllowance: number;
  medicalAllowance: number;
  specialAllowance: number;
  incentive: number;
  bonus: number;
}

export const payslipComponentData = (calc: { components: PayslipSalaryComponents }): PayslipSalaryComponents => ({
  hra: calc.components.hra,
  travelAllowance: calc.components.travelAllowance,
  medicalAllowance: calc.components.medicalAllowance,
  specialAllowance: calc.components.specialAllowance,
  incentive: calc.components.incentive,
  bonus: calc.components.bonus,
});

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
  basicSalary?: number;
  monthlySalary: number;
  grossSalary: number;
  hra: number;
  da: number;
  conveyance: number;
  travelAllowance?: number;
  medical: number;
  medicalAllowance?: number;
  special: number;
  specialAllowance?: number;
  incentive?: number;
  bonus?: number;
  salaryAdvanceLimit?: number;
  pfEnabled?: boolean;
  esicEnabled?: boolean;
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
          office: true,
          user: true
        }
      });

      if (!employee) {
        throw new Error('Employee not found');
      }

      // Get salary structure
      const salaryStructure = await this.getSalaryStructure(employeeId, new Date(year, month - 1, 1));

      // Monthly & Base Salary
      const baseSalary = salaryStructure.baseSalary || 0;
      const totalAllowance = Math.round((
        (salaryStructure.hra || 0) +
        (salaryStructure.medical || 0) +
        (salaryStructure.conveyance || 0) +
        (salaryStructure.special || 0) +
        (salaryStructure.incentive || 0) +
        (salaryStructure.bonus || 0)
      ) * 100) / 100;

      const monthlySalary =
        computeGrossSalary({
          basicSalary: salaryStructure.baseSalary,
          hra: salaryStructure.hra,
          medicalAllowance: salaryStructure.medical,
          travelAllowance: salaryStructure.conveyance,
          specialAllowance: salaryStructure.special,
          incentive: salaryStructure.incentive,
          bonus: salaryStructure.bonus,
        }) || (baseSalary + totalAllowance) || 12000;

      // Get attendance breakdown data for the month
      const attendanceData = await this.getAttendanceData(employeeId, month, year, employee.office, employee.joiningDate);

      const workingDays = attendanceData.workingDays || 26;
      const totalCalendarDays = attendanceData.totalCalendarDays || new Date(year, month, 0).getDate();

      const existingApproval = await prisma.payslip.findUnique({ where: { employeeId_month_year: { employeeId, month, year } }, select: { extraAttendanceApproval: true } });
      const approval = existingApproval?.extraAttendanceApproval as { dates?: string[]; rateMultiplier?: number; approvedBy?: number } | null;
      const basis = fixedThirtyDaySalary(monthlySalary, attendanceData.classification,
        approval?.approvedBy && Array.isArray(approval.dates) ? approval.dates : [], approval?.rateMultiplier ?? 1);
      const dailySalary = basis.dailySalary;
      const unpaidLeaveDays = basis.unpaidLeaveDays;
      const absentDays = attendanceData.absentDays;
      const halfDayDeduction = Math.min(basis.attendanceDeduction, Math.round(attendanceData.halfDays * 0.5 * monthlySalary / 30 * 100) / 100);
      const unpaidLeaveDeduction = Math.min(Math.max(0, basis.attendanceDeduction - halfDayDeduction), Math.round(unpaidLeaveDays * monthlySalary / 30 * 100) / 100);
      const absentDeduction = Math.round(Math.max(0, basis.attendanceDeduction - halfDayDeduction - unpaidLeaveDeduction) * 100) / 100;

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

      const isCommissionEligible = isCommissionEligibleEmployee(employee);
      let commissionEarned = 0;
      if (isCommissionEligible) {
        const commAggregate = await prisma.commissionTransaction.aggregate({
          where: {
            employeeId,
            createdAt: { gte: monthStart, lte: monthEnd },
            status: { in: ['PENDING', 'APPROVED', 'PAID'] }
          },
          _sum: { commissionAmount: true }
        });
        commissionEarned = commAggregate._sum?.commissionAmount || 0;
      }

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

      // Applicable Gross = salary-structure monthly total only.
      // Extra holiday/weekly-off payouts are kept as separate audit fields and
      // are not added here: a monthly salary already covers the calendar month,
      // so adding a daily amount (e.g. 14000/11 = 1272.72) inflates Gross Earnings.
      const grossSalary = monthlySalary;

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

      // Find all finalized (PAID) payslips before this period to prevent duplicate recovery
      const priorPaidPayslips = await prisma.payslip.findMany({
        where: {
          employeeId,
          status: { in: ['Paid', 'PAID'] },
          OR: [
            { year: { lt: year } },
            { year, month: { lt: month } }
          ]
        },
        select: { advanceDeduction: true }
      });
      let priorRecoveredPool = priorPaidPayslips.reduce((sum, p) => sum + (p.advanceDeduction || 0), 0);

      let advanceDeduction = 0;
      for (const adv of activeAdvances) {
        // Track unrecovered amount accounting for both explicit paidAmount and prior payslip deductions
        const alreadyPaid = Math.max(adv.paidAmount || 0, Math.min(adv.amount, priorRecoveredPool));
        priorRecoveredPool = Math.max(0, priorRecoveredPool - alreadyPaid);
        const effectiveRemaining = Math.max(0, adv.amount - alreadyPaid);

        if (effectiveRemaining <= 0) {
          continue; // Already fully recovered in previous payroll runs
        }

        const standardEmi = adv.monthlyEmi > 0 
          ? adv.monthlyEmi 
          : (adv.months > 0 ? Math.round((adv.amount / adv.months) * 100) / 100 : adv.amount);

        const emiToDeduct = Math.min(standardEmi, effectiveRemaining);
        advanceDeduction += emiToDeduct;
      }
      advanceDeduction = Math.round(advanceDeduction * 100) / 100;

      // Total Deductions
      const totalDeductions = Math.round((statutoryDeductions + policyDeductions + absentDeduction + halfDayDeduction + unpaidLeaveDeduction + advanceDeduction) * 100) / 100;

      const settlement = computePayrollSettlement({
        baseGrossEarnings: monthlySalary,
        holidayWeeklyOffPay: extraHolidayPayout + extraWeeklyOffPayout,
        extraAttendancePay: basis.extraAttendancePayout,
        totalDeductions,
        reimbursements: approvedExpenses,
        commissionEarned,
      });
      const netSalary = settlement.netSalary;
      const totalTakeHomePay = settlement.totalTakeHomePay;

      const calculation: PayrollCalculation = {
        employeeId,
        month,
        year,
        baseSalary,
        monthlySalary,
        fixedGrossSalary: monthlySalary,
        dailySalary,
        salaryBasisDays: 30,
        standardPayableDays: basis.standardPayableDays,
        eligibleExtraAttendanceDates: basis.eligibleExtraAttendanceDates,
        extraAttendanceDays: basis.extraAttendanceDays,
        extraAttendancePayout: basis.extraAttendancePayout,
        allowance: totalAllowance,
        deductions: totalDeductions,
        statutoryDeductions,
        policyDeductions,
        overtime,
        bonus,
        netSalary,
        grossSalary,
        grossEarnings: grossSalary,
        totalTakeHomePay,
        workingDays,
        totalCalendarDays,
        presentDays: attendanceData.presentDays,
        absentDays: attendanceData.absentDays,
        leaveDays: attendanceData.paidLeaveDays + attendanceData.unpaidLeaveDays,
        halfDays: attendanceData.halfDays,
        paidLeaveDays: basis.paidLeaveDays,
        unpaidLeaveDays: basis.unpaidLeaveDays,
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
        holidayWeeklyOffPay: settlement.holidayWeeklyOffPay,
        additionalEarnings: settlement.additionalEarnings,
        totalEarnings: settlement.totalEarnings,
        commissionEarned,
        isCommissionEligible,
        overtimeHours: attendanceData.overtimeHours,
        attendanceSummary: attendanceSummaryFromClassification(attendanceData.classification),
        components: {
          hra: salaryStructure.hra || 0,
          travelAllowance: salaryStructure.conveyance || 0,
          medicalAllowance: salaryStructure.medical || 0,
          specialAllowance: salaryStructure.special || 0,
          incentive: salaryStructure.incentive || 0,
          bonus: salaryStructure.bonus || 0,
        }
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
        // Idempotency check: Only preserve finalized (PAID) records
        const existingPayslip = await prisma.payslip.findUnique({
          where: {
            employeeId_month_year: {
              employeeId: emp.id,
              month,
              year
            }
          }
        });

        const isPaid = existingPayslip && String(existingPayslip.status).toUpperCase() === 'PAID';
        if (isPaid) {
          skipped++;
          console.log(`ℹ️ [AutoPayroll] Payslip for employee #${emp.id} (${emp.employeeCode}) for ${month}/${year} is already PAID. Skipping.`);
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
   * Resolve the earnings (base + salary components) of a stored payslip.
   * Single source for every payslip consumer (mobile list, mobile PDF).
   * - Payslips with a component snapshot: allowance is always the sum of the snapshot components.
   * - Legacy payslips (no snapshot) of the current month: rebuilt from the employee's salary structure
   *   (same source the admin live calculation uses) and the payslip row is healed.
   * - Legacy payslips of past months: structure is used only if it still reconciles with the stored
   *   totals, otherwise the stored allowance is reported as a single lump sum.
   */
  async resolvePayslipEarnings(ps: {
    id: number;
    employeeId: number;
    month: number;
    year: number;
    baseSalary: number;
    allowance: number;
    hra?: number | null;
    travelAllowance?: number | null;
    medicalAllowance?: number | null;
    specialAllowance?: number | null;
    incentive?: number | null;
    bonus?: number | null;
    status?: string | null;
  }): Promise<{ baseSalary: number; allowance: number; grossEarnings: number; components: PayslipSalaryComponents }> {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const sumOf = (c: PayslipSalaryComponents) => round2((c.hra || 0) + (c.travelAllowance || 0) + (c.medicalAllowance || 0) + (c.specialAllowance || 0) + (c.incentive || 0) + (c.bonus || 0));

    const hasSnapshot = ps.hra != null && ps.travelAllowance != null && ps.medicalAllowance != null && ps.specialAllowance != null;
    if (hasSnapshot) {
      const components: PayslipSalaryComponents = {
        hra: ps.hra || 0,
        travelAllowance: ps.travelAllowance || 0,
        medicalAllowance: ps.medicalAllowance || 0,
        specialAllowance: ps.specialAllowance || 0,
        incentive: ps.incentive || 0,
        bonus: ps.bonus || 0,
      };
      const allowance = sumOf(components);
      return { baseSalary: ps.baseSalary, allowance, grossEarnings: round2(ps.baseSalary + allowance), components };
    }

    if (lockedPayslip(ps.status)) {
      const allowance = ps.allowance || 0;
      return { baseSalary: ps.baseSalary, allowance,
        grossEarnings: round2(ps.baseSalary + allowance),
        components: { hra: 0, travelAllowance: 0, medicalAllowance: 0,
          specialAllowance: allowance, incentive: 0, bonus: 0 } };
    }

    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const isCurrentMonth = ps.year === ist.getUTCFullYear() && ps.month === ist.getUTCMonth() + 1;
    const structure = await this.getSalaryStructure(ps.employeeId, new Date(ps.year, ps.month - 1, 1));
    const structureComponents: PayslipSalaryComponents = {
      hra: structure.hra || 0,
      travelAllowance: structure.conveyance || 0,
      medicalAllowance: structure.medical || 0,
      specialAllowance: structure.special || 0,
      incentive: structure.incentive || 0,
      bonus: structure.bonus || 0,
    };
    const structureAllowance = sumOf(structureComponents);

    if (isCurrentMonth && structure.id !== 0 && !lockedPayslip(ps.status)) {
      const baseSalary = structure.baseSalary || ps.baseSalary;
      await prisma.payslip.update({
        where: { id: ps.id },
        data: { baseSalary, allowance: structureAllowance, ...structureComponents },
      }).catch(err => console.warn(`[resolvePayslipEarnings] Failed to heal payslip #${ps.id}:`, err));
      return { baseSalary, allowance: structureAllowance, grossEarnings: round2(baseSalary + structureAllowance), components: structureComponents };
    }

    const reconciles = structure.id !== 0 && structure.baseSalary === ps.baseSalary && Math.abs(structureAllowance - (ps.allowance || 0)) < 0.01;
    const allowance = ps.allowance || 0;
    const components: PayslipSalaryComponents = reconciles
      ? structureComponents
      : { hra: 0, travelAllowance: 0, medicalAllowance: 0, specialAllowance: allowance, incentive: 0, bonus: 0 };
    return { baseSalary: ps.baseSalary, allowance, grossEarnings: round2(ps.baseSalary + allowance), components };
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
            salaryAdvanceLimit: 0,
          }
        });
      }

      const mapped = mapStructureGrossFields(structure);
      const basic = mapped.basicSalary || mapped.monthlySalary;
      const gross = mapped.grossSalary;
      const pf = structure.pfEnabled ? basic * (structure.employeePfRate / 100) : 0;
      const esi = structure.esicEnabled ? gross * (structure.employeeEsicRate / 100) : 0;

      return {
        id: structure.id,
        employeeId: structure.employeeId,
        baseSalary: basic,
        basicSalary: basic,
        monthlySalary: mapped.monthlySalary,
        grossSalary: gross,
        hra: mapped.hra,
        da: 0,
        conveyance: mapped.travelAllowance,
        travelAllowance: mapped.travelAllowance,
        medical: mapped.medicalAllowance,
        medicalAllowance: mapped.medicalAllowance,
        special: mapped.specialAllowance,
        specialAllowance: mapped.specialAllowance,
        incentive: mapped.incentive,
        bonus: mapped.bonus,
        salaryAdvanceLimit: structure.salaryAdvanceLimit ?? 0,
        pfEnabled: structure.pfEnabled,
        esicEnabled: structure.esicEnabled,
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
        incentive: 0,
        bonus: 0,
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
  async updateSalaryStructure(employeeId: number, structureData: Partial<SalaryStructure> & any): Promise<SalaryStructure> {
    try {
      const currentSS = await prisma.salaryStructure.findUnique({ where: { employeeId } });

      const basicSalary = structureData.basicSalary !== undefined
        ? Number(structureData.basicSalary)
        : (structureData.baseSalary !== undefined ? Number(structureData.baseSalary) : (currentSS?.basicSalary || 0));

      const hra = structureData.hra !== undefined
        ? Number(structureData.hra)
        : (currentSS?.hra || 0);

      const medicalAllowance = structureData.medicalAllowance !== undefined
        ? Number(structureData.medicalAllowance)
        : (structureData.medical !== undefined ? Number(structureData.medical) : (currentSS?.medicalAllowance || 0));

      const travelAllowance = structureData.travelAllowance !== undefined
        ? Number(structureData.travelAllowance)
        : (structureData.travel !== undefined ? Number(structureData.travel) : (structureData.conveyance !== undefined ? Number(structureData.conveyance) : (currentSS?.travelAllowance || 0)));

      const specialAllowance = structureData.specialAllowance !== undefined
        ? Number(structureData.specialAllowance)
        : (structureData.special !== undefined ? Number(structureData.special) : (currentSS?.specialAllowance || 0));

      const incentive = structureData.incentive !== undefined
        ? Number(structureData.incentive)
        : (currentSS?.incentive || 0);

      const bonus = structureData.bonus !== undefined
        ? Number(structureData.bonus)
        : (structureData.fixedBonus !== undefined ? Number(structureData.fixedBonus) : (currentSS?.bonus || 0));

      const salaryAdvanceLimit = structureData.salaryAdvanceLimit !== undefined && structureData.salaryAdvanceLimit !== null && structureData.salaryAdvanceLimit !== ''
        ? (Number.isFinite(Number(structureData.salaryAdvanceLimit)) ? Number(structureData.salaryAdvanceLimit) : 0)
        : (currentSS?.salaryAdvanceLimit ?? 0);

      const pfEnabled = structureData.pfEnabled !== undefined ? Boolean(structureData.pfEnabled) : (currentSS?.pfEnabled ?? false);
      const employeePfRate = structureData.employeePfRate !== undefined ? Number(structureData.employeePfRate) : (currentSS?.employeePfRate ?? 12.0);
      const employerPfRate = structureData.employerPfRate !== undefined ? Number(structureData.employerPfRate) : (currentSS?.employerPfRate ?? 12.0);

      const esicEnabled = structureData.esicEnabled !== undefined ? Boolean(structureData.esicEnabled) : (currentSS?.esicEnabled ?? false);
      const employeeEsicRate = structureData.employeeEsicRate !== undefined ? Number(structureData.employeeEsicRate) : (currentSS?.employeeEsicRate ?? 0.75);
      const employerEsicRate = structureData.employerEsicRate !== undefined ? Number(structureData.employerEsicRate) : (currentSS?.employerEsicRate ?? 3.25);

      const grossSalary = computeGrossSalary({
        basicSalary,
        hra,
        medicalAllowance,
        travelAllowance,
        specialAllowance,
        incentive,
        bonus,
      });

      const structure = await prisma.salaryStructure.upsert({
        where: { employeeId },
        update: {
          basicSalary,
          hra,
          medicalAllowance,
          travelAllowance,
          specialAllowance,
          incentive,
          bonus,
          grossSalary,
          monthlySalary: grossSalary,
          salaryAdvanceLimit,
          pfEnabled,
          employeePfRate,
          employerPfRate,
          esicEnabled,
          employeeEsicRate,
          employerEsicRate,
          updatedAt: new Date()
        },
        create: {
          employeeId,
          basicSalary,
          hra,
          medicalAllowance,
          travelAllowance,
          specialAllowance,
          incentive,
          bonus,
          grossSalary,
          monthlySalary: grossSalary,
          salaryAdvanceLimit,
          pfEnabled,
          employeePfRate,
          employerPfRate,
          esicEnabled,
          employeeEsicRate,
          employerEsicRate,
        }
      });

      // Synchronize wallet advanceLimit
      try {
        await prisma.wallet.updateMany({
          where: { employeeId },
          data: { advanceLimit: salaryAdvanceLimit },
        });
      } catch (wErr) {
        console.warn('Wallet advanceLimit sync warning:', wErr);
      }

      // Re-calculate and update draft/unfinalized current month payslips
      try {
        const now = new Date();
        const istTime = now.getTime() + 5.5 * 60 * 60 * 1000;
        const istDate = new Date(istTime);
        const curMonth = istDate.getUTCMonth() + 1;
        const curYear = istDate.getUTCFullYear();

        const unfinalizedSlips = await prisma.payslip.findMany({
          where: {
            employeeId,
            month: curMonth,
            year: curYear,
            status: { notIn: ['PAID', 'paid', 'Paid'] }
          }
        });
        for (const slip of unfinalizedSlips) {
          const calc = await this.calculatePayroll(employeeId, slip.month, slip.year);
          await this.savePayslip(calc);
          console.log(`[updateSalaryStructure] Re-calculated payslip for emp #${employeeId} (${slip.month}/${slip.year})`);
        }
      } catch (syncErr) {
        console.warn(`[updateSalaryStructure] Failed to sync payslip for emp #${employeeId}:`, syncErr);
      }

      const pf = structure.pfEnabled ? basicSalary * (structure.employeePfRate / 100) : 0;
      const esi = structure.esicEnabled ? grossSalary * (structure.employeeEsicRate / 100) : 0;

      return {
        id: structure.id,
        employeeId: structure.employeeId,
        baseSalary: basicSalary,
        basicSalary: basicSalary,
        monthlySalary: structure.monthlySalary || grossSalary,
        grossSalary,
        hra,
        da: 0,
        conveyance: travelAllowance,
        travelAllowance,
        medical: medicalAllowance,
        medicalAllowance,
        special: specialAllowance,
        specialAllowance,
        incentive,
        bonus,
        salaryAdvanceLimit: structure.salaryAdvanceLimit ?? 0,
        pfEnabled: structure.pfEnabled,
        esicEnabled: structure.esicEnabled,
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
      let disbursed_amount = 0;
      let pending_amount = 0;

      const deptMap = new Map<string, { department: string; employee_count: number; total_salary: number }>();

      for (const p of payslips) {
        const net = p.netSalary || 0;
        total_net_salary += net;
        total_base_salary += p.baseSalary || 0;
        total_allowance += p.allowance || 0;
        total_deductions += p.deductions || 0;

        const st = p.status?.toLowerCase() || '';
        if (st === 'paid') {
          approved_payslips++;
          disbursed_amount += net;
        } else {
          if (st === 'approved') {
            approved_payslips++;
          } else {
            pending_payslips++;
          }
          pending_amount += net;
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
          pending_payslips,
          disbursed_amount,
          pending_amount
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
  /**
   * Authoritative attendance classification for one employee and payroll
   * period. Payroll, payslip views, PDFs, Admin and mobile all read from this.
   */
  async getAttendanceSnapshot(
    employeeId: number,
    month: number,
    year: number,
    office?: any,
    joiningDate?: Date | string | null,
  ): Promise<AttendanceClassification> {
    const monthRange = getIstMonthRange(year, month);
    const [attendanceRecords, holidays, allLeaves, shiftAssignments] = await Promise.all([
      prisma.attendance.findMany({
        where: { employeeId, date: { gte: monthRange.startDateStr, lte: monthRange.endDateStr } },
      }),
      prisma.holiday.findMany({
        where: { date: { gte: monthRange.monthStart, lte: monthRange.monthEnd } },
      }),
      prisma.leaveRequest.findMany({
        where: {
          employeeId,
          fromDate: { lte: monthRange.monthEnd },
          toDate: { gte: monthRange.monthStart },
        },
      }),
      prisma.shiftAssignment.findMany({
        where: {
          employeeId,
          effectiveFrom: { lte: monthRange.monthEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: monthRange.monthStart } }],
        },
        include: { shift: true },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);

    const toIstYmd = (d: Date | string) => {
      const ist = new Date(new Date(d).getTime() + 5.5 * 60 * 60 * 1000);
      return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
    };
    const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const todayYmd = `${nowIst.getUTCFullYear()}-${String(nowIst.getUTCMonth() + 1).padStart(2, '0')}-${String(nowIst.getUTCDate()).padStart(2, '0')}`;

    const activeShift = shiftAssignments.find((a) => a.shift?.workingDays && a.shift.workingDays.length > 0);
    const configuredWorkingDays = (activeShift?.shift?.workingDays && activeShift.shift.workingDays.length > 0)
      ? activeShift.shift.workingDays
      : ((office?.workingDays && office.workingDays.length > 0)
          ? office.workingDays
          : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

    return classifyPayrollAttendance({
      year,
      month,
      workingDayNames: configuredWorkingDays,
      holidayYmds: holidays.map((h) => toIstYmd(h.date)),
      records: attendanceRecords,
      leaves: allLeaves.map((l) => ({
        fromYmd: toIstYmd(l.fromDate),
        toYmd: toIstYmd(l.toDate),
        type: l.type,
        leaveCategory: l.leaveCategory,
        status: l.status,
      })),
      todayYmd,
      joiningYmd: joiningDate ? toIstYmd(joiningDate) : null,
      officeStartTime: office?.workingHoursStart,
      officeEndTime: office?.workingHoursEnd,
      shifts: shiftAssignments.map((a) => ({
        fromYmd: toIstYmd(a.effectiveFrom),
        toYmd: a.effectiveTo ? toIstYmd(a.effectiveTo) : null,
        startTime: a.shift.startTime,
        endTime: a.shift.endTime,
        workingDays: a.shift.workingDays,
      })),
      isLateCheckIn: (rec) => {
        if (!rec.checkIn || !office?.workingHoursStart) return false;
        return new Date(rec.checkIn).toTimeString().slice(0, 5) > office.workingHoursStart;
      },
    });
  }

  private async getAttendanceData(
    employeeId: number,
    month: number,
    year: number,
    office?: any,
    joiningDate?: Date | string | null,
  ): Promise<any> {
    try {
      const c = await this.getAttendanceSnapshot(employeeId, month, year, office, joiningDate);
      // Payroll fields keep their whole-month meaning (pre-joining days included),
      // so stored payslips and deductions are unchanged; the summary splits them out.
      const holidayCount = c.holidayCount + c.notJoinedHolidayDays;
      const weeklyOffCount = c.weeklyOffCount + c.notJoinedWeeklyOffDays;
      return {
        workingDays: c.monthWorkingDays > 0
          ? c.monthWorkingDays
          : (c.totalCalendarDays - weeklyOffCount - holidayCount) || 26,
        totalCalendarDays: c.totalCalendarDays,
        presentDays: c.presentDays,
        absentDays: c.absentDays + c.notJoinedElapsedDays,
        halfDays: c.halfDays,
        paidLeaveDays: c.paidLeaveDays,
        unpaidLeaveDays: c.unpaidLeaveDays,
        holidayCount,
        weeklyOffCount,
        holidayWorkedCount: c.holidayWorkedCount,
        weeklyOffWorkedCount: c.weeklyOffWorkedCount,
        lateMarks: c.lateMarks,
        overtimeHours: Math.round((c.overtimeMinutes / 60) * 100) / 100,
        classification: c,
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

  async savePayslip(calculation: PayrollCalculation): Promise<void> {
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

      const totalTakeHome = calculation.totalTakeHomePay ?? Math.round((calculation.netSalary + (calculation.commissionEarned || 0) + (calculation.expenseReimbursement || 0)) * 100) / 100;
      const netInWords = `${numToWords(Math.round(totalTakeHome))} Rupees Only`;

      const existingSlip = await prisma.payslip.findUnique({
        where: {
          employeeId_month_year: {
            employeeId: calculation.employeeId,
            month: calculation.month,
            year: calculation.year,
          },
        },
      });

      // Preserve status if already finalized ('Paid')
      if (existingSlip && lockedPayslip(existingSlip.status)) {
        console.log(`[savePayslip] Payslip for emp #${calculation.employeeId} (${calculation.month}/${calculation.year}) is already PAID. Preserving finalized record.`);
        return;
      }

      const preservedStatus = existingSlip?.status || 'Approved';

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
          extraAttendanceDays: calculation.extraAttendanceDays || 0,
          extraAttendancePayout: calculation.extraAttendancePayout || 0,
          dailySalary: calculation.dailySalary,
          workingDays: calculation.workingDays,
          totalCalendarDays: calculation.totalCalendarDays,
          commissionEarned: calculation.commissionEarned,
          advanceDeduction: calculation.advanceDeduction,
          expenseReimbursement: calculation.expenseReimbursement,
          ...payslipComponentData(calculation),
          netInWords,
          status: preservedStatus,
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
          extraAttendanceDays: calculation.extraAttendanceDays || 0,
          extraAttendancePayout: calculation.extraAttendancePayout || 0,
          dailySalary: calculation.dailySalary,
          workingDays: calculation.workingDays,
          totalCalendarDays: calculation.totalCalendarDays,
          commissionEarned: calculation.commissionEarned,
          ...payslipComponentData(calculation),
          netInWords,
          createdAt: new Date()
        }
      });
    } catch (error) {
      console.error('Save payslip error:', error);
      throw error;
    }
  }

  
  /**
   * Map calculatePayroll — the only salary formula — onto the payslip view
   * consumed by admin, mobile wallet, and PDF.
   */
  private async viewFromPayrollCalculation(
    ps: {
      id?: number;
      employeeId: number;
      month: number;
      year: number;
      status?: string | null;
      employeeCode?: string | null;
      employeeName?: string | null;
      designation?: string | null;
      department?: string | null;
      officeName?: string | null;
      deductions?: number | null;
      netSalary?: number | null;
      advanceDeduction?: number | null;
      halfDays?: number | null;
      absentDays?: number | null;
      presentDays?: number | null;
      unpaidLeaveDays?: number | null;
      paidLeaveDays?: number | null;
      extraHolidayPayout?: number | null;
      extraWeeklyOffPayout?: number | null;
      commissionEarned?: number | null;
      expenseReimbursement?: number | null;
      dailySalary?: number | null;
      workingDays?: number | null;
      netInWords?: string | null;
      baseSalary?: number | null;
      allowance?: number | null;
      hra?: number | null;
      travelAllowance?: number | null;
      medicalAllowance?: number | null;
      specialAllowance?: number | null;
      bonus?: number | null;
      incentive?: number | null;
    },
    employee: {
      firstName?: string | null;
      lastName?: string | null;
      employeeCode?: string | null;
      designation?: string | null;
      department?: { name?: string | null } | null;
      office?: { name?: string | null } | null;
    } | null,
    calc: PayrollCalculation,
  ) {
    const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
    const structure = await this.getSalaryStructure(ps.employeeId, new Date(ps.year, ps.month - 1, 1));
    const pf = round2(structure.pf || 0);
    const esic = round2(structure.esi || 0);
    const advanceDeduction = round2(calc.advanceDeduction);
    const halfDayDeduction = round2(calc.halfDayDeduction);
    const leaveDeduction = round2(calc.leaveDeduction);
    const absentDeduction = round2(calc.absentDeduction);
    const totalDeductions = round2(calc.deductions);
    const itemized = round2(pf + esic + absentDeduction + halfDayDeduction + leaveDeduction + advanceDeduction);
    const otherDeductions = round2(Math.max(0, totalDeductions - itemized));
    const extraHolidayPayout = round2(calc.extraHolidayPayout);
    const extraWeeklyOffPayout = round2(calc.extraWeeklyOffPayout);
    const isCommissionEligible = calc.isCommissionEligible !== undefined
      ? calc.isCommissionEligible
      : isCommissionEligibleEmployee(employee);
    const commissionEarned = isCommissionEligible ? round2(calc.commissionEarned) : 0;
    const expenseReimbursement = round2(calc.expenseReimbursement);
    const settlement = computePayrollSettlement({
      baseGrossEarnings: calc.fixedGrossSalary || calc.monthlySalary || calc.grossEarnings || calc.grossSalary,
      holidayWeeklyOffPay: extraHolidayPayout + extraWeeklyOffPayout,
      extraAttendancePay: calc.extraAttendancePayout || 0,
      totalDeductions,
      reimbursements: expenseReimbursement,
      commissionEarned,
    });
    const grossEarnings = settlement.baseGrossEarnings;
    const netSalary = settlement.netSalary;
    const totalTakeHomePay = settlement.totalTakeHomePay;
    const components = calc.components;
    const travelMedicalAllowance = round2((components.travelAllowance || 0) + (components.medicalAllowance || 0));
    const expenseCategories = calc.expenseCategories || {};
    const expensesByCategory = calc.expensesByCategory || Object.entries(expenseCategories).map(([category, amount]) => ({
      category,
      amount: round2(amount),
    }));

    const payPeriod = new Date(ps.year, ps.month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const employeeCode = ps.employeeCode || employee?.employeeCode || '';
    const documentId = `HR-PAY-${employeeCode}-${ps.year}${String(ps.month).padStart(2, '0')}`;
    const netInWords = `${numToWords(Math.round(totalTakeHomePay))} Rupees Only`;
    const isPaid = String(ps.status || '').toUpperCase() === 'PAID';
    const paymentStatus = isPaid ? 'PAID' : 'PENDING';

    const empName = ps.employeeName || `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim();
    const offName = ps.officeName || employee?.office?.name || '';
    const deptName = ps.department || employee?.department?.name || '';
    const desigName = ps.designation || employee?.designation || '';

    // Reading a draft projects the calculation; saving is an explicit payroll action.

    const fixedGrossSalary = round2(calc.fixedGrossSalary || calc.monthlySalary || (calc.baseSalary + (components.hra || 0) + (components.medicalAllowance || 0) + (components.travelAllowance || 0) + (components.specialAllowance || 0)));

    const earnings = {
      baseSalary: calc.baseSalary,
      basicSalary: calc.baseSalary,
      fixedGrossSalary,
      monthlySalary: fixedGrossSalary,
      hra: components.hra,
      medical: components.medicalAllowance,
      medicalAllowance: components.medicalAllowance,
      travel: components.travelAllowance,
      travelAllowance: components.travelAllowance,
      travelMedicalAllowance,
      special: components.specialAllowance,
      specialAllowance: components.specialAllowance,
      bonus: components.bonus,
      incentive: components.incentive,
      extraHolidayPayout,
      extraWeeklyOffPayout,
      extraAttendancePayout: calc.extraAttendancePayout || 0,
      extraPayout: settlement.holidayWeeklyOffPay,
      additionalEarnings: settlement.additionalEarnings,
      totalEarnings: settlement.totalEarnings,
      displayedGrossEarnings: settlement.totalEarnings,
      holidayWeeklyOffPay: settlement.holidayWeeklyOffPay,
      grossSalary: grossEarnings,
      grossTotal: grossEarnings,
      grossEarnings,
      commission: commissionEarned,
      expenseReimbursement,
      expenses: expensesByCategory,
      expensesByCategory,
      expenseCategories,
    };

    return {
      ...ps,
      employeeCode,
      employeeName: empName,
      name: empName,
      designation: desigName,
      department: deptName,
      departmentName: deptName,
      office: offName,
      officeName: offName,
      status: ps.status || (isPaid ? 'Paid' : 'Approved'),
      paymentStatus,
      payrollStatus: ps.status || 'PENDING',
      fixedGrossSalary,
      monthlySalary: fixedGrossSalary,
      baseSalary: calc.baseSalary,
      basicSalary: calc.baseSalary,
      allowance: calc.allowance,
      hra: components.hra,
      travelAllowance: components.travelAllowance,
      medicalAllowance: components.medicalAllowance,
      travelMedicalAllowance,
      specialAllowance: components.specialAllowance,
      incentive: components.incentive,
      bonus: components.bonus,
      grossSalary: grossEarnings,
      grossEarnings,
      deductions: totalDeductions,
      totalDeductions,
      advanceDeduction,
      advanceSalary: advanceDeduction,
      totalAdvanceSalary: advanceDeduction,
      pf,
      esic,
      absentDeduction,
      halfDayDeduction,
      leaveDeduction,
      otherDeductions,
      otherDeduction: otherDeductions,
      netSalary,
      totalTakeHomePay,
      documentId,
      payPeriod,
      netInWords,
      presentDays: calc.presentDays,
      absentDays: calc.absentDays,
      expenseReimbursement,
      totalReimbursements: expenseReimbursement,
      approvedExpenses: expenseReimbursement,
      approvedExpenseAmount: expenseReimbursement,
      totalExpenses: expenseReimbursement,
      expenses: expensesByCategory,
      expensesByCategory,
      isCommissionEligible,
      commission: commissionEarned,
      commissionEarned,
      deductionsObj: {
        deductions: totalDeductions,
        totalDeductions,
        advanceDeduction,
        advanceSalary: advanceDeduction,
        pf,
        esic,
        absentDeduction,
        halfDayDeduction,
        leaveDeduction,
        otherDeductions,
      },
      halfDays: calc.halfDays,
      paidLeaveDays: calc.paidLeaveDays,
      unpaidLeaveDays: calc.unpaidLeaveDays,
      holidayCount: calc.holidayCount,
      weeklyOffCount: calc.weeklyOffCount,
      holidayWorkedCount: calc.holidayWorkedCount,
      weeklyOffWorkedCount: calc.weeklyOffWorkedCount,
      extraHolidayPayout,
      extraWeeklyOffPayout,
      additionalEarnings: settlement.additionalEarnings,
      totalEarnings: settlement.totalEarnings,
      displayedGrossEarnings: settlement.totalEarnings,
      holidayWeeklyOffPay: settlement.holidayWeeklyOffPay,
      extraAttendanceDays: calc.extraAttendanceDays || 0,
      extraAttendancePayout: calc.extraAttendancePayout || 0,
      salaryBasisDays: 30,
      standardPayableDays: calc.standardPayableDays,
      dailySalary: calc.dailySalary,
      workingDays: calc.workingDays,
      totalCalendarDays: calc.totalCalendarDays,
      overtimeHours: calc.overtimeHours,
      attendanceSummary: calc.attendanceSummary ?? null,
      expenseCategories,
      earnings,
      summary: {
        fixedGrossSalary,
        monthlySalary: fixedGrossSalary,
        grossSalary: grossEarnings,
        grossEarnings,
        additionalEarnings: settlement.additionalEarnings,
        totalEarnings: settlement.totalEarnings,
        displayedGrossEarnings: settlement.totalEarnings,
        holidayWeeklyOffPay: settlement.holidayWeeklyOffPay,
        totalDeductions,
        netSalary,
        totalTakeHomePay,
        isCommissionEligible,
        commission: commissionEarned,
        expenseReimbursement,
        netInWords,
      },
    };
  }

  async resolveFullPayslipView(ps: any, employeeParam?: any) {
    const employee = employeeParam || await prisma.employee.findUnique({
      where: { id: ps.employeeId },
      include: { office: true, salaryStructure: true, department: true, user: true }
    });

    const isFinalized = lockedPayslip(ps.status);
    if (!isFinalized) {
      try {
        const calc = await this.calculatePayroll(ps.employeeId, ps.month, ps.year);
        return await this.viewFromPayrollCalculation(ps, employee, calc);
      } catch (err) {
        console.warn(`[resolveFullPayslipView] calculatePayroll failed for payslip #${ps?.id}, using stored row:`, err);
      }
    }

    const cal = calculateScheduledWorkingDays(ps.year, ps.month, employee?.office?.workingDays);
    const calendarDays = ps.totalCalendarDays || cal.totalCalendarDays;
    const schedWorkingDays = ps.workingDays || cal.workingDays;

    // Earnings come from the shared backend resolver
    const earnings = await this.resolvePayslipEarnings(ps);
    const fixedGrossSalary = earnings.grossEarnings;
    const baseMonthly = earnings.grossEarnings;
    const dSalary = ps.dailySalary || (schedWorkingDays > 0 ? Math.round((baseMonthly / schedWorkingDays) * 100) / 100 : 0);
    const absentDeduction = ps.absentDays ? Math.round((ps.absentDays * dSalary) * 100) / 100 : 0;
    const halfDayDeduction = ps.halfDays ? Math.round((ps.halfDays * 0.5 * dSalary) * 100) / 100 : 0;
    const leaveDeduction = ps.unpaidLeaveDays ? Math.round((ps.unpaidLeaveDays * dSalary) * 100) / 100 : 0;

    // Stored payroll is an accounting snapshot. Never infer recoveries from
    // today's loans or replace authorized deductions using a size heuristic.
    const advanceDeduction = ps.advanceDeduction || 0;
    const grossSalary = fixedGrossSalary;
    const pf = 0;
    const esic = 0;
    const itemizedDeductions = absentDeduction + halfDayDeduction + leaveDeduction + advanceDeduction;
    const cleanDeductions = ps.deductions || 0;

    const extraHolidayPayout = ps.extraHolidayPayout || 0;
    const extraWeeklyOffPayout = ps.extraWeeklyOffPayout || 0;
    const isCommissionEligible = isCommissionEligibleEmployee(employee);
    const commissionEarned = isCommissionEligible ? (ps.commissionEarned || 0) : 0;
    const settlement = computePayrollSettlement({
      baseGrossEarnings: grossSalary,
      holidayWeeklyOffPay: extraHolidayPayout + extraWeeklyOffPayout,
      totalDeductions: cleanDeductions,
      reimbursements: ps.expenseReimbursement || 0,
      commissionEarned,
    });
    const netSalary = Number(ps.netSalary ?? settlement.netSalary);
    const totalTakeHomePay = Math.round((netSalary + (ps.expenseReimbursement || 0) + commissionEarned) * 100) / 100;
    if (Math.abs(netSalary - settlement.netSalary) > 0.01) {
      console.warn('[payroll-reconciliation]', {
        payslipId: ps.id, employeeId: ps.employeeId, month: ps.month, year: ps.year,
        reason: 'Stored net differs from earnings minus stored deductions; authorized review required',
      });
    }
    const otherDeductions = Math.max(0, Math.round((cleanDeductions - itemizedDeductions) * 100) / 100);

    const empName = ps.employeeName || `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim();
    const offName = ps.officeName || employee?.office?.name || '';
    const deptName = ps.department || employee?.department?.name || '';
    const desigName = ps.designation || employee?.designation || '';

    const payPeriod = new Date(ps.year, ps.month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const documentId = `HR-PAY-${ps.employeeCode}-${ps.year}${String(ps.month).padStart(2, '0')}`;
    const netInWords = ps.netInWords || `${numToWords(Math.round(totalTakeHomePay))} Rupees Only`;
    const isPaid = ps.status?.toUpperCase() === 'PAID';
    const paymentStatus = isPaid ? 'PAID' : 'PENDING';

    let storedAttendanceSummary: AttendanceSummary | null = null;
    try {
      const live = await this.getAttendanceSnapshot(ps.employeeId, ps.month, ps.year, employee?.office, employee?.joiningDate);
      storedAttendanceSummary = attendanceSummaryFromStoredPayslip(
        { ...ps, workingDays: schedWorkingDays, totalCalendarDays: ps.totalCalendarDays || calendarDays },
        live,
      );
    } catch (err) {
      console.warn(`[resolveFullPayslipView] attendance summary unavailable for payslip #${ps?.id}:`, err);
    }

    // Also resolve expense breakdown for PDF
    const monthRange = getIstMonthRange(ps.year, ps.month);
    const approvedExpensesList = await prisma.expense.findMany({
      where: {
        employeeId: ps.employeeId,
        status: 'APPROVED',
        date: { gte: monthRange.monthStart, lte: monthRange.monthEnd },
      },
      orderBy: { date: 'asc' },
    });
    const expenseCategories: Record<string, number> = {};
    for (const exp of approvedExpensesList) {
      const cat = exp.category || 'Other';
      const amt = exp.amount || 0;
      expenseCategories[cat] = Math.round(((expenseCategories[cat] || 0) + amt) * 100) / 100;
    }

    return {
      ...ps,
      employeeName: empName,
      name: empName,
      office: offName,
      officeName: offName,
      department: deptName,
      departmentName: deptName,
      designation: desigName,
      status: paymentStatus,
      paymentStatus,
      payrollStatus: ps.status || 'PENDING',
      fixedGrossSalary,
      monthlySalary: fixedGrossSalary,
      baseSalary: earnings.baseSalary,
      basicSalary: earnings.baseSalary,
      allowance: earnings.allowance,
      hra: earnings.components.hra,
      travelAllowance: earnings.components.travelAllowance,
      medicalAllowance: earnings.components.medicalAllowance,
      travelMedicalAllowance: (earnings.components.travelAllowance || 0) + (earnings.components.medicalAllowance || 0),
      specialAllowance: earnings.components.specialAllowance,
      incentive: earnings.components.incentive,
      bonus: earnings.components.bonus,
      grossSalary,
      grossEarnings: grossSalary,
      deductions: cleanDeductions,
      totalDeductions: cleanDeductions,
      advanceDeduction,
      advanceSalary: advanceDeduction,
      totalAdvanceSalary: advanceDeduction,
      pf,
      esic,
      absentDeduction,
      halfDayDeduction,
      leaveDeduction,
      otherDeductions,
      otherDeduction: otherDeductions,
      netSalary,
      totalTakeHomePay,
      documentId,
      payPeriod,
      netInWords,
      presentDays: ps.presentDays || 0,
      absentDays: ps.absentDays || 0,
      expenseReimbursement: ps.expenseReimbursement || 0,
      totalReimbursements: ps.expenseReimbursement || 0,
      approvedExpenses: ps.expenseReimbursement || 0,
      approvedExpenseAmount: ps.expenseReimbursement || 0,
      totalExpenses: ps.expenseReimbursement || 0,
      isCommissionEligible,
      commission: commissionEarned,
      commissionEarned,
      deductionsObj: {
        deductions: cleanDeductions,
        totalDeductions: cleanDeductions,
        advanceDeduction,
        advanceSalary: advanceDeduction,
        pf,
        esic,
        absentDeduction,
        halfDayDeduction,
        leaveDeduction,
        otherDeductions
      },
      halfDays: ps.halfDays || 0,
      paidLeaveDays: ps.paidLeaveDays || 0,
      unpaidLeaveDays: ps.unpaidLeaveDays || 0,
      holidayCount: ps.holidayCount || 0,
      weeklyOffCount: ps.weeklyOffCount || 0,
      holidayWorkedCount: ps.holidayWorkedCount || 0,
      weeklyOffWorkedCount: ps.weeklyOffWorkedCount || 0,
      extraHolidayPayout,
      extraWeeklyOffPayout,
      additionalEarnings: settlement.additionalEarnings,
      totalEarnings: settlement.totalEarnings,
      displayedGrossEarnings: settlement.totalEarnings,
      holidayWeeklyOffPay: settlement.holidayWeeklyOffPay,
      dailySalary: ps.dailySalary || 0,
      workingDays: schedWorkingDays,
      totalCalendarDays: ps.totalCalendarDays || calendarDays,
      overtimeHours: storedAttendanceSummary ? Math.round((storedAttendanceSummary.overtimeMinutes / 60) * 100) / 100 : 0,
      attendanceSummary: storedAttendanceSummary,
      expenseCategories,
      earnings: {
        baseSalary: earnings.baseSalary,
        basicSalary: earnings.baseSalary,
        fixedGrossSalary,
        monthlySalary: fixedGrossSalary,
        hra: earnings.components.hra,
        medical: earnings.components.medicalAllowance,
        medicalAllowance: earnings.components.medicalAllowance,
        travel: earnings.components.travelAllowance,
        travelAllowance: earnings.components.travelAllowance,
        travelMedicalAllowance: (earnings.components.travelAllowance || 0) + (earnings.components.medicalAllowance || 0),
        special: earnings.components.specialAllowance,
        specialAllowance: earnings.components.specialAllowance,
        bonus: earnings.components.bonus,
        incentive: earnings.components.incentive,
        extraHolidayPayout,
        extraWeeklyOffPayout,
        extraPayout: settlement.holidayWeeklyOffPay,
        additionalEarnings: settlement.additionalEarnings,
        totalEarnings: settlement.totalEarnings,
        displayedGrossEarnings: settlement.totalEarnings,
        holidayWeeklyOffPay: settlement.holidayWeeklyOffPay,
        grossSalary,
        grossTotal: grossSalary,
        grossEarnings: grossSalary,
        commission: commissionEarned,
        expenseReimbursement: ps.expenseReimbursement || 0,
      },
      summary: {
        fixedGrossSalary,
        monthlySalary: fixedGrossSalary,
        grossSalary,
        grossEarnings: grossSalary,
        additionalEarnings: settlement.additionalEarnings,
        totalEarnings: settlement.totalEarnings,
        displayedGrossEarnings: settlement.totalEarnings,
        holidayWeeklyOffPay: settlement.holidayWeeklyOffPay,
        totalDeductions: cleanDeductions,
        netSalary,
        totalTakeHomePay,
        isCommissionEligible,
        commission: commissionEarned,
        expenseReimbursement: ps.expenseReimbursement || 0,
        netInWords,
      }
    };
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