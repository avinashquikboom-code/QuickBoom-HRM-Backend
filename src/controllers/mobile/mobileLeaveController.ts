import { Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { Prisma } from '@prisma/client';
const pdfmake = require('pdfmake');

// Fetch employee's own leave requests and balances
export const fetchMyLeaves = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        leaveRequests: {
          orderBy: { appliedOn: 'desc' },
        },
      },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    // Calculate leave balances
    const leaveBalances = {
      casual: {
        total: 12,
        used: employee.leaveRequests
          .filter(l => l.status === 'APPROVED' && l.type === 'CASUAL')
          .reduce((sum, l) => {
            const days = Math.ceil((l.toDate.getTime() - l.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            return sum + days;
          }, 0),
        remaining: 0,
      },
      sick: {
        total: 10,
        used: employee.leaveRequests
          .filter(l => l.status === 'APPROVED' && l.type === 'SICK')
          .reduce((sum, l) => {
            const days = Math.ceil((l.toDate.getTime() - l.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            return sum + days;
          }, 0),
        remaining: 0,
      },
      earned: {
        total: 15,
        used: employee.leaveRequests
          .filter(l => l.status === 'APPROVED' && l.type === 'EARNED')
          .reduce((sum, l) => {
            const days = Math.ceil((l.toDate.getTime() - l.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            return sum + days;
          }, 0),
        remaining: 0,
      },
    };

    // Calculate remaining
    leaveBalances.casual.remaining = Math.max(0, leaveBalances.casual.total - leaveBalances.casual.used);
    leaveBalances.sick.remaining = Math.max(0, leaveBalances.sick.total - leaveBalances.sick.used);
    leaveBalances.earned.remaining = Math.max(0, leaveBalances.earned.total - leaveBalances.earned.used);

    const leaveRequests = employee.leaveRequests.map(l => ({
      id: l.id.toString(),
      type: l.type,
      typeLabel: l.type === 'CASUAL' ? 'Casual Leave' : l.type === 'SICK' ? 'Sick Leave' : 'Earned Leave',
      fromDate: l.fromDate.toISOString().split('T')[0],
      toDate: l.toDate.toISOString().split('T')[0],
      reason: l.reason,
      status: l.status,
      statusLabel: l.status.charAt(0) + l.status.slice(1).toLowerCase(),
      appliedOn: l.appliedOn.toISOString().split('T')[0],
      reviewedBy: l.reviewedBy,
      reviewNote: l.reviewNote,
      days: Math.ceil((l.toDate.getTime() - l.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
    }));

    res.json({
      success: true,
      data: {
        employee: {
          id: employee.id.toString(),
          employeeCode: employee.employeeCode,
          name: `${employee.firstName} ${employee.lastName}`,
          designation: employee.designation,
        },
        leaveRequests,
        leaveBalances,
      },
    });
  } catch (error) {
    console.error('Fetch my leaves error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch leave data' });
  }
};

// Apply for leave
export const applyLeave = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { type, fromDate, toDate, reason } = req.body;

    if (!type || !fromDate || !toDate || !reason) {
      res.status(400).json({ success: false, message: 'All fields are required' });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    // Check for overlapping leave requests
    const existingLeave = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: { in: ['PENDING', 'APPROVED'] },
        OR: [
          {
            fromDate: { lte: new Date(fromDate) },
            toDate: { gte: new Date(fromDate) },
          },
          {
            fromDate: { lte: new Date(toDate) },
            toDate: { gte: new Date(toDate) },
          },
          {
            fromDate: { gte: new Date(fromDate) },
            toDate: { lte: new Date(toDate) },
          },
        ],
      },
    });

    if (existingLeave) {
      res.status(400).json({ success: false, message: 'Leave already exists for this period' });
      return;
    }

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        type: type.toUpperCase(),
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
        reason: reason.trim(),
        status: 'PENDING',
        appliedOn: new Date(),
      },
    });

    res.status(201).json({
      success: true,
      message: 'Leave request submitted successfully',
      data: {
        id: leaveRequest.id.toString(),
        type: leaveRequest.type,
        fromDate: leaveRequest.fromDate.toISOString().split('T')[0],
        toDate: leaveRequest.toDate.toISOString().split('T')[0],
        reason: leaveRequest.reason,
        status: leaveRequest.status,
        appliedOn: leaveRequest.appliedOn.toISOString().split('T')[0],
      },
    });
  } catch (error) {
    console.error('Apply leave error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply for leave' });
  }
};

// Generate leave report PDF for download (Employee - own leaves)
export const downloadMyLeaveReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        leaveRequests: {
          orderBy: { appliedOn: 'desc' },
        },
        office: true,
      },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    // Generate PDF content
    const fonts = {
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    };
    const printer = new pdfmake(fonts);

    const leaveData = employee.leaveRequests.map(lr => ({
      type: lr.type,
      typeLabel: lr.type === 'CASUAL' ? 'Casual Leave' : lr.type === 'SICK' ? 'Sick Leave' : 'Earned Leave',
      fromDate: lr.fromDate.toISOString().split('T')[0],
      toDate: lr.toDate.toISOString().split('T')[0],
      days: Math.ceil((lr.toDate.getTime() - lr.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      status: lr.status,
      reason: lr.reason,
      appliedOn: lr.appliedOn.toISOString().split('T')[0],
      reviewedBy: lr.reviewedBy || 'Pending',
    }));

    const docDefinition = {
      content: [
        { text: 'Leave Report', style: 'header' },
        { text: `Employee: ${employee.firstName} ${employee.lastName}`, style: 'subheader' },
        { text: `Employee Code: ${employee.employeeCode}`, style: 'subheader' },
        { text: `Designation: ${employee.designation}`, style: 'subheader' },
        { text: `Office: ${employee.office?.name || 'N/A'}`, style: 'subheader' },
        { text: `Generated on: ${new Date().toLocaleDateString()}`, style: 'subheader' },
        { text: '', margin: [0, 20] },
        
        { text: 'Leave History', style: 'tableHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['*', '*', '*', '*', '*', '*'],
            body: [
              ['Type', 'From Date', 'To Date', 'Days', 'Status', 'Reviewed By'],
              ...leaveData.map(lr => [
                lr.typeLabel,
                lr.fromDate,
                lr.toDate,
                lr.days.toString(),
                lr.status,
                lr.reviewedBy
              ])
            ]
          }
        }
      ],
      styles: {
        header: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
        subheader: { fontSize: 12, margin: [0, 5, 0, 5] },
        tableHeader: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] }
      }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="leave-report-${employee.employeeCode}-${new Date().toISOString().split('T')[0]}.pdf"`);
    
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error('Download my leave report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate leave report' });
  }
};

// Generate leave report PDF for HR (all employees or specific employee)
export const downloadLeaveReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, startDate, endDate } = req.query;

    // Check if user is HR or Admin
    if (req.user?.role !== 'HR' && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    let whereClause: any = {};
    
    if (employeeId) {
      whereClause.employeeId = parseInt(employeeId as string);
    }
    
    if (startDate && endDate) {
      whereClause.appliedOn = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }

    const leaveRequests = await prisma.leaveRequest.findMany({
      where: whereClause,
      include: {
        employee: {
          include: {
            office: true,
          },
        },
      },
      orderBy: { appliedOn: 'desc' },
    });

    const leaveData = leaveRequests.map(lr => ({
      employeeName: `${lr.employee.firstName} ${lr.employee.lastName}`,
      employeeCode: lr.employee.employeeCode,
      designation: lr.employee.designation,
      office: lr.employee.office?.name || 'N/A',
      type: lr.type,
      typeLabel: lr.type === 'CASUAL' ? 'Casual Leave' : lr.type === 'SICK' ? 'Sick Leave' : 'Earned Leave',
      fromDate: lr.fromDate.toISOString().split('T')[0],
      toDate: lr.toDate.toISOString().split('T')[0],
      days: Math.ceil((lr.toDate.getTime() - lr.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      status: lr.status,
      reason: lr.reason,
      appliedOn: lr.appliedOn.toISOString().split('T')[0],
      reviewedBy: lr.reviewedBy || 'Pending',
    }));

    // Generate PDF content
    const fonts = {
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    };
    const printer = new pdfmake(fonts);

    const docDefinition = {
      content: [
        { text: 'Leave Report', style: 'header' },
        { text: `Generated by: HR Manager`, style: 'subheader' },
        { text: `Generated on: ${new Date().toLocaleDateString()}`, style: 'subheader' },
        { text: `Total Records: ${leaveData.length}`, style: 'subheader' },
        { text: '', margin: [0, 20] },
        
        { text: 'Leave History', style: 'tableHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['*', '*', '*', '*', '*', '*', '*', '*', '*'],
            body: [
              ['Employee', 'Code', 'Designation', 'Type', 'From', 'To', 'Days', 'Status', 'Reviewed By'],
              ...leaveData.map(lr => [
                lr.employeeName,
                lr.employeeCode,
                lr.designation,
                lr.typeLabel,
                lr.fromDate,
                lr.toDate,
                lr.days.toString(),
                lr.status,
                lr.reviewedBy
              ])
            ]
          }
        }
      ],
      styles: {
        header: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
        subheader: { fontSize: 12, margin: [0, 5, 0, 5] },
        tableHeader: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] }
      }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="hr-leave-report-${new Date().toISOString().split('T')[0]}.pdf"`);
    
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error('Download leave report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate leave report' });
  }
};
