import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

export const fetchWorkModes = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const workModes = await prisma.workMode.findMany({
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      data: workModes,
    });
  } catch (error) {
    console.error('Fetch work modes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch work modes.' });
  }
};
