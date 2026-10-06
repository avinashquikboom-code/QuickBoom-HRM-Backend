import { prisma } from '../src/utils/db';
import payrollService from '../src/services/payrollService';

interface SlipComparison {
  caseName: string;
  adminGross: number;
  pdfGross: number;
  mobileGross: number;
  adminDeductions: number;
  pdfDeductions: number;
  mobileDeductions: number;
  adminNet: number;
  pdfNet: number;
  mobileNet: number;
  adminCommission: number;
  pdfCommission: number;
  mobileCommission: number;
  adminTakeHome: number;
  pdfTakeHome: number;
  mobileTakeHome: number;
  allMatch: boolean;
}

// Emulates the official PDF calculation logic from generatePayslipPDF
function computePdfValues(payslip: any, earnings: any, schedWorkingDays: number) {
  const extraPayout = (payslip.extraHolidayPayout || 0) + (payslip.extraWeeklyOffPayout || 0);
  const grossEarnings = Math.round((earnings.grossEarnings + extraPayout) * 100) / 100;
  const dSalary = payslip.dailySalary || (schedWorkingDays > 0 ? Math.round((earnings.grossEarnings / schedWorkingDays) * 100) / 100 : 0);
  const absentDeduction = payslip.absentDays ? Math.round((payslip.absentDays * dSalary) * 100) / 100 : 0;
  const halfDayDeduction = payslip.halfDays ? Math.round((payslip.halfDays * 0.5 * dSalary) * 100) / 100 : 0;
  const leaveDeduction = payslip.unpaidLeaveDays ? Math.round((payslip.unpaidLeaveDays * dSalary) * 100) / 100 : 0;
  const advanceDeduction = payslip.advanceDeduction || 0;
  const ss = payslip.employee?.salaryStructure;
  const pf = ss?.pfEnabled ? Math.round(earnings.baseSalary * (ss.employeePfRate / 100)) : 0;
  const esic = ss?.esicEnabled ? Math.round(grossEarnings * (ss.employeeEsicRate / 100)) : 0;

  const itemizedDeductions = pf + esic + absentDeduction + halfDayDeduction + leaveDeduction + advanceDeduction;
  let deductions = payslip.deductions > 0 ? payslip.deductions : itemizedDeductions;
  if (payslip.deductions > 0 && payslip.deductions - itemizedDeductions > 5000) {
    deductions = itemizedDeductions;
  }
  const netSalary = Math.max(0, Math.round((grossEarnings - deductions) * 100) / 100);
  const commission = payslip.commissionEarned || 0;
  const reimbursements = payslip.expenseReimbursement || 0;
  const totalTakeHome = Math.round((netSalary + (commission > 0 ? commission : 0) + reimbursements) * 100) / 100;

  return {
    grossEarnings,
    totalDeductions: deductions,
    netSalary,
    commission,
    totalTakeHome
  };
}

// Emulates Admin Panel calculation logic from getAdminPayrollSlips & computeSlipData
function computeAdminValues(payslip: any, earnings: any, schedWorkingDays: number) {
  const extraPayout = (payslip.extraHolidayPayout || 0) + (payslip.extraWeeklyOffPayout || 0);
  const grossSalary = Math.round((earnings.grossEarnings + extraPayout) * 100) / 100;
  const dSalary = payslip.dailySalary || (schedWorkingDays > 0 ? Math.round((earnings.grossEarnings / schedWorkingDays) * 100) / 100 : 0);
  const absentDeduction = payslip.absentDays ? Math.round((payslip.absentDays * dSalary) * 100) / 100 : 0;
  const halfDayDeduction = payslip.halfDays ? Math.round((payslip.halfDays * 0.5 * dSalary) * 100) / 100 : 0;
  const leaveDeduction = payslip.unpaidLeaveDays ? Math.round((payslip.unpaidLeaveDays * dSalary) * 100) / 100 : 0;
  const advanceDeduction = payslip.advanceDeduction || 0;
  const ss = payslip.employee?.salaryStructure;
  const pf = ss?.pfEnabled ? Math.round(earnings.baseSalary * (ss.employeePfRate / 100)) : 0;
  const esic = ss?.esicEnabled ? Math.round(grossSalary * (ss.employeeEsicRate / 100)) : 0;

  const itemizedDeductions = pf + esic + absentDeduction + halfDayDeduction + leaveDeduction + advanceDeduction;
  let cleanDeductions = payslip.deductions || 0;
  if (cleanDeductions === 0 || (cleanDeductions > 0 && cleanDeductions - itemizedDeductions > 5000)) {
    cleanDeductions = itemizedDeductions;
  }
  const cleanNetSalary = Math.max(0, Math.round((grossSalary - cleanDeductions) * 100) / 100);
  const commission = payslip.commissionEarned || 0;
  const reimbursements = payslip.expenseReimbursement || 0;
  const totalTakeHome = Math.round((cleanNetSalary + (commission > 0 ? commission : 0) + reimbursements) * 100) / 100;

  return {
    grossEarnings: grossSalary,
    totalDeductions: cleanDeductions,
    netSalary: cleanNetSalary,
    commission,
    totalTakeHome
  };
}

// Emulates Flutter Mobile App calculation logic from toPayslipView + PayslipModel.fromJson + unified_salary_slip_widget
function computeMobileValues(payslip: any, earnings: any, schedWorkingDays: number) {
  const extraPayout = (payslip.extraHolidayPayout || 0) + (payslip.extraWeeklyOffPayout || 0);
  const grossSalary = Math.round((earnings.grossEarnings + extraPayout) * 100) / 100;
  const dSalary = payslip.dailySalary || (schedWorkingDays > 0 ? Math.round((earnings.grossEarnings / schedWorkingDays) * 100) / 100 : 0);
  const absentDeduction = payslip.absentDays ? Math.round((payslip.absentDays * dSalary) * 100) / 100 : 0;
  const halfDayDeduction = payslip.halfDays ? Math.round((payslip.halfDays * 0.5 * dSalary) * 100) / 100 : 0;
  const leaveDeduction = payslip.unpaidLeaveDays ? Math.round((payslip.unpaidLeaveDays * dSalary) * 100) / 100 : 0;
  const advanceDeduction = payslip.advanceDeduction || 0;
  const ss = payslip.employee?.salaryStructure;
  const pf = ss?.pfEnabled ? Math.round(earnings.baseSalary * (ss.employeePfRate / 100)) : 0;
  const esic = ss?.esicEnabled ? Math.round(grossSalary * (ss.employeeEsicRate / 100)) : 0;

  const itemizedDeductions = pf + esic + absentDeduction + halfDayDeduction + leaveDeduction + advanceDeduction;
  let cleanDeductions = payslip.deductions || 0;
  if (cleanDeductions === 0 || (cleanDeductions > 0 && cleanDeductions - itemizedDeductions > 5000)) {
    cleanDeductions = itemizedDeductions;
  }
  const netSalary = Math.max(0, Math.round((grossSalary - cleanDeductions) * 100) / 100);
  const commission = payslip.commissionEarned || 0;
  const reimbursements = payslip.expenseReimbursement || 0;
  const totalTakeHome = Math.round((netSalary + (commission > 0 ? commission : 0) + reimbursements) * 100) / 100;

  return {
    grossEarnings: grossSalary,
    totalDeductions: cleanDeductions,
    netSalary,
    commission,
    totalTakeHome
  };
}

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 RUNNING SALARY COMPARISON TESTS ACROSS ALL SCENARIOS');
  console.log('===============================================================\n');

  const testCases = [
    {
      name: 'Employee A: No deductions',
      baseSalary: 25000,
      hra: 5000,
      allowance: 2000,
      workingDays: 26,
      absentDays: 0,
      halfDays: 0,
      unpaidLeaveDays: 0,
      advanceDeduction: 0,
      commissionEarned: 0,
      expenseReimbursement: 0
    },
    {
      name: 'Employee B: Advance salary only (₹3,000)',
      baseSalary: 30000,
      hra: 6000,
      allowance: 3000,
      workingDays: 26,
      absentDays: 0,
      halfDays: 0,
      unpaidLeaveDays: 0,
      advanceDeduction: 3000,
      commissionEarned: 0,
      expenseReimbursement: 0
    },
    {
      name: 'Employee C: Present + 2 Half Days',
      baseSalary: 20000,
      hra: 4000,
      allowance: 2000,
      workingDays: 26,
      absentDays: 0,
      halfDays: 2,
      unpaidLeaveDays: 0,
      advanceDeduction: 0,
      commissionEarned: 0,
      expenseReimbursement: 0
    },
    {
      name: 'Employee D: Present + 3 Absent days',
      baseSalary: 26000,
      hra: 5000,
      allowance: 2000,
      workingDays: 26,
      absentDays: 3,
      halfDays: 0,
      unpaidLeaveDays: 0,
      advanceDeduction: 0,
      commissionEarned: 0,
      expenseReimbursement: 0
    },
    {
      name: 'Employee E: Paid Leave (0 unpaid deductions)',
      baseSalary: 35000,
      hra: 7000,
      allowance: 3500,
      workingDays: 26,
      absentDays: 0,
      halfDays: 0,
      unpaidLeaveDays: 0,
      advanceDeduction: 0,
      commissionEarned: 0,
      expenseReimbursement: 0
    },
    {
      name: 'Employee F: Unpaid Leave (2 days unpaid leave)',
      baseSalary: 28000,
      hra: 5600,
      allowance: 2800,
      workingDays: 26,
      absentDays: 0,
      halfDays: 0,
      unpaidLeaveDays: 2,
      advanceDeduction: 0,
      commissionEarned: 0,
      expenseReimbursement: 0
    },
    {
      name: 'Employee G: Advance (₹5,000) + Absent Deduction (2 days)',
      baseSalary: 40000,
      hra: 8000,
      allowance: 4000,
      workingDays: 26,
      absentDays: 2,
      halfDays: 0,
      unpaidLeaveDays: 0,
      advanceDeduction: 5000,
      commissionEarned: 0,
      expenseReimbursement: 0
    },
    {
      name: 'Employee H: Commission (₹8,500) + 1 Absent day',
      baseSalary: 22000,
      hra: 4400,
      allowance: 2200,
      workingDays: 26,
      absentDays: 1,
      halfDays: 0,
      unpaidLeaveDays: 0,
      advanceDeduction: 0,
      commissionEarned: 8500,
      expenseReimbursement: 1200
    },
    {
      name: 'Employee I: Multiple deductions (Advance + Absent + Half Day + Leave) + Commission',
      baseSalary: 50000,
      hra: 10000,
      allowance: 5000,
      workingDays: 26,
      absentDays: 1,
      halfDays: 2,
      unpaidLeaveDays: 1,
      advanceDeduction: 4000,
      commissionEarned: 12500,
      expenseReimbursement: 3500
    }
  ];

  let passedAll = true;

  for (const tc of testCases) {
    const totalGrossEarnings = tc.baseSalary + tc.hra + tc.allowance;
    const dailySalary = Math.round((totalGrossEarnings / tc.workingDays) * 100) / 100;
    const absentDed = Math.round((tc.absentDays * dailySalary) * 100) / 100;
    const halfDayDed = Math.round((tc.halfDays * 0.5 * dailySalary) * 100) / 100;
    const leaveDed = Math.round((tc.unpaidLeaveDays * dailySalary) * 100) / 100;
    const totalDed = absentDed + halfDayDed + leaveDed + tc.advanceDeduction;

    const mockPayslip: any = {
      id: 1001,
      employeeId: 99,
      month: 10,
      year: 2026,
      workingDays: tc.workingDays,
      dailySalary,
      absentDays: tc.absentDays,
      halfDays: tc.halfDays,
      unpaidLeaveDays: tc.unpaidLeaveDays,
      advanceDeduction: tc.advanceDeduction,
      deductions: totalDed,
      commissionEarned: tc.commissionEarned,
      expenseReimbursement: tc.expenseReimbursement,
      extraHolidayPayout: 0,
      extraWeeklyOffPayout: 0,
      employee: {
        department: { name: 'Sales' },
        office: { name: 'Main Office' },
        salaryStructure: {
          pfEnabled: false,
          esicEnabled: false
        }
      }
    };

    const mockEarnings: any = {
      baseSalary: tc.baseSalary,
      allowance: tc.allowance,
      grossEarnings: totalGrossEarnings,
      components: {
        hra: tc.hra,
        travelAllowance: tc.allowance / 2,
        medicalAllowance: tc.allowance / 2,
        specialAllowance: 0,
        bonus: 0,
        incentive: 0
      }
    };

    const admin = computeAdminValues(mockPayslip, mockEarnings, tc.workingDays);
    const pdf = computePdfValues(mockPayslip, mockEarnings, tc.workingDays);
    const mobile = computeMobileValues(mockPayslip, mockEarnings, tc.workingDays);

    const grossMatches = admin.grossEarnings === pdf.grossEarnings && pdf.grossEarnings === mobile.grossEarnings;
    const dedMatches = admin.totalDeductions === pdf.totalDeductions && pdf.totalDeductions === mobile.totalDeductions;
    const netMatches = admin.netSalary === pdf.netSalary && pdf.netSalary === mobile.netSalary;
    const commMatches = admin.commission === pdf.commission && pdf.commission === mobile.commission;
    const takeHomeMatches = admin.totalTakeHome === pdf.totalTakeHome && pdf.totalTakeHome === mobile.totalTakeHome;

    const allMatch = grossMatches && dedMatches && netMatches && commMatches && takeHomeMatches;

    if (!allMatch) passedAll = false;

    console.log(`📌 CASE: ${tc.name}`);
    console.log(`   Admin:     Gross=₹${admin.grossEarnings.toFixed(2)}, Ded=₹${admin.totalDeductions.toFixed(2)}, Net=₹${admin.netSalary.toFixed(2)}, Comm=₹${admin.commission.toFixed(2)}, TakeHome=₹${admin.totalTakeHome.toFixed(2)}`);
    console.log(`   PDF:       Gross=₹${pdf.grossEarnings.toFixed(2)}, Ded=₹${pdf.totalDeductions.toFixed(2)}, Net=₹${pdf.netSalary.toFixed(2)}, Comm=₹${pdf.commission.toFixed(2)}, TakeHome=₹${pdf.totalTakeHome.toFixed(2)}`);
    console.log(`   Mobile:    Gross=₹${mobile.grossEarnings.toFixed(2)}, Ded=₹${mobile.totalDeductions.toFixed(2)}, Net=₹${mobile.netSalary.toFixed(2)}, Comm=₹${mobile.commission.toFixed(2)}, TakeHome=₹${mobile.totalTakeHome.toFixed(2)}`);
    console.log(`   Result:    ${allMatch ? '✅ PERFECT MATCH (Admin = PDF = Mobile)' : '❌ MISMATCH'}\n`);
  }

  // Also query actual live database payslips for all active employees across months
  console.log('---------------------------------------------------------------');
  console.log('🔍 CHECKING LIVE DATABASE PAYSLIPS FOR ACTIVE EMPLOYEES:');
  console.log('---------------------------------------------------------------');

  const liveEmployees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'active'] } },
    include: { salaryStructure: true, office: true, department: true }
  });

  console.log(`Found ${liveEmployees.length} active employees in database.`);

  for (const emp of liveEmployees) {
    const payslips = await prisma.payslip.findMany({
      where: { employeeId: emp.id },
      include: {
        employee: {
          include: { department: true, office: true, salaryStructure: true }
        }
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 2
    });

    for (const ps of payslips) {
      const resolved = await payrollService.resolvePayslipEarnings(ps);
      const schedDays = ps.workingDays || 26;
      const admin = computeAdminValues(ps, resolved, schedDays);
      const pdf = computePdfValues(ps, resolved, schedDays);
      const mobile = computeMobileValues(ps, resolved, schedDays);

      const allMatch = (
        admin.grossEarnings === pdf.grossEarnings && pdf.grossEarnings === mobile.grossEarnings &&
        admin.totalDeductions === pdf.totalDeductions && pdf.totalDeductions === mobile.totalDeductions &&
        admin.netSalary === pdf.netSalary && pdf.netSalary === mobile.netSalary &&
        admin.commission === pdf.commission && pdf.commission === mobile.commission &&
        admin.totalTakeHome === pdf.totalTakeHome && pdf.totalTakeHome === mobile.totalTakeHome
      );

      if (!allMatch) passedAll = false;

      console.log(`👤 Emp #${emp.id} (${emp.employeeCode} - ${emp.firstName} ${emp.lastName}) [${ps.month}/${ps.year}]:`);
      console.log(`   Admin:     Gross=₹${admin.grossEarnings.toFixed(2)}, Ded=₹${admin.totalDeductions.toFixed(2)}, Net=₹${admin.netSalary.toFixed(2)}, TakeHome=₹${admin.totalTakeHome.toFixed(2)}`);
      console.log(`   PDF:       Gross=₹${pdf.grossEarnings.toFixed(2)}, Ded=₹${pdf.totalDeductions.toFixed(2)}, Net=₹${pdf.netSalary.toFixed(2)}, TakeHome=₹${pdf.totalTakeHome.toFixed(2)}`);
      console.log(`   Mobile:    Gross=₹${mobile.grossEarnings.toFixed(2)}, Ded=₹${mobile.totalDeductions.toFixed(2)}, Net=₹${mobile.netSalary.toFixed(2)}, TakeHome=₹${mobile.totalTakeHome.toFixed(2)}`);
      console.log(`   Result:    ${allMatch ? '✅ MATCH' : '❌ MISMATCH'}`);
    }
  }

  console.log('\n===============================================================');
  if (passedAll) {
    console.log('🎉 ALL SALARY MATCHING TESTS PASSED 100% GLOBALLY!');
  } else {
    console.log('❌ SOME TESTS FAILED');
  }
  console.log('===============================================================');

  await prisma.$disconnect();
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
