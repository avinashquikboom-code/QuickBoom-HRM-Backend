import { Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import payrollService, { payslipComponentData } from '../../services/payrollService';
import { getIstMonthRange } from '../../utils/commissionHelper';
import { numToWords } from '../../services/payrollAutomationService';
const PdfPrinter = require('pdfmake');

// Primary color for all PDF reports
const PRIMARY_COLOR = '#3BA38B';

const fonts = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

const printer = new PdfPrinter(fonts);

// Fetch all payslips for the logged-in employee
export const getMyPayslips = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { office: true, salaryStructure: true }
    });

    if (!employee) {
      // HopKid employees may not have a local DB record yet — return empty list gracefully
      res.json({
        success: true,
        data: [],
        message: 'No employee record linked to this account.'
      });
      return;
    }

    const calculateScheduledWorkingDays = (year: number, month: number, office: any): number => {
      const calendarDays = new Date(year, month, 0).getDate();
      const officeDays = office?.workingDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      let count = 0;
      for (let d = 1; d <= calendarDays; d++) {
        const dayName = new Date(year, month - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
        if (officeDays.includes(dayName)) count++;
      }
      return count > 0 ? count : 26;
    };

    const rawPayslips = await prisma.payslip.findMany({
      where: { employeeId: employee.id },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' }
      ]
    });

    const toPayslipView = async (ps: (typeof rawPayslips)[number]) => {
      return await payrollService.resolveFullPayslipView(ps, employee);
    };

    let payslips = await Promise.all(rawPayslips.map(toPayslipView));

    if (payslips.length === 0) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      await payrollService.autoGenerateMonthlyPayroll(month, year);

      const updatedRaw = await prisma.payslip.findMany({
        where: { employeeId: employee.id },
        orderBy: [{ year: 'desc' }, { month: 'desc' }]
      });

      payslips = await Promise.all(updatedRaw.map(toPayslipView));
    }

    res.json({
      success: true,
      data: payslips,
      payslips: payslips
    });
  } catch (error: any) {
    console.error('Get my payslips error — userId:', req.user?.id, '| detail:', error?.message ?? error);
    // Return empty list rather than a 500 crash — payslips may simply not exist yet
    res.json({
      success: true,
      data: [],
      _warning: 'Payslips temporarily unavailable.'
    });
  }
};


// Download a payslip as PDF
export const downloadPayslip = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { month, year, employeeId: qEmpId } = req.query;

    let employee = null;
    if (req.user?.id) {
      employee = await prisma.employee.findFirst({
        where: { userId: req.user.id }
      });
    }

    let payslip: any = null;

    if (id && !isNaN(parseInt(id as string, 10))) {
      const payslipId = parseInt(id as string, 10);
      payslip = await prisma.payslip.findUnique({
        where: { id: payslipId },
        include: { employee: true }
      });
    } else if (month && year) {
      const targetEmpId = qEmpId && !isNaN(Number(qEmpId)) ? Number(qEmpId) : employee?.id;
      if (targetEmpId) {
        payslip = await prisma.payslip.findFirst({
          where: {
            employeeId: targetEmpId,
            month: Number(month),
            year: Number(year),
          },
          include: { employee: true }
        });
      }
    }

    // Dynamic fallback if no formal payslip row exists in database yet
    if (!payslip) {
      const targetEmpId = qEmpId && !isNaN(Number(qEmpId)) ? Number(qEmpId) : employee?.id;
      const targetMonth = month ? Number(month) : new Date().getMonth() + 1;
      const targetYear = year ? Number(year) : new Date().getFullYear();

      if (targetEmpId) {
        const emp = await prisma.employee.findUnique({
          where: { id: targetEmpId },
          include: { office: true, department: true }
        });

        if (emp) {
          // Single source of truth: the backend payroll calculation (same one admin uses)
          const calc = await payrollService.calculatePayroll(emp.id, targetMonth, targetYear);
          payslip = {
            id: 0,
            employeeId: emp.id,
            employeeCode: emp.employeeCode,
            employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
            designation: emp.designation || '',
            department: emp.department?.name || '',
            officeName: emp.office?.name || '',
            month: targetMonth,
            year: targetYear,
            baseSalary: calc.baseSalary,
            allowance: calc.allowance,
            deductions: calc.deductions,
            netSalary: calc.netSalary,
            advanceDeduction: calc.advanceDeduction,
            expenseReimbursement: calc.expenseReimbursement,
            presentDays: calc.presentDays,
            absentDays: calc.absentDays,
            halfDays: calc.halfDays,
            paidLeaveDays: calc.paidLeaveDays,
            unpaidLeaveDays: calc.unpaidLeaveDays,
            holidayCount: calc.holidayCount,
            weeklyOffCount: calc.weeklyOffCount,
            holidayWorkedCount: calc.holidayWorkedCount,
            weeklyOffWorkedCount: calc.weeklyOffWorkedCount,
            extraHolidayPayout: calc.extraHolidayPayout,
            extraWeeklyOffPayout: calc.extraWeeklyOffPayout,
            dailySalary: calc.dailySalary,
            workingDays: calc.workingDays,
            totalCalendarDays: calc.totalCalendarDays,
            commissionEarned: calc.commissionEarned,
            ...payslipComponentData(calc),
            netInWords: `${calc.netSalary.toLocaleString('en-IN')} Rupees Only`,
            employee: emp,
          };
        }
      }
    }

    if (!payslip) {
      res.status(404).json({
        success: false,
        message: 'Payslip not found.'
      });
      return;
    }

    // Verify employee authorization: Employees can only download their own payslips
    if (req.user?.role === 'EMPLOYEE') {
      if (employee && employee.id !== payslip.employeeId) {
        res.status(403).json({
          success: false,
          message: 'Unauthorized to download this payslip.'
        });
        return;
      }
    }

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[payslip.month - 1] || 'Unknown';
    const periodLabel = `${monthName} ${payslip.year}`;

    // Fetch employee salary structure for reference if needed
    const employeeWithSalary = await prisma.employee.findUnique({
      where: { id: payslip.employeeId },
      include: { salaryStructure: true, office: true, department: true }
    });

    // SINGLE SOURCE OF TRUTH: Get the fully resolved view object
    const view = await payrollService.resolveFullPayslipView(payslip, employeeWithSalary);

    const grossEarnings = view.grossEarnings;
    const totalDeductions = view.totalDeductions;
    const netSalary = view.netSalary;
    const totalTakeHomePay = view.totalTakeHomePay;
    const commissionEarned = view.commissionEarned;
    const expenseReimbursement = view.expenseReimbursement;
    const paymentStatus = view.paymentStatus;
    const totalDaysInMonth = view.totalCalendarDays;

    const fmt = (n: number) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Build Earnings Items
    const earningsItems: { name: string; amount: number }[] = [
      { name: 'Basic Salary', amount: view.earnings.baseSalary },
    ];
    if (view.earnings.hra > 0) earningsItems.push({ name: 'House Rent Allowance (HRA)', amount: view.earnings.hra });
    if (view.earnings.travelMedicalAllowance > 0) earningsItems.push({ name: 'Allowances (Travel/Medical)', amount: view.earnings.travelMedicalAllowance });
    if (view.earnings.specialAllowance > 0) earningsItems.push({ name: 'Special Allowance', amount: view.earnings.specialAllowance });
    if (view.earnings.bonus > 0) earningsItems.push({ name: 'Bonus', amount: view.earnings.bonus });
    if (view.earnings.incentive > 0) earningsItems.push({ name: 'Incentive', amount: view.earnings.incentive });
    const extraPayout = view.extraHolidayPayout + view.extraWeeklyOffPayout;
    if (extraPayout > 0) earningsItems.push({ name: 'Holiday / Weekly Off Payout', amount: extraPayout });
    if (commissionEarned > 0) earningsItems.push({ name: 'Commission', amount: commissionEarned });
    if (earningsItems.length === 1 && view.allowance > 0) {
      earningsItems.push({ name: 'Allowances', amount: view.allowance });
    }

    // Build Deductions Items
    const deductionsItems: { name: string; amount: number }[] = [];
    if (view.deductionsObj.advanceDeduction > 0) deductionsItems.push({ name: 'Advance Salary', amount: view.deductionsObj.advanceDeduction });
    if (view.deductionsObj.pf > 0) deductionsItems.push({ name: 'Provident Fund (PF)', amount: view.deductionsObj.pf });
    if (view.deductionsObj.esic > 0) deductionsItems.push({ name: 'ESIC / Tax', amount: view.deductionsObj.esic });
    if (view.deductionsObj.absentDeduction > 0) deductionsItems.push({ name: `Absent (${view.absentDays} days)`, amount: view.deductionsObj.absentDeduction });
    if (view.deductionsObj.halfDayDeduction > 0) deductionsItems.push({ name: `Half Day (${view.halfDays} half days)`, amount: view.deductionsObj.halfDayDeduction });
    if (view.deductionsObj.leaveDeduction > 0) deductionsItems.push({ name: `Leave (${view.unpaidLeaveDays} unpaid leaves)`, amount: view.deductionsObj.leaveDeduction });
    if (view.deductionsObj.otherDeductions > 0) deductionsItems.push({ name: 'Other Deductions', amount: view.deductionsObj.otherDeductions });
    if (deductionsItems.length === 0) {
      deductionsItems.push({ name: 'Advance Salary', amount: 0 }); // placeholder if none
    }

    const maxRows = Math.max(earningsItems.length, deductionsItems.length);
    const tableRows: any[] = [];
    for (let i = 0; i < maxRows; i++) {
      const earn = earningsItems[i];
      const ded = deductionsItems[i];
      tableRows.push([
        { text: earn ? earn.name : '' },
        { text: earn ? `Rs. ${fmt(earn.amount)}` : '', alignment: 'right' },
        { text: ded ? ded.name : '' },
        { text: ded ? (ded.amount > 0 ? `-Rs. ${fmt(ded.amount)}` : `Rs. ${fmt(0)}`) : '', alignment: 'right' },
      ]);
    }

    const earningsTableBody: any[] = [
      [
        { text: 'Earnings', bold: true, fillColor: '#f3f4f6' },
        { text: 'Amount (INR)', bold: true, alignment: 'right', fillColor: '#f3f4f6' },
        { text: 'Deductions', bold: true, fillColor: '#f3f4f6' },
        { text: 'Amount (INR)', bold: true, alignment: 'right', fillColor: '#f3f4f6' }
      ],
      ...tableRows,
      [
        { text: 'Gross Earnings', bold: true, fillColor: '#f9fafb' },
        { text: `Rs. ${fmt(grossEarnings)}`, bold: true, alignment: 'right', fillColor: '#f9fafb' },
        { text: 'Total Deductions', bold: true, fillColor: '#f9fafb' },
        { text: totalDeductions > 0 ? `-Rs. ${fmt(totalDeductions)}` : `Rs. ${fmt(0)}`, bold: true, alignment: 'right', fillColor: '#f9fafb' }
      ]
    ];

    // Build Reimbursements / Expenses Section
    const reimbursementsTableBody: any[] = [
      [
        { text: 'Reimbursement / Expense Category', bold: true, fillColor: '#f3f4f6' },
        { text: 'Amount (INR)', bold: true, alignment: 'right', fillColor: '#f3f4f6' }
      ]
    ];
    
    if (view.expenseCategories && Object.keys(view.expenseCategories).length > 0) {
      for (const [cat, amt] of Object.entries(view.expenseCategories)) {
        reimbursementsTableBody.push([
          { text: `${cat} Expense` },
          { text: `Rs. ${fmt(amt as number)}`, alignment: 'right' }
        ]);
      }
    } else if (expenseReimbursement > 0) {
      reimbursementsTableBody.push([
        { text: 'Approved Expenses' },
        { text: `Rs. ${fmt(expenseReimbursement)}`, alignment: 'right' }
      ]);
    } else {
      reimbursementsTableBody.push([
        { text: 'No Expenses / Reimbursements', color: '#6b7280', italics: true },
        { text: `Rs. ${fmt(0)}`, alignment: 'right', color: '#6b7280' }
      ]);
    }

    reimbursementsTableBody.push([
      { text: 'Total Reimbursements', bold: true, fillColor: '#ecfdf5', color: '#047857' },
      { text: `Rs. ${fmt(expenseReimbursement)}`, bold: true, alignment: 'right', fillColor: '#ecfdf5', color: '#047857' }
    ]);

    const docContent: any[] = [
      // Title Header
      { text: 'HOPKID PORTAL', style: 'companyName', alignment: 'center' },
      { text: 'Human Resources · Payroll Division', style: 'companySub', alignment: 'center', margin: [0, 2, 0, 15] },
      
      { text: 'SALARY SLIP', style: 'docTitle', alignment: 'center', margin: [0, 0, 0, 20] },
      
      // Employee details table
      {
        style: 'tableExample',
        table: {
          widths: ['*', '*'],
          body: [
            [
              {
                text: [
                  { text: 'Employee Name: ', bold: true }, view.employeeName || payslip.employeeName, '\n',
                  { text: 'Employee Code: ', bold: true }, view.employeeCode || payslip.employeeCode, '\n',
                  { text: 'Designation:   ', bold: true }, view.designation || payslip.designation || '\u2014', '\n',
                  { text: 'Department:    ', bold: true }, view.department || payslip.department || '\u2014'
                ],
                margin: [5, 5, 5, 5]
              },
              {
                text: [
                  { text: 'Office / Branch:     ', bold: true }, view.officeName || payslip.officeName || '\u2014', '\n',
                  { text: 'Pay Period:          ', bold: true }, periodLabel, '\n',
                  { text: 'Total Days of Month: ', bold: true }, `${totalDaysInMonth} Days`, '\n',
                  { text: 'Document ID:         ', bold: true }, view.documentId || `HR-PAY-${payslip.employeeCode}-${payslip.year}${String(payslip.month).padStart(2, '0')}`, '\n',
                  { text: 'Status:              ', bold: true }, paymentStatus
                ],
                margin: [5, 5, 5, 5]
              }
            ]
          ]
        },
        layout: 'lightHorizontalLines'
      },
      
      { text: 'Salary Breakdown', style: 'sectionHeader', margin: [0, 20, 0, 8] },
      
      // Earnings & Deductions Table
      {
        table: {
          widths: ['*', 'auto', '*', 'auto'],
          body: earningsTableBody
        },
        layout: 'grid'
      },

      // Reimbursements Section
      { text: 'Reimbursements / Expenses', style: 'sectionHeader', margin: [0, 16, 0, 8] },
      {
        table: {
          widths: ['*', 'auto'],
          body: reimbursementsTableBody
        },
        layout: 'grid'
      },
      
      // Net pay calculation breakdown & block
      {
        margin: [0, 20, 0, 0],
        table: {
          widths: ['*'],
          body: [
            [
              {
                fillColor: PRIMARY_COLOR,
                color: 'white',
                text: [
                  { text: 'PAYABLE SUMMARY\n', fontSize: 10, bold: true },
                  { text: `Gross Earnings: Rs. ${fmt(grossEarnings)}  |  Less Deductions: Rs. ${fmt(totalDeductions)}  |  Net Salary: Rs. ${fmt(netSalary)}\n`, fontSize: 9 },
                  ...(commissionEarned > 0 ? [{ text: `Add: Commission: +Rs. ${fmt(commissionEarned)}\n`, fontSize: 9, bold: true }] : []),
                  ...(expenseReimbursement > 0 ? [{ text: `Add: Eligible Reimbursements: +Rs. ${fmt(expenseReimbursement)}\n`, fontSize: 9, bold: true }] : []),
                  { text: `\nTOTAL TAKE-HOME PAY\n`, fontSize: 11, bold: true },
                  { text: `INR ${fmt(totalTakeHomePay)}/-\n`, fontSize: 18, bold: true },
                  { text: `In Words: ${payslip.netInWords || `${totalTakeHomePay.toLocaleString('en-IN')} Rupees Only`}`, fontSize: 9, italics: true }
                ],
                alignment: 'center',
                margin: [15, 12, 15, 12]
              }
            ]
          ]
        },
        layout: 'noBorders'
      },
      
      // Footer disclaimer
      { 
        text: 'This is a computer-generated salary slip and does not require a physical signature.', 
        style: 'footerDisclaimer', 
        alignment: 'center', 
        margin: [0, 35, 0, 0] 
      }
    ];

    const docDefinition = {
      content: docContent,
      styles: {
        companyName: { fontSize: 20, bold: true, color: PRIMARY_COLOR },
        companySub: { fontSize: 9, color: '#6b7280' },
        docTitle: { fontSize: 14, bold: true, decoration: 'underline', color: '#111827' },
        sectionHeader: { fontSize: 11, bold: true, color: '#374151' },
        footerDisclaimer: { fontSize: 8, color: '#9ca3af', italics: true }
      },
      defaultStyle: {
        font: 'Roboto',
        fontSize: 10
      }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    const safeName = payslip.employeeName.replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=SalarySlip_${payslip.employeeCode}_${safeName}_${payslip.year}_${payslip.month}.pdf`);
    
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error('Download payslip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download payslip PDF.'
    });
  }
};
