import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../utils/db';
import { signToken } from '../utils/jwt';
import { Role } from '../generated/prisma';

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({
      success: false,
      message: 'Email and password are required.',
    });
    return;
  }

  try {
    // 1. Fetch user along with profile and employee relationship
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: {
        profile: true,
        employee: {
          include: {
            office: true,
          },
        },
      },
    });

    if (!user || !user.isActive) {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials or inactive account.',
      });
      return;
    }

    // 2. Verify password
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
      return;
    }

    // 3. Generate token
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // 4. Update last login metadata in user profile if exists
    let updatedProfile = user.profile;
    const loginLocation = 'Local Office'; // Mocked or fetched from request IP
    if (user.profile) {
      updatedProfile = await prisma.profile.update({
        where: { id: user.profile.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginLocation: loginLocation,
        },
      });
    }

    // 5. Structure security field for frontend mapper compatibility
    const profileResponse = updatedProfile
      ? {
          id: updatedProfile.id,
          userId: updatedProfile.userId,
          email: updatedProfile.email,
          fullName: updatedProfile.fullName,
          phone: updatedProfile.phone,
          avatarUrl: updatedProfile.avatarUrl,
          timezone: updatedProfile.timezone,
          timezoneLabel: updatedProfile.timezoneLabel,
          bio: updatedProfile.bio,
          createdAt: updatedProfile.createdAt.toISOString(),
          updatedAt: updatedProfile.updatedAt.toISOString(),
          security: {
            twoFactorEnabled: updatedProfile.twoFactorEnabled,
            twoFactorStatus: updatedProfile.twoFactorStatus,
            lastLoginAt: updatedProfile.lastLoginAt.toISOString(),
            lastLoginLocation: updatedProfile.lastLoginLocation,
            clearanceLevel: updatedProfile.clearanceLevel,
            clearanceLabel: updatedProfile.clearanceLabel,
          },
        }
      : null;

    res.json({
      success: true,
      token,
      currentLoginLocation: loginLocation,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: profileResponse,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during login.',
    });
  }
};

export const register = async (req: Request, res: Response): Promise<void> => {
  const { email, password, role } = req.body;

  if (!email || !password || !role) {
    res.status(400).json({
      success: false,
      message: 'Email, password, and role are required.',
    });
    return;
  }

  // Validate role string maps to enum
  let dbRole: Role;
  try {
    dbRole = Role[role.toUpperCase() as keyof typeof Role];
    if (!dbRole) {
      throw new Error();
    }
  } catch (e) {
    res.status(400).json({
      success: false,
      message: 'Invalid role value specified.',
    });
    return;
  }

  try {
    // 1. Check if email already registered
    const existingUser = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (existingUser) {
      res.status(400).json({
        success: false,
        message: 'Account with this email already exists.',
      });
      return;
    }

    // 2. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Create user and profile in a transaction
    const emailName = email.split('@')[0];
    const fallbackName = emailName.charAt(0).toUpperCase() + emailName.slice(1);

    // Map clearance default values based on role
    let clearanceLevel = 1;
    let clearanceLabel = 'Level 1 (General)';
    if (dbRole === Role.SUPER_ADMIN || dbRole === Role.ADMIN) {
      clearanceLevel = 4;
      clearanceLabel = 'Level 4 (Super Admin)';
    } else if (dbRole === Role.HR || dbRole === Role.PLATFORM_ADMIN) {
      clearanceLevel = 3;
      clearanceLabel = 'Level 3 (HR Lead)';
    }

    const newUser = await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        role: dbRole,
        profile: {
          create: {
            email: email.trim().toLowerCase(),
            fullName: fallbackName,
            phone: '',
            bio: '',
            clearanceLevel,
            clearanceLabel,
            timezone: 'Asia/Kolkata',
            timezoneLabel: '(GMT+5:30) Mumbai, New Delhi',
            lastLoginLocation: 'Unknown',
          },
        },
      },
      include: {
        profile: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully!',
      user: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        createdAt: newUser.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register user.',
    });
  }
};
