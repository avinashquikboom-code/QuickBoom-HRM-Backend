import { prisma } from '../utils/db';

interface CalendarGenerationConfig {
  month: number;
  year: number;
  branchId?: number;
  departmentId?: number;
  officeId?: number;
}

interface GeneratedAttendance {
  employeeId: number;
  date: string;
  status: string;
  officeId?: number;
  isWeeklyOff?: boolean;
  isHoliday?: boolean;
}

class AttendanceCalendarService {
  async generateCalendar(config: CalendarGenerationConfig): Promise<GeneratedAttendance[]> {
    const { month, year, branchId, departmentId, officeId } = config;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const totalDays = endDate.getDate();

    // Get employees based on filters
    const employees = await this.getEmployees(branchId, departmentId, officeId);
    
    // Get holidays for the month
    const holidays = await this.getHolidays(month, year);
    
    // Get offices for weekly off configuration
    const offices = await this.getOffices(branchId, departmentId, officeId);
    
    const generatedAttendance: GeneratedAttendance[] = [];

    for (const employee of employees) {
      const office = offices.find(o => o.id === employee.officeId);
      
      for (let day = 1; day <= totalDays; day++) {
        const date = new Date(year, month - 1, day);
        const dateString = date.toISOString().split('T')[0];
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        
        // Check if it's a weekly off
        const isWeeklyOff = this.isWeeklyOff(dayName, office);
        
        // Check if it's a holiday
        const isHoliday = holidays.some(h => h.date.toISOString().split('T')[0] === dateString);
        
        // Determine status
        let status = 'ABSENT'; // Default status
        if (isWeeklyOff) {
          status = 'WEEKLY_OFF';
        } else if (isHoliday) {
          status = 'HOLIDAY';
        }
        
        // Check if attendance already exists
        const existingAttendance = await prisma.attendance.findFirst({
          where: {
            employeeId: employee.id,
            date: dateString
          }
        });
        
        if (!existingAttendance) {
          generatedAttendance.push({
            employeeId: employee.id,
            date: dateString,
            status,
            officeId: employee.officeId || undefined,
            isWeeklyOff,
            isHoliday
          });
        }
      }
    }

    // Bulk create attendance records
    if (generatedAttendance.length > 0) {
      await this.createAttendanceRecords(generatedAttendance);
    }

    return generatedAttendance;
  }

  private async getEmployees(branchId?: number, departmentId?: number, officeId?: number) {
    const where: any = { status: 'active' };
    if (branchId) where.branchId = branchId;
    if (departmentId) where.departmentId = departmentId;
    if (officeId) where.officeId = officeId;

    return await prisma.employee.findMany({
      where,
      include: {
        office: true
      }
    });
  }

  private async getHolidays(month: number, year: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    return await prisma.holiday.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        }
      }
    });
  }

  private async getOffices(branchId?: number, departmentId?: number, officeId?: number) {
    const where: any = { isActive: true };
    if (officeId) where.id = officeId;
    
    return await prisma.office.findMany({
      where
    });
  }

  private isWeeklyOff(dayName: string, office: any): boolean {
    if (!office || !office.workingDays) {
      // Default weekly offs: Saturday and Sunday
      return dayName === 'Saturday' || dayName === 'Sunday';
    }
    return !office.workingDays.includes(dayName);
  }

  private async createAttendanceRecords(attendance: GeneratedAttendance[]) {
    const records = attendance.map(a => ({
      employeeId: a.employeeId,
      date: a.date,
      status: a.status,
      officeId: a.officeId,
      notes: a.isWeeklyOff ? 'Weekly Off' : a.isHoliday ? 'Holiday' : undefined
    }));

    await prisma.attendance.createMany({
      data: records,
      skipDuplicates: true
    });
  }

  async generateCalendarForPolicy(policyId: number) {
    const policy = await prisma.attendanceGenerationPolicy.findUnique({
      where: { id: policyId }
    });

    if (!policy || !policy.isEnabled) {
      throw new Error('Policy not found or not enabled');
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const monthsToGenerate: { month: number; year: number }[] = [];

    // Generate current month if enabled
    if (policy.autoGenerateCurrentMonth) {
      monthsToGenerate.push({ month: currentMonth, year: currentYear });
    }

    // Generate future months if enabled
    if (policy.autoGenerateFutureMonths) {
      for (let i = 1; i <= policy.numberOfFutureMonths; i++) {
        const futureDate = new Date(currentYear, currentMonth - 1 + i, 1);
        monthsToGenerate.push({
          month: futureDate.getMonth() + 1,
          year: futureDate.getFullYear()
        });
      }
    }

    const results = [];

    for (const { month, year } of monthsToGenerate) {
      const result = await this.generateCalendar({
        month,
        year,
        branchId: policy.branchId || undefined,
        departmentId: policy.departmentId || undefined,
        officeId: policy.officeId || undefined
      });
      results.push({ month, year, count: result.length });
    }

    return results;
  }
}

export default new AttendanceCalendarService();
