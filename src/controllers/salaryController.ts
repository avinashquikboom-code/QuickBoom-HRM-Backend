import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

export const getSalarySlip = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, month, year } = req.query;

    let targetEmployeeId: number | null = null;

    if (employeeId && !isNaN(Number(employeeId))) {
      targetEmployeeId = Number(employeeId);
    } else if (req.user?.id) {
      const emp = await prisma.employee.findFirst({
        where: { userId: req.user.id }
      });
      if (emp) {
        targetEmployeeId = emp.id;
      }
    }

    if (!targetEmployeeId) {
      // Fallback for dev / admin testing if employeeId not passed and no user context
      const firstEmp = await prisma.employee.findFirst({
        where: { OR: [{ employeeCode: '074' }, { status: 'active' }] }
      });
      targetEmployeeId = firstEmp ? firstEmp.id : 1;
    }

    const employee = await prisma.employee.findUnique({
      where: { id: targetEmployeeId },
      include: { user: true, salaryStructure: true }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    const now = new Date();
    let targetYear = now.getFullYear();
    let targetMonth = now.getMonth() + 1; // 1-12

    if (year && !isNaN(Number(year))) {
      targetYear = Number(year);
    }

    if (month) {
      const mStr = String(month).trim();
      if (mStr.includes('-')) {
        const parts = mStr.split('-');
        targetYear = Number(parts[0]);
        targetMonth = Number(parts[1]);
      } else if (!isNaN(Number(mStr))) {
        targetMonth = Number(mStr);
      }
    }

    // Base salary from salaryStructure or fallback to 10000
    const baseSalary = employee.salaryStructure?.basicSalary ||
      employee.salaryStructure?.monthlySalary ||
      employee.salaryStructure?.grossSalary ||
      10000;

    // Month date range
    const monthStart = new Date(targetYear, targetMonth - 1, 1);
    const monthEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
    const monthPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    const totalWorkingDays = 26; // standard working days

    // 1. Commission Amount THIS MONTH ONLY
    const commissionTxns = await prisma.commissionTransaction.findMany({
      where: {
        employeeId: targetEmployeeId,
        createdAt: { gte: monthStart, lte: monthEnd },
        status: { notIn: ['REJECTED', 'CANCELLED'] }
      }
    });
    const commissionAmount = commissionTxns.reduce((sum, t) => sum + (t.commissionAmount || 0), 0);

    // 2. Attendance (Present days & Half-days) THIS MONTH
    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId: targetEmployeeId,
        date: { startsWith: monthPrefix },
      }
    });

    // Count distinct present dates
    const presentRecords = attendances.filter(a =>
      a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'HALF_DAY' || a.checkIn !== null
    );
    const presentDays = presentRecords.length;

    // Count half-days
    const halfDays = attendances.filter(a =>
      a.status === 'HALF_DAY' || (a as any).halfDay === true || (a as any).isHalfDay === true
    ).length;

    // 3. Leave deductions THIS MONTH (unplanned leaves)
    const leaveRequests = await prisma.leaveRequest.findMany({
      where: {
        employeeId: targetEmployeeId,
        status: { notIn: ['APPROVED', 'CANCELLED'] }, // unapproved/unplanned leaves
        startDate: { gte: monthStart, lte: monthEnd }
      }
    });
    const leaveDays = leaveRequests.length;

    // Daily rate for deductions
    const dailyRate = baseSalary / totalWorkingDays;

    // Gross salary: (present_days / total_working_days) * base_salary + commission_amount
    const grossRatio = Math.min(1.0, presentDays / totalWorkingDays);
    const gross = Math.round((grossRatio * baseSalary) + commissionAmount);

    // Deductions: (half_days * dailyRate / 2) + (leave_days * dailyRate)
    const halfDayDeduction = halfDays * (dailyRate / 2);
    const leaveDeduction = leaveDays * dailyRate;
    const totalDeductions = Math.round(halfDayDeduction + leaveDeduction);

    // Net salary: Gross - Deductions (No negative net)
    const net = Math.max(0, gross - totalDeductions);

    const employeeName = `${employee.firstName} ${employee.lastName}`.trim();

    res.json({
      success: true,
      data: {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        name: employeeName,
        base_salary: baseSalary,
        present_days: presentDays,
        half_days: halfDays,
        leave_days: leaveDays,
        commission_amount: commissionAmount,
        gross,
        deductions: totalDeductions,
        net,
        month: targetMonth,
        year: targetYear,
      }
    });
  } catch (error) {
    console.error('Get salary slip error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate salary slip.' });
  }
};
