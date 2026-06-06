import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import leaveBalanceService from '../../services/leaveBalanceService';
import { webSocketService } from '../..';

// ==========================================
// Mobile Leave Balance Controller
// ==========================================

// Get employee's own leave balance
export const getMyLeaveBalance = async (
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

    const { fiscalYear } = req.query;
    const leaveBalance = await leaveBalanceService.getEmployeeLeaveBalance(
      employee.id,
      fiscalYear as string
    );

    res.json({
      success: true,
      data: {
        employee: {
          id: employee.id.toString(),
          employeeCode: employee.employeeCode,
          name: `${employee.firstName} ${employee.lastName}`,
          designation: employee.designation,
        },
        leaveBalance,
      },
    });
  } catch (error) {
    console.error('Get my leave balance error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch leave balance' });
  }
};

// HR: Get all employees' leave balances
export const getAllEmployeesLeaveBalances = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Verify user has HR role
    if (req.user?.role !== 'HR' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'PLATFORM_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const { fiscalYear, departmentId } = req.query;
    
    const leaveBalances = await leaveBalanceService.getAllLeaveBalances(
      fiscalYear as string,
      departmentId ? parseInt(departmentId as string) : undefined
    );

    res.json({
      success: true,
      data: {
        leaveBalances,
        count: leaveBalances.length,
        summary: {
          totalEmployees: leaveBalances.length,
          totalCasualRemaining: leaveBalances.reduce((sum, b) => sum + b.casualRemaining, 0),
          totalSickRemaining: leaveBalances.reduce((sum, b) => sum + b.sickRemaining, 0),
          totalEarnedRemaining: leaveBalances.reduce((sum, b) => sum + b.earnedRemaining, 0),
        }
      },
    });
  } catch (error) {
    console.error('Get all employees leave balances error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch leave balances' });
  }
};

// HR: Update employee leave balance
export const updateEmployeeLeaveBalance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Verify user has HR role
    if (req.user?.role !== 'HR' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'PLATFORM_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const { employeeId, casualTotal, sickTotal, earnedTotal, fiscalYear } = req.body;

    if (!employeeId) {
      res.status(400).json({ success: false, message: 'Employee ID is required' });
      return;
    }

    const updatedBalance = await leaveBalanceService.createOrUpdateLeaveBalance({
      employeeId: parseInt(employeeId),
      fiscalYear,
      casualTotal: casualTotal ? parseInt(casualTotal) : undefined,
      sickTotal: sickTotal ? parseInt(sickTotal) : undefined,
      earnedTotal: earnedTotal ? parseInt(earnedTotal) : undefined,
      createdBy: req.user?.email || 'HR Mobile'
    });

    // Broadcast real-time leave balance update
    try {
      await webSocketService.broadcastLeaveBalanceUpdate(parseInt(employeeId), {
        type: 'LEAVE_BALANCE_UPDATED',
        employeeId: parseInt(employeeId),
        fiscalYear,
        leaveBalance: updatedBalance,
        updatedBy: req.user?.email || 'HR Mobile',
        timestamp: new Date().toISOString()
      });
    } catch (wsError) {
      console.error('Failed to broadcast leave balance update:', wsError);
    }

    res.json({
      success: true,
      message: 'Leave balance updated successfully',
      data: updatedBalance,
    });
  } catch (error) {
    console.error('Update employee leave balance error:', error);
    res.status(500).json({ success: false, message: 'Failed to update leave balance' });
  }
};

// HR: Get leave balance statistics
export const getLeaveBalanceStatistics = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Verify user has HR role
    if (req.user?.role !== 'HR' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'PLATFORM_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const { fiscalYear } = req.query;
    const stats = await leaveBalanceService.getLeaveBalanceStats(fiscalYear as string);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get leave balance statistics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics' });
  }
};

// HR: Get department leave policy
export const getDepartmentLeavePolicyMobile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Verify user has HR role
    if (req.user?.role !== 'HR' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'PLATFORM_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const { departmentId } = req.params;
    
    if (!departmentId) {
      res.status(400).json({ success: false, message: 'Department ID is required' });
      return;
    }

    const departmentIdStr = Array.isArray(departmentId) ? departmentId[0] : departmentId;
    const policy = await leaveBalanceService.getDepartmentLeavePolicy(parseInt(departmentIdStr));

    if (!policy) {
      res.status(404).json({ success: false, message: 'Department not found' });
      return;
    }

    res.json({
      success: true,
      data: policy,
    });
  } catch (error) {
    console.error('Get department leave policy error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch department policy' });
  }
};

// HR: Bulk allocate leaves to multiple employees
export const bulkAllocateLeavesMobile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Verify user has HR role
    if (req.user?.role !== 'HR' && req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'PLATFORM_ADMIN') {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const { allocations } = req.body;

    if (!allocations || !Array.isArray(allocations)) {
      res.status(400).json({ success: false, message: 'Allocations array is required' });
      return;
    }

    const createdBy = req.user?.email || 'HR Mobile';
    
    // Add createdBy to each allocation
    const processedAllocations = allocations.map(allocation => ({
      ...allocation,
      createdBy
    }));

    const results = await leaveBalanceService.bulkAllocateLeaves(processedAllocations);

    res.json({
      success: true,
      message: `Bulk allocation completed. Success: ${results.success}, Failed: ${results.failed}`,
      data: results,
    });
  } catch (error) {
    console.error('Bulk allocate leaves mobile error:', error);
    res.status(500).json({ success: false, message: 'Failed to bulk allocate leaves' });
  }
};
