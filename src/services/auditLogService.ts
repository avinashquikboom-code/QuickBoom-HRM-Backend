import { prisma } from '../utils/db';

export interface CreateAuditLogParams {
  userId?: string;
  employeeId?: string;
  branchId?: string;
  ipAddress?: string;
  deviceInfo?: string;
  action: string;
}

class AuditLogService {
  async log(params: CreateAuditLogParams) {
    try {
      const logEntry = await prisma.auditLog.create({
        data: {
          userId: params.userId,
          employeeId: params.employeeId,
          branchId: params.branchId,
          ipAddress: params.ipAddress,
          deviceInfo: params.deviceInfo,
          action: params.action,
        },
      });
      console.log(`[AUDIT LOG] ${params.action} (User: ${params.userId ?? 'system'})`);
      return logEntry;
    } catch (error) {
      console.error('Failed to write audit log:', error);
      // Fail silently to prevent interrupting business logic if auditing has an issue
    }
  }

  async getLogs(limit: number = 100, offset: number = 0) {
    return prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
    });
  }
}

export default new AuditLogService();
