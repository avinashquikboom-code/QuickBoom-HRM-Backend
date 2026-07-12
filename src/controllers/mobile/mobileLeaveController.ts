import { Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { Prisma } from '@prisma/client';
import { pushNotificationService } from '../../services/pushNotificationService';
import { getWebSocketInstance } from '../../utils/websocketSingleton';
import leaveBalanceService from '../../services/leaveBalanceService';
const PdfPrinter = require('pdfmake');

// Primary color for all PDF reports
const PRIMARY_COLOR = '#3BA38B';

// Fetch employee's own leave requests and balances (including HR-applied leaves)
export const fetchMyLeaves = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    // Fetch all leave requests for this employee (including those applied by HR)
    const allLeaveRequests = await prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { appliedOn: 'desc' },
    });

    // Calculate leave balances
    const leaveBalances = {
      casual: {
        total: 12,
        used: allLeaveRequests
          .filter(l => l.status === 'APPROVED' && l.type === 'CASUAL')
          .reduce((sum, l) => {
            const days = Math.ceil((l.toDate.getTime() - l.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            return sum + days;
          }, 0),
        remaining: 0,
      },
      sick: {
        total: 10,
        used: allLeaveRequests
          .filter(l => l.status === 'APPROVED' && l.type === 'SICK')
          .reduce((sum, l) => {
            const days = Math.ceil((l.toDate.getTime() - l.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            return sum + days;
          }, 0),
        remaining: 0,
      },
      earned: {
        total: 15,
        used: allLeaveRequests
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

    const leaveRequests = allLeaveRequests.map(l => ({
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

    // Send real-time notifications to all HR users
    try {
      // Get all HR users
      const hrUsers = await prisma.user.findMany({
        where: {
          role: { in: ['HR', 'SUPER_ADMIN', 'PLATFORM_ADMIN'] },
          isActive: true
        },
        include: {
          employee: true
        }
      });

      // Create notifications for all HR users
      const notificationPromises = hrUsers.map(hrUser => 
        prisma.notification.create({
          data: {
            userId: hrUser.id,
            title: 'New Leave Application',
            body: `${employee.firstName} ${employee.lastName} requested for ${type.toLowerCase()} leave from ${fromDate} to ${toDate}`,
            category: 'LEAVE',
            actionId: leaveRequest.id.toString(),
            actionType: 'LEAVE_APPLICATION',
            isRead: false,
          }
        })
      );

      await Promise.all(notificationPromises);

      // Broadcast real-time WebSocket event to HR users
      try {
        await getWebSocketInstance().broadcastToRole('HR', {
          type: 'new_leave_application',
          leaveRequest: {
            id: leaveRequest.id.toString(),
            employee: {
              id: employee.id.toString(),
              name: `${employee.firstName} ${employee.lastName}`,
              employeeCode: employee.employeeCode,
              designation: employee.designation
            },
            type: leaveRequest.type,
            typeLabel: leaveRequest.type === 'CASUAL' ? 'Casual Leave' : leaveRequest.type === 'SICK' ? 'Sick Leave' : 'Earned Leave',
            fromDate: leaveRequest.fromDate.toISOString().split('T')[0],
            toDate: leaveRequest.toDate.toISOString().split('T')[0],
            reason: leaveRequest.reason,
            status: leaveRequest.status,
            appliedOn: leaveRequest.appliedOn.toISOString(),
            days: Math.ceil((leaveRequest.toDate.getTime() - leaveRequest.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
          },
          timestamp: new Date().toISOString()
        });
        console.log(`✅ Real-time notification sent to HR users for leave application by ${employee.firstName} ${employee.lastName}`);
      } catch (wsError) {
        console.error('❌ Failed to broadcast WebSocket event:', wsError);
      }

      // Send Firebase Push Notifications to HR/Admin users
      try {
        const hrUserIds = hrUsers.map(u => u.id);
        const pushTitle = 'New Leave Application';
        const pushBody = `New leave request from ${employee.firstName} ${employee.lastName}`;
        pushNotificationService.sendPush(
          hrUserIds,
          pushTitle,
          pushBody,
          {
            screen: 'leave_requests',
            id: leaveRequest.id.toString()
          }
        ).catch(err => console.error('Failed to send mobile HR push notification:', err));
      } catch (pushError) {
        console.error('Failed to send FCM push notifications for leave request:', pushError);
      }
    } catch (notificationError) {
      console.error('❌ Failed to send HR notifications:', notificationError);
      // Don't fail the request if notifications fail
    }

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
    const printer = new PdfPrinter(fonts);

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
    const printer = new PdfPrinter(fonts);

    const docDefinition = {
      pageOrientation: 'landscape',
      pageMargins: [20, 80, 20, 20],
      content: [
        // Header with colored background using app primary color
        {
          canvas: [
            {
              type: 'rect',
              x: -20,
              y: -80,
              w: 842,
              h: 70,
              color: PRIMARY_COLOR
            }
          ]
        },
        {
          text: 'Leave Report',
          style: 'header',
          color: 'white',
          margin: [0, -60, 0, 0]
        },
        {
          text: `Generated by: HR Manager`,
          style: 'subheader',
          color: 'white',
          margin: [0, 5, 0, 0]
        },
        {
          text: `Generated on: ${new Date().toLocaleDateString()}`,
          style: 'subheader',
          color: 'white',
          margin: [0, 0, 0, 10]
        },
        { text: '', margin: [0, 15] },
        
        { text: 'Leave History', style: 'tableHeader' },
        {
          table: {
            headerRows: 1,
            widths: [110, 60, 75, 65, 65, 65, 35, 55, 75],
            body: [
              [
                { text: 'Employee Name', style: 'tableHeaderCell', color: 'white' },
                { text: 'Code', style: 'tableHeaderCell', color: 'white' },
                { text: 'Designation', style: 'tableHeaderCell', color: 'white' },
                { text: 'Type', style: 'tableHeaderCell', color: 'white' },
                { text: 'From', style: 'tableHeaderCell', color: 'white' },
                { text: 'To', style: 'tableHeaderCell', color: 'white' },
                { text: 'Days', style: 'tableHeaderCell', color: 'white' },
                { text: 'Status', style: 'tableHeaderCell', color: 'white' },
                { text: 'Reviewed By', style: 'tableHeaderCell', color: 'white' }
              ],
              ...leaveData.map((lr, index) => [
                { text: lr.employeeName, style: index % 2 === 0 ? 'tableCell' : 'tableCellAlt' },
                { text: lr.employeeCode, style: index % 2 === 0 ? 'tableCell' : 'tableCellAlt' },
                { text: lr.designation, style: index % 2 === 0 ? 'tableCell' : 'tableCellAlt' },
                { text: lr.typeLabel, style: index % 2 === 0 ? 'tableCell' : 'tableCellAlt' },
                { text: lr.fromDate, style: index % 2 === 0 ? 'tableCell' : 'tableCellAlt' },
                { text: lr.toDate, style: index % 2 === 0 ? 'tableCell' : 'tableCellAlt' },
                { text: lr.days.toString(), style: index % 2 === 0 ? 'tableCell' : 'tableCellAlt', alignment: 'center' },
                { text: lr.status, style: index % 2 === 0 ? 'tableCell' : 'tableCellAlt', alignment: 'center' },
                { text: lr.reviewedBy, style: index % 2 === 0 ? 'tableCell' : 'tableCellAlt' }
              ])
            ]
          },
          layout: {
            hLineWidth: (i: number) => i === 0 || i === 1 ? 1 : 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#E5E7EB',
            vLineColor: () => '#E5E7EB',
            paddingTop: () => 8,
            paddingBottom: () => 8,
            paddingLeft: () => 8,
            paddingRight: () => 8
          }
        }
      ],
      styles: {
        header: { fontSize: 24, bold: true, margin: [0, 0, 0, 5] },
        subheader: { fontSize: 11, margin: [0, 2, 0, 2] },
        tableHeader: { fontSize: 16, bold: true, margin: [0, 10, 0, 10], color: '#111827' },
        tableHeaderCell: { fontSize: 10, bold: true },
        tableCell: { fontSize: 9, color: '#111827' },
        tableCellAlt: { fontSize: 9, color: '#111827', fillColor: '#F3F4F6' }
      },
      defaultStyle: {
        font: 'Roboto'
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

// Fetch leave requests for HR approval
export const fetchHRLeaveRequests = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Verify user has HR role
    if (req.user?.role !== 'HR' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'PLATFORM_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const { status, employeeId } = req.query;
    
    let whereClause: any = {};
    
    if (status && status !== 'All') {
      whereClause.status = status;
    }
    
    if (employeeId) {
      whereClause.employeeId = parseInt(employeeId as string);
    }

    const leaveRequests = await prisma.leaveRequest.findMany({
      where: whereClause,
      include: {
        employee: {
          include: {
            user: true,
            office: true,
            department: true
          }
        }
      },
      orderBy: { appliedOn: 'desc' }
    });

    const formattedRequests = leaveRequests.map(lr => ({
      id: lr.id.toString(),
      type: lr.type,
      typeLabel: lr.type === 'CASUAL' ? 'Casual Leave' : lr.type === 'SICK' ? 'Sick Leave' : 'Earned Leave',
      fromDate: lr.fromDate.toISOString().split('T')[0],
      toDate: lr.toDate.toISOString().split('T')[0],
      reason: lr.reason,
      status: lr.status,
      statusLabel: lr.status.charAt(0) + lr.status.slice(1).toLowerCase(),
      appliedOn: lr.appliedOn.toISOString().split('T')[0],
      reviewedBy: lr.reviewedBy,
      reviewNote: lr.reviewNote,
      days: Math.ceil((lr.toDate.getTime() - lr.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      employee: {
        id: lr.employee.id.toString(),
        employeeCode: lr.employee.employeeCode,
        name: `${lr.employee.firstName} ${lr.employee.lastName}`,
        firstName: lr.employee.firstName,
        lastName: lr.employee.lastName,
        designation: lr.employee.designation,
        email: lr.employee.user?.email || '',
        office: lr.employee.office?.name || 'N/A',
        department: lr.employee.department?.name || 'N/A'
      }
    }));

    res.json({
      success: true,
      data: {
        leaveRequests: formattedRequests,
        summary: {
          total: formattedRequests.length,
          pending: formattedRequests.filter(lr => lr.status === 'PENDING').length,
          approved: formattedRequests.filter(lr => lr.status === 'APPROVED').length,
          rejected: formattedRequests.filter(lr => lr.status === 'REJECTED').length
        }
      }
    });
  } catch (error) {
    console.error('Fetch HR leave requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch leave requests' });
  }
};

// Approve leave request (mobile HR)
export const approveLeaveRequest = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { reviewerName, reviewNote } = req.body;

    // Verify user has HR role
    if (req.user?.role !== 'HR' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'PLATFORM_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    // Get leave request details before updating
    const existingLeave = await prisma.leaveRequest.findUnique({
      where: { id: parseInt(id as string, 10) },
      include: {
        employee: {
          include: {
            user: true
          }
        }
      }
    });

    if (!existingLeave) {
      res.status(404).json({ success: false, message: 'Leave request not found' });
      return;
    }

    // Update leave request status
    const leave = await prisma.leaveRequest.update({
      where: { id: parseInt(id as string, 10) },
      data: {
        status: 'APPROVED',
        reviewedBy: reviewerName || req.user?.email || 'HR',
        reviewNote: reviewNote || 'Approved via mobile',
        reviewedAt: new Date(),
      },
      include: {
        employee: {
          include: {
            user: true
          }
        }
      }
    });

    // Send notification to employee
    await prisma.notification.create({
      data: {
        employeeId: existingLeave.employee.id,
        userId: existingLeave.employee.userId,
        title: 'Leave Request Approved',
        body: `Your leave request from ${leave.fromDate.toDateString()} to ${leave.toDate.toDateString()} has been approved by ${reviewerName || 'HR'}.`,
        category: 'LEAVE',
        actionId: leave.id.toString(),
        actionType: 'LEAVE_APPROVED',
        isRead: false,
      },
    });

    // Send Firebase Push Notification to Employee
    if (existingLeave.employee.userId) {
      try {
        pushNotificationService.sendPush(
          [existingLeave.employee.userId],
          'Leave Request Approved',
          `Your leave request from ${leave.fromDate.toDateString()} to ${leave.toDate.toDateString()} has been approved.`,
          {
            screen: 'leave',
            id: leave.id.toString()
          }
        ).catch(err => console.error('Failed to send leave approved push:', err));
      } catch (pushError) {
        console.error('Failed to send FCM push notification to employee on leave approval:', pushError);
      }
    }

    console.log(`✅ Mobile HR: Leave request ${leave.id} approved and notification sent to employee ${existingLeave.employee.firstName} ${existingLeave.employee.lastName}`);

    // Broadcast real-time leave balance update after approval
    try {
      // Get updated leave balance
      const updatedBalance = await leaveBalanceService.getEmployeeLeaveBalance(existingLeave.employee.id);
      
      await getWebSocketInstance().broadcastLeaveBalanceUpdate(existingLeave.employee.id, {
        type: 'LEAVE_BALANCE_UPDATED',
        employeeId: existingLeave.employee.id,
        leaveId: leave.id,
        action: 'APPROVED',
        leaveBalance: updatedBalance,
        updatedBy: reviewerName || req.user?.email || 'HR',
        timestamp: new Date().toISOString()
      });
    } catch (wsError) {
      console.error('Failed to broadcast leave balance update after approval:', wsError);
    }

    res.json({
      success: true,
      message: 'Leave request approved successfully',
      data: {
        id: leave.id.toString(),
        status: leave.status,
        reviewedBy: leave.reviewedBy,
        reviewNote: leave.reviewNote,
        employeeName: `${existingLeave.employee.firstName} ${existingLeave.employee.lastName}`
      }
    });
  } catch (error) {
    console.error('Mobile approve leave error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve leave request' });
  }
};

// Reject leave request (mobile HR)
export const rejectLeaveRequest = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { reviewerName, reviewNote } = req.body;

    // Verify user has HR role
    if (req.user?.role !== 'HR' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'PLATFORM_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    if (!reviewNote || reviewNote.trim() === '') {
      res.status(400).json({ success: false, message: 'Review note is required for rejection' });
      return;
    }

    // Get leave request details before updating
    const existingLeave = await prisma.leaveRequest.findUnique({
      where: { id: parseInt(id as string, 10) },
      include: {
        employee: {
          include: {
            user: true
          }
        }
      }
    });

    if (!existingLeave) {
      res.status(404).json({ success: false, message: 'Leave request not found' });
      return;
    }

    // Update leave request status
    const leave = await prisma.leaveRequest.update({
      where: { id: parseInt(id as string, 10) },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerName || req.user?.email || 'HR',
        reviewNote: reviewNote.trim(),
        reviewedAt: new Date(),
      },
      include: {
        employee: {
          include: {
            user: true
          }
        }
      }
    });

    // Send notification to employee
    await prisma.notification.create({
      data: {
        employeeId: existingLeave.employee.id,
        userId: existingLeave.employee.userId,
        title: 'Leave Request Rejected',
        body: `Your leave request from ${leave.fromDate.toDateString()} to ${leave.toDate.toDateString()} has been rejected. Reason: ${reviewNote}`,
        category: 'LEAVE',
        actionId: leave.id.toString(),
        actionType: 'LEAVE_REJECTED',
        isRead: false,
      },
    });

    // Send Firebase Push Notification to Employee
    if (existingLeave.employee.userId) {
      try {
        pushNotificationService.sendPush(
          [existingLeave.employee.userId],
          'Leave Request Rejected',
          `Your leave request from ${leave.fromDate.toDateString()} to ${leave.toDate.toDateString()} has been rejected. Reason: ${reviewNote}`,
          {
            screen: 'leave',
            id: leave.id.toString()
          }
        ).catch(err => console.error('Failed to send leave rejected push:', err));
      } catch (pushError) {
        console.error('Failed to send FCM push notification to employee on leave rejection:', pushError);
      }
    }

    console.log(`✅ Mobile HR: Leave request ${leave.id} rejected and notification sent to employee ${existingLeave.employee.firstName} ${existingLeave.employee.lastName}`);

    // Broadcast real-time leave balance update after rejection
    try {
      // Get updated leave balance
      const updatedBalance = await leaveBalanceService.getEmployeeLeaveBalance(existingLeave.employee.id);
      
      await getWebSocketInstance().broadcastLeaveBalanceUpdate(existingLeave.employee.id, {
        type: 'LEAVE_BALANCE_UPDATED',
        employeeId: existingLeave.employee.id,
        leaveId: leave.id,
        action: 'REJECTED',
        leaveBalance: updatedBalance,
        updatedBy: reviewerName || req.user?.email || 'HR',
        timestamp: new Date().toISOString()
      });
    } catch (wsError) {
      console.error('Failed to broadcast leave balance update after rejection:', wsError);
    }

    res.json({
      success: true,
      message: 'Leave request rejected successfully',
      data: {
        id: leave.id.toString(),
        status: leave.status,
        reviewedBy: leave.reviewedBy,
        reviewNote: leave.reviewNote,
        employeeName: `${existingLeave.employee.firstName} ${existingLeave.employee.lastName}`
      }
    });
  } catch (error) {
    console.error('Mobile reject leave error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject leave request' });
  }
};
