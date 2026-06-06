import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import leaveBalanceService from '../services/leaveBalanceService';
import { prisma } from '../utils/db';

// ==========================================
// Leave Balance Management Controller
// ==========================================

export const createEmployeeLeaveBalance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, departmentId, fiscalYear, casualTotal, sickTotal, earnedTotal } = req.body;

    if (!employeeId) {
      res.status(400).json({
        success: false,
        message: 'Employee ID is required.',
        errorCode: 'MISSING_EMPLOYEE_ID'
      });
      return;
    }

    const createdBy = req.user?.email || 'Admin';

    const leaveBalance = await leaveBalanceService.createOrUpdateLeaveBalance({
      employeeId: parseInt(employeeId),
      departmentId: departmentId ? parseInt(departmentId) : undefined,
      fiscalYear,
      casualTotal: casualTotal ? parseInt(casualTotal) : undefined,
      sickTotal: sickTotal ? parseInt(sickTotal) : undefined,
      earnedTotal: earnedTotal ? parseInt(earnedTotal) : undefined,
      createdBy
    });

    res.status(201).json({
      success: true,
      message: 'Leave balance created/updated successfully.',
      data: leaveBalance
    });
  } catch (error) {
    console.error('Create employee leave balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create/update leave balance.',
      errorCode: 'CREATE_LEAVE_BALANCE_ERROR'
    });
  }
};

export const getEmployeeLeaveBalance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const { fiscalYear } = req.query;

    let targetEmployeeId: number;
    
    if (employeeId) {
      // Admin/HR viewing another employee's balance
      const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;
      targetEmployeeId = parseInt(employeeIdStr);
    } else {
      // Employee viewing their own balance
      const employee = await prisma.employee.findFirst({
        where: { userId: req.user?.id }
      });
      
      if (!employee) {
        res.status(404).json({
          success: false,
          message: 'Employee record not found.',
          errorCode: 'EMPLOYEE_NOT_FOUND'
        });
        return;
      }
      
      targetEmployeeId = employee.id;
    }

    const leaveBalance = await leaveBalanceService.getEmployeeLeaveBalance(
      targetEmployeeId,
      fiscalYear as string
    );

    res.json({
      success: true,
      data: leaveBalance
    });
  } catch (error) {
    console.error('Get employee leave balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get leave balance.',
      errorCode: 'GET_LEAVE_BALANCE_ERROR'
    });
  }
};

export const getAllLeaveBalances = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { fiscalYear, departmentId } = req.query;

    // Check if user has admin/HR role
    if (!['HR', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'ADMIN'].includes(req.user?.role || '')) {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin/HR role required.',
        errorCode: 'ACCESS_DENIED'
      });
      return;
    }

    const leaveBalances = await leaveBalanceService.getAllLeaveBalances(
      fiscalYear as string,
      departmentId ? parseInt(departmentId as string) : undefined
    );

    res.json({
      success: true,
      data: leaveBalances,
      count: leaveBalances.length
    });
  } catch (error) {
    console.error('Get all leave balances error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get leave balances.',
      errorCode: 'GET_ALL_LEAVE_BALANCES_ERROR'
    });
  }
};

export const bulkAllocateLeaves = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { allocations } = req.body;

    if (!allocations || !Array.isArray(allocations)) {
      res.status(400).json({
        success: false,
        message: 'Allocations array is required.',
        errorCode: 'MISSING_ALLOCATIONS'
      });
      return;
    }

    // Check if user has admin/HR role
    if (!['HR', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'ADMIN'].includes(req.user?.role || '')) {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin/HR role required.',
        errorCode: 'ACCESS_DENIED'
      });
      return;
    }

    const createdBy = req.user?.email || 'Admin';
    
    // Add createdBy to each allocation
    const processedAllocations = allocations.map(allocation => ({
      ...allocation,
      createdBy
    }));

    const results = await leaveBalanceService.bulkAllocateLeaves(processedAllocations);

    res.json({
      success: true,
      message: `Bulk allocation completed. Success: ${results.success}, Failed: ${results.failed}`,
      data: results
    });
  } catch (error) {
    console.error('Bulk allocate leaves error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk allocate leaves.',
      errorCode: 'BULK_ALLOCATE_LEAVES_ERROR'
    });
  }
};

export const getLeaveBalanceStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { fiscalYear } = req.query;

    // Check if user has admin/HR role
    if (!['HR', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'ADMIN'].includes(req.user?.role || '')) {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin/HR role required.',
        errorCode: 'ACCESS_DENIED'
      });
      return;
    }

    const stats = await leaveBalanceService.getLeaveBalanceStats(fiscalYear as string);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get leave balance stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get leave balance statistics.',
      errorCode: 'GET_LEAVE_BALANCE_STATS_ERROR'
    });
  }
};

export const updateUsedLeave = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, leaveType, days } = req.body;

    if (!employeeId || !leaveType || !days) {
      res.status(400).json({
        success: false,
        message: 'Employee ID, leave type, and days are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    // Check if user has admin/HR role
    if (!['HR', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'ADMIN'].includes(req.user?.role || '')) {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin/HR role required.',
        errorCode: 'ACCESS_DENIED'
      });
      return;
    }

    await leaveBalanceService.updateUsedLeave(
      parseInt(employeeId),
      leaveType,
      parseInt(days)
    );

    res.json({
      success: true,
      message: 'Used leave updated successfully.'
    });
  } catch (error) {
    console.error('Update used leave error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update used leave.',
      errorCode: 'UPDATE_USED_LEAVE_ERROR'
    });
  }
};

export const setDepartmentLeavePolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { departmentId, casualTotal, sickTotal, earnedTotal } = req.body;

    if (!departmentId || casualTotal === undefined || sickTotal === undefined || earnedTotal === undefined) {
      res.status(400).json({
        success: false,
        message: 'Department ID and all leave totals are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    // Check if user has admin/HR role
    if (!['HR', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'ADMIN'].includes(req.user?.role || '')) {
      res.status(403).json({
        success: false,
        message: 'Access denied. Admin/HR role required.',
        errorCode: 'ACCESS_DENIED'
      });
      return;
    }

    await leaveBalanceService.setDepartmentLeavePolicy(parseInt(departmentId), {
      casualTotal: parseInt(casualTotal),
      sickTotal: parseInt(sickTotal),
      earnedTotal: parseInt(earnedTotal)
    });

    res.json({
      success: true,
      message: 'Department leave policy set successfully.'
    });
  } catch (error) {
    console.error('Set department leave policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set department leave policy.',
      errorCode: 'SET_DEPARTMENT_LEAVE_POLICY_ERROR'
    });
  }
};

export const getDepartmentLeavePolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { departmentId } = req.params;

    if (!departmentId) {
      res.status(400).json({
        success: false,
        message: 'Department ID is required.',
        errorCode: 'MISSING_DEPARTMENT_ID'
      });
      return;
    }

    const departmentIdStr = Array.isArray(departmentId) ? departmentId[0] : departmentId;
    const policy = await leaveBalanceService.getDepartmentLeavePolicy(parseInt(departmentIdStr));

    if (!policy) {
      res.status(404).json({
        success: false,
        message: 'Department not found.',
        errorCode: 'DEPARTMENT_NOT_FOUND'
      });
      return;
    }

    res.json({
      success: true,
      data: policy
    });
  } catch (error) {
    console.error('Get department leave policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get department leave policy.',
      errorCode: 'GET_DEPARTMENT_LEAVE_POLICY_ERROR'
    });
  }
};
