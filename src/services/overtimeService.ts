/**
 * Overtime Calculation and Management Service
 * Calculates:
 * 1. Before-Shift Overtime: Work performed before scheduled shift start
 * 2. After-Shift Overtime: Work performed after scheduled shift end
 * 3. Total Daily Overtime = Before-Shift + After-Shift (regular shift hours excluded)
 * Supports overnight shifts, break deductions, approval workflows, and payroll integration.
 */

import { prisma } from '../utils/db';
import { Prisma } from '@prisma/client';

export interface OvertimeCalculationResult {
  beforeShiftMinutes: number;
  afterShiftMinutes: number;
  totalOvertimeMinutes: number;
  scheduledStartTime: string;
  scheduledEndTime: string;
  actualCheckIn: Date | null;
  actualCheckOut: Date | null;
  shiftId: number | null;
}

export class OvertimeService {
  /**
   * Helper to parse "HH:mm" or "HH:mm:ss" string to hours and minutes
   */
  private static parseTimeString(timeStr?: string | null): { hours: number; minutes: number } {
    if (!timeStr) return { hours: 10, minutes: 0 };
    const clean = timeStr.trim();
    // Handle "10:00 AM" or "06:00 PM"
    if (/am|pm/i.test(clean)) {
      const isPm = /pm/i.test(clean);
      const timePart = clean.replace(/am|pm/i, '').trim();
      const [h, m] = timePart.split(':').map(Number);
      let hours = h % 12;
      if (isPm) hours += 12;
      return { hours: isNaN(hours) ? 10 : hours, minutes: isNaN(m) ? 0 : m };
    }
    const [h, m] = clean.split(':').map(Number);
    return {
      hours: isNaN(h) ? 10 : h,
      minutes: isNaN(m) ? 0 : m,
    };
  }

  /**
   * Constructs Date objects in Asia/Kolkata (or configured timezone) for shift start and shift end on a given attendance date.
   * Accurately supports overnight shifts (e.g. 22:00 -> 06:00 next day).
   */
  public static resolveShiftWindow(
    dateStr: string, // "YYYY-MM-DD"
    startTimeStr: string,
    endTimeStr: string
  ): { shiftStart: Date; shiftEnd: Date; isOvernight: boolean } {
    const { hours: sH, minutes: sM } = this.parseTimeString(startTimeStr);
    const { hours: eH, minutes: eM } = this.parseTimeString(endTimeStr);

    const [year, month, day] = dateStr.split('-').map(Number);

    // Create shiftStart: year, month-1, day, sH, sM
    const shiftStart = new Date(year, month - 1, day, sH, sM, 0, 0);

    // Check if shift ends on next calendar day (overnight)
    const isOvernight = eH < sH || (eH === sH && eM <= sM);

    let shiftEnd: Date;
    if (isOvernight) {
      // End time belongs to next day
      shiftEnd = new Date(year, month - 1, day + 1, eH, eM, 0, 0);
    } else {
      shiftEnd = new Date(year, month - 1, day, eH, eM, 0, 0);
    }

    return { shiftStart, shiftEnd, isOvernight };
  }

  /**
   * Calculates break overlap duration in minutes with a given time window [windowStart, windowEnd].
   */
  private static calculateBreakOverlapMinutes(
    breaks: Array<{ startTime: Date; endTime: Date | null; duration?: number }>,
    windowStart: Date,
    windowEnd: Date
  ): number {
    let overlapMinutes = 0;
    const wStart = windowStart.getTime();
    const wEnd = windowEnd.getTime();

    if (wEnd <= wStart) return 0;

    for (const b of breaks) {
      const bStart = new Date(b.startTime).getTime();
      const bEnd = b.endTime ? new Date(b.endTime).getTime() : bStart + (b.duration || 0) * 1000;

      // Overlap of [bStart, bEnd] with [wStart, wEnd]
      const maxStart = Math.max(bStart, wStart);
      const minEnd = Math.min(bEnd, wEnd);

      if (minEnd > maxStart) {
        overlapMinutes += Math.floor((minEnd - maxStart) / 60000);
      }
    }

    return overlapMinutes;
  }

  /**
   * Main calculation function for an Attendance record.
   */
  public static async calculateAttendanceOvertime(
    attendanceId: number
  ): Promise<OvertimeCalculationResult | null> {
    const attendance = await prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: {
        breakRecords: true,
        employee: {
          include: {
            shiftAssignments: {
              where: { effectiveTo: null },
              include: { shift: true },
              orderBy: { id: 'desc' },
            },
            department: true,
            salaryStructure: true,
          },
        },
      },
    });

    if (!attendance || !attendance.employee) {
      return null;
    }

    // Do not calculate overtime for absent records or when check-in is missing
    if (attendance.status === 'ABSENT' || !attendance.checkIn) {
      // If an existing record was saved, reset to 0
      await prisma.overtimeRecord.deleteMany({
        where: { attendanceId, approvalStatus: 'PENDING' },
      }).catch(() => null);
      return null;
    }

    const employee = attendance.employee;
    const checkIn = new Date(attendance.checkIn);
    const checkOut = attendance.checkOut ? new Date(attendance.checkOut) : null;

    // Resolve shift assignment
    const activeAssignment = employee.shiftAssignments?.[0];
    let shift: any = activeAssignment?.shift;

    if (!shift) {
      // Look for any default shift matching employee's department
      if (employee.departmentId) {
        shift = await prisma.shift.findFirst({
          where: { departmentId: employee.departmentId },
          orderBy: { id: 'asc' },
        });
      }
    }

    if (!shift) {
      // Fallback to first available shift in database or standard 10:00 - 18:00
      shift = await prisma.shift.findFirst({ orderBy: { id: 'asc' } });
    }

    const startTimeStr = shift?.startTime || '10:00';
    const endTimeStr = shift?.endTime || '18:00';

    const { shiftStart, shiftEnd } = this.resolveShiftWindow(
      attendance.date,
      startTimeStr,
      endTimeStr
    );

    // 1. Before-Shift Overtime
    let beforeShiftMinutes = 0;
    if (checkIn.getTime() < shiftStart.getTime()) {
      const rawBeforeMs = shiftStart.getTime() - checkIn.getTime();
      const rawBeforeMin = Math.floor(rawBeforeMs / 60000);

      // Deduct any breaks that took place before shift start
      const breakDeduction = this.calculateBreakOverlapMinutes(
        attendance.breakRecords,
        checkIn,
        shiftStart
      );

      beforeShiftMinutes = Math.max(0, rawBeforeMin - breakDeduction);
    }

    // 2. After-Shift Overtime
    let afterShiftMinutes = 0;
    if (checkOut && checkOut.getTime() > shiftEnd.getTime()) {
      const rawAfterMs = checkOut.getTime() - shiftEnd.getTime();
      const rawAfterMin = Math.floor(rawAfterMs / 60000);

      // Deduct any breaks that took place after shift end
      const breakDeduction = this.calculateBreakOverlapMinutes(
        attendance.breakRecords,
        shiftEnd,
        checkOut
      );

      afterShiftMinutes = Math.max(0, rawAfterMin - breakDeduction);
    }

    // 3. Total Daily Overtime
    const totalOvertimeMinutes = beforeShiftMinutes + afterShiftMinutes;

    return {
      beforeShiftMinutes,
      afterShiftMinutes,
      totalOvertimeMinutes,
      scheduledStartTime: startTimeStr,
      scheduledEndTime: endTimeStr,
      actualCheckIn: checkIn,
      actualCheckOut: checkOut,
      shiftId: shift?.id ?? null,
    };
  }

  /**
   * Computes and saves or updates the OvertimeRecord for an attendance record.
   */
  public static async syncOvertimeRecord(attendanceId: number): Promise<any | null> {
    const calc = await this.calculateAttendanceOvertime(attendanceId);
    if (!calc) return null;

    const attendance = await prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: {
        employee: {
          include: { salaryStructure: true },
        },
      },
    });

    if (!attendance) return null;

    // Hourly rate estimation based on SalaryStructure
    const salaryStructure = attendance.employee.salaryStructure;
    let hourlyRate: number | null = null;
    let payableAmount: number | null = null;

    if (salaryStructure) {
      if (salaryStructure.overtimeHourlyRate && salaryStructure.overtimeHourlyRate > 0) {
        hourlyRate = salaryStructure.overtimeHourlyRate;
      } else {
        const gross = salaryStructure.grossSalary || salaryStructure.monthlySalary || 0;
        const dailySalary = gross > 0 ? gross / 26 : 0;
        const shiftHours = 8; // Standard shift hours
        const multiplier = salaryStructure.overtimeMultiplier || 1.0;
        hourlyRate = Math.round((dailySalary / shiftHours) * multiplier * 100) / 100;
      }

      if (calc.totalOvertimeMinutes > 0 && hourlyRate > 0) {
        payableAmount = Math.round((calc.totalOvertimeMinutes / 60) * hourlyRate * 100) / 100;
      }
    }

    // Check if overtime record exists
    const existing = await prisma.overtimeRecord.findUnique({
      where: { attendanceId },
    });

    if (calc.totalOvertimeMinutes === 0) {
      if (existing && existing.approvalStatus === 'PENDING') {
        // Remove 0-minute pending records to avoid clutter
        await prisma.overtimeRecord.delete({ where: { id: existing.id } });
      }
      return null;
    }

    // Determine status: preserve if already approved/rejected, else PENDING
    const status = existing ? existing.approvalStatus : 'PENDING';

    const record = await prisma.overtimeRecord.upsert({
      where: { attendanceId },
      create: {
        employeeId: attendance.employeeId,
        attendanceId,
        shiftId: calc.shiftId,
        overtimeDate: attendance.date,
        scheduledStartTime: calc.scheduledStartTime,
        scheduledEndTime: calc.scheduledEndTime,
        actualCheckIn: calc.actualCheckIn,
        actualCheckOut: calc.actualCheckOut,
        beforeShiftMinutes: calc.beforeShiftMinutes,
        afterShiftMinutes: calc.afterShiftMinutes,
        totalOvertimeMinutes: calc.totalOvertimeMinutes,
        approvalStatus: status,
        hourlyRate,
        payableAmount,
      },
      update: {
        shiftId: calc.shiftId,
        scheduledStartTime: calc.scheduledStartTime,
        scheduledEndTime: calc.scheduledEndTime,
        actualCheckIn: calc.actualCheckIn,
        actualCheckOut: calc.actualCheckOut,
        beforeShiftMinutes: calc.beforeShiftMinutes,
        afterShiftMinutes: calc.afterShiftMinutes,
        totalOvertimeMinutes: calc.totalOvertimeMinutes,
        hourlyRate: hourlyRate ?? existing?.hourlyRate,
        payableAmount: payableAmount ?? existing?.payableAmount,
      },
    });

    return record;
  }

  /**
   * Retrieves today's overtime information for employee mobile app view.
   */
  public static async getTodayOvertime(employeeId: number, dateStr?: string) {
    const today = dateStr || new Date().toISOString().split('T')[0];

    const attendance = await prisma.attendance.findFirst({
      where: { employeeId, date: today },
      include: {
        breakRecords: true,
        overtimeRecord: true,
        employee: {
          include: {
            shiftAssignments: {
              where: { effectiveTo: null },
              include: { shift: true },
            },
          },
        },
      },
    });

    // Determine shift
    const shift = attendance?.employee.shiftAssignments?.[0]?.shift;
    const scheduledStartTime = shift?.startTime || '10:00';
    const scheduledEndTime = shift?.endTime || '18:00';

    if (!attendance) {
      return {
        date: today,
        hasAttendance: false,
        scheduledStartTime,
        scheduledEndTime,
        actualCheckIn: null,
        actualCheckOut: null,
        beforeShiftMinutes: 0,
        afterShiftMinutes: 0,
        totalOvertimeMinutes: 0,
        approvalStatus: 'NONE',
        remarks: null,
      };
    }

    // Refresh calculation if attendance exists
    await this.syncOvertimeRecord(attendance.id);
    const updatedRecord = await prisma.overtimeRecord.findUnique({
      where: { attendanceId: attendance.id },
    });

    return {
      date: today,
      hasAttendance: true,
      attendanceId: attendance.id,
      scheduledStartTime,
      scheduledEndTime,
      actualCheckIn: attendance.checkIn,
      actualCheckOut: attendance.checkOut,
      beforeShiftMinutes: updatedRecord?.beforeShiftMinutes ?? 0,
      afterShiftMinutes: updatedRecord?.afterShiftMinutes ?? 0,
      totalOvertimeMinutes: updatedRecord?.totalOvertimeMinutes ?? 0,
      approvalStatus: updatedRecord?.approvalStatus ?? 'NONE',
      rejectionReason: updatedRecord?.rejectionReason ?? null,
      remarks: updatedRecord?.remarks ?? null,
    };
  }

  /**
   * Retrieves monthly overtime summary for mobile app and admin view.
   */
  public static async getMonthlySummary(employeeId: number, month: number, year: number) {
    const monthStr = String(month).padStart(2, '0');
    const prefix = `${year}-${monthStr}`;

    const records = await prisma.overtimeRecord.findMany({
      where: {
        employeeId,
        overtimeDate: { startsWith: prefix },
      },
      orderBy: { overtimeDate: 'asc' },
    });

    let approvedMinutes = 0;
    let pendingMinutes = 0;
    let rejectedMinutes = 0;
    let totalMinutes = 0;
    let beforeShiftMinutes = 0;
    let afterShiftMinutes = 0;
    let estimatedEarnings = 0;

    for (const r of records) {
      totalMinutes += r.totalOvertimeMinutes;
      beforeShiftMinutes += r.beforeShiftMinutes;
      afterShiftMinutes += r.afterShiftMinutes;

      if (r.approvalStatus === 'APPROVED') {
        approvedMinutes += r.totalOvertimeMinutes;
        estimatedEarnings += r.payableAmount || 0;
      } else if (r.approvalStatus === 'PENDING') {
        pendingMinutes += r.totalOvertimeMinutes;
      } else if (r.approvalStatus === 'REJECTED') {
        rejectedMinutes += r.totalOvertimeMinutes;
      }
    }

    return {
      month,
      year,
      totalOvertimeMinutes: totalMinutes,
      totalOvertimeHours: Math.round((totalMinutes / 60) * 100) / 100,
      approvedMinutes,
      approvedHours: Math.round((approvedMinutes / 60) * 100) / 100,
      pendingMinutes,
      pendingHours: Math.round((pendingMinutes / 60) * 100) / 100,
      rejectedMinutes,
      rejectedHours: Math.round((rejectedMinutes / 60) * 100) / 100,
      beforeShiftMinutes,
      afterShiftMinutes,
      estimatedEarnings: Math.round(estimatedEarnings * 100) / 100,
      recordCount: records.length,
    };
  }

  /**
   * Retrieves paginated overtime history for employee mobile app.
   */
  public static async getEmployeeHistory(
    employeeId: number,
    query: {
      month?: number;
      year?: number;
      status?: string;
      page?: number;
      limit?: number;
    } = {}
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(Number(query.limit) || 30, 100));
    const skip = (page - 1) * limit;

    const where: Prisma.OvertimeRecordWhereInput = {
      employeeId,
    };

    if (query.year && query.month) {
      const monthStr = String(query.month).padStart(2, '0');
      where.overtimeDate = { startsWith: `${query.year}-${monthStr}` };
    }

    if (query.status && query.status !== 'ALL') {
      where.approvalStatus = query.status.toUpperCase();
    }

    const [items, totalCount] = await Promise.all([
      prisma.overtimeRecord.findMany({
        where,
        orderBy: { overtimeDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.overtimeRecord.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;
    return {
      items,
      records: items,
      totalCount,
      total: totalCount,
      page,
      limit,
      totalPages,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
      },
    };
  }

  /**
   * Admin Table View with filters.
   */
  public static async listAdminOvertime(query: {
    startDate?: string;
    endDate?: string;
    employeeId?: number;
    departmentId?: number;
    branchId?: number;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(Number(query.limit) || 50, 200));
    const skip = (page - 1) * limit;

    const where: Prisma.OvertimeRecordWhereInput = {};

    if (query.startDate && query.endDate) {
      where.overtimeDate = {
        gte: query.startDate,
        lte: query.endDate,
      };
    } else if (query.startDate) {
      where.overtimeDate = { gte: query.startDate };
    } else if (query.endDate) {
      where.overtimeDate = { lte: query.endDate };
    }

    if (query.status && query.status !== 'ALL') {
      where.approvalStatus = query.status.toUpperCase();
    }

    if (query.employeeId) {
      where.employeeId = Number(query.employeeId);
    }

    if (query.departmentId || query.branchId || query.search) {
      where.employee = {
        ...(query.departmentId ? { departmentId: Number(query.departmentId) } : {}),
        ...(query.branchId ? { branchId: Number(query.branchId) } : {}),
        ...(query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { employeeCode: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
    }

    const [items, totalCount] = await Promise.all([
      prisma.overtimeRecord.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              department: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
          shift: {
            select: { id: true, name: true, startTime: true, endTime: true },
          },
          payslip: {
            select: { id: true, month: true, year: true, status: true },
          },
        },
        orderBy: { overtimeDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.overtimeRecord.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 1;
    return {
      items,
      records: items,
      totalCount,
      total: totalCount,
      page,
      limit,
      totalPages,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
      },
    };
  }

  /**
   * Approves an overtime record.
   */
  public static async approveOvertime(id: number, approverName: string) {
    const existing = await prisma.overtimeRecord.findUnique({
      where: { id },
      include: { employee: { include: { salaryStructure: true } } },
    });

    if (!existing) {
      throw new Error(`Overtime record #${id} not found.`);
    }

    // Recalculate payable amount if missing
    let payableAmount = existing.payableAmount;
    let hourlyRate = existing.hourlyRate;

    if (!payableAmount || !hourlyRate) {
      const struct = existing.employee.salaryStructure;
      if (struct) {
        if (struct.overtimeHourlyRate && struct.overtimeHourlyRate > 0) {
          hourlyRate = struct.overtimeHourlyRate;
        } else {
          const gross = struct.grossSalary || struct.monthlySalary || 0;
          const daily = gross > 0 ? gross / 26 : 0;
          hourlyRate = Math.round((daily / 8) * (struct.overtimeMultiplier || 1.0) * 100) / 100;
        }
        payableAmount = Math.round((existing.totalOvertimeMinutes / 60) * hourlyRate * 100) / 100;
      }
    }

    return prisma.overtimeRecord.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        approvedBy: approverName,
        approvedAt: new Date(),
        rejectionReason: null,
        hourlyRate,
        payableAmount,
      },
    });
  }

  /**
   * Rejects an overtime record with reason.
   */
  public static async rejectOvertime(id: number, approverName: string, reason: string) {
    const existing = await prisma.overtimeRecord.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`Overtime record #${id} not found.`);
    }

    return prisma.overtimeRecord.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        approvedBy: approverName,
        approvedAt: new Date(),
        rejectionReason: reason,
      },
    });
  }

  /**
   * Bulk approves multiple overtime records.
   */
  public static async bulkApprove(ids: number[], approverName: string) {
    if (!ids || ids.length === 0) return { updatedCount: 0 };

    const records = await prisma.overtimeRecord.findMany({
      where: { id: { in: ids }, approvalStatus: 'PENDING' },
      select: { id: true },
    });

    const now = new Date();
    const updated = await prisma.overtimeRecord.updateMany({
      where: { id: { in: records.map(r => r.id) } },
      data: {
        approvalStatus: 'APPROVED',
        approvedBy: approverName,
        approvedAt: now,
        rejectionReason: null,
      },
    });

    return { updatedCount: updated.count };
  }

  /**
   * Allows an employee to submit an Overtime Request.
   */
  public static async requestEmployeeOvertime(
    employeeId: number,
    dto: {
      date: string; // "YYYY-MM-DD"
      beforeShiftMinutes?: number;
      afterShiftMinutes?: number;
      totalOvertimeMinutes?: number;
      reason: string;
      shiftId?: number;
    }
  ) {
    if (!dto.date) {
      throw new Error('Date is required for overtime request.');
    }
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new Error('Reason or justification is required for overtime request.');
    }

    const beforeMins = Math.max(0, Number(dto.beforeShiftMinutes) || 0);
    const afterMins = Math.max(0, Number(dto.afterShiftMinutes) || 0);
    let totalMins = Math.max(0, Number(dto.totalOvertimeMinutes) || 0);
    if (totalMins === 0) {
      totalMins = beforeMins + afterMins;
    }
    if (totalMins <= 0) {
      throw new Error('Total overtime minutes must be greater than 0.');
    }

    const dateStr = dto.date.substring(0, 10);

    // Find or create Attendance record for that date
    let attendance = await prisma.attendance.findFirst({
      where: {
        employeeId,
        date: { startsWith: dateStr },
      },
    });

    if (!attendance) {
      attendance = await prisma.attendance.create({
        data: {
          employeeId,
          date: dateStr,
          status: 'PRESENT',
          notes: `Overtime Request: ${dto.reason.trim()}`,
        },
      });
    }

    // Resolve shift assignment
    let shiftId = dto.shiftId ? Number(dto.shiftId) : null;
    let scheduledStartTime: string | null = null;
    let scheduledEndTime: string | null = null;

    if (!shiftId) {
      const activeAssignment = await prisma.shiftAssignment.findFirst({
        where: { employeeId, effectiveTo: null },
        include: { shift: true },
        orderBy: { id: 'desc' },
      });
      if (activeAssignment?.shift) {
        shiftId = activeAssignment.shift.id;
        scheduledStartTime = activeAssignment.shift.startTime;
        scheduledEndTime = activeAssignment.shift.endTime;
      }
    } else {
      const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
      if (shift) {
        scheduledStartTime = shift.startTime;
        scheduledEndTime = shift.endTime;
      }
    }

    // Fetch employee salary structure to set hourlyRate if available
    const salaryStructure = await prisma.salaryStructure.findFirst({
      where: { employeeId, isActive: true },
      orderBy: { id: 'desc' },
    });

    let hourlyRate: number | null = null;
    if (salaryStructure) {
      hourlyRate = salaryStructure.overtimeHourlyRate || null;
      if (!hourlyRate && salaryStructure.basicSalary) {
        const mult = salaryStructure.overtimeMultiplier || 1.0;
        hourlyRate = (salaryStructure.basicSalary / (30 * 8)) * mult;
      }
    }

    const payableAmount = hourlyRate ? (totalMins / 60) * hourlyRate : null;

    // Upsert OvertimeRecord
    const record = await prisma.overtimeRecord.upsert({
      where: { attendanceId: attendance.id },
      create: {
        employeeId,
        attendanceId: attendance.id,
        shiftId,
        overtimeDate: dateStr,
        scheduledStartTime,
        scheduledEndTime,
        actualCheckIn: attendance.checkIn,
        actualCheckOut: attendance.checkOut,
        beforeShiftMinutes: beforeMins,
        afterShiftMinutes: afterMins,
        totalOvertimeMinutes: totalMins,
        approvalStatus: 'PENDING',
        remarks: dto.reason.trim(),
        hourlyRate,
        payableAmount,
      },
      update: {
        beforeShiftMinutes: beforeMins,
        afterShiftMinutes: afterMins,
        totalOvertimeMinutes: totalMins,
        approvalStatus: 'PENDING',
        remarks: dto.reason.trim(),
        hourlyRate: hourlyRate ?? undefined,
        payableAmount: payableAmount ?? undefined,
        rejectionReason: null,
      },
      include: {
        shift: true,
      },
    });

    return record;
  }
}
