import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

export const getEmployeeList = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employees = await prisma.employee.findMany({
      include: {
        user: {
          select: {
            email: true,
            role: true,
            isActive: true,
          }
        },
        store: true,
        department: true,
      },
    });

    res.json({
      success: true,
      employees: employees.map(emp => ({
        id: emp.id,
        employeeCode: emp.employeeCode,
        firstName: emp.firstName,
        lastName: emp.lastName,
        designation: emp.designation,
        status: emp.status,
        mobileNumber: emp.mobileNumber,
        joiningDate: emp.joiningDate,
        role: emp.user?.role || 'EMPLOYEE',
        email: emp.user?.email || null,
        storeId: emp.storeId,
        storeName: emp.store?.name || null,
        departmentId: emp.departmentId,
        departmentName: emp.department?.name || null,
      })),
    });
  } catch (error) {
    console.error('Get employee list error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employee list.',
    });
  }
};
