import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import securityService from '../services/securityService';
import { prisma } from '../utils/db';

// ==========================================
// Enhanced Security Controller
// ==========================================

export const hashPassword = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { password } = req.body;

    if (!password) {
      res.status(400).json({
        success: false,
        message: 'Password is required.',
        errorCode: 'MISSING_PASSWORD'
      });
      return;
    }

    const hashedPassword = await securityService.hashPassword(password);

    res.json({
      success: true,
      message: 'Password hashed successfully.',
      hashedPassword
    });
  } catch (error) {
    console.error('Hash password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to hash password.',
      errorCode: 'HASH_PASSWORD_ERROR'
    });
  }
};

export const verifyPassword = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { password, hash } = req.body;

    if (!password || !hash) {
      res.status(400).json({
        success: false,
        message: 'Password and hash are required.',
        errorCode: 'MISSING_CREDENTIALS'
      });
      return;
    }

    const isValid = await securityService.verifyPassword(password, hash);

    res.json({
      success: true,
      isValid,
      message: isValid ? 'Password verification successful.' : 'Password verification failed.'
    });
  } catch (error) {
    console.error('Verify password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify password.',
      errorCode: 'VERIFY_PASSWORD_ERROR'
    });
  }
};

export const generateToken = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { payload } = req.body;

    if (!payload) {
      res.status(400).json({
        success: false,
        message: 'Payload is required.',
        errorCode: 'MISSING_PAYLOAD'
      });
      return;
    }

    const token = securityService.generateToken(payload);

    res.json({
      success: true,
      message: 'Token generated successfully.',
      token
    });
  } catch (error) {
    console.error('Generate token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate token.',
      errorCode: 'GENERATE_TOKEN_ERROR'
    });
  }
};

export const verifyToken = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({
        success: false,
        message: 'Token is required.',
        errorCode: 'MISSING_TOKEN'
      });
      return;
    }

    const decoded = securityService.verifyToken(token);

    res.json({
      success: true,
      message: 'Token verified successfully.',
      decoded
    });
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify token.',
      errorCode: 'VERIFY_TOKEN_ERROR'
    });
  }
};

export const checkAccountLock = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { email, ipAddress } = req.body;

    if (!email || !ipAddress) {
      res.status(400).json({
        success: false,
        message: 'Email and IP address are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const isLocked = await securityService.isAccountLocked(email, ipAddress);

    res.json({
      success: true,
      isLocked,
      message: isLocked ? 'Account is locked.' : 'Account is not locked.'
    });
  } catch (error) {
    console.error('Check account lock error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check account lock status.',
      errorCode: 'CHECK_ACCOUNT_LOCK_ERROR'
    });
  }
};

export const recordLoginAttempt = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { email, ipAddress, userAgent, success, failureReason, userId } = req.body;

    if (!email || !ipAddress || success === undefined) {
      res.status(400).json({
        success: false,
        message: 'Email, IP address, and success status are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    await securityService.recordLoginAttempt({
      email,
      ipAddress,
      userAgent,
      success,
      failureReason,
      userId
    });

    res.json({
      success: true,
      message: 'Login attempt recorded successfully.'
    });
  } catch (error) {
    console.error('Record login attempt error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record login attempt.',
      errorCode: 'RECORD_LOGIN_ATTEMPT_ERROR'
    });
  }
};

export const logSecurityEvent = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { action, resource, details, ipAddress, userAgent, status, riskLevel, userId, employeeId } = req.body;

    if (!action || !resource || !status || !riskLevel) {
      res.status(400).json({
        success: false,
        message: 'Action, resource, status, and risk level are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    await securityService.logSecurityEvent({
      action,
      resource,
      details,
      ipAddress,
      userAgent,
      status,
      riskLevel,
      userId,
      employeeId
    });

    res.json({
      success: true,
      message: 'Security event logged successfully.'
    });
  } catch (error) {
    console.error('Log security event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log security event.',
      errorCode: 'LOG_SECURITY_EVENT_ERROR'
    });
  }
};

export const getSecurityAlerts = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { severity, isResolved } = req.query;

    const alerts = await securityService.getSecurityAlerts(
      severity as string,
      isResolved !== undefined ? isResolved === 'true' : undefined
    );

    res.json({
      success: true,
      alerts
    });
  } catch (error) {
    console.error('Get security alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get security alerts.',
      errorCode: 'GET_SECURITY_ALERTS_ERROR'
    });
  }
};

export const resolveSecurityAlert = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { alertId } = req.params;
    const { resolvedBy } = req.body;

    if (!alertId) {
      res.status(400).json({
        success: false,
        message: 'Alert ID is required.',
        errorCode: 'MISSING_ALERT_ID'
      });
      return;
    }

    const alertIdStr = Array.isArray(alertId) ? alertId[0] : alertId;
    const resolvedByStr = resolvedBy || req.user?.email || 'System';

    await securityService.resolveSecurityAlert(parseInt(alertIdStr), resolvedByStr);

    res.json({
      success: true,
      message: 'Security alert resolved successfully.'
    });
  } catch (error) {
    console.error('Resolve security alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve security alert.',
      errorCode: 'RESOLVE_SECURITY_ALERT_ERROR'
    });
  }
};

export const getSecurityAuditLogs = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate, userId, action, riskLevel } = req.query as { 
      startDate?: string, 
      endDate?: string, 
      userId?: string, 
      action?: string, 
      riskLevel?: string 
    };

    const logs = await securityService.getSecurityAuditLogs(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      userId ? userId : undefined,
      action,
      riskLevel
    );

    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Get security audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get security audit logs.',
      errorCode: 'GET_SECURITY_AUDIT_LOGS_ERROR'
    });
  }
};

export const validatePasswordStrength = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { password } = req.body;

    if (!password) {
      res.status(400).json({
        success: false,
        message: 'Password is required.',
        errorCode: 'MISSING_PASSWORD'
      });
      return;
    }

    const validation = securityService.validatePasswordStrength(password);

    res.json({
      success: true,
      validation
    });
  } catch (error) {
    console.error('Validate password strength error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate password strength.',
      errorCode: 'VALIDATE_PASSWORD_STRENGTH_ERROR'
    });
  }
};

export const getLoginStatistics = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string, endDate?: string };

    const stats = await securityService.getLoginStatistics(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get login statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get login statistics.',
      errorCode: 'GET_LOGIN_STATISTICS_ERROR'
    });
  }
};

export const getSecurityDashboard = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string, endDate?: string };

    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();

    // Get security alerts
    const alerts = await securityService.getSecurityAlerts();
    const criticalAlerts = alerts.filter(alert => alert.severity === 'CRITICAL' && !alert.isResolved);
    const highAlerts = alerts.filter(alert => alert.severity === 'HIGH' && !alert.isResolved);
    const totalAlerts = alerts.length;
    const resolvedAlerts = alerts.filter(alert => alert.isResolved).length;

    // Get login statistics
    const loginStats = await securityService.getLoginStatistics(start, end);

    // Get recent security events
    const recentEvents = await securityService.getSecurityAuditLogs(start, end, undefined, undefined, 'HIGH');

    // Get failed login attempts in last 24 hours
    const failedAttempts = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM login_attempts 
      WHERE success = false 
      AND attempted_at > NOW() - INTERVAL '24 hours'
    ` as any[];

    const dashboard = {
      alerts: {
        total: totalAlerts,
        resolved: resolvedAlerts,
        pending: totalAlerts - resolvedAlerts,
        critical: criticalAlerts.length,
        high: highAlerts.length,
        recent: alerts.slice(0, 10)
      },
      loginStats,
      recentEvents: recentEvents.slice(0, 20),
      failedAttempts24h: parseInt(failedAttempts[0]?.count || '0'),
      period: { start, end }
    };

    res.json({
      success: true,
      dashboard
    });
  } catch (error) {
    console.error('Get security dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get security dashboard.',
      errorCode: 'GET_SECURITY_DASHBOARD_ERROR'
    });
  }
};

export const cleanupOldLogs = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { daysToKeep = 90 } = req.body;

    const result = await securityService.cleanupOldLogs(parseInt(daysToKeep));

    res.json({
      success: true,
      message: 'Old logs cleaned up successfully.',
      result
    });
  } catch (error) {
    console.error('Cleanup old logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup old logs.',
      errorCode: 'CLEANUP_OLD_LOGS_ERROR'
    });
  }
};

export const generateSecureToken = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { length = 32 } = req.body;

    const token = securityService.generateSecureToken(parseInt(length));

    res.json({
      success: true,
      message: 'Secure token generated successfully.',
      token
    });
  } catch (error) {
    console.error('Generate secure token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate secure token.',
      errorCode: 'GENERATE_SECURE_TOKEN_ERROR'
    });
  }
};
