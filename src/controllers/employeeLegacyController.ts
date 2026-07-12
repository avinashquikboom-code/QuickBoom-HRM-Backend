import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { syncHopkidEmployees } from '../utils/employeeSync';

export const getEmployeeList = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Run the sync to keep the local database up to date
    await syncHopkidEmployees();

    const response = await fetch('https://hopkidapi.3dweb.in/api/Employee/GetEmployeeList', {
      method: 'GET',
      headers: {
        'x-api-key': 'HOPKID-MOBILE-ACCESS-API-KEY',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`External API responded with status ${response.status}`);
    }

    const result = await response.json();
    const dataList = result.data || [];

    // Map external API response format to the structure expected by legacy local consumers
    const mappedEmployees = dataList.map((emp: any) => ({
      id: emp.employeeID,
      employeeCode: emp.employeeCode || '',
      firstName: emp.employeeName ? emp.employeeName.split(' ')[0] : '',
      lastName: emp.employeeName ? emp.employeeName.split(' ').slice(1).join(' ') : '',
      designation: emp.branchName || 'Employee',
      status: emp.isActive ? 'active' : 'inactive',
      mobileNumber: emp.mobileNo || '',
      joiningDate: emp.dateofJoining || null,
      role: 'EMPLOYEE',
      email: emp.email || null,
      storeId: emp.branchId2 || null,
      storeName: emp.branchName || null,
      departmentId: null,
      departmentName: null,
    }));

    res.json({
      success: true,
      message: result.message || '',
      data: dataList,
      employees: mappedEmployees,
    });
  } catch (error: any) {
    console.error('Get employee list error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch employee list from external API.',
    });
  }
};
