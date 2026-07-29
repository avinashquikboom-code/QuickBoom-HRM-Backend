import { Request, Response, NextFunction } from 'express';
import { getIntegrationSettings } from '../utils/configService';

export const apiKeyMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // Bypass if already authenticated via JWT
  if ((req as any).user) {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'];
  const { mobileApiKey, hopkidApiKey } = await getIntegrationSettings();

  if (!apiKey || (apiKey !== mobileApiKey && apiKey !== hopkidApiKey)) {
    res.status(401).json({
      success: false,
      message: 'Unauthorized. Invalid API Key.',
    });
    return;
  }

  next();
};
