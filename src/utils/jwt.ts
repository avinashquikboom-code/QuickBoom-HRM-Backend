import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'quickboom_secret_key_12345_67890';

export interface UserJWTPayload {
  id: number;
  email: string;
  role: string;
}

export const signToken = (payload: UserJWTPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

export const verifyToken = (token: string): UserJWTPayload => {
  return jwt.verify(token, JWT_SECRET) as UserJWTPayload;
};
