import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { syncHopkidEmployees } from '../utils/employeeSync';
import { getIntegrationSettings } from '../utils/configService';

export const getEmployeeList = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Serve from local database cache (refreshed asynchronously on background schedule)
    const localEmployees = await prisma.employee.findMany({
      include: {
        store: true,
        office: true,
        user: true,
        salaryStructure: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const dataList = localEmployees.map((emp) => {
      const isManual = emp.source === 'MANUAL';
      const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee';
      
      return {
        employeeID: emp.employeeID || `local-${emp.id}`,
        employeeCode: emp.employeeCode,
        employeeName: fullName,
        gender: null,
        dateofBirth: null,
        dateofJoining: emp.joiningDate ? emp.joiningDate.toISOString() : null,
        pinCode: null,
        address: '',
        branchName: emp.store?.name || emp.office?.name || 'Main Branch',
        mobileNo: emp.mobileNumber || '',
        email: emp.user?.email || null,
        salary: emp.salaryStructure?.grossSalary || 0.0,
        commissionPercentage: emp.commissionPercentage || 0.0,
        companyId: '',
        branchId: emp.storeId ? emp.storeId.toString() : '',
        isActive: emp.status === 'active',
        createdBy: isManual ? 'HR' : 'HOPKID',
        createdOn: emp.createdAt.toISOString(),
        updatedBy: isManual ? 'HR' : 'HOPKID',
        updatedOn: emp.updatedAt.toISOString(),
        branchId2: emp.storeId ? emp.storeId.toString() : '',
        source: emp.source || 'HOPKID',
      };
    });

    const mappedEmployees = localEmployees.map((emp) => ({
      id: emp.id,
      employeeID: emp.employeeID,
      employeeCode: emp.employeeCode || '',
      firstName: emp.firstName,
      lastName: emp.lastName,
      designation: emp.designation || emp.store?.name || 'Employee',
      status: emp.status,
      mobileNumber: emp.mobileNumber || '',
      joiningDate: emp.joiningDate ? emp.joiningDate.toISOString() : null,
      role: emp.user?.role || 'EMPLOYEE',
      email: emp.user?.email || null,
      storeId: emp.storeId ? emp.storeId.toString() : null,
      storeName: emp.store?.name || null,
      departmentId: emp.departmentId ? emp.departmentId.toString() : null,
      departmentName: null,
      source: emp.source || 'HOPKID',
    }));

    res.json({
      success: true,
      message: 'Employees loaded from local DB cache',
      data: dataList,
      employees: mappedEmployees,
    });
  } catch (error: any) {
    console.error('Get employee list error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch employee list from local cache.',
    });
  }
};

export const triggerEmployeeSync = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Run sync in background (non-blocking)
    syncHopkidEmployees().catch((err) =>
      console.error('Manual HopKid sync error:', err)
    );

    res.json({
      success: true,
      message: 'HopKid employee synchronization initiated in background.',
    });
  } catch (error: any) {
    console.error('Trigger employee sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate HopKid employee sync.',
    });
  }
};
