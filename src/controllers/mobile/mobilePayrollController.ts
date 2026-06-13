import { Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
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
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const payslips = await (prisma as any).payslip.findMany({
      where: { employeeId: employee.id },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' }
      ]
    });

    res.json({
      success: true,
      data: payslips
    });
  } catch (error) {
    console.error('Get my payslips error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve payslips.'
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
    const payslipId = parseInt(id as string, 10);

    if (isNaN(payslipId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid payslip ID.'
      });
      return;
    }

    const payslip = await (prisma as any).payslip.findUnique({
      where: { id: payslipId },
      include: { employee: true }
    });

    if (!payslip) {
      res.status(404).json({
        success: false,
        message: 'Payslip not found.'
      });
      return;
    }

    // Verify employee authorization: Employees can only download their own payslips
    if (req.user?.role === 'EMPLOYEE') {
      const employee = await prisma.employee.findFirst({
        where: { userId: req.user.id }
      });
      if (!employee || employee.id !== payslip.employeeId) {
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

    // Compute detailed salary components matching the UI model
    const basic = payslip.baseSalary;
    const hra = Math.round(basic * 0.40);
    const ta = Math.round(basic * 0.10);
    const special = Math.max(0, payslip.allowance - hra - ta);
    const grossEarnings = basic + hra + ta + special;
    const pf = Math.round(basic * 0.12);
    const pt = 200;
    const tds = Math.max(0, payslip.deductions - pf - pt);
    const totalDeductions = pf + pt + tds;

    const docDefinition = {
      content: [
        // Title Header
        { text: 'QUICKBOOM HRM', style: 'companyName', alignment: 'center' },
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
                    { text: 'Employee Name: ', bold: true }, payslip.employeeName, '\n',
                    { text: 'Employee Code: ', bold: true }, payslip.employeeCode, '\n',
                    { text: 'Designation:   ', bold: true }, payslip.designation, '\n',
                    { text: 'Department:    ', bold: true }, payslip.department
                  ],
                  margin: [5, 5, 5, 5]
                },
                {
                  text: [
                    { text: 'Office / Branch: ', bold: true }, payslip.officeName, '\n',
                    { text: 'Pay Period:      ', bold: true }, periodLabel, '\n',
                    { text: 'Document ID:     ', bold: true }, `QB-PAY-${payslip.employeeCode}-${payslip.year}${String(payslip.month).padStart(2, '0')}`, '\n',
                    { text: 'Status:          ', bold: true }, 'PAID'
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
            body: [
              // Table Headers
              [
                { text: 'Earnings', bold: true, fillColor: '#f3f4f6' },
                { text: 'Amount (INR)', bold: true, alignment: 'right', fillColor: '#f3f4f6' },
                { text: 'Deductions', bold: true, fillColor: '#f3f4f6' },
                { text: 'Amount (INR)', bold: true, alignment: 'right', fillColor: '#f3f4f6' }
              ],
              // Row 1
              [
                { text: 'Basic Salary' },
                { text: `Rs. ${basic.toLocaleString('en-IN')}`, alignment: 'right' },
                { text: 'Provident Fund (PF)' },
                { text: `Rs. ${pf.toLocaleString('en-IN')}`, alignment: 'right' }
              ],
              // Row 2
              [
                { text: 'House Rent Allowance (HRA)' },
                { text: `Rs. ${hra.toLocaleString('en-IN')}`, alignment: 'right' },
                { text: 'Professional Tax (PT)' },
                { text: `Rs. ${pt.toLocaleString('en-IN')}`, alignment: 'right' }
              ],
              // Row 3
              [
                { text: 'Travel Allowance (TA)' },
                { text: `Rs. ${ta.toLocaleString('en-IN')}`, alignment: 'right' },
                { text: 'Income Tax / TDS' },
                { text: `Rs. ${tds.toLocaleString('en-IN')}`, alignment: 'right' }
              ],
              // Row 4
              [
                { text: 'Special Allowance' },
                { text: `Rs. ${special.toLocaleString('en-IN')}`, alignment: 'right' },
                { text: '' },
                { text: '' }
              ],
              // Totals
              [
                { text: 'Gross Earnings', bold: true, fillColor: '#f9fafb' },
                { text: `Rs. ${grossEarnings.toLocaleString('en-IN')}`, bold: true, alignment: 'right', fillColor: '#f9fafb' },
                { text: 'Total Deductions', bold: true, fillColor: '#f9fafb' },
                { text: `Rs. ${totalDeductions.toLocaleString('en-IN')}`, bold: true, alignment: 'right', fillColor: '#f9fafb' }
              ]
            ]
          },
          layout: 'grid'
        },
        
        // Net pay block
        {
          margin: [0, 25, 0, 0],
          table: {
            widths: ['*'],
            body: [
              [
                {
                  fillColor: PRIMARY_COLOR,
                  color: 'white',
                  text: [
                    { text: 'NET TAKE-HOME PAY\n', fontSize: 10, bold: true },
                    { text: `INR ${payslip.netSalary.toLocaleString('en-IN')}/-`, fontSize: 18, bold: true },
                    { text: `\nIn Words: ${payslip.netInWords}`, fontSize: 9, italics: true }
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
          margin: [0, 50, 0, 0] 
        }
      ],
      styles: {
        companyName: { fontSize: 20, bold: true, color: PRIMARY_COLOR },
        companySub: { fontSize: 9, color: '#6b7280' },
        docTitle: { fontSize: 14, bold: true, decoration: 'underline', color: '#111827' },
        sectionHeader: { fontSize: 12, bold: true, color: '#374151' },
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
