import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../../utils/db';
import { signToken } from '../../utils/jwt';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';

// Mobile-specific login with enhanced error handling and mobile device info
export const mobileLogin = async (req: Request, res: Response): Promise<void> => {
  const { email, password, deviceInfo, appVersion } = req.body;

  if (!email || !password) {
    res.status(400).json({
      success: false,
      message: 'Email and password are required.',
      errorCode: 'MISSING_CREDENTIALS'
    });
    return;
  }

  try {
    // 1. Fetch user with enhanced includes for mobile
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
              department: true,
            },
          },
        },
      });
    } else {
      // Support employee code login for mobile
      const employee = await prisma.employee.findUnique({
        where: { employeeCode: identifier },
        include: {
          user: {
            include: {
              profile: true,
              employee: {
                include: {
                  office: true,
                  department: true,
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

    // 3. Check if user has mobile-compatible role
    const mobileCompatibleRoles = ['EMPLOYEE' as Role, 'HR' as Role, 'ADMIN' as Role];
    if (!mobileCompatibleRoles.includes(user.role)) {
      res.status(403).json({
        success: false,
        message: 'Mobile access not available for this role.',
        errorCode: 'MOBILE_ACCESS_DENIED'
      });
      return;
    }

    // 4. Generate mobile-specific token
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // 5. Update last login metadata and device info
    let updatedProfile = user.profile;
    const loginLocation = 'Mobile App';
    const loginDevice = deviceInfo?.deviceType || 'Unknown';
    
    if (user.profile) {
      updatedProfile = await prisma.profile.update({
        where: { id: user.profile.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginLocation: loginLocation,
        },
      });
    }

    // 6. Store FCM token if provided
    if (req.body.fcmToken) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          fcmTokens: {
            push: req.body.fcmToken
          }
        },
      });
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
      deviceInfo: {
        loginTime: new Date().toISOString(),
        deviceType: loginDevice,
        appVersion: appVersion || 'Unknown',
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
    const user = req.user;
    
    // Generate new token
    const newToken = signToken({
      id: user!.id,
      email: user!.email,
      role: user!.role,
    });

    res.json({
      success: true,
      token: newToken,
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
