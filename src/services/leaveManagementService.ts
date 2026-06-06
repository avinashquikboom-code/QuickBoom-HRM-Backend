import { prisma } from '../utils/db';
// @ts-ignore - WebSocket service is imported dynamically
const { webSocketService } = require('../..');

export interface LeaveAllocation {
  id: number;
  employeeId: number;
  leaveType: string;
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  fiscalYear: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeavePolicy {
  id: number;
  name: string;
  leaveType: string;
  defaultDays: number;
  accrualRate: number;
  maxCarryForward: number;
  probationDays: number;
  isActive: boolean;
  description: string;
}

export interface LeaveAnalytics {
  totalLeaveRequests: number;
  approvedLeaves: number;
  rejectedLeaves: number;
  pendingLeaves: number;
  averageProcessingTime: number;
  leaveByType: Record<string, number>;
  leaveByMonth: Record<string, number>;
  upcomingLeaves: number;
  employeesOnLeave: number;
}

class LeaveManagementService {
  /**
   * Get leave balances for an employee
   */
  async getEmployeeLeaveBalances(employeeId: number): Promise<LeaveAllocation[]> {
    try {
      const currentYear = new Date().getFullYear().toString();
      
      const allocations = await prisma.$queryRaw`
        SELECT 
          id,
          employee_id as "employeeId",
          leave_type as "leaveType",
          total_days as "totalDays",
          used_days as "usedDays",
          remaining_days as "remainingDays",
          fiscal_year as "fiscalYear",
          is_active as "isActive",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM leave_allocation 
        WHERE employee_id = ${employeeId} 
        AND fiscal_year = ${currentYear}
        AND is_active = true
      ` as LeaveAllocation[];

      return allocations;
    } catch (error) {
      console.error('Get employee leave balances error:', error);
      throw error;
    }
  }

  /**
   * Create or update leave allocation for an employee
   */
  async upsertLeaveAllocation(
    employeeId: number,
    leaveType: string,
    totalDays: number,
    fiscalYear: string
  ): Promise<LeaveAllocation> {
    try {
      // Calculate used days from existing leave requests
      const usedDays = await prisma.leaveRequest.aggregate({
        where: {
          employeeId,
          type: leaveType,
          status: 'APPROVED',
          fromDate: {
            gte: new Date(`${fiscalYear}-01-01`)
          },
          toDate: {
            lte: new Date(`${fiscalYear}-12-31`)
          }
        },
        _count: {
          id: true
        }
      });

      // For now, use count as placeholder since we don't have a days field
      const usedDaysCount = usedDays._count.id || 0;
      const remainingDays = totalDays - usedDaysCount;

      const allocation = await prisma.$queryRaw`
        INSERT INTO leave_allocation (
          employee_id, leave_type, total_days, used_days, remaining_days, fiscal_year, is_active, created_at, updated_at
        ) VALUES (
          ${employeeId}, ${leaveType}, ${totalDays}, ${usedDaysCount}, ${remainingDays}, ${fiscalYear}, true, NOW(), NOW()
        )
        ON CONFLICT (employee_id, leave_type, fiscal_year) 
        DO UPDATE SET
          total_days = EXCLUDED.total_days,
          used_days = ${usedDaysCount},
          remaining_days = EXCLUDED.total_days - ${usedDaysCount},
          updated_at = NOW()
        RETURNING 
          id,
          employee_id as "employeeId",
          leave_type as "leaveType",
          total_days as "totalDays",
          used_days as "usedDays",
          remaining_days as "remainingDays",
          fiscal_year as "fiscalYear",
          is_active as "isActive",
          created_at as "createdAt",
          updated_at as "updatedAt"
      ` as LeaveAllocation[];

      return allocation[0];
    } catch (error) {
      console.error('Upsert leave allocation error:', error);
      throw error;
    }
  }

  /**
   * Get leave policies
   */
  async getLeavePolicies(): Promise<LeavePolicy[]> {
    try {
      const policies = await prisma.$queryRaw`
        SELECT 
          id,
          name,
          leave_type as "leaveType",
          default_days as "defaultDays",
          accrual_rate as "accrualRate",
          max_carry_forward as "maxCarryForward",
          probation_days as "probationDays",
          is_active as "isActive",
          description
        FROM leave_policy 
        WHERE is_active = true
        ORDER BY name
      ` as LeavePolicy[];

      return policies;
    } catch (error) {
      console.error('Get leave policies error:', error);
      throw error;
    }
  }

  /**
   * Create or update leave policy
   */
  async upsertLeavePolicy(policyData: Partial<LeavePolicy>): Promise<LeavePolicy> {
    try {
      const policy = await prisma.$queryRaw`
        INSERT INTO leave_policy (
          name, leave_type, default_days, accrual_rate, max_carry_forward, probation_days, is_active, description, created_at, updated_at
        ) VALUES (
          ${policyData.name || 'New Policy'}, 
          ${policyData.leaveType || 'CASUAL'}, 
          ${policyData.defaultDays || 12}, 
          ${policyData.accrualRate || 1}, 
          ${policyData.maxCarryForward || 0}, 
          ${policyData.probationDays || 90}, 
          ${policyData.isActive ?? true}, 
          ${policyData.description || ''}, 
          NOW(), NOW()
        )
        ON CONFLICT (id) 
        DO UPDATE SET
          name = EXCLUDED.name,
          leave_type = EXCLUDED.leave_type,
          default_days = EXCLUDED.default_days,
          accrual_rate = EXCLUDED.accrual_rate,
          max_carry_forward = EXCLUDED.max_carry_forward,
          probation_days = EXCLUDED.probation_days,
          is_active = EXCLUDED.is_active,
          description = EXCLUDED.description,
          updated_at = NOW()
        RETURNING 
          id,
          name,
          leave_type as "leaveType",
          default_days as "defaultDays",
          accrual_rate as "accrualRate",
          max_carry_forward as "maxCarryForward",
          probation_days as "probationDays",
          is_active as "isActive",
          description
      ` as LeavePolicy[];

      return policy[0];
    } catch (error) {
      console.error('Upsert leave policy error:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive leave analytics
   */
  async getLeaveAnalytics(startDate?: Date, endDate?: Date): Promise<LeaveAnalytics> {
    try {
      const start = startDate || new Date(new Date().getFullYear(), 0, 1);
      const end = endDate || new Date(new Date().getFullYear(), 11, 31);

      const analytics = await prisma.$queryRaw`
        SELECT 
          COUNT(*) as "totalLeaveRequests",
          COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as "approvedLeaves",
          COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as "rejectedLeaves",
          COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as "pendingLeaves",
          AVG(EXTRACT(EPOCH FROM (reviewed_at - applied_on))/86400) as "averageProcessingTime",
          COUNT(CASE WHEN from_date <= NOW() AND to_date >= NOW() AND status = 'APPROVED' THEN 1 END) as "employeesOnLeave",
          COUNT(CASE WHEN from_date > NOW() AND status = 'APPROVED' THEN 1 END) as "upcomingLeaves"
        FROM leave_request 
        WHERE applied_on BETWEEN ${start} AND ${end}
      ` as any[];

      const leaveByType = await prisma.$queryRaw`
        SELECT leave_type, COUNT(*) as count
        FROM leave_request 
        WHERE applied_on BETWEEN ${start} AND ${end}
        GROUP BY leave_type
      ` as any[];

      const leaveByMonth = await prisma.$queryRaw`
        SELECT 
          TO_CHAR(applied_on, 'YYYY-MM') as month,
          COUNT(*) as count
        FROM leave_request 
        WHERE applied_on BETWEEN ${start} AND ${end}
        GROUP BY TO_CHAR(applied_on, 'YYYY-MM')
        ORDER BY month
      ` as any[];

      const result = analytics[0];
      return {
        totalLeaveRequests: parseInt(result.totalLeaveRequests),
        approvedLeaves: parseInt(result.approvedLeaves),
        rejectedLeaves: parseInt(result.rejectedLeaves),
        pendingLeaves: parseInt(result.pendingLeaves),
        averageProcessingTime: parseFloat(result.averageProcessingTime) || 0,
        leaveByType: leaveByType.reduce((acc, item) => {
          acc[item.leave_type] = parseInt(item.count);
          return acc;
        }, {}),
        leaveByMonth: leaveByMonth.reduce((acc, item) => {
          acc[item.month] = parseInt(item.count);
          return acc;
        }, {}),
        upcomingLeaves: parseInt(result.employeesOnLeave),
        employeesOnLeave: parseInt(result.upcomingLeaves)
      };
    } catch (error) {
      console.error('Get leave analytics error:', error);
      throw error;
    }
  }

  /**
   * Auto-approve leave based on policy
   */
  async autoApproveLeave(leaveRequestId: number): Promise<boolean> {
    try {
      const leaveRequest = await prisma.leaveRequest.findUnique({
        where: { id: leaveRequestId },
        include: { employee: true }
      });

      if (!leaveRequest) {
        return false;
      }

      // Check if leave can be auto-approved based on policy
      const policies = await this.getLeavePolicies();
      const policy = policies.find(p => p.leaveType === leaveRequest.type);

      if (!policy || !policy.autoApproval) {
        return false;
      }

      // Check if employee has sufficient balance
      const balances = await this.getEmployeeLeaveBalances(leaveRequest.employeeId);
      const balance = balances.find(b => b.leaveType === leaveRequest.type);

      // Calculate days between from and to dates
      const days = Math.ceil((leaveRequest.toDate.getTime() - leaveRequest.fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      if (!balance || balance.remainingDays < days) {
        return false;
      }

      // Auto-approve the leave
      await prisma.leaveRequest.update({
        where: { id: leaveRequestId },
        data: {
          status: 'APPROVED',
          reviewedBy: 'System Auto-Approval'
        }
      });

      // Send notification
      await prisma.notification.create({
        data: {
          employeeId: leaveRequest.employeeId,
          userId: leaveRequest.employee.userId,
          title: 'Leave Auto-Approved',
          body: `Your leave request from ${leaveRequest.fromDate.toDateString()} to ${leaveRequest.toDate.toDateString()} has been auto-approved.`,
          category: 'LEAVE',
          actionId: leaveRequestId.toString(),
          actionType: 'LEAVE_AUTO_APPROVED'
        }
      });

      // Broadcast real-time update
      try {
        await webSocketService.broadcastNotification(leaveRequest.employeeId, {
          title: 'Leave Auto-Approved',
          body: `Your leave request has been auto-approved.`,
          type: 'leave_auto_approved',
          leaveId: leaveRequestId
        });
      } catch (wsError) {
        console.error('❌ Failed to broadcast auto-approval update:', wsError);
      }

      return true;
    } catch (error) {
      console.error('Auto approve leave error:', error);
      return false;
    }
  }

  /**
   * Carry forward unused leave days
   */
  async carryForwardLeave(employeeId: number, fromYear: string, toYear: string): Promise<void> {
    try {
      const allocations = await this.getEmployeeLeaveBalances(employeeId);
      
      for (const allocation of allocations) {
        if (allocation.remainingDays > 0) {
          const policies = await this.getLeavePolicies();
          const policy = policies.find(p => p.leaveType === allocation.leaveType);
          
          if (policy && policy.maxCarryForward > 0) {
            const carryForwardDays = Math.min(allocation.remainingDays, policy.maxCarryForward);
            
            await this.upsertLeaveAllocation(
              employeeId,
              allocation.leaveType,
              policy.defaultDays + carryForwardDays,
              toYear
            );
          }
        }
      }
    } catch (error) {
      console.error('Carry forward leave error:', error);
      throw error;
    }
  }

  /**
   * Get leave calendar for organization
   */
  async getLeaveCalendar(startDate: Date, endDate: Date): Promise<any[]> {
    try {
      const calendar = await prisma.$queryRaw`
        SELECT 
          lr.id,
          lr.from_date as "fromDate",
          lr.to_date as "toDate",
          lr.total_days as "totalDays",
          lr.leave_type as "leaveType",
          lr.status,
          lr.reason,
          e.first_name as "firstName",
          e.last_name as "lastName",
          e.employee_code as "employeeCode",
          d.name as "departmentName"
        FROM leave_request lr
        JOIN employee e ON lr.employee_id = e.id
        LEFT JOIN department d ON e.department_id = d.id
        WHERE lr.from_date <= ${endDate} AND lr.to_date >= ${startDate}
        AND lr.status = 'APPROVED'
        ORDER BY lr.from_date
      `;

      return calendar;
    } catch (error) {
      console.error('Get leave calendar error:', error);
      throw error;
    }
  }
}

export default new LeaveManagementService();
