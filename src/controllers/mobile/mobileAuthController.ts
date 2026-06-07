import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../../utils/db';
import { signToken, verifyToken } from '../../utils/jwt';
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
    // 1. Fetch user by email only (simplified for mobile)
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
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

    if (!user || !user.isActive) {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials or inactive account.',
        errorCode: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // 2. Verify password
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
        errorCode: 'INVALID_PASSWORD'
      });
      return;
    }

    // 3. Check if user has mobile-compatible role (block SUPER_ADMIN and PLATFORM_ADMIN)
    const mobileCompatibleRoles = ['EMPLOYEE' as Role, 'HR' as Role, 'ADMIN' as Role];
    const blockedRoles = ['SUPER_ADMIN' as Role, 'PLATFORM_ADMIN' as Role];
    if (blockedRoles.includes(user.role)) {
      res.status(403).json({
        success: false,
        message: 'Super Admin and Platform Admin roles cannot access the mobile app. Please use the web portal.',
        errorCode: 'MOBILE_ACCESS_DENIED'
      });
      return;
    }
    if (!mobileCompatibleRoles.includes(user.role)) {
      res.status(403).json({
        success: false,
        message: 'Mobile access not available for this role.',
        errorCode: 'MOBILE_ACCESS_DENIED'
      });
      return;
    }

    // 3.5. Check office/branch allotment for employees
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

    // 4. Generate mobile-specific token
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // 5. Update last login metadata
    let updatedProfile = user.profile;
    const loginLocation = 'Mobile App';
    
    if (user.profile) {
      updatedProfile = await prisma.profile.update({
        where: { id: user.profile.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginLocation: loginLocation,
        },
      });
    }

    // 6. Store FCM token if provided (optional)
    if (req.body.fcmToken) {
      const existingToken = await prisma.fCMToken.findFirst({
        where: { userId: user.id, token: req.body.fcmToken }
      });
      
      if (!existingToken) {
        await prisma.fCMToken.create({
          data: {
            userId: user.id,
            token: req.body.fcmToken,
            platform: 'mobile',
            isActive: true,
            lastUsedAt: new Date(),
          }
        });
      } else {
        await prisma.fCMToken.update({
          where: { id: existingToken.id },
          data: {
            isActive: true,
            lastUsedAt: new Date(),
          }
        });
      }
    }

    // 7. Structure mobile-optimized response
    const mobileUserResponse = {
      id: user?.id,
      email: user?.email,
      role: user?.role,
      profile: updatedProfile ? {
        id: updatedProfile.id,
        fullName: updatedProfile.fullName,
        phone: updatedProfile.phone,
        avatarUrl: updatedProfile.avatarUrl,
        timezone: updatedProfile.timezone,
        timezoneLabel: updatedProfile.timezoneLabel,
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

// Mobile logout with device cleanup
export const mobileLogout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { fcmToken } = req.body;
    
    if (fcmToken && req.user) {
      // Remove FCM token from user's tokens
      await prisma.user.update({
        where: { id: req.user?.id },
        data: {
          fcmTokens: {
            set: [] // Clear all tokens or implement specific token removal
          }
        },
      });
    }

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
    // Try to get user from auth middleware first (if token is still valid)
    let user = req.user;
    
    // If no user from middleware, try to verify token from request body
    if (!user) {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({
          success: false,
          message: 'Token is required',
          errorCode: 'MISSING_TOKEN'
        });
        return;
      }
      
      try {
        user = verifyToken(token);
      } catch (error) {
        res.status(401).json({
          success: false,
          message: 'Invalid or expired token',
          errorCode: 'INVALID_TOKEN'
        });
        return;
      }
    }
    
    // Generate new token (7 days expiration for mobile)
    const newToken = signToken({
      id: user!.id,
      email: user!.email,
      role: user!.role,
    });

    res.json({
      success: true,
      token: newToken,
      expiresIn: '7d',
      user: {
        id: user?.id,
        email: user?.email,
        role: user?.role,
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
