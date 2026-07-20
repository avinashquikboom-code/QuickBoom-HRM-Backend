import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { Role } from '@prisma/client';

// Get tasks assigned to logged-in user
export const getMobileTasks = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { store: true }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const { status, priority } = req.query;
    const whereClause: any = { assignedToId: employee.id };
    
    if (status) whereClause.status = status;
    if (priority) whereClause.priority = priority;

    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: {
        assignedBy: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
              }
            }
          }
        },
        assignedTo: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: tasks.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        projectName: t.projectName,
        dueDate: t.dueDate,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        assignedBy: {
          id: t.assignedBy.id,
          email: t.assignedBy.email,
          fullName: t.assignedBy.profile?.fullName || 'Unknown',
        },
        assignedTo: {
          id: t.assignedTo.id,
          employeeCode: t.assignedTo.employeeCode,
          firstName: t.assignedTo.firstName,
          lastName: t.assignedTo.lastName,
        },
      }))
    });
  } catch (error) {
    console.error('Get mobile tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve tasks.'
    });
  }
};

// Get task details by ID
export const getMobileTaskById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const taskId = Array.isArray(id) ? id[0] : id;
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { assignedToId: employee.id },
          { assignedById: req.user!.id }
        ]
      },
      include: {
        assignedBy: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
              }
            }
          }
        },
        assignedTo: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          }
        }
      },
    });

    if (!task) {
      res.status(404).json({
        success: false,
        message: 'Task not found.'
      });
      return;
    }

    res.json({
      success: true,
      data: {
        id: task.id,
        title: task.title,
        description: task.description,
        projectName: task.projectName,
        dueDate: task.dueDate,
        status: task.status,
        priority: task.priority,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        assignedBy: {
          id: task.assignedBy.id,
          email: task.assignedBy.email,
          fullName: task.assignedBy.profile?.fullName || 'Unknown',
        },
        assignedTo: {
          id: task.assignedTo.id,
          employeeCode: task.assignedTo.employeeCode,
          firstName: task.assignedTo.firstName,
          lastName: task.assignedTo.lastName,
        },
      }
    });
  } catch (error) {
    console.error('Get mobile task by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve task.'
    });
  }
};

// Create task (Store Manager only)
export const createMobileTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (req.user?.role !== Role.STORE_MANAGER) {
      res.status(403).json({
        success: false,
        message: 'Only Store Managers can create tasks.'
      });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { store: true }
    });

    if (!employee || !employee.storeId) {
      res.status(404).json({
        success: false,
        message: 'Store Manager must be assigned to a store.'
      });
      return;
    }

    const { title, description, projectName, assignedToId, dueDate, priority } = req.body;

    if (!title || !assignedToId || !dueDate) {
      res.status(400).json({
        success: false,
        message: 'Title, assigned employee, and due date are required.'
      });
      return;
    }

    // Verify assigned employee belongs to the same store
    const assignedEmployeeId = Array.isArray(assignedToId) ? assignedToId[0] : assignedToId;
    const assignedEmployee = await prisma.employee.findUnique({
      where: { id: assignedEmployeeId }
    });

    if (!assignedEmployee || assignedEmployee.storeId !== employee.storeId) {
      res.status(400).json({
        success: false,
        message: 'Can only assign tasks to employees in the same store.'
      });
      return;
    }

    const task = await prisma.task.create({
      data: {
        title,
        description: description || '',
        projectName: projectName || '',
        assignedToId: assignedToId,
        assignedById: req.user!.id,
        dueDate: new Date(dueDate),
        priority: priority || 'MEDIUM',
      },
      include: {
        assignedBy: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
              }
            }
          }
        },
        assignedTo: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          }
        }
      },
    });

    res.status(201).json({
      success: true,
      message: 'Task created successfully.',
      data: {
        id: task.id,
        title: task.title,
        description: task.description,
        projectName: task.projectName,
        dueDate: task.dueDate,
        status: task.status,
        priority: task.priority,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        assignedBy: {
          id: task.assignedBy.id,
          email: task.assignedBy.email,
          fullName: task.assignedBy.profile?.fullName || 'Unknown',
        },
        assignedTo: {
          id: task.assignedTo.id,
          employeeCode: task.assignedTo.employeeCode,
          firstName: task.assignedTo.firstName,
          lastName: task.assignedTo.lastName,
        },
      }
    });
  } catch (error) {
    console.error('Create mobile task error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create task.'
    });
  }
};

// Update task status
export const updateMobileTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const taskId = Array.isArray(id) ? id[0] : id;
    const { status, priority, description } = req.body;

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { assignedToId: employee.id },
          { assignedById: req.user!.id }
        ]
      },
    });

    if (!task) {
      res.status(404).json({
        success: false,
        message: 'Task not found.'
      });
      return;
    }

    // Only assigned user can update status, only creator can update priority/description
    const updateData: any = {};
    if (status && task.assignedToId === employee.id) {
      updateData.status = status;
    }
    if (priority && task.assignedById === req.user!.id) {
      updateData.priority = priority;
    }
    if (description !== undefined && task.assignedById === req.user!.id) {
      updateData.description = description;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({
        success: false,
        message: 'No valid fields to update.'
      });
      return;
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        assignedBy: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
              }
            }
          }
        },
        assignedTo: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          }
        }
      },
    });

    res.json({
      success: true,
      message: 'Task updated successfully.',
      data: {
        id: updatedTask.id,
        title: updatedTask.title,
        description: updatedTask.description,
        projectName: updatedTask.projectName,
        dueDate: updatedTask.dueDate,
        status: updatedTask.status,
        priority: updatedTask.priority,
        createdAt: updatedTask.createdAt,
        updatedAt: updatedTask.updatedAt,
        assignedBy: {
          id: updatedTask.assignedBy.id,
          email: updatedTask.assignedBy.email,
          fullName: updatedTask.assignedBy.profile?.fullName || 'Unknown',
        },
        assignedTo: {
          id: updatedTask.assignedTo.id,
          employeeCode: updatedTask.assignedTo.employeeCode,
          firstName: updatedTask.assignedTo.firstName,
          lastName: updatedTask.assignedTo.lastName,
        },
      }
    });
  } catch (error) {
    console.error('Update mobile task error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update task.'
    });
  }
};

// Delete task (Store Manager only)
export const deleteMobileTask = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (req.user?.role !== Role.STORE_MANAGER) {
      res.status(403).json({
        success: false,
        message: 'Only Store Managers can delete tasks.'
      });
      return;
    }

    const { id } = req.params;
    const taskId = Array.isArray(id) ? id[0] : id;

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        assignedById: req.user!.id
      },
    });

    if (!task) {
      res.status(404).json({
        success: false,
        message: 'Task not found or you do not have permission to delete it.'
      });
      return;
    }

    await prisma.task.delete({
      where: { id: taskId }
    });

    res.json({
      success: true,
      message: 'Task deleted successfully.'
    });
  } catch (error) {
    console.error('Delete mobile task error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete task.'
    });
  }
};
