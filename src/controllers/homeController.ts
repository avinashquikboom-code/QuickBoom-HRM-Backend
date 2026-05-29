import { Request, Response } from 'express';

export const getHome = (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Quickboom Backend is running with MVC Architecture!'
  });
};
