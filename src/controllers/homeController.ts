import { Request, Response } from 'express';

export const getHome = (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'HRM Backend is running with MVC Architecture!'
  });
};
