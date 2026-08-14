import fs from 'fs';
import path from 'path';

interface ExpenseClaimData {
  id: number;
  category: string;
  amount: number;
  description: string;
  date: Date | string;
  submittedOn?: Date | string;
  status: string;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  employeeId: number;
  employee?: {
    id: number;
    firstName: string;
    lastName: string;
    employeeCode: string;
    designation?: string | null;
    department?: { name: string } | null;
    office?: { name: string } | null;
  } | null;
}

interface ReviewDetails {
  reviewedBy?: string;
  reviewNote?: string;
  reviewedAt?: Date;
}

export class ExpenseReceiptService {
  /**
   * Generates a professional A4 Expense Claim Receipt PDF using pdfmake and saves it to storage.
   */
  public async generateExpenseReceipt(
    expense: ExpenseClaimData,
    employee: any,
    reviewDetails: ReviewDetails = {}
  ): Promise<{ pdfBuffer: Buffer; relativeUrl: string; filename: string }> {
    const PdfPrinter = require('pdfmake');
    const printer = new PdfPrinter({
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    });

    const timestamp = Date.now();
    const receiptNo = `EXP-RECEIPT-${expense.id}-${timestamp}`;
    const filename = `expenseclaimreceipt_${expense.id}_${timestamp}.pdf`;
    
    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), 'uploads', 'receipts');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const filePath = path.join(uploadsDir, filename);
    const relativeUrl = `/uploads/receipts/${filename}`;

    const fmtCurrency = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const fmtDate = (d?: Date | string | null) => {
      if (!d) return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
      return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    };

    const empName = employee ? `${employee.firstName} ${employee.lastName}` : (expense.employee ? `${expense.employee.firstName} ${expense.employee.lastName}` : 'N/A');
    const empCode = employee?.employeeCode || expense.employee?.employeeCode || `EMP-${expense.employeeId}`;
    const deptName = employee?.department?.name || expense.employee?.department?.name || 'General';
    const designation = employee?.designation || expense.employee?.designation || 'Employee';
    const officeName = employee?.office?.name || expense.employee?.office?.name || 'Main Office';

    const approvalDate = fmtDate(reviewDetails.reviewedAt);
    const claimDate = fmtDate(expense.date);
    const reviewer = reviewDetails.reviewedBy || expense.reviewedBy || 'HR Administration';
    const note = reviewDetails.reviewNote || expense.reviewNote || 'Approved for reimbursement';

    const docDefinition: any = {
      pageSize: 'A4',
      pageMargins: [36, 36, 36, 56],
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: 'HRM Portal  •  Official Reimbursement Receipt  •  Digitally Verified', fontSize: 8, color: '#6B7280', alignment: 'left' },
          { text: `Generated: ${approvalDate}  •  Page ${currentPage} of ${pageCount}`, fontSize: 8, color: '#6B7280', alignment: 'right' },
        ],
        margin: [36, 0, 36, 0],
      }),
      content: [
        // Header Banner
        {
          canvas: [
            { type: 'rect', x: -36, y: -36, w: 595, h: 84, color: '#4F46E5' },
            { type: 'rect', x: -36, y: 48, w: 595, h: 6, color: '#3730A3' },
          ],
        },
        {
          columns: [
            {
              stack: [
                { text: 'HRM ENTERPRISE PORTAL', fontSize: 9, color: 'white', opacity: 0.8, margin: [0, -74, 0, 2] },
                { text: 'EXPENSE CLAIM RECEIPT', fontSize: 18, bold: true, color: 'white', margin: [0, 0, 0, 2] },
                { text: `Receipt No: ${receiptNo}`, fontSize: 9, color: 'white', opacity: 0.9 },
              ],
            },
            {
              stack: [
                { text: 'STATUS: APPROVED', fontSize: 12, bold: true, color: '#10B981', alignment: 'right', margin: [0, -72, 0, 4] },
                { text: `Approved Date: ${approvalDate}`, fontSize: 9, color: 'white', opacity: 0.85, alignment: 'right' },
              ],
            },
          ],
          margin: [0, 0, 0, 24],
        },

        // Employee & Claim Metadata Header Section
        {
          columns: [
            {
              stack: [
                { text: 'EMPLOYEE INFORMATION', fontSize: 9, bold: true, color: '#4F46E5', margin: [0, 0, 0, 6] },
                { text: [{ text: 'Name: ', bold: true, fontSize: 9 }, { text: empName, fontSize: 9, color: '#1F2937' }] },
                { text: [{ text: 'Employee ID: ', bold: true, fontSize: 9 }, { text: empCode, fontSize: 9, color: '#1F2937' }] },
                { text: [{ text: 'Department: ', bold: true, fontSize: 9 }, { text: deptName, fontSize: 9, color: '#1F2937' }] },
                { text: [{ text: 'Designation: ', bold: true, fontSize: 9 }, { text: designation, fontSize: 9, color: '#1F2937' }] },
                { text: [{ text: 'Office Branch: ', bold: true, fontSize: 9 }, { text: officeName, fontSize: 9, color: '#1F2937' }] },
              ],
              width: '50%',
            },
            {
              stack: [
                { text: 'CLAIM DETAILS', fontSize: 9, bold: true, color: '#4F46E5', margin: [0, 0, 0, 6] },
                { text: [{ text: 'Expense ID: ', bold: true, fontSize: 9 }, { text: `#EXP-${expense.id}`, fontSize: 9, color: '#1F2937' }] },
                { text: [{ text: 'Expense Date: ', bold: true, fontSize: 9 }, { text: claimDate, fontSize: 9, color: '#1F2937' }] },
                { text: [{ text: 'Category: ', bold: true, fontSize: 9 }, { text: expense.category, fontSize: 9, color: '#1F2937' }] },
                { text: [{ text: 'Approved By: ', bold: true, fontSize: 9 }, { text: reviewer, fontSize: 9, color: '#1F2937' }] },
                { text: [{ text: 'Approval Note: ', bold: true, fontSize: 9 }, { text: note, fontSize: 9, color: '#1F2937' }] },
              ],
              width: '50%',
            },
          ],
          margin: [0, 0, 0, 18],
        },

        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1, lineColor: '#E5E7EB' }], margin: [0, 0, 0, 18] },

        // Claim Items Table
        { text: 'Expense Particulars', bold: true, fontSize: 11, color: '#111827', margin: [0, 0, 0, 8] },
        {
          table: {
            headerRows: 1,
            widths: ['*', 90, 110],
            body: [
              [
                { text: 'Description / Item Particulars', style: 'colHeader' },
                { text: 'Category', style: 'colHeader', alignment: 'center' },
                { text: 'Amount (₹)', style: 'colHeader', alignment: 'right' },
              ],
              [
                { text: expense.description || 'Expense Claim Reimbursement', fontSize: 9, color: '#1F2937' },
                { text: expense.category, fontSize: 9, alignment: 'center', color: '#4B5563' },
                { text: fmtCurrency(expense.amount), fontSize: 9, bold: true, alignment: 'right', color: '#111827' },
              ],
              [
                { text: 'Total Approved Reimbursement', fontSize: 9, bold: true, color: '#4F46E5', fillColor: '#EEF2FF', colSpan: 2 },
                {},
                { text: fmtCurrency(expense.amount), fontSize: 10, bold: true, alignment: 'right', color: '#4F46E5', fillColor: '#EEF2FF' },
              ],
            ],
          },
          layout: {
            hLineWidth: (i: number) => (i <= 1 ? 1.5 : 0.5),
            vLineWidth: () => 0,
            hLineColor: (i: number) => (i <= 1 ? '#4F46E5' : '#E5E7EB'),
            paddingLeft: () => 8,
            paddingRight: () => 8,
            paddingTop: () => 7,
            paddingBottom: () => 7,
          },
          margin: [0, 0, 0, 24],
        },

        // Total Summary Highlight Box
        {
          canvas: [
            { type: 'rect', x: 0, y: 0, w: 523, h: 50, color: '#F3F4F6', r: 4 },
            { type: 'rect', x: 0, y: 0, w: 6, h: 50, color: '#10B981', r: 2 },
          ],
        },
        {
          columns: [
            {
              stack: [
                { text: 'APPROVED AMOUNT FOR DISBURSEMENT', fontSize: 8, bold: true, color: '#6B7280', margin: [14, -44, 0, 2] },
                { text: `Status: Claim Verified & Settled`, fontSize: 8, color: '#059669', bold: true, margin: [14, 0, 0, 0] },
              ],
            },
            {
              text: fmtCurrency(expense.amount),
              fontSize: 18,
              bold: true,
              color: '#059669',
              alignment: 'right',
              margin: [0, -46, 12, 0],
            },
          ],
          margin: [0, 0, 0, 28],
        },

        // Verification & Digital Signature Block
        {
          columns: [
            {
              stack: [
                { text: 'Audit & Approval Sign-off', fontSize: 8, bold: true, color: '#374151', margin: [0, 0, 0, 4] },
                { text: `Approved by: ${reviewer}`, fontSize: 8, color: '#6B7280' },
                { text: `Date: ${approvalDate}`, fontSize: 8, color: '#6B7280' },
                { text: `Document Ref: ${receiptNo}`, fontSize: 8, color: '#6B7280' },
              ],
              width: '60%',
            },
            {
              stack: [
                { text: '[ DIGITAL SYSTEM STAMP ]', fontSize: 8, bold: true, color: '#4F46E5', alignment: 'center' },
                { text: 'HOPKID Official Finance Approval', fontSize: 7, color: '#6B7280', alignment: 'center', margin: [0, 2, 0, 0] },
                { text: 'Authenticated & Sealed', fontSize: 7, italics: true, color: '#059669', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              width: '40%',
            },
          ],
          margin: [0, 0, 0, 20],
        },

        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.5, lineColor: '#E5E7EB' }], margin: [0, 0, 0, 12] },
        {
          text: 'This document is a computer-generated official expense reimbursement receipt issued by the HRM System. No physical signature is required.',
          fontSize: 8,
          color: '#9CA3AF',
          italics: true,
          alignment: 'center',
        },
      ],
      styles: {
        colHeader: { fontSize: 8, bold: true, color: 'white', fillColor: '#4F46E5' },
      },
      defaultStyle: { font: 'Roboto', fontSize: 10 },
    };

    return new Promise((resolve, reject) => {
      try {
        const pdfDoc = printer.createPdfKitDocument(docDefinition);
        const writeStream = fs.createWriteStream(filePath);
        const chunks: Buffer[] = [];

        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.pipe(writeStream);

        writeStream.on('finish', () => {
          const pdfBuffer = Buffer.concat(chunks);
          resolve({ pdfBuffer, relativeUrl, filename });
        });

        writeStream.on('error', (err) => {
          reject(err);
        });

        pdfDoc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

export const expenseReceiptService = new ExpenseReceiptService();
export default expenseReceiptService;
