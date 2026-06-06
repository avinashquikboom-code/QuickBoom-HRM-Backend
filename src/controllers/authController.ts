import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../utils/db';
import { signToken } from '../utils/jwt';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

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
    // 1. Fetch user along with profile and employee relationship (support Email or Employee ID)
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

    // 2. Verify password
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
      return;
    }

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
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during login.',
      details: error.message || String(error),
      stack: error.stack,
    });
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

    // Generate token
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
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
      details: error.message || String(error),
      stack: error.stack,
    });
  }
};

// Role-specific login endpoints
export const employeeLogin = async (req: Request, res: Response): Promise<void> => {
  await authenticateRoleLogin(req, res, [Role.EMPLOYEE]);
};

export const hrLogin = async (req: Request, res: Response): Promise<void> => {
  await authenticateRoleLogin(req, res, [Role.HR, Role.ADMIN]);
};

export const superAdminLogin = async (req: Request, res: Response): Promise<void> => {
  await authenticateRoleLogin(req, res, [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN]);
};

