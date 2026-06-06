import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import leaveManagementService from '../services/leaveManagementService';
import { prisma } from '../utils/db';

// ==========================================
// Enhanced Leave Management Controller
// ==========================================

export const getEmployeeLeaveBalances = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    
    // Get employee information
    let targetEmployeeId: number;
    
    if (employeeId) {
      // HR/Admin viewing another employee's balances
      const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;
      targetEmployeeId = parseInt(employeeIdStr);
    } else {
      // Employee viewing their own balances
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

    const balances = await leaveManagementService.getEmployeeLeaveBalances(targetEmployeeId);

    res.json({
      success: true,
      balances
    });
  } catch (error) {
    console.error('Get employee leave balances error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get leave balances.',
      errorCode: 'GET_LEAVE_BALANCES_ERROR'
    });
  }
};

export const upsertLeaveAllocation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, leaveType, totalDays, fiscalYear } = req.body;

    if (!employeeId || !leaveType || !totalDays || !fiscalYear) {
      res.status(400).json({
        success: false,
        message: 'Employee ID, leave type, total days, and fiscal year are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const allocation = await leaveManagementService.upsertLeaveAllocation(
      parseInt(employeeId),
      leaveType,
      parseInt(totalDays),
      fiscalYear
    );

    res.json({
      success: true,
      message: 'Leave allocation updated successfully.',
      allocation
    });
  } catch (error) {
    console.error('Upsert leave allocation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update leave allocation.',
      errorCode: 'UPSERT_LEAVE_ALLOCATION_ERROR'
    });
  }
};

export const getLeavePolicies = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const policies = await leaveManagementService.getLeavePolicies();

    res.json({
      success: true,
      policies
    });
  } catch (error) {
    console.error('Get leave policies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get leave policies.',
      errorCode: 'GET_LEAVE_POLICIES_ERROR'
    });
  }
};

export const upsertLeavePolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id, name, leaveType, defaultDays, accrualRate, maxCarryForward, probationDays, isActive, description } = req.body;

    const policy = await leaveManagementService.upsertLeavePolicy({
      id: id ? parseInt(id) : undefined,
      name,
      leaveType,
      defaultDays: defaultDays ? parseInt(defaultDays) : undefined,
      accrualRate: accrualRate ? parseFloat(accrualRate) : undefined,
      maxCarryForward: maxCarryForward ? parseInt(maxCarryForward) : undefined,
      probationDays: probationDays ? parseInt(probationDays) : undefined,
      isActive,
      description
    });

    res.json({
      success: true,
      message: 'Leave policy updated successfully.',
      policy
    });
  } catch (error) {
    console.error('Upsert leave policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update leave policy.',
      errorCode: 'UPSERT_LEAVE_POLICY_ERROR'
    });
  }
};

export const getLeaveAnalytics = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string, endDate?: string };
    
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const analytics = await leaveManagementService.getLeaveAnalytics(start, end);

    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Get leave analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get leave analytics.',
      errorCode: 'GET_LEAVE_ANALYTICS_ERROR'
    });
  }
};

export const autoApproveLeave = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { leaveRequestId } = req.body;

    if (!leaveRequestId) {
      res.status(400).json({
        success: false,
        message: 'Leave request ID is required.',
        errorCode: 'MISSING_LEAVE_REQUEST_ID'
      });
      return;
    }

    const success = await leaveManagementService.autoApproveLeave(parseInt(leaveRequestId));

    if (success) {
      res.json({
        success: true,
        message: 'Leave request auto-approved successfully.'
      });
    } else {
      res.json({
        success: false,
        message: 'Leave request could not be auto-approved.',
        errorCode: 'AUTO_APPROVAL_FAILED'
      });
    }
  } catch (error) {
    console.error('Auto approve leave error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to auto-approve leave.',
      errorCode: 'AUTO_APPROVE_LEAVE_ERROR'
    });
  }
};

export const carryForwardLeave = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, fromYear, toYear } = req.body;

    if (!employeeId || !fromYear || !toYear) {
      res.status(400).json({
        success: false,
        message: 'Employee ID, from year, and to year are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    await leaveManagementService.carryForwardLeave(
      parseInt(employeeId),
      fromYear,
      toYear
    );

    res.json({
      success: true,
      message: 'Leave carry forward completed successfully.'
    });
  } catch (error) {
    console.error('Carry forward leave error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to carry forward leave.',
      errorCode: 'CARRY_FORWARD_LEAVE_ERROR'
    });
  }
};

export const getLeaveCalendar = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string, endDate?: string };

    if (!startDate || !endDate) {
      res.status(400).json({
        success: false,
        message: 'Start date and end date are required.',
        errorCode: 'MISSING_DATES'
      });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const calendar = await leaveManagementService.getLeaveCalendar(start, end);

    res.json({
      success: true,
      calendar
    });
  } catch (error) {
    console.error('Get leave calendar error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get leave calendar.',
      errorCode: 'GET_LEAVE_CALENDAR_ERROR'
    });
  }
};

export const bulkUpdateLeaveAllocations = async (
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

    const results = [];
    
    for (const allocation of allocations) {
      try {
        const result = await leaveManagementService.upsertLeaveAllocation(
          allocation.employeeId,
          allocation.leaveType,
          allocation.totalDays,
          allocation.fiscalYear
        );
        results.push({ success: true, allocation: result });
      } catch (error) {
        results.push({ 
          success: false, 
          employeeId: allocation.employeeId, 
          leaveType: allocation.leaveType,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    res.json({
      success: true,
      message: 'Bulk leave allocations processed.',
      results
    });
  } catch (error) {
    console.error('Bulk update leave allocations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update leave allocations.',
      errorCode: 'BULK_UPDATE_ALLOCATIONS_ERROR'
    });
  }
};
