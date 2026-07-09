import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import attendanceCalendarService from '../services/attendanceCalendarService';

// ==========================================
// Attendance Generation Policy Controller
// ==========================================

export const createAttendanceGenerationPolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const {
      isEnabled,
      generationMode,
      autoGenerateCurrentMonth,
      autoGenerateFutureMonths,
      numberOfFutureMonths,
      payrollCutoffDate,
      attendanceFreezeDate,
      autoGenerateWeeklyOffs,
      autoApplyHolidays,
      autoApplyShiftCalendar,
      autoMarkAbsentAfterWorkingHours,
      autoApplyHalfDayRules,
      autoApplyLateMarkRules,
      autoApplyEarlyExitRules,
      branchId,
      departmentId,
      officeId,
      effectiveFrom,
      effectiveTo,
      description
    } = req.body;

    const policy = await prisma.attendanceGenerationPolicy.create({
      data: {
        isEnabled: isEnabled ?? false,
        generationMode: generationMode ?? 'MONTHLY',
        autoGenerateCurrentMonth: autoGenerateCurrentMonth ?? true,
        autoGenerateFutureMonths: autoGenerateFutureMonths ?? false,
        numberOfFutureMonths: numberOfFutureMonths ?? 1,
        payrollCutoffDate: payrollCutoffDate ?? 25,
        attendanceFreezeDate: attendanceFreezeDate ?? 28,
        autoGenerateWeeklyOffs: autoGenerateWeeklyOffs ?? true,
        autoApplyHolidays: autoApplyHolidays ?? true,
        autoApplyShiftCalendar: autoApplyShiftCalendar ?? true,
        autoMarkAbsentAfterWorkingHours: autoMarkAbsentAfterWorkingHours ?? false,
        autoApplyHalfDayRules: autoApplyHalfDayRules ?? true,
        autoApplyLateMarkRules: autoApplyLateMarkRules ?? true,
        autoApplyEarlyExitRules: autoApplyEarlyExitRules ?? true,
        branchId: branchId ? parseInt(branchId) : null,
        departmentId: departmentId ? parseInt(departmentId) : null,
        officeId: officeId ? parseInt(officeId) : null,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        description,
        createdBy: req.user?.email || 'System'
      }
    });

    res.json({
      success: true,
      message: 'Attendance generation policy created successfully',
      policy
    });
  } catch (error) {
    console.error('Create attendance generation policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create attendance generation policy',
      errorCode: 'CREATE_POLICY_ERROR'
    });
  }
};

export const getAllAttendanceGenerationPolicies = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { isEnabled, branchId, departmentId, officeId } = req.query as {
      isEnabled?: string;
      branchId?: string;
      departmentId?: string;
      officeId?: string;
    };

    const where: any = {};
    
    if (isEnabled !== undefined) where.isEnabled = isEnabled === 'true';
    if (branchId) where.branchId = parseInt(branchId);
    if (departmentId) where.departmentId = parseInt(departmentId);
    if (officeId) where.officeId = parseInt(officeId);

    const policies = await prisma.attendanceGenerationPolicy.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      policies
    });
  } catch (error) {
    console.error('Get attendance generation policies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get attendance generation policies',
      errorCode: 'GET_POLICIES_ERROR'
    });
  }
};

export const getAttendanceGenerationPolicyById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    const policy = await prisma.attendanceGenerationPolicy.findUnique({
      where: { id: parseInt(idStr) }
    });

    if (!policy) {
      res.status(404).json({
        success: false,
        message: 'Policy not found',
        errorCode: 'POLICY_NOT_FOUND'
      });
      return;
    }

    res.json({
      success: true,
      policy
    });
  } catch (error) {
    console.error('Get attendance generation policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get attendance generation policy',
      errorCode: 'GET_POLICY_ERROR'
    });
  }
};

export const updateAttendanceGenerationPolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    
    const {
      isEnabled,
      generationMode,
      autoGenerateCurrentMonth,
      autoGenerateFutureMonths,
      numberOfFutureMonths,
      payrollCutoffDate,
      attendanceFreezeDate,
      autoGenerateWeeklyOffs,
      autoApplyHolidays,
      autoApplyShiftCalendar,
      autoMarkAbsentAfterWorkingHours,
      autoApplyHalfDayRules,
      autoApplyLateMarkRules,
      autoApplyEarlyExitRules,
      branchId,
      departmentId,
      officeId,
      effectiveFrom,
      effectiveTo,
      description
    } = req.body;

    const updateData: any = {};
    
    if (isEnabled !== undefined) updateData.isEnabled = isEnabled;
    if (generationMode !== undefined) updateData.generationMode = generationMode;
    if (autoGenerateCurrentMonth !== undefined) updateData.autoGenerateCurrentMonth = autoGenerateCurrentMonth;
    if (autoGenerateFutureMonths !== undefined) updateData.autoGenerateFutureMonths = autoGenerateFutureMonths;
    if (numberOfFutureMonths !== undefined) updateData.numberOfFutureMonths = numberOfFutureMonths;
    if (payrollCutoffDate !== undefined) updateData.payrollCutoffDate = payrollCutoffDate;
    if (attendanceFreezeDate !== undefined) updateData.attendanceFreezeDate = attendanceFreezeDate;
    if (autoGenerateWeeklyOffs !== undefined) updateData.autoGenerateWeeklyOffs = autoGenerateWeeklyOffs;
    if (autoApplyHolidays !== undefined) updateData.autoApplyHolidays = autoApplyHolidays;
    if (autoApplyShiftCalendar !== undefined) updateData.autoApplyShiftCalendar = autoApplyShiftCalendar;
    if (autoMarkAbsentAfterWorkingHours !== undefined) updateData.autoMarkAbsentAfterWorkingHours = autoMarkAbsentAfterWorkingHours;
    if (autoApplyHalfDayRules !== undefined) updateData.autoApplyHalfDayRules = autoApplyHalfDayRules;
    if (autoApplyLateMarkRules !== undefined) updateData.autoApplyLateMarkRules = autoApplyLateMarkRules;
    if (autoApplyEarlyExitRules !== undefined) updateData.autoApplyEarlyExitRules = autoApplyEarlyExitRules;
    if (branchId !== undefined) updateData.branchId = branchId ? parseInt(branchId) : null;
    if (departmentId !== undefined) updateData.departmentId = departmentId ? parseInt(departmentId) : null;
    if (officeId !== undefined) updateData.officeId = officeId ? parseInt(officeId) : null;
    if (effectiveFrom !== undefined) updateData.effectiveFrom = effectiveFrom ? new Date(effectiveFrom) : null;
    if (effectiveTo !== undefined) updateData.effectiveTo = effectiveTo ? new Date(effectiveTo) : null;
    if (description !== undefined) updateData.description = description;

    const policy = await prisma.attendanceGenerationPolicy.update({
      where: { id: parseInt(idStr) },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Attendance generation policy updated successfully',
      policy
    });
  } catch (error) {
    console.error('Update attendance generation policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update attendance generation policy',
      errorCode: 'UPDATE_POLICY_ERROR'
    });
  }
};

export const deleteAttendanceGenerationPolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    await prisma.attendanceGenerationPolicy.delete({
      where: { id: parseInt(idStr) }
    });

    res.json({
      success: true,
      message: 'Attendance generation policy deleted successfully'
    });
  } catch (error) {
    console.error('Delete attendance generation policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete attendance generation policy',
      errorCode: 'DELETE_POLICY_ERROR'
    });
  }
};

export const generateAttendanceCalendar = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { policyId } = req.params;
    const idStr = Array.isArray(policyId) ? policyId[0] : policyId;

    const results = await attendanceCalendarService.generateCalendarForPolicy(parseInt(idStr));

    res.json({
      success: true,
      message: 'Attendance calendar generated successfully',
      results
    });
  } catch (error) {
    console.error('Generate attendance calendar error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to generate attendance calendar',
      errorCode: 'GENERATE_CALENDAR_ERROR'
    });
  }
};

export const generateCalendarForMonth = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month, year, branchId, departmentId, officeId } = req.query;

    const results = await attendanceCalendarService.generateCalendar({
      month: parseInt(month as string),
      year: parseInt(year as string),
      branchId: branchId ? parseInt(branchId as string) : undefined,
      departmentId: departmentId ? parseInt(departmentId as string) : undefined,
      officeId: officeId ? parseInt(officeId as string) : undefined
    });

    res.json({
      success: true,
      message: 'Attendance calendar generated successfully',
      count: results.length,
      results
    });
  } catch (error) {
    console.error('Generate calendar for month error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to generate calendar for month',
      errorCode: 'GENERATE_CALENDAR_ERROR'
    });
  }
};
