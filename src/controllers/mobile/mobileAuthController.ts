import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../utils/db';
import { signToken, verifyToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import userSessionService from '../../services/userSessionService';
import auditLogService from '../../services/auditLogService';

// Mobile-specific login - simplified to email/employee ID and password only
export const mobileLogin = async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const { email, password } = req.body;

  console.log('[MOBILE_LOGIN] Request received at:', new Date().toISOString());
  console.log('[MOBILE_LOGIN] Identifier:', email);

  if (!email || !password) {
    console.log('[MOBILE_LOGIN] Missing credentials');
    res.status(400).json({
      success: false,
      message: 'Email/Employee ID and password are required.',
      errorCode: 'MISSING_CREDENTIALS'
    });
    return;
  }

  try {
    const identifier = email.trim();
    console.log('[MOBILE_LOGIN] Phase 1: Fetching user auth data...');
    const phase1Start = Date.now();

    let userAuth;

    if (identifier.includes('@')) {
      // Login with email
      const normalizedEmail = identifier.toLowerCase();
      userAuth = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          email: true,
          password: true,
          role: true,
          isActive: true,
          profile: { select: { id: true } },
          employee: { select: { id: true, officeId: true, storeId: true } },
        },
      });
    } else {
      // Login with employee code or mobile number
      const employee = await prisma.employee.findFirst({
        where: {
          OR: [
            { employeeCode: identifier.toUpperCase() },
            { mobileNumber: identifier },
            { mobileNumber: identifier.replace(/\D/g, '') }
          ]
        },
        select: {
          id: true,
          user: {
            select: {
              id: true,
              email: true,
              password: true,
              role: true,
              isActive: true,
              profile: { select: { id: true } },
            },
          },
          officeId: true,
          storeId: true,
        },
      });

      if (employee && employee.user) {
        userAuth = {
          id: employee.user.id,
          email: employee.user.email,
          password: employee.user.password,
          role: employee.user.role,
          isActive: employee.user.isActive,
          profile: employee.user.profile,
          employee: {
            id: employee.id,
            officeId: employee.officeId,
            storeId: employee.storeId,
          },
        };
      }
    }

    console.log('[MOBILE_LOGIN] Phase 1 completed in:', Date.now() - phase1Start, 'ms');

    if (!userAuth || !userAuth.isActive) {
      console.log('[MOBILE_LOGIN] User not found or inactive');
      res.status(401).json({
        success: false,
        message: 'Invalid credentials or inactive account.',
        errorCode: 'INVALID_CREDENTIALS'
      });
      return;
    }

    console.log('[MOBILE_LOGIN] Phase 2: Password comparison...');
    const passwordStart = Date.now();
    const isPasswordMatch = await bcrypt.compare(password, userAuth.password);
    console.log('[MOBILE_LOGIN] Password comparison completed in:', Date.now() - passwordStart, 'ms');
    
    if (!isPasswordMatch) {
      console.log('[MOBILE_LOGIN] Invalid password');
      res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
        errorCode: 'INVALID_PASSWORD'
      });
      return;
    }

    console.log('[MOBILE_LOGIN] Phase 3: Role validation...');
    // Mobile application: HR, EMPLOYEE, SALESMAN, STORE_MANAGER, HELPER are permitted
    const mobileCompatibleRoles: Role[] = [Role.HR, Role.EMPLOYEE, Role.SALESMAN, Role.STORE_MANAGER, Role.HELPER];
    if (!mobileCompatibleRoles.includes(userAuth.role)) {
      console.log('[MOBILE_LOGIN] Incompatible role:', userAuth.role);
      res.status(403).json({
        success: false,
        message: 'Access denied. Your role cannot access the mobile application.',
        errorCode: 'MOBILE_ACCESS_DENIED'
      });
      return;
    }

    // Ensure EMPLOYEE role has office or store assigned (store roles use storeId, HR has no location check)
    const needsOfficeCheck = userAuth.role === Role.EMPLOYEE;
    if (needsOfficeCheck && (!userAuth.employee || (!userAuth.employee.officeId && !userAuth.employee.storeId))) {
      console.log('[MOBILE_LOGIN] Office/store not allotted for employee');
      res.status(403).json({
        success: false,
        message: 'Your office or branch has not been allotted yet. Please contact your HR administrator.',
        errorCode: 'OFFICE_NOT_ALLOTTED'
      });
      return;
    }

    console.log('[MOBILE_LOGIN] Phase 4: Loading full profile data...');
    const phase4Start = Date.now();

    // Phase 2: load full profile data only after successful authentication
    const user = await prisma.user.findUnique({
      where: { id: userAuth.id },
      include: {
        profile: true,
        employee: {
          include: {
            office: true,
            department: true,
            salaryStructure: true,
          },
        },
      },
    });

    console.log('[MOBILE_LOGIN] Phase 4 completed in:', Date.now() - phase4Start, 'ms');

    if (!user) {
      console.log('[MOBILE_LOGIN] User not found in phase 4');
      res.status(401).json({
        success: false,
        message: 'Invalid credentials or inactive account.',
        errorCode: 'INVALID_CREDENTIALS'
      });
      return;
    }

    console.log('[MOBILE_LOGIN] Phase 5: Generating tokens...');
    const tokenStart = Date.now();

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

    const ipAddress = req.ip || req.socket.remoteAddress;
    const deviceInfo = req.headers['user-agent'] || 'Mobile App';
    await userSessionService.createSession(user.id, refreshToken, deviceInfo, ipAddress);

    // Audit Log
    await auditLogService.log({
      userId: user.id,
      employeeId: user.employee?.id || undefined,
      branchId: user.employee?.officeId || undefined,
      ipAddress,
      deviceInfo,
      action: 'MOBILE_USER_LOGIN',
    });

    console.log('[MOBILE_LOGIN] Token generation completed in:', Date.now() - tokenStart, 'ms');

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

    console.log('[MOBILE_LOGIN] Phase 6: Structuring response...');

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
        salary: user.employee.salaryStructure ? user.employee.salaryStructure.monthlySalary : 0,
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

    const totalTime = Date.now() - startTime;
    console.log('[MOBILE_LOGIN] Total request time:', totalTime, 'ms');

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
    const totalTime = Date.now() - startTime;
    console.error('[MOBILE_LOGIN] Error after', totalTime, 'ms:', error);
    
    // Include error details in development mode for debugging
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    res.status(500).json({
      success: false,
      message: 'Internal server error during mobile login.',
      errorCode: 'SERVER_ERROR',
      ...(isDevelopment && {
        details: errorMessage,
        stack: errorStack
      })
    });
  }
};

// Mobile logout - simplified to just return success
export const mobileLogout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
        deviceInfo: req.headers['user-agent'] || 'Mobile App',
        action: 'MOBILE_USER_LOGOUT',
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

    const ipAddress = req.ip || req.socket.remoteAddress;
    const deviceInfo = req.headers['user-agent'] || 'Mobile App';

    const rotationResult = await userSessionService.rotateToken(refreshToken, deviceInfo, ipAddress);
    if (!rotationResult) {
      // Fallback: try verifying as a legacy access/refresh token to keep backward compatibility
      try {
        const legacyUser = verifyToken(refreshToken);
        const newAccessToken = signAccessToken({
          id: legacyUser.id,
          email: legacyUser.email,
          role: legacyUser.role,
        });
        const newRefreshToken = signRefreshToken({
          id: legacyUser.id,
          email: legacyUser.email,
          role: legacyUser.role,
        });
        res.json({
          success: true,
          token: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: '1h',
          user: {
            id: legacyUser.id,
            email: legacyUser.email,
            role: legacyUser.role,
          }
        });
        return;
      } catch (err) {
        try {
          const legacyUser = verifyRefreshToken(refreshToken);
          const newAccessToken = signAccessToken({
            id: legacyUser.id,
            email: legacyUser.email,
            role: legacyUser.role,
          });
          const newRefreshToken = signRefreshToken({
            id: legacyUser.id,
            email: legacyUser.email,
            role: legacyUser.role,
          });
          res.json({
            success: true,
            token: newAccessToken,
            refreshToken: newRefreshToken,
            expiresIn: '1h',
            user: {
              id: legacyUser.id,
              email: legacyUser.email,
              role: legacyUser.role,
            }
          });
          return;
        } catch (innerError) {
          res.status(401).json({
            success: false,
            message: 'Invalid or expired refresh token',
            errorCode: 'INVALID_REFRESH_TOKEN'
          });
          return;
        }
      }
    }

    res.json({
      success: true,
      token: rotationResult.accessToken,
      refreshToken: rotationResult.refreshToken,
      expiresIn: '1h',
      user: {
        id: rotationResult.payload.id,
        email: rotationResult.payload.email,
        role: rotationResult.payload.role,
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
            salaryStructure: true,
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
        aadharNumber: user.profile.aadharNumber,
        pfNumber: user.profile.pfNumber,
        esicNumber: user.profile.esicNumber,
        isHandicapped: user.profile.isHandicapped,
        currentAddress: user.profile.currentAddress,
        permanentAddress: user.profile.permanentAddress,
      } : null,
      employee: user.employee ? {
        id: user.employee.id,
        employeeCode: user.employee.employeeCode,
        firstName: user.employee.firstName,
        lastName: user.employee.lastName,
        designation: user.employee.designation,
        status: user.employee.status,
        department: user.employee.department,
        departmentId: user.employee.departmentId,
        shiftTypeId: user.employee.shiftTypeId,
        workModeId: user.employee.workModeId,
        salary: user.employee.salaryStructure ? user.employee.salaryStructure.monthlySalary : 0,
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

export const changeMobilePassword = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ success: false, message: 'Current password and new password are required.' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user?.id }
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      res.status(400).json({ success: false, message: 'Current password is incorrect.' });
      return;
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
      },
    });

    res.json({
      success: true,
      message: 'Password changed successfully.',
    });
  } catch (error) {
    console.error('Change mobile password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password.',
      errorCode: 'PASSWORD_CHANGE_ERROR'
    });
  }
};

export const updateMobileProfile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const {
      fullName,
      phone,
      avatarUrl,
      timezone,
      timezoneLabel,
      bio,
      aadharNumber,
      pfNumber,
      esicNumber,
      isHandicapped,
      currentAddress,
      permanentAddress,
      departmentId,
      shiftTypeId,
      workModeId,
    } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      include: { profile: true, employee: true },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    if (!user.profile) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: user.profile.id },
      data: {
        ...(fullName !== undefined && { fullName }),
        ...(phone !== undefined && { phone }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(timezone !== undefined && { timezone }),
        ...(timezoneLabel !== undefined && { timezoneLabel }),
        ...(bio !== undefined && { bio }),
        ...(aadharNumber !== undefined && { aadharNumber }),
        ...(pfNumber !== undefined && { pfNumber }),
        ...(esicNumber !== undefined && { esicNumber }),
        ...(isHandicapped !== undefined && { isHandicapped }),
        ...(currentAddress !== undefined && { currentAddress }),
        ...(permanentAddress !== undefined && { permanentAddress }),
      },
    });

    // Update employee-level department/shift/work mode if provided
    if (user.employee) {
      const employeeUpdateData: any = {};
      if (departmentId !== undefined) {
        employeeUpdateData.departmentId = departmentId || null;
      }
      if (shiftTypeId !== undefined) employeeUpdateData.shiftTypeId = shiftTypeId;
      if (workModeId !== undefined) employeeUpdateData.workModeId = workModeId;

      if (Object.keys(employeeUpdateData).length > 0) {
        await prisma.employee.update({
          where: { id: user.employee.id },
          data: employeeUpdateData,
        });
      }
    }

    res.json({
      success: true,
      message: 'Profile updated successfully.',
      profile: {
        id: updatedProfile.id,
        fullName: updatedProfile.fullName,
        phone: updatedProfile.phone,
        avatarUrl: updatedProfile.avatarUrl,
        timezone: updatedProfile.timezone,
        timezoneLabel: updatedProfile.timezoneLabel,
        bio: updatedProfile.bio,
        aadharNumber: updatedProfile.aadharNumber,
        pfNumber: updatedProfile.pfNumber,
        esicNumber: updatedProfile.esicNumber,
        isHandicapped: updatedProfile.isHandicapped,
        currentAddress: updatedProfile.currentAddress,
        permanentAddress: updatedProfile.permanentAddress,
      },
    });
  } catch (error) {
    console.error('Update mobile profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile.',
      errorCode: 'PROFILE_UPDATE_ERROR'
    });
  }
};

export const mobileLogoutAll = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (req.user) {
      await userSessionService.revokeAllSessions(req.user.id);
      const employee = await prisma.employee.findFirst({ where: { userId: req.user.id } });
      await auditLogService.log({
        userId: req.user.id,
        employeeId: employee?.id || undefined,
        branchId: employee?.officeId || undefined,
        ipAddress: req.ip || req.socket.remoteAddress,
        deviceInfo: req.headers['user-agent'] || 'Mobile App',
        action: 'MOBILE_USER_LOGOUT_ALL_DEVICES',
      });
    }

    res.json({
      success: true,
      message: 'Logged out from all devices successfully',
    });
  } catch (error) {
    console.error('Mobile logout all error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during mobile logout all',
      errorCode: 'LOGOUT_ALL_ERROR'
    });
  }
};

export const uploadMobileAvatar = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { avatarUrl, imageBase64 } = req.body;

  let urlToSave = avatarUrl;
  if (imageBase64) {
    urlToSave = imageBase64;
  }

  if (!urlToSave) {
    res.status(400).json({ success: false, message: 'Avatar image is required.' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { profile: true },
    });

    if (!user || !user.profile) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: user.profile.id },
      data: { avatarUrl: urlToSave },
    });

    res.json({
      success: true,
      message: 'Avatar uploaded successfully!',
      profile: {
        id: updatedProfile.id,
        avatarUrl: updatedProfile.avatarUrl,
      },
    });
  } catch (error) {
    console.error('Upload mobile avatar error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload avatar.' });
  }
};

export const removeMobileAvatar = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { profile: true },
    });

    if (!user || !user.profile) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: user.profile.id },
      data: { avatarUrl: '/favicon.svg' },
    });

    res.json({
      success: true,
      message: 'Avatar removed successfully!',
      profile: {
        id: updatedProfile.id,
        avatarUrl: updatedProfile.avatarUrl,
      },
    });
  } catch (error) {
    console.error('Remove mobile avatar error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove avatar.' });
  }
};

// Fetch all departments for mobile profile selection
export const fetchMobileDepartments = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const departments = await prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
      },
    });

    res.json({
      success: true,
      departments,
    });
  } catch (error) {
    console.error('Fetch mobile departments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch departments.',
      errorCode: 'DEPARTMENTS_FETCH_ERROR',
    });
  }
};
