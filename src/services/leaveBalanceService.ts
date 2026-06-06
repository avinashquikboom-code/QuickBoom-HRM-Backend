import { prisma } from '../utils/db';
import { Role } from '@prisma/client';

export interface LeaveAllocationData {
  employeeId: number;
  departmentId?: number;
  fiscalYear?: string;
  casualTotal?: number;
  sickTotal?: number;
  earnedTotal?: number;
  createdBy?: string;
}

export interface DepartmentLeavePolicy {
  departmentId: number;
  departmentName: string;
  casualTotal: number;
  sickTotal: number;
  earnedTotal: number;
}

class LeaveBalanceService {
  /**
   * Create or update leave balance for an employee
   */
  async createOrUpdateLeaveBalance(data: LeaveAllocationData): Promise<any> {
    try {
      const {
        employeeId,
        departmentId,
        fiscalYear = new Date().getFullYear().toString(),
        casualTotal = 12,
        sickTotal = 10,
        earnedTotal = 15,
        createdBy
      } = data;

      // Get department-specific policies if department is provided
      let finalCasualTotal = casualTotal;
      let finalSickTotal = sickTotal;
      let finalEarnedTotal = earnedTotal;

      if (departmentId) {
        const departmentPolicy = await this.getDepartmentLeavePolicy(departmentId);
        if (departmentPolicy) {
          finalCasualTotal = departmentPolicy.casualTotal;
          finalSickTotal = departmentPolicy.sickTotal;
          finalEarnedTotal = departmentPolicy.earnedTotal;
        }
      }

      const leaveBalance = await prisma.leaveBalance.upsert({
        where: { employeeId },
        update: {
          fiscalYear,
          casualTotal: finalCasualTotal,
          sickTotal: finalSickTotal,
          earnedTotal: finalEarnedTotal,
          createdBy: createdBy || 'System',
          updatedAt: new Date()
        },
        create: {
          employeeId,
          fiscalYear,
          casualTotal: finalCasualTotal,
          casualUsed: 0,
          sickTotal: finalSickTotal,
          sickUsed: 0,
          earnedTotal: finalEarnedTotal,
          earnedUsed: 0,
          createdBy: createdBy || 'System'
        }
      });

      return leaveBalance;
    } catch (error) {
      console.error('Create/update leave balance error:', error);
      throw error;
    }
  }

  /**
   * Get leave balance for an employee
   */
  async getEmployeeLeaveBalance(employeeId: number, fiscalYear?: string): Promise<any> {
    try {
      const year = fiscalYear || new Date().getFullYear().toString();
      
      const leaveBalance = await prisma.leaveBalance.findFirst({
        where: {
          employeeId,
          fiscalYear: year
        },
        include: {
          employee: {
            include: {
              department: true,
              user: true
            }
          }
        }
      });

      if (!leaveBalance) {
        // Create default balance if not found
        return await this.createOrUpdateLeaveBalance({
          employeeId,
          fiscalYear: year
        });
      }

      // Calculate remaining leaves
      const casualRemaining = Math.max(0, leaveBalance.casualTotal - leaveBalance.casualUsed);
      const sickRemaining = Math.max(0, leaveBalance.sickTotal - leaveBalance.sickUsed);
      const earnedRemaining = Math.max(0, leaveBalance.earnedTotal - leaveBalance.earnedUsed);

      return {
        ...leaveBalance,
        casualRemaining,
        sickRemaining,
        earnedRemaining,
        totalRemaining: casualRemaining + sickRemaining + earnedRemaining
      };
    } catch (error) {
      console.error('Get employee leave balance error:', error);
      throw error;
    }
  }

  /**
   * Get all employees' leave balances (for admin/HR)
   */
  async getAllLeaveBalances(fiscalYear?: string, departmentId?: number): Promise<any[]> {
    try {
      const year = fiscalYear || new Date().getFullYear().toString();
      
      let whereClause: any = { fiscalYear: year };
      
      if (departmentId) {
        whereClause.employee = {
          departmentId: departmentId
        };
      }

      const leaveBalances = await prisma.leaveBalance.findMany({
        where: whereClause,
        include: {
          employee: {
            include: {
              department: true,
              user: true,
              office: true
            }
          }
        },
        orderBy: {
          employee: {
            employeeCode: 'asc'
          }
        }
      });

      return leaveBalances.map(balance => {
        const casualRemaining = Math.max(0, balance.casualTotal - balance.casualUsed);
        const sickRemaining = Math.max(0, balance.sickTotal - balance.sickUsed);
        const earnedRemaining = Math.max(0, balance.earnedTotal - balance.earnedUsed);

        return {
          ...balance,
          casualRemaining,
          sickRemaining,
          earnedRemaining,
          totalRemaining: casualRemaining + sickRemaining + earnedRemaining
        };
      });
    } catch (error) {
      console.error('Get all leave balances error:', error);
      throw error;
    }
  }

  /**
   * Update used leave count when a leave is approved
   */
  async updateUsedLeave(employeeId: number, leaveType: string, days: number): Promise<void> {
    try {
      const fiscalYear = new Date().getFullYear().toString();
      
      const leaveBalance = await prisma.leaveBalance.findFirst({
        where: {
          employeeId,
          fiscalYear
        }
      });

      if (!leaveBalance) {
        // Create balance if not found
        await this.createOrUpdateLeaveBalance({ employeeId, fiscalYear });
        return await this.updateUsedLeave(employeeId, leaveType, days);
      }

      const updateData: any = {};
      
      switch (leaveType.toUpperCase()) {
        case 'CASUAL':
          updateData.casualUsed = Math.max(0, leaveBalance.casualUsed + days);
          break;
        case 'SICK':
          updateData.sickUsed = Math.max(0, leaveBalance.sickUsed + days);
          break;
        case 'EARNED':
          updateData.earnedUsed = Math.max(0, leaveBalance.earnedUsed + days);
          break;
        default:
          throw new Error(`Invalid leave type: ${leaveType}`);
      }

      await prisma.leaveBalance.update({
        where: { id: leaveBalance.id },
        data: updateData
      });

      console.log(`✅ Updated used leave for employee ${employeeId}: ${leaveType} +${days} days`);
    } catch (error) {
      console.error('Update used leave error:', error);
      throw error;
    }
  }

  /**
   * Set department-specific leave policies
   */
  async setDepartmentLeavePolicy(departmentId: number, policy: {
    casualTotal: number;
    sickTotal: number;
    earnedTotal: number;
  }): Promise<void> {
    try {
      // This would typically be stored in a separate department policies table
      // For now, we'll use a simple approach by storing in a JSON field or creating a new table
      console.log(`Setting department ${departmentId} leave policy:`, policy);
      // Implementation would go here
    } catch (error) {
      console.error('Set department leave policy error:', error);
      throw error;
    }
  }

  /**
   * Get department leave policy
   */
  async getDepartmentLeavePolicy(departmentId: number): Promise<DepartmentLeavePolicy | null> {
    try {
      const department = await prisma.department.findUnique({
        where: { id: departmentId }
      });

      if (!department) return null;

      // Default policies based on department type
      // In a real implementation, this would come from a department policies table
      const defaultPolicies: Record<string, DepartmentLeavePolicy> = {
        'Human Resources': {
          departmentId,
          departmentName: department.name,
          casualTotal: 15,
          sickTotal: 12,
          earnedTotal: 18
        },
        'Engineering': {
          departmentId,
          departmentName: department.name,
          casualTotal: 12,
          sickTotal: 10,
          earnedTotal: 15
        },
        'Operations': {
          departmentId,
          departmentName: department.name,
          casualTotal: 10,
          sickTotal: 8,
          earnedTotal: 12
        }
      };

      return defaultPolicies[department.name] || {
        departmentId,
        departmentName: department.name,
        casualTotal: 12,
        sickTotal: 10,
        earnedTotal: 15
      };
    } catch (error) {
      console.error('Get department leave policy error:', error);
      throw error;
    }
  }

  /**
   * Bulk allocate leaves to multiple employees
   */
  async bulkAllocateLeaves(allocations: LeaveAllocationData[]): Promise<{ success: number; failed: number; errors: string[] }> {
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const allocation of allocations) {
      try {
        await this.createOrUpdateLeaveBalance(allocation);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(`Employee ${allocation.employeeId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return results;
  }

  /**
   * Get leave balance statistics
   */
  async getLeaveBalanceStats(fiscalYear?: string): Promise<any> {
    try {
      const year = fiscalYear || new Date().getFullYear().toString();
      
      const balances = await prisma.leaveBalance.findMany({
        where: { fiscalYear: year },
        include: {
          employee: {
            include: {
              department: true
            }
          }
        }
      });

      const stats = {
        totalEmployees: balances.length,
        totalCasualAllocated: balances.reduce((sum, b) => sum + b.casualTotal, 0),
        totalCasualUsed: balances.reduce((sum, b) => sum + b.casualUsed, 0),
        totalSickAllocated: balances.reduce((sum, b) => sum + b.sickTotal, 0),
        totalSickUsed: balances.reduce((sum, b) => sum + b.sickUsed, 0),
        totalEarnedAllocated: balances.reduce((sum, b) => sum + b.earnedTotal, 0),
        totalEarnedUsed: balances.reduce((sum, b) => sum + b.earnedUsed, 0),
        departmentBreakdown: {} as any
      };

      // Calculate remaining
      stats.totalCasualRemaining = stats.totalCasualAllocated - stats.totalCasualUsed;
      stats.totalSickRemaining = stats.totalSickAllocated - stats.totalSickUsed;
      stats.totalEarnedRemaining = stats.totalEarnedAllocated - stats.totalEarnedUsed;
      stats.totalRemaining = stats.totalCasualRemaining + stats.totalSickRemaining + stats.totalEarnedRemaining;

      // Department breakdown
      balances.forEach(balance => {
        const deptName = balance.employee.department?.name || 'Unassigned';
        if (!stats.departmentBreakdown[deptName]) {
          stats.departmentBreakdown[deptName] = {
            employees: 0,
            casualAllocated: 0,
            casualUsed: 0,
            sickAllocated: 0,
            sickUsed: 0,
            earnedAllocated: 0,
            earnedUsed: 0
          };
        }
        
        const dept = stats.departmentBreakdown[deptName];
        dept.employees++;
        dept.casualAllocated += balance.casualTotal;
        dept.casualUsed += balance.casualUsed;
        dept.sickAllocated += balance.sickTotal;
        dept.sickUsed += balance.sickUsed;
        dept.earnedAllocated += balance.earnedTotal;
        dept.earnedUsed += balance.earnedUsed;
      });

      return stats;
    } catch (error) {
      console.error('Get leave balance stats error:', error);
      throw error;
    }
  }
}

export default new LeaveBalanceService();
