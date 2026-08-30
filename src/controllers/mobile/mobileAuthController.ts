import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../utils/db';
import { signToken, verifyToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import userSessionService from '../../services/userSessionService';
import auditLogService from '../../services/auditLogService';
import { syncHopkidEmployees } from '../../utils/employeeSync';
import { getEffectiveUserPermissions } from '../../utils/permissionHelper';
import { logActivity } from '../../utils/activityLogger';
import {
  isProtectedEmail,
  PROTECTED_SYSTEM_ACCOUNT_MESSAGES
} from '../../utils/protectedAccounts';

// Mobile-specific login - supports email, mobile number, or employee code + password
export const mobileLogin = async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const { email, mobileNo, mobileNumber, identifier: rawId, password } = req.body;
  const inputIdentifier = mobileNo || mobileNumber || rawId || email;

  console.log('[MOBILE_LOGIN] Request received at:', new Date().toISOString());
  console.log('[MOBILE_LOGIN] Identifier:', inputIdentifier);

  if (!inputIdentifier || !password) {
    console.log('[MOBILE_LOGIN] Missing credentials');
    res.status(400).json({
      success: false,
      message: 'Mobile number/Email/Employee ID and password are required.',
      errorCode: 'MISSING_CREDENTIALS'
    });
    return;
  }

  try {
    const identifier = String(inputIdentifier).trim();
    console.log('[MOBILE_LOGIN] Phase 1: Fetching user auth data...');
    const phase1Start = Date.now();

    let userAuth: any = null;
    let employeeUnregistered = false;

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
      const cleanedMobile = identifier.replace(/\D/g, '');
      let employee = await prisma.employee.findFirst({
        where: {
          OR: [
            { employeeCode: identifier.toUpperCase() },
            { employeeCode: identifier },
            { mobileNumber: identifier },
            ...(cleanedMobile ? [{ mobileNumber: cleanedMobile }] : []),
            ...(cleanedMobile.length >= 10 ? [
              { mobileNumber: `+91${cleanedMobile.slice(-10)}` },
              { mobileNumber: `+91 ${cleanedMobile.slice(-10)}` },
              { mobileNumber: `91${cleanedMobile.slice(-10)}` }
            ] : []),
            ...(identifier.length >= 10 ? [{ mobileNumber: { contains: identifier.slice(-10) } }] : [])
          ]
        },
        select: {
          id: true,
          userId: true,
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

      if (!employee) {
        // Try syncing from HopKid API on-the-fly if not cached locally
        console.log('[MOBILE_LOGIN] Employee not found locally, running HopKid sync on-the-fly...');
        await syncHopkidEmployees().catch(() => {});
        employee = await prisma.employee.findFirst({
          where: {
            OR: [
              { employeeCode: identifier.toUpperCase() },
              { employeeCode: identifier },
              { mobileNumber: identifier },
              ...(cleanedMobile ? [{ mobileNumber: cleanedMobile }] : []),
              ...(cleanedMobile.length >= 10 ? [
                { mobileNumber: `+91${cleanedMobile.slice(-10)}` },
                { mobileNumber: `+91 ${cleanedMobile.slice(-10)}` },
                { mobileNumber: `91${cleanedMobile.slice(-10)}` }
              ] : []),
              ...(identifier.length >= 10 ? [{ mobileNumber: { contains: identifier.slice(-10) } }] : [])
            ]
          },
          select: {
            id: true,
            userId: true,
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
      }

      if (employee) {
        if (!employee.user) {
          employeeUnregistered = true;
        } else {
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
    }

    console.log('[MOBILE_LOGIN] Phase 1 completed in:', Date.now() - phase1Start, 'ms');

    if (employeeUnregistered) {
      console.log('[MOBILE_LOGIN] Employee found in directory but user row not registered yet');
      res.status(401).json({
        success: false,
        message: 'Account not registered yet. Please register first using your mobile number and employee code.',
        errorCode: 'ACCOUNT_NOT_REGISTERED'
      });
      return;
    }

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
        message: 'Invalid mobile number/email or password.',
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
        branchName: user.employee.branchName || user.employee.office?.name,
        storeId: user.employee.storeId?.toString() || user.employee.officeId?.toString(),
        storeName: user.employee.office?.name || user.employee.branchName,
        salary: user.employee.salaryStructure ? user.employee.salaryStructure.monthlySalary : 0,
        joiningDate: user.employee.joiningDate ? user.employee.joiningDate.toISOString() : null,
        dateOfJoining: user.employee.joiningDate ? user.employee.joiningDate.toISOString() : null,
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

    const userPermissions = await getEffectiveUserPermissions(user.id);

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        ...mobileUserResponse,
        permissions: userPermissions,
      },
      fcmToken: req.body.fcmToken || null,
      loginInfo: {
        loginTime: new Date().toISOString(),
        loginLocation: 'Mobile App',
      },
      permissions: userPermissions,
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

      logActivity({
        actorId: req.user.id,
        actorName: req.user.email,
        actorRole: req.user.role || 'EMPLOYEE',
        source: 'MOBILE',
        action: 'MOBILE_LOGOUT',
        entityType: 'User',
        entityId: req.user.id,
        description: `Mobile user ${req.user.email} logged out`,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        status: 'SUCCESS'
      }).catch(() => null);
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
        branchName: user.employee.branchName || user.employee.office?.name,
        storeId: user.employee.storeId?.toString() || user.employee.officeId?.toString(),
        storeName: user.employee.office?.name || user.employee.branchName,
        salary: user.employee.salaryStructure ? user.employee.salaryStructure.monthlySalary : 0,
        joiningDate: user.employee.joiningDate ? user.employee.joiningDate.toISOString() : null,
        dateOfJoining: user.employee.joiningDate ? user.employee.joiningDate.toISOString() : null,
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

    const userPermissions = await getEffectiveUserPermissions(user.id);

    res.json({
      success: true,
      user: {
        ...mobileProfile,
        permissions: userPermissions,
      },
      permissions: userPermissions,
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

    if (isProtectedEmail(req.user?.email)) {
      res.status(403).json({
        success: false,
        message: PROTECTED_SYSTEM_ACCOUNT_MESSAGES.CANNOT_CHANGE_OWN_PASSWORD,
        errorCode: 'PROTECTED_ACCOUNT'
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user?.id }
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    if (isProtectedEmail(user.email)) {
      res.status(403).json({
        success: false,
        message: PROTECTED_SYSTEM_ACCOUNT_MESSAGES.CANNOT_CHANGE_OWN_PASSWORD,
        errorCode: 'PROTECTED_ACCOUNT'
      });
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
        const parsedDepartmentId = parseInt(departmentId as string, 10);
        employeeUpdateData.departmentId = isNaN(parsedDepartmentId) ? null : parsedDepartmentId;
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
      data: { avatarUrl: null },
    });

    res.json({
      success: true,
      message: 'Avatar removed successfully!',
      profile: {
        id: updatedProfile.id,
        avatarUrl: null,
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

// Step 1: Verify mobile number against HopKid employee directory
export const verifyMobileNumber = async (req: Request, res: Response): Promise<void> => {
  const { mobileNo, mobileNumber } = req.body;
  const rawMobile = mobileNo || mobileNumber;

  if (!rawMobile) {
    res.status(400).json({
      success: false,
      message: 'Mobile number is required for verification.',
      errorCode: 'MISSING_MOBILE'
    });
    return;
  }

  try {
    const inputMobile = String(rawMobile).trim();
    const inputPhoneDigits = inputMobile.replace(/\D/g, '').slice(-10);

    if (inputPhoneDigits.length < 10) {
      res.status(400).json({
        success: false,
        message: 'Please enter a valid 10-digit mobile number.',
        errorCode: 'INVALID_MOBILE'
      });
      return;
    }

    const normalizePhone = (p: string | null | undefined): string => {
      if (!p) return '';
      const digits = String(p).replace(/\D/g, '');
      return digits.length >= 10 ? digits.slice(-10) : digits;
    };

    // 1. Query employee table by containing last 10 digits
    let candidatePool = await prisma.employee.findMany({
      where: {
        mobileNumber: { contains: inputPhoneDigits }
      },
      include: {
        user: true,
        office: true,
        store: true
      }
    });

    let employee = candidatePool.find(e => normalizePhone(e.mobileNumber) === inputPhoneDigits);

    // 2. On-the-fly sync from HopKid API if not found in local DB
    if (!employee) {
      console.log('[VERIFY_MOBILE] Mobile not in local DB. Syncing HopKid directory...');
      await syncHopkidEmployees().catch(err => console.error('[VERIFY_MOBILE] HopKid sync error:', err));

      candidatePool = await prisma.employee.findMany({
        where: {
          mobileNumber: { contains: inputPhoneDigits }
        },
        include: {
          user: true,
          office: true,
          store: true
        }
      });

      employee = candidatePool.find(e => normalizePhone(e.mobileNumber) === inputPhoneDigits);
    }

    // 3. Fallback scan all employees if contains missed formatting
    if (!employee) {
      const allEmployees = await prisma.employee.findMany({
        include: { user: true, office: true, store: true }
      });
      employee = allEmployees.find(e => normalizePhone(e.mobileNumber) === inputPhoneDigits);
    }

    if (!employee) {
      res.status(400).json({
        success: false,
        message: 'This mobile number is not registered as a HopKid employee. Contact HR.',
        errorCode: 'NOT_HOPKID_EMPLOYEE'
      });
      return;
    }

    if (employee.status !== 'active') {
      res.status(400).json({
        success: false,
        message: 'Your account is inactive. Contact HR.',
        errorCode: 'ACCOUNT_INACTIVE'
      });
      return;
    }

    if (employee.userId || employee.user) {
      res.status(400).json({
        success: false,
        message: 'Account exists, please login.',
        errorCode: 'ALREADY_REGISTERED'
      });
      return;
    }

    const fullName = `${employee.firstName} ${employee.lastName || ''}`.trim();

    res.json({
      success: true,
      verified: true,
      employeeName: fullName,
      employeeCode: employee.employeeCode,
      message: `Registered employee found: ${fullName}`
    });
  } catch (error: any) {
    console.error('[VERIFY_MOBILE] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify mobile number. Please try again.',
      errorCode: 'SERVER_ERROR'
    });
  }
};

// Mobile user registration endpoint - Step 2 completion
export const mobileRegister = async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const { mobileNo, mobileNumber, employeeCode, password, email } = req.body;
  const rawMobile = mobileNo || mobileNumber;

  console.log('[MOBILE_REGISTER] Request received at:', new Date().toISOString());

  if (!rawMobile || !employeeCode || !password) {
    res.status(400).json({
      success: false,
      message: 'Mobile number, employee code, and password are required for registration.',
      errorCode: 'MISSING_FIELDS'
    });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long.',
      errorCode: 'WEAK_PASSWORD'
    });
    return;
  }

  try {
    const inputMobile = String(rawMobile).trim();
    const inputPhoneDigits = inputMobile.replace(/\D/g, '').slice(-10);

    const normalizePhone = (p: string | null | undefined): string => {
      if (!p) return '';
      const digits = String(p).replace(/\D/g, '');
      return digits.length >= 10 ? digits.slice(-10) : digits;
    };

    // 1. Search employee by mobile number
    let candidatePool = await prisma.employee.findMany({
      where: {
        mobileNumber: { contains: inputPhoneDigits }
      },
      include: {
        user: true,
        office: true,
        store: true
      }
    });

    let employee = candidatePool.find(e => normalizePhone(e.mobileNumber) === inputPhoneDigits);

    // 2. If not found in local DB, sync from HopKid API on-the-fly and retry search
    if (!employee) {
      console.log('[MOBILE_REGISTER] Employee not found in local DB. Syncing HopKid employees...');
      await syncHopkidEmployees().catch(err => console.error('[MOBILE_REGISTER] HopKid sync error:', err));

      candidatePool = await prisma.employee.findMany({
        where: {
          mobileNumber: { contains: inputPhoneDigits }
        },
        include: {
          user: true,
          office: true,
          store: true
        }
      });

      employee = candidatePool.find(e => normalizePhone(e.mobileNumber) === inputPhoneDigits);
    }

    if (!employee) {
      const allEmployees = await prisma.employee.findMany({
        include: { user: true, office: true, store: true }
      });
      employee = allEmployees.find(e => normalizePhone(e.mobileNumber) === inputPhoneDigits);
    }

    if (!employee) {
      res.status(400).json({
        success: false,
        message: 'This mobile number is not registered as a HopKid employee. Contact HR.',
        errorCode: 'NOT_HOPKID_EMPLOYEE'
      });
      return;
    }

    if (employee.status !== 'active') {
      res.status(400).json({
        success: false,
        message: 'Your account is inactive. Contact HR.',
        errorCode: 'ACCOUNT_INACTIVE'
      });
      return;
    }

    if (employee.userId || employee.user) {
      res.status(400).json({
        success: false,
        message: 'Account exists, please login.',
        errorCode: 'ALREADY_REGISTERED'
      });
      return;
    }

    // 3. Employee code verification
    const cleanInputCode = String(employeeCode).trim().replace(/^EMP/i, '').replace(/^0+/, '').toUpperCase();
    const cleanEmpCode = String(employee.employeeCode).trim().replace(/^EMP/i, '').replace(/^0+/, '').toUpperCase();
    const exactEmpCode = String(employee.employeeCode).trim().toUpperCase();
    const inputUpper = String(employeeCode).trim().toUpperCase();

    const codeMatches = (inputUpper === exactEmpCode) || (cleanInputCode === cleanEmpCode);

    if (!codeMatches) {
      res.status(400).json({
        success: false,
        message: 'Employee code does not match the registered mobile number.',
        errorCode: 'CODE_MISMATCH'
      });
      return;
    }

    // Optional email uniqueness validation if email provided
    let normalizedEmail: string | null = null;
    if (email && typeof email === 'string' && email.trim() !== '') {
      normalizedEmail = email.trim().toLowerCase();
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        res.status(400).json({
          success: false,
          message: 'An account with this email address already exists.',
          errorCode: 'EMAIL_IN_USE'
        });
        return;
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const fullName = `${employee.firstName} ${employee.lastName}`.trim();
    const finalEmployeeID = (employee.employeeID || employee.employeeCode).toLowerCase();

    // Create User & Profile
    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        role: Role.EMPLOYEE,
        isActive: true,
        employeeID: finalEmployeeID,
        profile: {
          create: {
            email: normalizedEmail || '',
            fullName,
            phone: employee.mobileNumber || inputMobile,
            bio: '',
            clearanceLevel: 1,
            clearanceLabel: 'Level 1 (General)',
            timezone: 'Asia/Kolkata',
            timezoneLabel: '(GMT+5:30) Mumbai, New Delhi',
            lastLoginLocation: 'Mobile App',
          }
        }
      },
      include: {
        profile: true
      }
    });

    // Link Employee to User
    await prisma.employee.update({
      where: { id: employee.id },
      data: { userId: newUser.id }
    });

    // Allocate leave balance
    try {
      const leaveBalanceService = require('../../services/leaveBalanceService').default;
      await leaveBalanceService.createOrUpdateLeaveBalance({
        employeeId: employee.id,
        departmentId: employee.departmentId || undefined,
        createdBy: 'Mobile Registration'
      });
    } catch (lErr) {
      console.error('[MOBILE_REGISTER] Leave balance error (non-fatal):', lErr);
    }

    // Auto-create initial SalaryStructure
    try {
      await prisma.salaryStructure.create({
        data: {
          employeeId: employee.id,
          basicSalary: 10000,
          hra: 2000,
          medicalAllowance: 500,
          travelAllowance: 1000,
          specialAllowance: 0,
          monthlySalary: 13500,
          grossSalary: 13500,
          salaryAdvanceLimit: 25000,
        }
      });
    } catch (sErr) {
      console.warn('[MOBILE_REGISTER] SalaryStructure creation warning (non-fatal):', sErr);
    }

    // Issue JWT tokens
    const token = signAccessToken({
      id: newUser.id,
      email: newUser.email || '',
      role: newUser.role,
    });

    const refreshToken = signRefreshToken({
      id: newUser.id,
      email: newUser.email || '',
      role: newUser.role,
    });

    const ipAddress = req.ip || req.socket.remoteAddress;
    const deviceInfo = req.headers['user-agent'] || 'Mobile App';
    await userSessionService.createSession(newUser.id, refreshToken, deviceInfo, ipAddress);
    await auditLogService.log({
      userId: newUser.id,
      employeeId: employee.id,
      branchId: employee.officeId || undefined,
      ipAddress,
      deviceInfo,
      action: 'MOBILE_USER_REGISTER',
    });

    console.log(`[MOBILE_REGISTER] Successfully registered employee ${employee.employeeCode} (User ID: ${newUser.id})`);

    res.status(201).json({
      success: true,
      message: 'Registration successful!',
      token,
      refreshToken,
      user: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        profile: newUser.profile ? {
          id: newUser.profile.id,
          fullName: newUser.profile.fullName,
          phone: newUser.profile.phone,
        } : null,
        employee: {
          id: employee.id,
          employeeCode: employee.employeeCode,
          firstName: employee.firstName,
          lastName: employee.lastName,
          designation: employee.designation,
          status: employee.status,
          office: employee.office ? {
            id: employee.office.id,
            name: employee.office.name,
            address: employee.office.address,
            latitude: employee.office.latitude,
            longitude: employee.office.longitude,
            maxRadius: employee.office.maxPunchRadiusMeters,
          } : null,
          store: employee.store ? {
            id: employee.store.id,
            name: employee.store.name,
          } : null,
        }
      }
    });
  } catch (error: any) {
    console.error('[MOBILE_REGISTER] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during registration.',
      errorCode: 'SERVER_ERROR',
      ...(process.env.NODE_ENV !== 'production' && { details: error.message })
    });
  }
};

// Helper to lookup employee by Employee Code, Mobile Number, or Email
const findEmployeeByIdentifier = async (inputStr: string) => {
  const cleanInput = String(inputStr).trim();
  if (!cleanInput) return null;

  // 1. Email lookup
  if (cleanInput.includes('@')) {
    const normEmail = cleanInput.toLowerCase();
    const user = await prisma.user.findFirst({
      where: { email: normEmail },
      include: { employee: true }
    });
    if (user && user.employee) {
      return { employee: user.employee, user };
    }
  }

  // 2. Mobile Number lookup
  const phoneDigits = cleanInput.replace(/\D/g, '');
  if (phoneDigits.length >= 10) {
    const last10 = phoneDigits.slice(-10);
    const candidatePool = await prisma.employee.findMany({
      where: { mobileNumber: { contains: last10 } },
      include: { user: true }
    });
    const match = candidatePool.find(e => e.mobileNumber?.replace(/\D/g, '').slice(-10) === last10);
    if (match) {
      return { employee: match, user: match.user };
    }
  }

  // 3. Employee Code / ID lookup
  const cleanCode = cleanInput.replace(/^EMP/i, '').replace(/^0+/, '').toUpperCase();
  const allEmployees = await prisma.employee.findMany({ include: { user: true } });
  const codeMatch = allEmployees.find(e => {
    const eCode = String(e.employeeCode || '').trim().replace(/^EMP/i, '').replace(/^0+/, '').toUpperCase();
    return eCode === cleanCode || e.employeeCode.toUpperCase() === cleanInput.toUpperCase() || String(e.id) === cleanInput;
  });
  if (codeMatch) {
    return { employee: codeMatch, user: codeMatch.user };
  }

  return null;
};

// Verify user account identifier (Step 1 of reset password)
export const verifyResetIdentifier = async (req: Request, res: Response): Promise<void> => {
  const { identifier, mobileNo, employeeCode, email } = req.body;
  const input = identifier || mobileNo || employeeCode || email;

  if (!input) {
    res.status(400).json({
      success: false,
      message: 'Please enter your Employee Code, Mobile Number, or Email.',
      errorCode: 'MISSING_IDENTIFIER'
    });
    return;
  }

  try {
    const result = await findEmployeeByIdentifier(String(input));

    if (!result || !result.employee) {
      res.status(400).json({
        success: false,
        message: 'No account found matching this Employee Code, Mobile Number, or Email.',
        errorCode: 'ACCOUNT_NOT_FOUND'
      });
      return;
    }

    if (isProtectedEmail(input) || isProtectedEmail(result.user?.email) || isProtectedEmail((result.employee as any)?.email)) {
      res.status(403).json({
        success: false,
        message: 'Password reset is not allowed for protected system accounts. Password can only be changed by authorized HR administrators.',
        errorCode: 'PROTECTED_ACCOUNT'
      });
      return;
    }

    const { employee } = result;
    const fullName = `${employee.firstName} ${employee.lastName || ''}`.trim();

    res.status(200).json({
      success: true,
      verified: true,
      employeeName: fullName,
      employeeCode: employee.employeeCode,
      mobileNumber: employee.mobileNumber,
      message: `Account verified for ${fullName} (${employee.employeeCode}). You can now reset your password.`
    });
  } catch (error: any) {
    console.error('[VERIFY_RESET_IDENTIFIER] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify account details.',
      errorCode: 'SERVER_ERROR'
    });
  }
};

// Mobile Reset / Forgot Password with Employee Code / Mobile No / Email + New Password
export const mobileResetPassword = async (req: Request, res: Response): Promise<void> => {
  const { identifier, mobileNo, employeeCode, email, newPassword, password } = req.body;
  const input = identifier || mobileNo || employeeCode || email;
  const finalPassword = newPassword || password;

  if (!input || !finalPassword) {
    res.status(400).json({
      success: false,
      message: 'Employee Code / Mobile No / Email and new password are required.',
      errorCode: 'MISSING_FIELDS'
    });
    return;
  }

  if (finalPassword.length < 6) {
    res.status(400).json({
      success: false,
      message: 'New password must be at least 6 characters long.',
      errorCode: 'WEAK_PASSWORD'
    });
    return;
  }

  try {
    const result = await findEmployeeByIdentifier(String(input));

    if (!result || !result.employee) {
      res.status(400).json({
        success: false,
        message: 'No account found matching this Employee Code, Mobile Number, or Email.',
        errorCode: 'ACCOUNT_NOT_FOUND'
      });
      return;
    }

    const { employee, user } = result;

    if (isProtectedEmail(input) || isProtectedEmail(user?.email) || isProtectedEmail((employee as any)?.email)) {
      res.status(403).json({
        success: false,
        message: 'Password reset is not allowed for protected system accounts. Password can only be changed by authorized HR administrators.',
        errorCode: 'PROTECTED_ACCOUNT'
      });
      return;
    }
    const hashedPassword = await bcrypt.hash(finalPassword, 10);

    if (user || employee.userId) {
      const targetUserId = user?.id || employee.userId;
      if (targetUserId) {
        await prisma.user.update({
          where: { id: targetUserId },
          data: { password: hashedPassword, isActive: true }
        });
      }
    } else {
      const fullName = `${employee.firstName} ${employee.lastName || ''}`.trim();
      const finalEmployeeID = (employee.employeeID || employee.employeeCode).toLowerCase();
      const empEmail = (employee as any).email || null;

      const newUser = await prisma.user.create({
        data: {
          email: empEmail,
          password: hashedPassword,
          role: Role.EMPLOYEE,
          isActive: true,
          employeeID: finalEmployeeID,
          profile: {
            create: {
              email: empEmail || '',
              fullName,
              phone: employee.mobileNumber || '',
              bio: '',
              clearanceLevel: 1,
              clearanceLabel: 'Level 1 (General)',
              timezone: 'Asia/Kolkata',
              timezoneLabel: '(GMT+5:30) Mumbai, New Delhi',
              lastLoginLocation: 'Mobile App',
            }
          }
        }
      });

      await prisma.employee.update({
        where: { id: employee.id },
        data: { userId: newUser.id }
      });
    }

    console.log(`[MOBILE_RESET_PASSWORD] Successfully reset password for employee ${employee.employeeCode}`);

    res.status(200).json({
      success: true,
      message: 'Password reset successfully! You can now login with your new password.'
    });
  } catch (error: any) {
    console.error('[MOBILE_RESET_PASSWORD] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password. Please try again.',
      errorCode: 'SERVER_ERROR'
    });
  }
};
