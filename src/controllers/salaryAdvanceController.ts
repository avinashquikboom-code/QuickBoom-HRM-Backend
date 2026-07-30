import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { firebaseNotificationService } from '../services/firebaseNotificationService';

/**
 * GET /api/payroll/admin/advances
 * Admin endpoint to list all salary advances across employees with status filter.
 */
export const getAdminSalaryAdvances = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { status } = req.query;

    const whereClause: any = {};
    if (status && status !== 'ALL') {
      whereClause.status = (status as string).toUpperCase();
    }

    const advances = await prisma.salaryAdvance.findMany({
      where: whereClause,
      include: {
        wallet: {
          include: {
            employee: {
              select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                designation: true,
                department: {
                  select: { name: true },
                },
              },
            },
          },
        },
      },
      orderBy: { requestedOn: 'desc' },
    });

    const formattedAdvances = advances.map((adv) => {
      const emp = adv.wallet?.employee;
      const totalEmis = adv.months > 0 ? adv.months : 1;
      const pendingEmis = Math.max(0, totalEmis - adv.paidEmis);
      const calculatedMonthlyEmi = adv.monthlyEmi > 0 
        ? adv.monthlyEmi 
        : Math.round((adv.amount / totalEmis) * 100) / 100;

      return {
        id: adv.id,
        walletId: adv.walletId,
        employeeId: emp?.id || null,
        employeeCode: emp?.employeeCode || 'N/A',
        employeeName: emp ? `${emp.firstName} ${emp.lastName || ''}`.trim() : 'Unknown',
        designation: emp?.designation || 'Staff',
        department: emp?.department?.name || 'Operations',
        amount: adv.amount,
        months: adv.months,
        monthlyEmi: calculatedMonthlyEmi,
        paidAmount: adv.paidAmount,
        remainingAmount: adv.remainingAmount,
        paidEmis: adv.paidEmis,
        pendingEmis,
        reason: adv.reason,
        status: adv.status,
        requestedOn: adv.requestedOn.toISOString(),
        reviewedBy: adv.reviewedBy,
        reviewNote: adv.reviewNote,
        approvedAt: adv.approvedAt ? adv.approvedAt.toISOString() : null,
      };
    });

    res.json({
      success: true,
      advances: formattedAdvances,
    });
  } catch (error: any) {
    console.error('Error fetching admin salary advances:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch salary advance requests.' });
  }
};

/**
 * PUT /api/payroll/admin/advances/:id/review
 * Admin endpoint to approve or reject a salary advance request and set EMI tenure.
 */
export const reviewSalaryAdvance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { action, months, reviewNote } = req.body; // action: 'APPROVE' | 'REJECT'

    if (!id) {
      res.status(400).json({ success: false, message: 'Advance Request ID is required.' });
      return;
    }

    const advanceId = parseInt(id as string, 10);
    const advance = await prisma.salaryAdvance.findUnique({
      where: { id: advanceId },
      include: { wallet: { include: { employee: true } } },
    });

    if (!advance) {
      res.status(404).json({ success: false, message: 'Salary advance request not found.' });
      return;
    }

    const reviewerEmail = req.user?.email || 'admin@hopkid.com';

    if (action === 'REJECT') {
      const updatedAdvance = await prisma.salaryAdvance.update({
        where: { id: advanceId },
        data: {
          status: 'REJECTED',
          reviewedBy: reviewerEmail,
          reviewNote: reviewNote || 'Rejected by Admin',
          reviewedAt: new Date(),
        },
      });

      // Log wallet transaction
      await prisma.walletTransaction.create({
        data: {
          walletId: advance.walletId,
          title: 'Salary Advance Rejected',
          category: 'Advance',
          amount: advance.amount,
          date: new Date(),
          status: 'Failed',
          isCredit: false,
          description: reviewNote || 'Salary advance request was rejected by Admin.',
        },
      });

      // Notify Employee (in-app & FCM push outside app)
      if (advance.wallet?.employee?.userId) {
        firebaseNotificationService.sendAppNotification({
          userId: advance.wallet.employee.userId,
          title: 'Salary Advance Rejected',
          body: `Your salary advance request of ₹${advance.amount} was rejected. Reason: ${reviewNote || 'No remark'}`,
          category: 'advance',
          screen: 'salary_advance',
          type: 'salary_advance_rejected',
          actionId: advance.id.toString(),
        }).catch(err => console.error('Advance reject notification error:', err));
      }

      res.json({
        success: true,
        message: 'Salary advance request rejected.',
        advance: updatedAdvance,
      });
      return;
    }

    if (action === 'APPROVE') {
      // Determine EMI tenure months (use admin passed value if provided, else keep original requested months)
      const finalMonths = months && parseInt(months, 10) > 0 ? parseInt(months, 10) : (advance.months || 1);
      const monthlyEmi = Math.round((advance.amount / finalMonths) * 100) / 100;

      const updatedAdvance = await prisma.salaryAdvance.update({
        where: { id: advanceId },
        data: {
          status: 'APPROVED',
          months: finalMonths,
          monthlyEmi,
          paidAmount: 0,
          remainingAmount: advance.amount,
          paidEmis: 0,
          reviewedBy: reviewerEmail,
          reviewNote: reviewNote || `Approved with ${finalMonths} EMI installments`,
          reviewedAt: new Date(),
          approvedAt: new Date(),
        },
      });

      // Disburse advance to wallet available balance
      await prisma.wallet.update({
        where: { id: advance.walletId },
        data: {
          availableBalance: { increment: advance.amount },
        },
      });

      // Log credit transaction in wallet
      await prisma.walletTransaction.create({
        data: {
          walletId: advance.walletId,
          title: 'Salary Advance Disbursed',
          category: 'Advance',
          amount: advance.amount,
          date: new Date(),
          status: 'Success',
          isCredit: true,
          description: `Disbursed ₹${advance.amount} with ${finalMonths} EMI monthly deductions (₹${monthlyEmi}/month).`,
        },
      });

      // Notify Employee (in-app & FCM push outside app)
      if (advance.wallet?.employee?.userId) {
        firebaseNotificationService.sendAppNotification({
          userId: advance.wallet.employee.userId,
          title: 'Salary Advance Approved',
          body: `Your salary advance request of ₹${advance.amount} has been approved by HR with ${finalMonths} EMIs.`,
          category: 'advance',
          screen: 'salary_advance',
          type: 'salary_advance_approved',
          actionId: advance.id.toString(),
        }).catch(err => console.error('Advance approve notification error:', err));
      }

      res.json({
        success: true,
        message: `Salary advance approved successfully with ${finalMonths} EMI months.`,
        advance: updatedAdvance,
      });
      return;
    }

    res.status(400).json({ success: false, message: 'Invalid review action. Must be APPROVE or REJECT.' });
  } catch (error: any) {
    console.error('Error reviewing salary advance:', error);
    res.status(500).json({ success: false, message: 'Failed to process salary advance review.' });
  }
};
