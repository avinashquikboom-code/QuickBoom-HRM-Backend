import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';

// Get holiday calendar
export const getMobileHolidays = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { year } = req.query;
    const currentYear = year ? parseInt(year as string) : new Date().getFullYear();

    const startDate = new Date(currentYear, 0, 1);
    const endDate = new Date(currentYear, 11, 31);

    const holidays = await prisma.holiday.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: 'asc' },
    });

    res.json({
      success: true,
      data: holidays.map(h => ({
        id: h.id,
        name: h.name,
        date: h.date.toISOString().split('T')[0],
        isPublic: h.isPublic,
        description: h.description,
        type: h.type,
        recurring: h.recurring,
      }))
    });
  } catch (error) {
    console.error('Get mobile holidays error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve holidays.'
    });
  }
};
