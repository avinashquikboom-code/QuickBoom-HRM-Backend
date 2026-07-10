import { Request, Response, NextFunction } from 'express';

export const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== 'HOPKID-MOBILE-ACCESS-API-KEY') {
    res.status(401).json({
      success: false,
      message: 'Unauthorized. Invalid API Key.',
    });
    return;
  }

  next();
};
