import { prisma } from '../utils/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface SecurityAuditLog {
  id: number;
  userId?: number;
  employeeId?: number;
  action: string;
  resource: string;
  details?: string;
  ipAddress?: string;
  userAgent?: string;
  status: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  createdAt: Date;
}

export interface SecurityPolicy {
  id: number;
  name: string;
  type: 'PASSWORD' | 'SESSION' | 'ACCESS' | 'DATA';
  rules: any;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SecurityAlert {
  id: number;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  userId?: number;
  employeeId?: number;
  ipAddress?: string;
  isResolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  createdAt: Date;
}

export interface LoginAttempt {
  id: number;
  email: string;
  ipAddress: string;
  userAgent?: string;
  success: boolean;
  failureReason?: string;
  attemptedAt: Date;
  userId?: number;
}

class SecurityService {
  private readonly JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
  private readonly JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

  /**
   * Hash password using bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    try {
      const saltRounds = 12;
      return await bcrypt.hash(password, saltRounds);
    } catch (error) {
      console.error('Hash password error:', error);
      throw error;
    }
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      console.error('Verify password error:', error);
      throw error;
    }
  }

  /**
   * Generate JWT token
   */
  generateToken(payload: any): string {
    try {
      // @ts-ignore - JWT library types are causing issues
      const token = jwt.sign(payload, this.JWT_SECRET, {
        expiresIn: this.JWT_EXPIRES_IN,
        issuer: 'quickboom-hrm',
        audience: 'quickboom-users'
      });
      return token;
    } catch (error) {
      console.error('Generate token error:', error);
      throw error;
    }
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): any {
    try {
      return jwt.verify(token, this.JWT_SECRET, {
        issuer: 'quickboom-hrm',
        audience: 'quickboom-users'
      });
    } catch (error) {
      console.error('Verify token error:', error);
      throw error;
    }
  }

  /**
   * Generate secure random token
   */
  generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Check if account is locked due to failed attempts
   */
  async isAccountLocked(email: string, ipAddress: string): Promise<boolean> {
    try {
      const recentAttempts = await prisma.$queryRaw`
        SELECT COUNT(*) as attempt_count
        FROM login_attempts 
        WHERE email = ${email} 
        AND ip_address = ${ipAddress}
        AND success = false
        AND attempted_at > NOW() - INTERVAL '${this.LOCKOUT_DURATION / 1000} seconds'
      ` as any[];

      const attemptCount = parseInt(recentAttempts[0]?.attempt_count || '0');
      return attemptCount >= this.MAX_LOGIN_ATTEMPTS;
    } catch (error) {
      console.error('Check account locked error:', error);
      return false;
    }
  }

  /**
   * Record login attempt
   */
  async recordLoginAttempt(attempt: {
    email: string;
    ipAddress: string;
    userAgent?: string;
    success: boolean;
    failureReason?: string;
    userId?: number;
  }): Promise<void> {
    try {
      await prisma.$queryRaw`
        INSERT INTO login_attempts (
          email, ip_address, user_agent, success, failure_reason, user_id, attempted_at
        ) VALUES (
          ${attempt.email}, ${attempt.ipAddress}, ${attempt.userAgent || ''}, 
          ${attempt.success}, ${attempt.failureReason || ''}, ${attempt.userId || null}, NOW()
        )
      `;

      // Log security event
      await this.logSecurityEvent({
        action: 'LOGIN_ATTEMPT',
        resource: 'AUTHENTICATION',
        details: JSON.stringify({
          email: attempt.email,
          success: attempt.success,
          ipAddress: attempt.ipAddress,
          failureReason: attempt.failureReason
        }),
        ipAddress: attempt.ipAddress,
        userAgent: attempt.userAgent,
        status: attempt.success ? 'SUCCESS' : 'FAILURE',
        riskLevel: attempt.success ? 'LOW' : 'MEDIUM',
        userId: attempt.userId
      });

      // Check for suspicious activity
      if (!attempt.success) {
        await this.checkSuspiciousActivity(attempt.email, attempt.ipAddress);
      }
    } catch (error) {
      console.error('Record login attempt error:', error);
    }
  }

  /**
   * Log security event
   */
  async logSecurityEvent(event: {
    action: string;
    resource: string;
    details?: string;
    ipAddress?: string;
    userAgent?: string;
    status: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    userId?: number;
    employeeId?: number;
  }): Promise<void> {
    try {
      await prisma.$queryRaw`
        INSERT INTO security_audit_log (
          user_id, employee_id, action, resource, details, ip_address, user_agent, 
          status, risk_level, created_at
        ) VALUES (
          ${event.userId || null}, ${event.employeeId || null}, ${event.action}, 
          ${event.resource}, ${event.details || ''}, ${event.ipAddress || ''}, 
          ${event.userAgent || ''}, ${event.status}, ${event.riskLevel}, NOW()
        )
      `;

      // Create security alert for high-risk events
      if (event.riskLevel === 'HIGH' || event.riskLevel === 'CRITICAL') {
        await this.createSecurityAlert({
          type: event.action,
          severity: event.riskLevel,
          title: `Security Event: ${event.action}`,
          description: event.details || `Security event detected: ${event.action} on ${event.resource}`,
          userId: event.userId,
          employeeId: event.employeeId,
          ipAddress: event.ipAddress
        });
      }
    } catch (error) {
      console.error('Log security event error:', error);
    }
  }

  /**
   * Check for suspicious activity
   */
  async checkSuspiciousActivity(email: string, ipAddress: string): Promise<void> {
    try {
      // Check for multiple failed attempts from different IPs
      const ipAttempts = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT ip_address) as unique_ips
        FROM login_attempts 
        WHERE email = ${email}
        AND success = false
        AND attempted_at > NOW() - INTERVAL '1 hour'
      ` as any[];

      const uniqueIPs = parseInt(ipAttempts[0]?.unique_ips || '0');
      
      if (uniqueIPs >= 3) {
        await this.createSecurityAlert({
          type: 'SUSPICIOUS_LOGIN',
          severity: 'HIGH',
          title: 'Suspicious Login Activity Detected',
          description: `Multiple failed login attempts for ${email} from ${uniqueIPs} different IP addresses in the last hour`,
          ipAddress
        });
      }

      // Check for rapid failed attempts
      const rapidAttempts = await prisma.$queryRaw`
        SELECT COUNT(*) as rapid_count
        FROM login_attempts 
        WHERE email = ${email}
        AND ip_address = ${ipAddress}
        AND success = false
        AND attempted_at > NOW() - INTERVAL '5 minutes'
      ` as any[];

      const rapidCount = parseInt(rapidAttempts[0]?.rapid_count || '0');
      
      if (rapidCount >= 10) {
        await this.createSecurityAlert({
          type: 'BRUTE_FORCE_ATTACK',
          severity: 'CRITICAL',
          title: 'Potential Brute Force Attack',
          description: `Rapid failed login attempts detected for ${email} from ${ipAddress}`,
          ipAddress
        });
      }
    } catch (error) {
      console.error('Check suspicious activity error:', error);
    }
  }

  /**
   * Create security alert
   */
  async createSecurityAlert(alert: {
    type: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    title: string;
    description: string;
    userId?: number;
    employeeId?: number;
    ipAddress?: string;
  }): Promise<void> {
    try {
      await prisma.$queryRaw`
        INSERT INTO security_alerts (
          type, severity, title, description, user_id, employee_id, ip_address, is_resolved, created_at
        ) VALUES (
          ${alert.type}, ${alert.severity}, ${alert.title}, ${alert.description}, 
          ${alert.userId || null}, ${alert.employeeId || null}, ${alert.ipAddress || ''}, 
          false, NOW()
        )
      `;
    } catch (error) {
      console.error('Create security alert error:', error);
    }
  }

  /**
   * Get security alerts
   */
  async getSecurityAlerts(severity?: string, isResolved?: boolean): Promise<SecurityAlert[]> {
    try {
      let whereClause = '';
      const conditions = [];
      
      if (severity) {
        conditions.push(`severity = '${severity}'`);
      }
      
      if (isResolved !== undefined) {
        conditions.push(`is_resolved = ${isResolved}`);
      }
      
      if (conditions.length > 0) {
        whereClause = `WHERE ${conditions.join(' AND ')}`;
      }

      const alerts = await prisma.$queryRaw`
        SELECT id, type, severity, title, description, user_id as "userId", 
               employee_id as "employeeId", ip_address as "ipAddress", is_resolved as "isResolved",
               resolved_at as "resolvedAt", resolved_by as "resolvedBy", created_at as "createdAt"
        FROM security_alerts 
        ${whereClause}
        ORDER BY created_at DESC
      ` as SecurityAlert[];

      return alerts;
    } catch (error) {
      console.error('Get security alerts error:', error);
      throw error;
    }
  }

  /**
   * Resolve security alert
   */
  async resolveSecurityAlert(alertId: number, resolvedBy: string): Promise<void> {
    try {
      await prisma.$queryRaw`
        UPDATE security_alerts 
        SET is_resolved = true, resolved_at = NOW(), resolved_by = ${resolvedBy}
        WHERE id = ${alertId}
      `;
    } catch (error) {
      console.error('Resolve security alert error:', error);
      throw error;
    }
  }

  /**
   * Get security audit logs
   */
  async getSecurityAuditLogs(
    startDate?: Date,
    endDate?: Date,
    userId?: number,
    action?: string,
    riskLevel?: string
  ): Promise<SecurityAuditLog[]> {
    try {
      const conditions = [];
      
      if (startDate) {
        conditions.push(`created_at >= ${startDate}`);
      }
      
      if (endDate) {
        conditions.push(`created_at <= ${endDate}`);
      }
      
      if (userId) {
        conditions.push(`user_id = ${userId}`);
      }
      
      if (action) {
        conditions.push(`action = '${action}'`);
      }
      
      if (riskLevel) {
        conditions.push(`risk_level = '${riskLevel}'`);
      }
      
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const logs = await prisma.$queryRaw`
        SELECT id, user_id as "userId", employee_id as "employeeId", action, resource, 
               details, ip_address as "ipAddress", user_agent as "userAgent", 
               status, risk_level as "riskLevel", created_at as "createdAt"
        FROM security_audit_log 
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT 1000
      ` as SecurityAuditLog[];

      return logs;
    } catch (error) {
      console.error('Get security audit logs error:', error);
      throw error;
    }
  }

  /**
   * Validate password strength
   */
  validatePasswordStrength(password: string): {
    isValid: boolean;
    score: number;
    feedback: string[];
  } {
    const feedback = [];
    let score = 0;

    // Length check
    if (password.length >= 8) {
      score += 1;
    } else {
      feedback.push('Password must be at least 8 characters long');
    }

    // Uppercase check
    if (/[A-Z]/.test(password)) {
      score += 1;
    } else {
      feedback.push('Password must contain at least one uppercase letter');
    }

    // Lowercase check
    if (/[a-z]/.test(password)) {
      score += 1;
    } else {
      feedback.push('Password must contain at least one lowercase letter');
    }

    // Number check
    if (/\d/.test(password)) {
      score += 1;
    } else {
      feedback.push('Password must contain at least one number');
    }

    // Special character check
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      score += 1;
    } else {
      feedback.push('Password must contain at least one special character');
    }

    return {
      isValid: score >= 4,
      score,
      feedback
    };
  }

  /**
   * Get login statistics
   */
  async getLoginStatistics(startDate?: Date, endDate?: Date): Promise<any> {
    try {
      const start = startDate || new Date(new Date().setDate(new Date().getDate() - 30));
      const end = endDate || new Date();

      const stats = await prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_attempts,
          COUNT(CASE WHEN success = true THEN 1 END) as successful_logins,
          COUNT(CASE WHEN success = false THEN 1 END) as failed_logins,
          COUNT(DISTINCT email) as unique_users,
          COUNT(DISTINCT ip_address) as unique_ips
        FROM login_attempts 
        WHERE attempted_at BETWEEN ${start} AND ${end}
      ` as any[];

      const dailyStats = await prisma.$queryRaw`
        SELECT 
          DATE(attempted_at) as date,
          COUNT(*) as attempts,
          COUNT(CASE WHEN success = true THEN 1 END) as successful,
          COUNT(CASE WHEN success = false THEN 1 END) as failed
        FROM login_attempts 
        WHERE attempted_at BETWEEN ${start} AND ${end}
        GROUP BY DATE(attempted_at)
        ORDER BY date
      ` as any[];

      const topIPs = await prisma.$queryRaw`
        SELECT ip_address, COUNT(*) as attempts
        FROM login_attempts 
        WHERE attempted_at BETWEEN ${start} AND ${end}
        GROUP BY ip_address
        ORDER BY attempts DESC
        LIMIT 10
      ` as any[];

      return {
        summary: stats[0] || {},
        dailyStats,
        topIPs,
        period: { start, end }
      };
    } catch (error) {
      console.error('Get login statistics error:', error);
      throw error;
    }
  }

  /**
   * Cleanup old security logs
   */
  async cleanupOldLogs(daysToKeep: number = 90): Promise<{ deletedLogs: number; deletedAttempts: number }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const deletedLogs = await prisma.$queryRaw`
        DELETE FROM security_audit_log 
        WHERE created_at < ${cutoffDate}
        RETURNING COUNT(*) as count
      ` as any[];

      const deletedAttempts = await prisma.$queryRaw`
        DELETE FROM login_attempts 
        WHERE attempted_at < ${cutoffDate}
        RETURNING COUNT(*) as count
      ` as any[];

      return {
        deletedLogs: parseInt(deletedLogs[0]?.count || '0'),
        deletedAttempts: parseInt(deletedAttempts[0]?.count || '0')
      };
    } catch (error) {
      console.error('Cleanup old logs error:', error);
      throw error;
    }
  }
}

export default new SecurityService();
