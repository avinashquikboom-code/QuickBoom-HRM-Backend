import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

// ==========================================
// Policy Controller
// ==========================================

export const createDeductionPolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const {
      name,
      type,
      deductionType,
      deductionValue,
      maxDeduction,
      applicableDays,
      departmentId,
      officeId,
      effectiveFrom,
      effectiveTo,
      description
    } = req.body;

    if (!name || !type || !deductionType || deductionValue === undefined) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: name, type, deductionType, deductionValue',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const policy = await prisma.deductionPolicy.create({
      data: {
        name,
        type,
        deductionType,
        deductionValue: parseFloat(deductionValue),
        maxDeduction: maxDeduction ? parseFloat(maxDeduction) : null,
        applicableDays: applicableDays || [],
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
      message: 'Deduction policy created successfully',
      policy
    });
  } catch (error) {
    console.error('Create deduction policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create deduction policy',
      errorCode: 'CREATE_POLICY_ERROR'
    });
  }
};

export const getAllDeductionPolicies = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { type, departmentId, officeId, isActive } = req.query as {
      type?: string;
      departmentId?: string;
      officeId?: string;
      isActive?: string;
    };

    const where: any = {};
    
    if (type) where.type = type;
    if (departmentId) where.departmentId = parseInt(departmentId);
    if (officeId) where.officeId = parseInt(officeId);
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const policies = await prisma.deductionPolicy.findMany({
      where,
      include: {
        department: {
          select: { id: true, name: true, code: true }
        },
        office: {
          select: { id: true, name: true, code: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      policies
    });
  } catch (error) {
    console.error('Get deduction policies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get deduction policies',
      errorCode: 'GET_POLICIES_ERROR'
    });
  }
};

export const getDeductionPolicyById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    const policy = await prisma.deductionPolicy.findUnique({
      where: { id: parseInt(idStr) },
      include: {
        department: {
          select: { id: true, name: true, code: true }
        },
        office: {
          select: { id: true, name: true, code: true }
        }
      }
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
    console.error('Get deduction policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get deduction policy',
      errorCode: 'GET_POLICY_ERROR'
    });
  }
};

export const updateDeductionPolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    
    const {
      name,
      type,
      deductionType,
      deductionValue,
      maxDeduction,
      applicableDays,
      departmentId,
      officeId,
      isActive,
      effectiveFrom,
      effectiveTo,
      description
    } = req.body;

    const updateData: any = {};
    
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (deductionType !== undefined) updateData.deductionType = deductionType;
    if (deductionValue !== undefined) updateData.deductionValue = parseFloat(deductionValue);
    if (maxDeduction !== undefined) updateData.maxDeduction = maxDeduction ? parseFloat(maxDeduction) : null;
    if (applicableDays !== undefined) updateData.applicableDays = applicableDays;
    if (departmentId !== undefined) updateData.departmentId = departmentId ? parseInt(departmentId) : null;
    if (officeId !== undefined) updateData.officeId = officeId ? parseInt(officeId) : null;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (effectiveFrom !== undefined) updateData.effectiveFrom = effectiveFrom ? new Date(effectiveFrom) : null;
    if (effectiveTo !== undefined) updateData.effectiveTo = effectiveTo ? new Date(effectiveTo) : null;
    if (description !== undefined) updateData.description = description;

    const policy = await prisma.deductionPolicy.update({
      where: { id: parseInt(idStr) },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Deduction policy updated successfully',
      policy
    });
  } catch (error) {
    console.error('Update deduction policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update deduction policy',
      errorCode: 'UPDATE_POLICY_ERROR'
    });
  }
};

export const deleteDeductionPolicy = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    await prisma.deductionPolicy.delete({
      where: { id: parseInt(idStr) }
    });

    res.json({
      success: true,
      message: 'Deduction policy deleted successfully'
    });
  } catch (error) {
    console.error('Delete deduction policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete deduction policy',
      errorCode: 'DELETE_POLICY_ERROR'
    });
  }
};

export const getApplicablePoliciesForEmployee = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;

    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeIdStr) },
      include: {
        department: true,
        office: true
      }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee not found',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    const policies = await prisma.deductionPolicy.findMany({
      where: {
        isActive: true,
        OR: [
          { departmentId: employee.departmentId },
          { officeId: employee.officeId },
          { departmentId: null, officeId: null } // Global policies
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      policies
    });
  } catch (error) {
    console.error('Get applicable policies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get applicable policies',
      errorCode: 'GET_APPLICABLE_POLICIES_ERROR'
    });
  }
};
