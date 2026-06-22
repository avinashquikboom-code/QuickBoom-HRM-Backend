import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../utils/db';
import { signToken, signRefreshToken, signAccessToken, verifyRefreshToken, verifyToken } from '../utils/jwt';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import userSessionService from '../services/userSessionService';
import auditLogService from '../services/auditLogService';

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
    console.log('🔐 [LOGIN] Attempt for email:', email);
    
    // 1. Fetch user with basic relations (skip FCM tokens for now)
    const identifier = email.trim().toLowerCase();
    let user;

    if (identifier.includes('@')) {
      user = await prisma.user.findUnique({
        where: { email: identifier },
        include: {
          profile: true,
          employee: {
            include: {
              office: true,
            },
          },
        },
      });
    }

    if (!user || !user.isActive) {
      console.log('❌ [LOGIN] User not found or inactive:', email);
      res.status(401).json({
        success: false,
        message: 'Invalid credentials or inactive account.',
      });
      return;
    }

    // 2. Verify password
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      console.log('❌ [LOGIN] Password mismatch for:', email);
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
      return;
    }

    console.log('✅ [LOGIN] Password verified for:', email);

    // 2.5. Check office/branch allotment for employees
    if (user.role === Role.EMPLOYEE) {
      if (!user.employee || !user.employee.officeId) {
        res.status(403).json({
          success: false,
          message: 'Your office or branch has not been allotted yet. Please contact your HR administrator.',
          errorCode: 'OFFICE_NOT_ALLOTTED'
        });
        return;
      }
    }

    // 3. Generate JWT token (7 days expiration)
    const token = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    const refreshToken = signRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const ipAddress = req.ip || req.socket.remoteAddress;
    const deviceInfo = req.headers['user-agent'] || 'Unknown Device';
    await userSessionService.createSession(user.id, refreshToken, deviceInfo, ipAddress);

    // Audit Log
    await auditLogService.log({
      userId: user.id,
      employeeId: user.employee?.id || undefined,
      branchId: user.employee?.officeId || undefined,
      ipAddress,
      deviceInfo,
      action: 'USER_LOGIN',
    });

    console.log('✅ [LOGIN] Token generated for:', email);

    // 4. Update last login metadata (skip FCM token handling for now)
    let updatedProfile = user.profile;
    const loginLocation = 'Mobile App';
    if (user.profile) {
      try {
        updatedProfile = await prisma.profile.update({
          where: { id: user.profile.id },
          data: {
            lastLoginAt: new Date(),
            lastLoginLocation: loginLocation,
          },
        });
      } catch (profileError) {
        console.log('⚠️ [LOGIN] Profile update failed, continuing...');
        // Continue without profile update
      }
    }

    // 5. Structure response
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
            lastLoginAt: updatedProfile.lastLoginAt?.toISOString() || null,
            lastLoginLocation: updatedProfile.lastLoginLocation,
            clearanceLevel: updatedProfile.clearanceLevel,
            clearanceLabel: updatedProfile.clearanceLabel,
          },
        }
      : null;

    console.log('✅ [LOGIN] Login successful for:', email);
    
    res.json({
      success: true,
      token,
      refreshToken,
      currentLoginLocation: loginLocation,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: profileResponse,
      },
    });
  } catch (error: any) {
    console.error('❌ [LOGIN] Error:', error.message);
    
    // Handle specific database errors
    if (error.message?.includes('FCMToken') || error.code === 'P2021') {
      console.log('🔧 [LOGIN] FCM Token schema issue detected, using fallback...');
      // Try login without FCM token dependencies
      res.status(500).json({
        success: false,
        message: 'Authentication service temporarily unavailable. Please try again.',
        errorCode: 'TEMPORARY_ERROR'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Internal server error during login.',
      });
    }
  }
};

export const register = async (req: Request, res: Response): Promise<void> => {
  const { email, password, role, firstName, lastName, departmentId, officeId, designation } = req.body;

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

  // Enforce that only HR and EMPLOYEE accounts can be created/registered
  if (dbRole !== Role.HR && dbRole !== Role.EMPLOYEE) {
    res.status(400).json({
      success: false,
      message: 'Only HR and EMPLOYEE roles can be created via this endpoint.',
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
    const checkRole = dbRole as Role;
    if (checkRole === Role.SUPER_ADMIN || checkRole === Role.ADMIN) {
      clearanceLevel = 4;
      clearanceLabel = 'Level 4 (Super Admin)';
    } else if (checkRole === Role.HR || checkRole === Role.PLATFORM_ADMIN) {
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

    // Create Employee record for EMPLOYEE and HR roles so they appear in employee directory
    if (dbRole === Role.EMPLOYEE || dbRole === Role.HR || dbRole === Role.PLATFORM_ADMIN) {
      try {
        const employeeCode = `EMP${String(newUser.id).padStart(4, '0')}`;
        const employee = await prisma.employee.create({
          data: {
            userId: newUser.id,
            employeeCode,
            firstName: firstName || fallbackName,
            lastName: lastName || '',
            designation: designation || (dbRole === Role.EMPLOYEE ? 'Employee' : 'HR Administrator'),
            status: 'active',
            departmentId: departmentId ? parseInt(departmentId) : null,
            officeId: officeId ? parseInt(officeId) : null,
          },
        });

        // Create leave balance allocation for the new employee
        try {
          const leaveBalanceService = require('../services/leaveBalanceService').default;
          await leaveBalanceService.createOrUpdateLeaveBalance({
            employeeId: employee.id,
            departmentId: departmentId ? parseInt(departmentId) : undefined,
            createdBy: 'Registration System'
          });
          console.log(`✅ Leave balance allocated for new employee ${employee.id}`);
        } catch (leaveError) {
          console.error('Failed to create leave balance for new employee:', leaveError);
          // Non-fatal: employee is still registered even if leave balance creation fails
        }
      } catch (empError) {
        console.error('Failed to create employee record for new user:', empError);
        // Non-fatal: user is still registered even if employee creation fails
      }
    }

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

// Register FCM device token for the current user
export const registerFcmToken = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { token } = req.body;

    if (!userId || !token) {
      return res.status(400).json({ error: 'User ID and FCM token are required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Add token if it doesn't already exist
    const existingToken = await prisma.fCMToken.findFirst({
      where: { userId, token }
    });
    
    if (!existingToken) {
      await prisma.fCMToken.create({
        data: {
          userId,
          token,
          platform: req.body.platform || 'unknown',
          isActive: true,
          lastUsedAt: new Date(),
        }
      });
    } else {
      // Update existing token
      await prisma.fCMToken.update({
        where: { id: existingToken.id },
        data: {
          isActive: true,
          lastUsedAt: new Date(),
          platform: req.body.platform || existingToken.platform,
        }
      });
    }

    res.json({ success: true, message: 'FCM Token registered successfully' });
  } catch (error) {
    console.error('Error registering FCM token:', error);
    res.status(500).json({ error: 'Server error registering FCM token' });
  }
};

// Helper function for role-specific login
const authenticateRoleLogin = async (req: Request, res: Response, allowedRoles: Role[]): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({
      success: false,
      message: 'Email and password are required.',
    });
    return;
  }

  try {
    const identifier = email.trim();
    let user;

    if (identifier.includes('@')) {
      user = await prisma.user.findUnique({
        where: { email: identifier.toLowerCase() },
        include: {
          profile: true,
          employee: {
            include: {
              office: true,
            },
          },
        },
      });
    } else {
      const employee = await prisma.employee.findUnique({
        where: { employeeCode: identifier },
        include: {
          user: {
            include: {
              profile: true,
              employee: {
                include: {
                  office: true,
                },
              },
            },
          },
        },
      });
      user = employee?.user;
    }

    if (!user || !user.isActive) {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials or inactive account.',
      });
      return;
    }

    // Role validation
    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({
        success: false,
        message: `Access denied. This login portal is restricted for your role.`,
        errorCode: 'ROLE_MISMATCH'
      });
      return;
    }

    // Verify password
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
      return;
    }

    // Check office/branch allotment for employees
    if (user.role === Role.EMPLOYEE) {
      if (!user.employee || !user.employee.officeId) {
        res.status(403).json({
          success: false,
          message: 'Your office or branch has not been allotted yet. Please contact your HR administrator.',
          errorCode: 'OFFICE_NOT_ALLOTTED'
        });
        return;
      }
    }

    // Generate JWT tokens
    const token = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    const refreshToken = signRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const ipAddress = req.ip || req.socket.remoteAddress;
    const deviceInfo = req.headers['user-agent'] || 'Unknown Device';
    await userSessionService.createSession(user.id, refreshToken, deviceInfo, ipAddress);

    // Audit Log
    await auditLogService.log({
      userId: user.id,
      employeeId: user.employee?.id || undefined,
      branchId: user.employee?.officeId || undefined,
      ipAddress,
      deviceInfo,
      action: 'USER_LOGIN',
    });

    // Update last login metadata in user profile if exists
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

    // Structure security field for frontend mapper compatibility
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
      refreshToken,
      currentLoginLocation: loginLocation,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: profileResponse,
      },
    });
  } catch (error: any) {
    console.error('Role-specific login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during login.',
    });
  }
};

// Role-specific login endpoints
export const employeeLogin = async (req: Request, res: Response): Promise<void> => {
  await authenticateRoleLogin(req, res, [Role.EMPLOYEE]);
};

export const hrLogin = async (req: Request, res: Response): Promise<void> => {
  await authenticateRoleLogin(req, res, [Role.HR, Role.PLATFORM_ADMIN]);
};

export const superAdminLogin = async (req: Request, res: Response): Promise<void> => {
  await authenticateRoleLogin(req, res, [Role.SUPER_ADMIN, Role.ADMIN]);
};

export const refreshToken = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rToken = req.body.refreshToken;
    const ipAddress = req.ip || req.socket.remoteAddress;
    const deviceInfo = req.headers['user-agent'] || 'Unknown Device';

    if (rToken) {
      const rotationResult = await userSessionService.rotateToken(rToken, deviceInfo, ipAddress);
      if (!rotationResult) {
        res.status(401).json({
          success: false,
          message: 'Invalid or expired refresh token.',
          errorCode: 'INVALID_REFRESH_TOKEN'
        });
        return;
      }
      res.json({
        success: true,
        token: rotationResult.accessToken,
        refreshToken: rotationResult.refreshToken,
        user: {
          id: rotationResult.payload.id,
          email: rotationResult.payload.email,
          role: rotationResult.payload.role,
        },
      });
      return;
    }

    // Fallback: legacy token refresh behavior
    const user = req.user;
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired authorization token.',
      });
      return;
    }

    const newToken = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    res.json({
      success: true,
      token: newToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token.',
    });
  }
};

export const logout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const token = req.body.refreshToken || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
    if (token) {
      await userSessionService.revokeSession(token);
    }

    if (req.user) {
      const employee = await prisma.employee.findFirst({ where: { userId: req.user.id } });
      await auditLogService.log({
        userId: req.user.id,
        employeeId: employee?.id || undefined,
        branchId: employee?.officeId || undefined,
        ipAddress: req.ip || req.socket.remoteAddress,
        deviceInfo: req.headers['user-agent'] || 'Unknown Device',
        action: 'USER_LOGOUT',
      });
    }

    res.json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to logout.',
    });
  }
};

export const logoutAll = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (req.user) {
      await userSessionService.revokeAllSessions(req.user.id);

      const employee = await prisma.employee.findFirst({ where: { userId: req.user.id } });
      await auditLogService.log({
        userId: req.user.id,
        employeeId: employee?.id || undefined,
        branchId: employee?.officeId || undefined,
        ipAddress: req.ip || req.socket.remoteAddress,
        deviceInfo: req.headers['user-agent'] || 'Unknown Device',
        action: 'USER_LOGOUT_ALL_DEVICES',
      });
    }

    res.json({
      success: true,
      message: 'Logged out from all devices.',
    });
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to logout from all devices.',
    });
  }
};

