import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';

// Get documents for logged-in user
export const getMobileDocuments = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
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

    const { type, isPublic } = req.query;
    const whereClause: any = { 
      OR: [
        { employeeId: employee.id },
        { isPublic: true }
      ]
    };
    
    if (type) whereClause.type = type;
    if (isPublic !== undefined) whereClause.isPublic = isPublic === 'true';

    const documents = await prisma.document.findMany({
      where: whereClause,
      orderBy: { date: 'desc' },
    });

    res.json({
      success: true,
      data: documents.map(d => ({
        id: d.id,
        title: d.title,
        type: d.type,
        date: d.date,
        fileSize: d.fileSize,
        filePath: d.filePath,
        isPublic: d.isPublic,
        createdAt: d.createdAt,
      }))
    });
  } catch (error) {
    console.error('Get mobile documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve documents.'
    });
  }
};
