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
          { text: 'HopKid HRM Enterprise Portal  •  Official Reimbursement Receipt  •  Digitally Verified', fontSize: 8, color: '#64748B', alignment: 'left' },
          { text: `Generated: ${approvalDate}  •  Page ${currentPage} of ${pageCount}`, fontSize: 8, color: '#64748B', alignment: 'right' },
        ],
        margin: [36, 0, 36, 0],
      }),
      content: [
        // ─── Modern Header Banner ───────────────────────────────────────────
        {
          canvas: [
            { type: 'rect', x: -36, y: -36, w: 595, h: 86, color: '#1E293B' },
            { type: 'rect', x: -36, y: 50, w: 595, h: 4, color: '#3BA38B' },
          ],
        },
        {
          columns: [
            {
              stack: [
                { text: 'HOPKID ENTERPRISE PORTAL', fontSize: 9, bold: true, color: '#3BA38B', margin: [0, -74, 0, 2] },
                { text: 'EXPENSE REIMBURSEMENT RECEIPT', fontSize: 16, bold: true, color: '#FFFFFF', margin: [0, 0, 0, 2] },
                { text: `Receipt Ref: ${receiptNo}`, fontSize: 8.5, color: '#94A3B8' },
              ],
            },
            {
              stack: [
                { text: 'STATUS: APPROVED', fontSize: 11, bold: true, color: '#10B981', alignment: 'right', margin: [0, -72, 0, 4] },
                { text: `Approval Date: ${approvalDate}`, fontSize: 8.5, color: '#CBD5E1', alignment: 'right' },
              ],
            },
          ],
          margin: [0, 0, 0, 24],
        },

        // ─── Dual Metadata Cards Section ─────────────────────────────────────
        {
          columns: [
            {
              stack: [
                { text: 'EMPLOYEE INFORMATION', fontSize: 9, bold: true, color: '#3BA38B', margin: [0, 0, 0, 6] },
                { text: [{ text: 'Employee Name: ', bold: true, fontSize: 9, color: '#334155' }, { text: empName, fontSize: 9, color: '#0F172A' }] },
                { text: [{ text: 'Employee ID: ', bold: true, fontSize: 9, color: '#334155' }, { text: empCode, fontSize: 9, color: '#0F172A' }] },
                { text: [{ text: 'Department: ', bold: true, fontSize: 9, color: '#334155' }, { text: deptName, fontSize: 9, color: '#0F172A' }] },
                { text: [{ text: 'Designation: ', bold: true, fontSize: 9, color: '#334155' }, { text: designation, fontSize: 9, color: '#0F172A' }] },
                { text: [{ text: 'Store / Branch: ', bold: true, fontSize: 9, color: '#334155' }, { text: officeName, fontSize: 9, color: '#0F172A' }] },
              ],
              width: '48%',
            },
            { text: '', width: '4%' },
            {
              stack: [
                { text: 'CLAIM SUMMARY', fontSize: 9, bold: true, color: '#3BA38B', margin: [0, 0, 0, 6] },
                { text: [{ text: 'Expense Claim ID: ', bold: true, fontSize: 9, color: '#334155' }, { text: `#EXP-${expense.id}`, fontSize: 9, color: '#0F172A' }] },
                { text: [{ text: 'Expense Date: ', bold: true, fontSize: 9, color: '#334155' }, { text: claimDate, fontSize: 9, color: '#0F172A' }] },
                { text: [{ text: 'Expense Category: ', bold: true, fontSize: 9, color: '#334155' }, { text: expense.category, fontSize: 9, color: '#0F172A' }] },
                { text: [{ text: 'Approved By: ', bold: true, fontSize: 9, color: '#334155' }, { text: reviewer, fontSize: 9, color: '#0F172A' }] },
                { text: [{ text: 'Review Remarks: ', bold: true, fontSize: 9, color: '#334155' }, { text: note, fontSize: 9, color: '#0F172A' }] },
              ],
              width: '48%',
            },
          ],
          margin: [0, 0, 0, 20],
        },

        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1, lineColor: '#E2E8F0' }], margin: [0, 0, 0, 18] },

        // ─── Line Items Breakdown Table ──────────────────────────────────────
        { text: 'Claim Particulars & Itemized Breakdown', bold: true, fontSize: 11, color: '#0F172A', margin: [0, 0, 0, 8] },
        {
          table: {
            headerRows: 1,
            widths: ['*', 100, 110],
            body: [
              [
                { text: 'Particulars & Description', style: 'colHeader' },
                { text: 'Category', style: 'colHeader', alignment: 'center' },
                { text: 'Amount (₹)', style: 'colHeader', alignment: 'right' },
              ],
              [
                { text: expense.description || 'Official Business Expense Reimbursement', fontSize: 9, color: '#1E293B' },
                { text: expense.category, fontSize: 9, alignment: 'center', color: '#475569' },
                { text: fmtCurrency(expense.amount), fontSize: 9, bold: true, alignment: 'right', color: '#0F172A' },
              ],
              [
                { text: 'Total Approved Reimbursement Amount', fontSize: 9, bold: true, color: '#1E293B', fillColor: '#F1F5F9', colSpan: 2 },
                {},
                { text: fmtCurrency(expense.amount), fontSize: 10, bold: true, alignment: 'right', color: '#3BA38B', fillColor: '#F1F5F9' },
              ],
            ],
          },
          layout: {
            hLineWidth: (i: number) => (i <= 1 ? 1.5 : 0.5),
            vLineWidth: () => 0,
            hLineColor: (i: number) => (i <= 1 ? '#3BA38B' : '#E2E8F0'),
            paddingLeft: () => 10,
            paddingRight: () => 10,
            paddingTop: () => 8,
            paddingBottom: () => 8,
          },
          margin: [0, 0, 0, 24],
        },

        // ─── Approved Disbursement Highlight Container ───────────────────────
        {
          canvas: [
            { type: 'rect', x: 0, y: 0, w: 523, h: 48, color: '#F8FAFC', r: 6 },
            { type: 'rect', x: 0, y: 0, w: 6, h: 48, color: '#3BA38B', r: 2 },
          ],
        },
        {
          columns: [
            {
              stack: [
                { text: 'TOTAL REIMBURSED AMOUNT', fontSize: 8, bold: true, color: '#64748B', margin: [14, -42, 0, 2] },
                { text: 'Status: Claim Verified & Settled', fontSize: 8, color: '#059669', bold: true, margin: [14, 0, 0, 0] },
              ],
            },
            {
              text: fmtCurrency(expense.amount),
              fontSize: 17,
              bold: true,
              color: '#3BA38B',
              alignment: 'right',
              margin: [0, -44, 14, 0],
            },
          ],
          margin: [0, 0, 0, 28],
        },

        // ─── Digital Signature & Stamp Block ─────────────────────────────────
        {
          columns: [
            {
              stack: [
                { text: 'Audit & Verification Sign-off', fontSize: 8.5, bold: true, color: '#334155', margin: [0, 0, 0, 4] },
                { text: `Approved by: ${reviewer}`, fontSize: 8, color: '#64748B' },
                { text: `Date: ${approvalDate}`, fontSize: 8, color: '#64748B' },
                { text: `Document Ref: ${receiptNo}`, fontSize: 8, color: '#64748B' },
              ],
              width: '60%',
            },
            {
              stack: [
                { text: '[ DIGITAL SYSTEM STAMP ]', fontSize: 8, bold: true, color: '#4F46E5', alignment: 'center' },
                { text: 'HOPKID Official Finance Approval', fontSize: 7, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
                { text: 'Authenticated & Sealed', fontSize: 7, italics: true, color: '#059669', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              width: '40%',
            },
          ],
          margin: [0, 0, 0, 20],
        },

        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.5, lineColor: '#E2E8F0' }], margin: [0, 0, 0, 12] },
        {
          text: 'This document is a computer-generated official expense reimbursement receipt issued by HopKid HRM Portal. No physical signature is required.',
          fontSize: 7.5,
          color: '#94A3B8',
          italics: true,
          alignment: 'center',
        },
      ],
      styles: {
        colHeader: { fontSize: 8.5, bold: true, color: 'white', fillColor: '#3BA38B' },
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
