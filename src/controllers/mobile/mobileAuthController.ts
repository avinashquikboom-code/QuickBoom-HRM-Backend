import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../../utils/db';
import { signToken, verifyToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';

// Mobile-specific login - simplified to email and password only
export const mobileLogin = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({
      success: false,
      message: 'Email and password are required.',
      errorCode: 'MISSING_CREDENTIALS'
    });
    return;
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    // Phase 1: minimal fetch for credential verification (avoids heavy JOINs on failed attempts)
    const userAuth = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        isActive: true,
        profile: { select: { id: true } },
        employee: { select: { id: true, officeId: true } },
      },
    });

    if (!userAuth || !userAuth.isActive) {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials or inactive account.',
        errorCode: 'INVALID_CREDENTIALS'
      });
      return;
    }

    const isPasswordMatch = await bcrypt.compare(password, userAuth.password);
    if (!isPasswordMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
        errorCode: 'INVALID_PASSWORD'
      });
      return;
    }

    const mobileCompatibleRoles = ['EMPLOYEE' as Role, 'HR' as Role, 'ADMIN' as Role];
    const blockedRoles = ['SUPER_ADMIN' as Role, 'PLATFORM_ADMIN' as Role];
    if (blockedRoles.includes(userAuth.role)) {
      res.status(403).json({
        success: false,
        message: 'Super Admin and Platform Admin roles cannot access the mobile app. Please use the web portal.',
        errorCode: 'MOBILE_ACCESS_DENIED'
      });
      return;
    }
    if (!mobileCompatibleRoles.includes(userAuth.role)) {
      res.status(403).json({
        success: false,
        message: 'Mobile access not available for this role.',
        errorCode: 'MOBILE_ACCESS_DENIED'
      });
      return;
    }

    if (userAuth.role === Role.EMPLOYEE) {
      if (!userAuth.employee || !userAuth.employee.officeId) {
        res.status(403).json({
          success: false,
          message: 'Your office or branch has not been allotted yet. Please contact your HR administrator.',
          errorCode: 'OFFICE_NOT_ALLOTTED'
        });
        return;
      }
    }

    // Phase 2: load full profile data only after successful authentication
    const user = await prisma.user.findUnique({
      where: { id: userAuth.id },
      include: {
        profile: true,
        employee: {
          include: {
            office: true,
            department: true,
          },
        },
      },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials or inactive account.',
        errorCode: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // 4. Generate mobile-specific tokens
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

    // 5. Update last login metadata (non-blocking)
    const loginLocation = 'Mobile App';
    if (user.profile) {
      prisma.profile.update({
        where: { id: user.profile.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginLocation: loginLocation,
        },
      }).catch(err => console.error('Failed to update profile lastLoginAt:', err));
    }

    // 6. Store FCM token if provided (optional, non-blocking)
    if (req.body.fcmToken) {
      prisma.fCMToken.findFirst({
        where: { userId: user.id, token: req.body.fcmToken }
      }).then(existingToken => {
        if (!existingToken) {
          return prisma.fCMToken.create({
            data: {
              userId: user.id,
              token: req.body.fcmToken,
              platform: 'mobile',
              isActive: true,
              lastUsedAt: new Date(),
            }
          });
        } else {
          return prisma.fCMToken.update({
            where: { id: existingToken.id },
            data: {
              isActive: true,
              lastUsedAt: new Date(),
            }
          });
        }
      }).catch(err => console.error('Failed to update FCM token:', err));
    }

    // 7. Structure mobile-optimized response
    const mobileUserResponse = {
      id: user?.id,
      email: user?.email,
      role: user?.role,
      profile: user.profile ? {
        id: user.profile.id,
        fullName: user.profile.fullName,
        phone: user.profile.phone,
        avatarUrl: user.profile.avatarUrl,
        timezone: user.profile.timezone,
        timezoneLabel: user.profile.timezoneLabel,
      } : null,
      employee: user?.employee ? {
        id: user.employee.id,
        employeeCode: user.employee.employeeCode,
        firstName: user.employee.firstName,
        lastName: user.employee.lastName,
        designation: user.employee.designation,
        status: user.employee.status,
        department: user.employee.department,
        office: user.employee.office ? {
          id: user.employee.office.id,
          name: user.employee.office.name,
          address: user.employee.office.address,
          latitude: user.employee.office.latitude,
          longitude: user.employee.office.longitude,
          maxRadius: user.employee.office.maxPunchRadiusMeters,
        } : null,
      } : null,
    };

    res.json({
      success: true,
      token,
      refreshToken,
      user: mobileUserResponse,
      fcmToken: req.body.fcmToken || null,
      loginInfo: {
        loginTime: new Date().toISOString(),
        loginLocation: 'Mobile App',
      },
      permissions: {
        canCheckIn: user.role === Role.EMPLOYEE || user.role === Role.HR,
        canApproveLeaves: user.role === Role.HR || user.role === Role.ADMIN,
        canManageEmployees: user.role === Role.HR || user.role === Role.ADMIN,
        canViewReports: user.role === Role.HR || user.role === Role.ADMIN,
      }
    });
  } catch (error) {
    console.error('Mobile login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during mobile login.',
      errorCode: 'SERVER_ERROR'
    });
  }
};

// Mobile logout - simplified to just return success
export const mobileLogout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({
      success: true,
      message: 'Mobile logout successful',
    });
  } catch (error) {
    console.error('Mobile logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during mobile logout',
      errorCode: 'LOGOUT_ERROR'
    });
  }
};

// Refresh token for mobile
export const mobileRefreshToken = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Expect refreshToken from body. Fallback to token (which could be legacy access/refresh token)
    const refreshToken = req.body.refreshToken || req.body.token;

    if (!refreshToken) {
      res.status(400).json({
        success: false,
        message: 'Refresh token is required',
        errorCode: 'MISSING_REFRESH_TOKEN'
      });
      return;
    }
    
    let user;
    try {
      // Try verifying as a refresh token first (uses REFRESH_SECRET)
      user = verifyRefreshToken(refreshToken);
    } catch (error) {
      try {
        // Fallback: try verifying as a legacy token/access token (uses JWT_SECRET)
        user = verifyToken(refreshToken);
      } catch (innerError) {
        res.status(401).json({
          success: false,
          message: 'Invalid or expired refresh token',
          errorCode: 'INVALID_REFRESH_TOKEN'
        });
        return;
      }
    }
    
    // Generate new access token (1 hour)
    const newAccessToken = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // Generate new refresh token (7 days)
    const newRefreshToken = signRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    res.json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: '1h',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Error refreshing token',
      errorCode: 'TOKEN_REFRESH_ERROR'
    });
  }
};

// Get mobile user profile with all necessary data
export const getMobileProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        profile: true,
        employee: {
          include: {
            office: true,
            department: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
        errorCode: 'USER_NOT_FOUND'
      });
      return;
    }

    const mobileProfile = {
      id: user.id,
      email: user.email,
      role: user.role,
      profile: user.profile ? {
        id: user.profile.id,
        fullName: user.profile.fullName,
        phone: user.profile.phone,
        avatarUrl: user.profile.avatarUrl,
        timezone: user.profile.timezone,
        timezoneLabel: user.profile.timezoneLabel,
        bio: user.profile.bio,
      } : null,
      employee: user.employee ? {
        id: user.employee.id,
        employeeCode: user.employee.employeeCode,
        firstName: user.employee.firstName,
        lastName: user.employee.lastName,
        designation: user.employee.designation,
        status: user.employee.status,
        department: user.employee.department,
        office: user.employee.office ? {
          id: user.employee.office.id,
          name: user.employee.office.name,
          address: user.employee.office.address,
          latitude: user.employee.office.latitude,
          longitude: user.employee.office.longitude,
          maxRadius: user.employee.office.maxPunchRadiusMeters,
        } : null,
      } : null,
    };

    res.json({
      success: true,
      user: mobileProfile,
    });
  } catch (error) {
    console.error('Get mobile profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching mobile profile',
      errorCode: 'PROFILE_ERROR'
    });
  }
};
