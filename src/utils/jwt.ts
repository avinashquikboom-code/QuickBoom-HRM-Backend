import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'quickboom_secret_key_12345_67890';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'quickboom_refresh_secret_key_12345_67890';

export interface UserJWTPayload {
  id: number;
  email: string;
  role: string;
}

// Access token - short-lived (1 hour)
export const signAccessToken = (payload: UserJWTPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
};

// Refresh token - long-lived (7 days)
export const signRefreshToken = (payload: UserJWTPayload): string => {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' });
};

// Legacy function for backward compatibility - uses refresh token expiration
export const signToken = (payload: UserJWTPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

export const verifyToken = (token: string): UserJWTPayload => {
  return jwt.verify(token, JWT_SECRET) as UserJWTPayload;
};

export const verifyRefreshToken = (token: string): UserJWTPayload => {
  return jwt.verify(token, REFRESH_SECRET) as UserJWTPayload;
};
