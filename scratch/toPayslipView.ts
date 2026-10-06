    const toPayslipView = async (ps: (typeof rawPayslips)[number]) => {
      const calendarDays = new Date(ps.year, ps.month, 0).getDate();
      const schedWorkingDays = ps.workingDays || calculateScheduledWorkingDays(ps.year, ps.month, employee.office);

      // Earnings come from the shared backend resolver (same components as the admin payroll)
      const earnings = await payrollService.resolvePayslipEarnings(ps);
      const baseMonthly = earnings.grossEarnings;
      const dSalary = ps.dailySalary || (schedWorkingDays > 0 ? Math.round((baseMonthly / schedWorkingDays) * 100) / 100 : 0);
      const absentDeduction = ps.absentDays ? Math.round((ps.absentDays * dSalary) * 100) / 100 : 0;
      const halfDayDeduction = ps.halfDays ? Math.round((ps.halfDays * 0.5 * dSalary) * 100) / 100 : 0;
      const leaveDeduction = ps.unpaidLeaveDays ? Math.round((ps.unpaidLeaveDays * dSalary) * 100) / 100 : 0;

      let advanceDeduction = ps.advanceDeduction || 0;
      if (advanceDeduction === 0) {
        const monthEnd = new Date(ps.year, ps.month, 0, 23, 59, 59, 999);
        const activeAdvances = await prisma.salaryAdvance.findMany({
          where: {
            wallet: { employeeId: ps.employeeId },
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
        for (const adv of activeAdvances) {
          const standardEmi = adv.monthlyEmi > 0 
            ? adv.monthlyEmi 
            : (adv.months > 0 ? Math.round((adv.amount / adv.months) * 100) / 100 : adv.amount);
          const remaining = adv.remainingAmount > 0 ? adv.remainingAmount : Math.max(0, adv.amount - (adv.paidAmount || 0));
          advanceDeduction += Math.min(standardEmi, remaining);
        }
        advanceDeduction = Math.round(advanceDeduction * 100) / 100;
      }

      // Gross excludes commission; net = gross - deductions. Commission is reported separately.
      const extraPayout = (ps.extraHolidayPayout || 0) + (ps.extraWeeklyOffPayout || 0);
      const grossSalary = Math.round((earnings.grossEarnings + extraPayout) * 100) / 100;

      const ss = employee.salaryStructure;
      const pf = ss?.pfEnabled ? Math.round(earnings.baseSalary * (ss.employeePfRate / 100)) : 0;
      const esic = ss?.esicEnabled ? Math.round(grossSalary * (ss.employeeEsicRate / 100)) : 0;

      const itemizedDeductions = pf + esic + absentDeduction + halfDayDeduction + leaveDeduction + advanceDeduction;

      let cleanDeductions = ps.deductions || 0;
      const isCorrupted = cleanDeductions > 0 && (cleanDeductions - itemizedDeductions > 5000);

      if (cleanDeductions === 0 || isCorrupted) {
        cleanDeductions = itemizedDeductions;
      }

      const netSalary = Math.max(0, Math.round((grossSalary - cleanDeductions) * 100) / 100);
      const totalTakeHomePay = Math.round((netSalary + (ps.commissionEarned || 0) + (ps.expenseReimbursement || 0)) * 100) / 100;
      const otherDeductions = Math.max(0, Math.round((cleanDeductions - itemizedDeductions) * 100) / 100);

      if (isCorrupted || ps.netSalary !== netSalary || ps.deductions !== cleanDeductions || (ps.advanceDeduction || 0) !== advanceDeduction) {
        prisma.payslip.update({
          where: { id: ps.id },
          data: {
            deductions: cleanDeductions,
            netSalary,
            advanceDeduction,
            netInWords: `${numToWords(Math.round(totalTakeHomePay))} Rupees Only`
          }
        }).catch(err => console.warn(`[getMyPayslips] Failed to heal payslip #${ps.id}:`, err));
      }

      const payPeriod = new Date(ps.year, ps.month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const documentId = `HR-PAY-${ps.employeeCode}-${ps.year}${String(ps.month).padStart(2, '0')}`;
      const netInWords = ps.netInWords || `${numToWords(Math.round(totalTakeHomePay))} Rupees Only`;
      const isPaid = ps.status?.toUpperCase() === 'PAID';
      const paymentStatus = isPaid ? 'PAID' : 'PENDING';

      return {
        ...ps,
        status: paymentStatus,
        paymentStatus,
        payrollStatus: ps.status || 'PENDING',
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
        commission: ps.commissionEarned || 0,
        commissionEarned: ps.commissionEarned || 0,
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
        extraHolidayPayout: ps.extraHolidayPayout || 0,
        extraWeeklyOffPayout: ps.extraWeeklyOffPayout || 0,
        dailySalary: ps.dailySalary || 0,
        workingDays: schedWorkingDays,
        totalCalendarDays: ps.totalCalendarDays || calendarDays,
        earnings: {
          baseSalary: earnings.baseSalary,
          basicSalary: earnings.baseSalary,
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
          grossSalary,
          grossTotal: grossSalary,
          grossEarnings: grossSalary,
          commission: ps.commissionEarned || 0,
          expenseReimbursement: ps.expenseReimbursement || 0,
        }
      };
    };
