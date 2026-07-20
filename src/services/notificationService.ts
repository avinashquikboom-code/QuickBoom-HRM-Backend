import { prisma } from '../utils/db';
import { getWebSocketInstance } from '../utils/websocketSingleton';

export interface NotificationTemplate {
  id: number;
  name: string;
  type: string;
  title: string;
  body: string;
  category: string;
  isActive: boolean;
  variables: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationRule {
  id: number;
  name: string;
  trigger: string;
  conditions: any;
  templateId: number;
  recipients: string[];
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationCampaign {
  id: number;
  name: string;
  title: string;
  body: string;
  category: string;
  recipients: string | number[];
  scheduledAt?: Date;
  sentAt?: Date;
  status: 'DRAFT' | 'SCHEDULED' | 'SENT' | 'FAILED';
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationStats {
  totalNotifications: number;
  sentNotifications: number;
  failedNotifications: number;
  readNotifications: number;
  unreadNotifications: number;
  notificationsByCategory: Record<string, number>;
  notificationsByType: Record<string, number>;
  recentNotifications: any[];
  deliveryRate: number;
  readRate: number;
}

class NotificationService {
  /**
   * Create notification template
   */
  async createNotificationTemplate(templateData: Partial<NotificationTemplate>): Promise<NotificationTemplate> {
    try {
      const template = await prisma.$queryRaw`
        INSERT INTO notification_template (
          name, type, title, body, category, is_active, variables, created_by, created_at, updated_at
        ) VALUES (
          ${templateData.name}, ${templateData.type || 'GENERAL'}, ${templateData.title || ''}, 
          ${templateData.body || ''}, ${templateData.category || 'GENERAL'}, 
          ${templateData.isActive ?? true}, ${JSON.stringify(templateData.variables || [])}, 
          ${templateData.createdBy || 'System'}, NOW(), NOW()
        )
        RETURNING id, name, type, title, body, category, is_active as "isActive", variables, 
                  created_by as "createdBy", created_at as "createdAt", updated_at as "updatedAt"
      ` as NotificationTemplate[];

      return template[0];
    } catch (error) {
      console.error('Create notification template error:', error);
      throw error;
    }
  }

  /**
   * Get notification templates
   */
  async getNotificationTemplates(category?: string): Promise<NotificationTemplate[]> {
    try {
      let whereClause = '';
      if (category) {
        whereClause = `WHERE category = ${category}`;
      }

      const templates = await prisma.$queryRaw`
        SELECT id, name, type, title, body, category, is_active as "isActive", variables, 
               created_by as "createdBy", created_at as "createdAt", updated_at as "updatedAt"
        FROM notification_template 
        ${whereClause}
        ORDER BY name
      ` as NotificationTemplate[];

      return templates;
    } catch (error) {
      console.error('Get notification templates error:', error);
      throw error;
    }
  }

  /**
   * Send notification to multiple recipients
   */
  async sendBulkNotification(notificationData: {
    title: string;
    body: string;
    category: string;
    recipients: number[];
    actionId?: string;
    actionType?: string;
    variables?: Record<string, any>;
  }): Promise<{ sent: number; failed: number }> {
    try {
      const { title, body, category, recipients, actionId, actionType, variables } = notificationData;
      
      let sentCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (const recipientId of recipients) {
        try {
          // Get employee information
          const employee = await prisma.employee.findUnique({
            where: { id: recipientId },
            include: { user: true }
          });

          if (!employee || !employee.user) {
            failedCount++;
            errors.push(`Employee ${recipientId} not found or has no user`);
            continue;
          }

          // Process template variables
          const processedTitle = this.processTemplate(title, variables, employee);
          const processedBody = this.processTemplate(body, variables, employee);

          // Create notification
          await prisma.notification.create({
            data: {
              employeeId: recipientId,
              userId: employee.user.id,
              title: processedTitle,
              body: processedBody,
              category,
              actionId: actionId || '',
              actionType: actionType || 'GENERAL',
              isRead: false
            }
          });

          // Send real-time notification
          try {
            await getWebSocketInstance().broadcastNotification(recipientId, {
              title: processedTitle,
              body: processedBody,
              category,
              actionId,
              actionType,
              timestamp: new Date()
            });
          } catch (wsError) {
            console.error('❌ Failed to send real-time notification:', wsError);
          }

          sentCount++;
        } catch (error) {
          console.error(`Error sending notification to recipient ${recipientId}:`, error);
          failedCount++;
          errors.push(`Recipient ${recipientId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return { sent: sentCount, failed: failedCount };
    } catch (error) {
      console.error('Send bulk notification error:', error);
      throw error;
    }
  }

  /**
   * Send notification using template
   */
  async sendTemplateNotification(
    templateId: number,
    recipients: number[],
    variables?: Record<string, any>
  ): Promise<{ sent: number; failed: number }> {
    try {
      // Get template
      const template = await prisma.$queryRaw`
        SELECT * FROM notification_template WHERE id = ${templateId}
      ` as NotificationTemplate[];

      if (template.length === 0) {
        throw new Error('Template not found');
      }

      const templateData = template[0];

      return await this.sendBulkNotification({
        title: templateData.title,
        body: templateData.body,
        category: templateData.category,
        recipients: recipients as number[],
        actionType: templateData.type,
        variables
      });
    } catch (error) {
      console.error('Send template notification error:', error);
      throw error;
    }
  }

  /**
   * Get notification statistics
   */
  async getNotificationStats(startDate?: Date, endDate?: Date): Promise<NotificationStats> {
    try {
      const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const end = endDate || new Date();

      const stats = await prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_notifications,
          COUNT(CASE WHEN sent_at IS NOT NULL THEN 1 END) as sent_notifications,
          COUNT(CASE WHEN sent_at IS NULL THEN 1 END) as failed_notifications,
          COUNT(CASE WHEN is_read = true THEN 1 END) as read_notifications,
          COUNT(CASE WHEN is_read = false THEN 1 END) as unread_notifications
        FROM notification 
        WHERE created_at BETWEEN ${start} AND ${end}
      ` as any[];

      const categoryStats = await prisma.$queryRaw`
        SELECT category, COUNT(*) as count
        FROM notification 
        WHERE created_at BETWEEN ${start} AND ${end}
        GROUP BY category
      ` as any[];

      const typeStats = await prisma.$queryRaw`
        SELECT action_type, COUNT(*) as count
        FROM notification 
        WHERE created_at BETWEEN ${start} AND ${end}
        GROUP BY action_type
      ` as any[];

      const recentNotifications = await prisma.notification.findMany({
        where: {
          createdAt: {
            gte: start,
            lte: end
          }
        },
        include: {
          employee: {
            select: {
              firstName: true,
              lastName: true,
              employeeCode: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });

      const result = stats[0];
      const totalNotifications = parseInt(result.total_notifications) || 0;
      const sentNotifications = parseInt(result.sent_notifications) || 0;
      const readNotifications = parseInt(result.read_notifications) || 0;

      return {
        totalNotifications,
        sentNotifications,
        failedNotifications: parseInt(result.failed_notifications) || 0,
        readNotifications,
        unreadNotifications: parseInt(result.unread_notifications) || 0,
        notificationsByCategory: categoryStats.reduce((acc, item) => {
          acc[item.category] = parseInt(item.count);
          return acc;
        }, {}),
        notificationsByType: typeStats.reduce((acc, item) => {
          acc[item.action_type] = parseInt(item.count);
          return acc;
        }, {}),
        recentNotifications,
        deliveryRate: totalNotifications > 0 ? (sentNotifications / totalNotifications) * 100 : 0,
        readRate: sentNotifications > 0 ? (readNotifications / sentNotifications) * 100 : 0
      };
    } catch (error) {
      console.error('Get notification stats error:', error);
      throw error;
    }
  }

  /**
   * Create notification campaign
   */
  async createNotificationCampaign(campaignData: Partial<NotificationCampaign>): Promise<NotificationCampaign> {
    try {
      const campaign = await prisma.$queryRaw`
        INSERT INTO notification_campaign (
          name, title, body, category, recipients, scheduled_at, status, 
          total_recipients, created_by, created_at, updated_at
        ) VALUES (
          ${campaignData.name}, ${campaignData.title || ''}, ${campaignData.body || ''}, 
          ${campaignData.category || 'GENERAL'}, ${JSON.stringify(campaignData.recipients || [])},
          ${campaignData.scheduledAt || null}, ${campaignData.status || 'DRAFT'},
          ${campaignData.totalRecipients || 0}, ${campaignData.createdBy || 'System'}, NOW(), NOW()
        )
        RETURNING id, name, title, body, category, recipients, scheduled_at as "scheduledAt", 
                  sent_at as "sentAt", status, total_recipients as "totalRecipients", 
                  sent_count as "sentCount", failed_count as "failedCount",
                  created_by as "createdBy", created_at as "createdAt", updated_at as "updatedAt"
      ` as NotificationCampaign[];

      return campaign[0];
    } catch (error) {
      console.error('Create notification campaign error:', error);
      throw error;
    }
  }

  /**
   * Process scheduled campaigns
   */
  async processScheduledCampaigns(): Promise<void> {
    try {
      const campaigns = await prisma.$queryRaw`
        SELECT * FROM notification_campaign 
        WHERE status = 'SCHEDULED' 
        AND scheduled_at <= NOW()
      ` as NotificationCampaign[];

      for (const campaign of campaigns) {
        try {
          const result = await this.sendBulkNotification({
            title: campaign.title,
            body: campaign.body,
            category: campaign.category,
            recipients: JSON.parse(campaign.recipients as unknown as string),
            actionType: 'CAMPAIGN'
          });

          // Update campaign status
          await prisma.$queryRaw`
            UPDATE notification_campaign 
            SET status = 'SENT', sent_at = NOW(), sent_count = ${result.sent}, 
                failed_count = ${result.failed}, updated_at = NOW()
            WHERE id = ${campaign.id}
          `;

        } catch (error) {
          console.error(`Error processing campaign ${campaign.id}:`, error);
          
          // Update campaign status to failed
          await prisma.$queryRaw`
            UPDATE notification_campaign 
            SET status = 'FAILED', updated_at = NOW()
            WHERE id = ${campaign.id}
          `;
        }
      }
    } catch (error) {
      console.error('Process scheduled campaigns error:', error);
      throw error;
    }
  }

  /**
   * Get notification campaigns
   */
  async getNotificationCampaigns(status?: string): Promise<NotificationCampaign[]> {
    try {
      let whereClause = '';
      if (status) {
        whereClause = `WHERE status = '${status}'`;
      }

      const campaigns = await prisma.$queryRaw`
        SELECT id, name, title, body, category, recipients, scheduled_at as "scheduledAt", 
               sent_at as "sentAt", status, total_recipients as "totalRecipients", 
               sent_count as "sentCount", failed_count as "failedCount",
               created_by as "createdBy", created_at as "createdAt", updated_at as "updatedAt"
        FROM notification_campaign 
        ${whereClause}
        ORDER BY created_at DESC
      ` as NotificationCampaign[];

      return campaigns;
    } catch (error) {
      console.error('Get notification campaigns error:', error);
      throw error;
    }
  }

  /**
   * Mark notifications as read
   */
  async markNotificationsAsRead(employeeId: number, notificationIds?: number[]): Promise<void> {
    try {
      let whereClause = `WHERE employee_id = ${employeeId}`;
      if (notificationIds && notificationIds.length > 0) {
        whereClause += ` AND id IN (${notificationIds.join(',')})`;
      }

      await prisma.$queryRaw`
        UPDATE notification 
        SET is_read = true, read_at = NOW()
        ${whereClause}
      `;
    } catch (error) {
      console.error('Mark notifications as read error:', error);
      throw error;
    }
  }

  /**
   * Delete old notifications
   */
  async deleteOldNotifications(daysToKeep: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await prisma.$queryRaw`
        DELETE FROM notification 
        WHERE created_at < ${cutoffDate}
        RETURNING COUNT(*) as deleted_count
      ` as any[];

      return parseInt(result[0]?.deleted_count || '0');
    } catch (error) {
      console.error('Delete old notifications error:', error);
      throw error;
    }
  }

  /**
   * Helper method to process template variables
   */
  private processTemplate(template: string, variables: Record<string, any> = {}, employee: any): string {
    let processed = template;

    // Default variables
    processed = processed.replace(/\{employeeName\}/g, `${employee.firstName} ${employee.lastName}`);
    processed = processed.replace(/\{employeeCode\}/g, employee.employeeCode || '');
    processed = processed.replace(/\{currentDate\}/g, new Date().toLocaleDateString());
    processed = processed.replace(/\{currentTime\}/g, new Date().toLocaleTimeString());

    // Custom variables
    if (variables) {
      Object.keys(variables).forEach(key => {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        processed = processed.replace(regex, String(variables[key]));
      });
    }

    return processed;
  }
}

export default new NotificationService();
