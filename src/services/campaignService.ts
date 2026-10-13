import { prisma } from '../utils/db';
import { FirebaseNotificationService } from './firebaseNotificationService';
import { getWebSocketInstance } from '../utils/websocketSingleton';
import path from 'path';
import fs from 'fs';

const firebaseService = new FirebaseNotificationService();

export interface AudienceCriteria {
  storeId?: number;
  storeIds?: number[];
  departmentId?: number;
  role?: string;
  designationId?: number;
  employeeIds?: number[];
}

export interface CreateCampaignDTO {
  title: string;
  message: string;
  description?: string;
  notificationType?: string;
  imageUrl?: string;
  actionUrl?: string;
  audienceType?: string;
  audienceCriteria?: AudienceCriteria;
  scheduledAt?: string | Date;
  status?: string;
  createdById?: number;
  createdBy?: string;
  companyId?: string;
}

export class CampaignService {
  /**
   * Resolve active employee recipients based on target audience criteria
   */
  async resolveAudience(audienceType: string, audienceCriteria?: AudienceCriteria): Promise<any[]> {
    const where: any = {
      status: 'active',
    };

    switch (audienceType) {
      case 'SPECIFIC_STORE':
        if (audienceCriteria?.storeId) {
          where.storeId = Number(audienceCriteria.storeId);
        }
        break;

      case 'MULTIPLE_STORES':
        if (audienceCriteria?.storeIds && audienceCriteria.storeIds.length > 0) {
          where.storeId = {
            in: audienceCriteria.storeIds.map(id => Number(id)),
          };
        }
        break;

      case 'DEPARTMENT':
        if (audienceCriteria?.departmentId) {
          where.departmentId = Number(audienceCriteria.departmentId);
        }
        break;

      case 'ROLE_DESIGNATION':
        if (audienceCriteria?.designationId) {
          where.designationId = Number(audienceCriteria.designationId);
        }
        if (audienceCriteria?.role) {
          where.user = {
            role: audienceCriteria.role as any,
            isActive: true,
          };
        }
        break;

      case 'SELECTED_EMPLOYEES':
        if (audienceCriteria?.employeeIds && audienceCriteria.employeeIds.length > 0) {
          where.id = {
            in: audienceCriteria.employeeIds.map(id => Number(id)),
          };
        } else {
          return [];
        }
        break;

      case 'ALL_EMPLOYEES':
      default:
        // No additional filter, all active employees
        break;
    }

    const employees = await prisma.employee.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            fcmTokens: {
              where: { isActive: true },
              select: { token: true },
            },
          },
        },
        department: { select: { id: true, name: true } },
        store: { select: { id: true, name: true, code: true } },
        designationRelation: { select: { id: true, name: true } },
      },
    });

    return employees;
  }

  /**
   * Preview audience before sending campaign
   */
  async previewAudience(audienceType: string, audienceCriteria?: AudienceCriteria) {
    const employees = await this.resolveAudience(audienceType, audienceCriteria);

    const formatted = employees.map(emp => ({
      id: emp.id,
      userId: emp.userId,
      employeeCode: emp.employeeCode,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      designation: emp.designationRelation?.name || emp.designation || 'Staff',
      department: emp.department?.name || 'General',
      store: emp.store?.name || 'Headquarters',
      hasPushToken: (emp.user?.fcmTokens?.length || 0) > 0,
    }));

    return {
      totalCount: formatted.length,
      reachableByPush: formatted.filter(e => e.hasPushToken).length,
      preview: formatted.slice(0, 50),
    };
  }

  /**
   * Create campaign
   */
  async createCampaign(data: CreateCampaignDTO) {
    const audienceType = data.audienceType || 'ALL_EMPLOYEES';
    const audienceCriteria = data.audienceCriteria || {};

    // Estimate initial recipient count
    const recipients = await this.resolveAudience(audienceType, audienceCriteria);

    let status = data.status || 'DRAFT';
    if (data.scheduledAt && new Date(data.scheduledAt) > new Date()) {
      status = 'SCHEDULED';
    }

    const campaign = await prisma.campaign.create({
      data: {
        title: data.title,
        message: data.message,
        description: data.description || null,
        notificationType: data.notificationType || 'GENERAL_ANNOUNCEMENT',
        imageUrl: data.imageUrl || null,
        actionUrl: data.actionUrl || null,
        audienceType,
        audienceCriteria: audienceCriteria as any,
        status,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        totalRecipients: recipients.length,
        createdById: data.createdById || null,
        createdBy: data.createdBy || null,
        companyId: data.companyId || null,
      },
    });

    return campaign;
  }

  /**
   * Update campaign
   */
  async updateCampaign(id: string, data: Partial<CreateCampaignDTO>) {
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Campaign not found');
    }

    if (existing.status === 'SENT' || existing.status === 'SENDING') {
      throw new Error('Cannot update campaign that has already been sent or is currently sending');
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.message !== undefined) updateData.message = data.message;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.notificationType !== undefined) updateData.notificationType = data.notificationType;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.actionUrl !== undefined) updateData.actionUrl = data.actionUrl;
    if (data.audienceType !== undefined) updateData.audienceType = data.audienceType;
    if (data.audienceCriteria !== undefined) updateData.audienceCriteria = data.audienceCriteria as any;

    if (data.scheduledAt !== undefined) {
      if (data.scheduledAt) {
        updateData.scheduledAt = new Date(data.scheduledAt);
        updateData.status = 'SCHEDULED';
      } else {
        updateData.scheduledAt = null;
        updateData.status = 'DRAFT';
      }
    }

    if (data.status !== undefined) {
      updateData.status = data.status;
    }

    // Recalculate recipient count if audience parameters changed
    if (data.audienceType || data.audienceCriteria) {
      const audType = data.audienceType || existing.audienceType;
      const audCrit = data.audienceCriteria || (existing.audienceCriteria as any);
      const employees = await this.resolveAudience(audType, audCrit);
      updateData.totalRecipients = employees.length;
    }

    const updated = await prisma.campaign.update({
      where: { id },
      data: updateData,
    });

    return updated;
  }

  /**
   * Get single campaign by ID with recipient stats
   */
  async getCampaignById(id: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        recipients: {
          take: 100,
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                designation: true,
                store: { select: { name: true } },
                department: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    return campaign;
  }

  /**
   * List campaigns with pagination and filters
   */
  async listCampaigns(params: {
    status?: string;
    notificationType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, notificationType, search, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }
    if (notificationType && notificationType !== 'ALL') {
      where.notificationType = notificationType;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.campaign.count({ where }),
    ]);

    return {
      campaigns,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Cancel scheduled campaign
   */
  async cancelCampaign(id: string) {
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new Error('Campaign not found');

    if (campaign.status === 'SENT') {
      throw new Error('Cannot cancel a campaign that has already been sent');
    }

    return await prisma.campaign.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Send campaign immediately (with duplicate send prevention & batching)
   */
  async sendCampaign(id: string, sentBy?: string) {
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new Error('Campaign not found');

    // Idempotency: Prevent duplicate sends
    if (campaign.status === 'SENT') {
      throw new Error('This campaign has already been sent.');
    }
    if (campaign.status === 'SENDING') {
      throw new Error('Campaign is currently being dispatched.');
    }

    // Set status to SENDING
    await prisma.campaign.update({
      where: { id },
      data: { status: 'SENDING' },
    });

    try {
      const audienceType = campaign.audienceType;
      const audienceCriteria = (campaign.audienceCriteria as AudienceCriteria) || {};
      const employees = await this.resolveAudience(audienceType, audienceCriteria);

      if (employees.length === 0) {
        await prisma.campaign.update({
          where: { id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            totalRecipients: 0,
            sentCount: 0,
            failedCount: 0,
          },
        });
        return { success: true, message: 'Audience resolved to 0 recipients', total: 0, sent: 0 };
      }

      // 1. Create or upsert CampaignRecipient records & In-App Notification records
      const allTokens: string[] = [];
      const tokenToEmployeeMap = new Map<string, number>();

      for (const employee of employees) {
        const userId = employee.user?.id || null;

        // Upsert recipient record
        await prisma.campaignRecipient.upsert({
          where: {
            campaignId_employeeId: {
              campaignId: campaign.id,
              employeeId: employee.id,
            },
          },
          update: {
            deliveryStatus: 'SENT',
          },
          create: {
            campaignId: campaign.id,
            employeeId: employee.id,
            userId,
            deliveryStatus: 'SENT',
          },
        });

        // Create in-app Notification record
        await prisma.notification.create({
          data: {
            employeeId: employee.id,
            userId,
            campaignId: campaign.id,
            title: campaign.title,
            body: campaign.message,
            category: campaign.notificationType,
            imageUrl: campaign.imageUrl,
            actionUrl: campaign.actionUrl,
            actionType: 'CAMPAIGN',
            actionId: campaign.id,
            isRead: false,
            deliveryStatus: 'SENT',
          },
        });

        // Broadcast real-time WebSocket notification if active
        try {
          getWebSocketInstance().broadcastNotification(employee.id, {
            campaignId: campaign.id,
            title: campaign.title,
            body: campaign.message,
            category: campaign.notificationType,
            imageUrl: campaign.imageUrl,
            actionUrl: campaign.actionUrl,
            timestamp: new Date(),
          });
        } catch {
          // Non-blocking WS broadcast
        }

        // Collect FCM tokens
        const tokens = employee.user?.fcmTokens?.map((t: any) => t.token) || [];
        for (const token of tokens) {
          if (token && token.trim()) {
            allTokens.push(token);
            tokenToEmployeeMap.set(token, employee.id);
          }
        }
      }

      // 2. Dispatch FCM Push Notifications
      const uniqueTokens = Array.from(new Set(allTokens));
      let pushSuccessCount = 0;
      let pushFailureCount = 0;

      if (uniqueTokens.length > 0) {
        try {
          const pushResult = await firebaseService.sendNotificationToTokens(
            uniqueTokens,
            campaign.title,
            campaign.message,
            {
              campaignId: campaign.id,
              type: campaign.notificationType,
              category: campaign.notificationType,
              imageUrl: campaign.imageUrl || '',
              actionUrl: campaign.actionUrl || '',
              click_action: campaign.actionUrl || 'FLUTTER_NOTIFICATION_CLICK',
            },
            {
              imageUrl: campaign.imageUrl || undefined,
            }
          );
          pushSuccessCount = pushResult.successCount;
          pushFailureCount = pushResult.failureCount;
        } catch (fcmError: any) {
          console.error(`⚠️ [CampaignService] FCM push error for campaign ${id}:`, fcmError);
          pushFailureCount = uniqueTokens.length;
        }
      }

      // 3. Update campaign record with final delivery stats
      const updatedCampaign = await prisma.campaign.update({
        where: { id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          totalRecipients: employees.length,
          sentCount: pushSuccessCount > 0 ? pushSuccessCount : employees.length,
          failedCount: pushFailureCount,
        },
      });

      // Audit log
      try {
        await prisma.auditLog.create({
          data: {
            action: `SENT_CAMPAIGN: ${campaign.title} (${campaign.id}) to ${employees.length} employees`,
            deviceInfo: sentBy ? `By user: ${sentBy}` : 'System Scheduler',
          },
        });
      } catch {
        // Non-blocking audit log
      }

      return {
        success: true,
        campaign: updatedCampaign,
        totalRecipients: employees.length,
        pushDelivered: pushSuccessCount,
        pushFailed: pushFailureCount,
      };
    } catch (error: any) {
      console.error(`❌ [CampaignService] Error sending campaign ${id}:`, error);
      await prisma.campaign.update({
        where: { id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }

  /**
   * Schedule campaign
   */
  async scheduleCampaign(id: string, scheduledAt: Date | string) {
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new Error('Campaign not found');

    if (campaign.status === 'SENT') {
      throw new Error('Campaign has already been sent');
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      throw new Error('Scheduled date and time must be in the future');
    }

    return await prisma.campaign.update({
      where: { id },
      data: {
        scheduledAt: scheduledDate,
        status: 'SCHEDULED',
      },
    });
  }

  /**
   * Get campaign analytics and recipient delivery breakdown
   */
  async getCampaignAnalytics(id: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        recipients: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                store: { select: { name: true } },
                department: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!campaign) throw new Error('Campaign not found');

    const total = campaign.totalRecipients || campaign.recipients.length;
    const sent = campaign.sentCount;
    const failed = campaign.failedCount;
    const read = campaign.recipients.filter(r => r.isRead).length;

    const deliveryRate = total > 0 ? Math.round((sent / total) * 100) : 0;
    const readRate = sent > 0 ? Math.round((read / sent) * 100) : 0;

    return {
      campaignId: campaign.id,
      title: campaign.title,
      status: campaign.status,
      notificationType: campaign.notificationType,
      sentAt: campaign.sentAt,
      scheduledAt: campaign.scheduledAt,
      totalRecipients: total,
      sentCount: sent,
      failedCount: failed,
      readCount: read,
      deliveryRate,
      readRate,
      recipients: campaign.recipients,
    };
  }

  /**
   * Get employees celebrating their birthday today
   * Accurately supports IANA timezones, leap day (Feb 29 on non-leap years), missing dates, and store/branch scoping
   */
  async getTodayBirthdays(options?: string | {
    timezone?: string;
    storeId?: number;
    branchId?: number;
  }) {
    let targetTz = 'Asia/Kolkata';
    let storeId: number | undefined;
    let branchId: number | undefined;

    if (typeof options === 'string' && options.trim()) {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: options.trim() });
        targetTz = options.trim();
      } catch {
        targetTz = 'Asia/Kolkata';
      }
    } else if (typeof options === 'object' && options !== null) {
      if (options.timezone && typeof options.timezone === 'string') {
        const candidate = options.timezone.trim();
        if (candidate && candidate !== 'undefined' && candidate !== 'null') {
          try {
            new Intl.DateTimeFormat(undefined, { timeZone: candidate });
            targetTz = candidate;
          } catch {
            targetTz = 'Asia/Kolkata';
          }
        }
      }
      storeId = typeof options.storeId === 'number' && !isNaN(options.storeId) ? options.storeId : undefined;
      branchId = typeof options.branchId === 'number' && !isNaN(options.branchId) ? options.branchId : undefined;
    }

    // Determine current calendar day in the target timezone
    const now = new Date();
    const todayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: targetTz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    const todayParts = todayFormatter.formatToParts(now);
    const currentYear = parseInt(todayParts.find(p => p.type === 'year')?.value || String(now.getFullYear()), 10);
    const currentMonth = parseInt(todayParts.find(p => p.type === 'month')?.value || '1', 10);
    const currentDay = parseInt(todayParts.find(p => p.type === 'day')?.value || '1', 10);

    const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const currentIsLeap = isLeapYear(currentYear);

    // Query active employees with date of birth
    const activeEmployees = await prisma.employee.findMany({
      where: {
        status: { in: ['active', 'ACTIVE'] },
        dateOfBirth: { not: null },
        ...(storeId ? { storeId } : {}),
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        dateOfBirth: true,
        storeId: true,
        branchId: true,
        departmentId: true,
        department: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, email: true } },
      },
    });

    const birthdayEmployees = activeEmployees.filter(emp => {
      if (!emp.dateOfBirth) return false;
      const dob = new Date(emp.dateOfBirth);
      if (isNaN(dob.getTime())) return false;

      // Extract month and day in target timezone
      const dobFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: targetTz,
        month: 'numeric',
        day: 'numeric',
      });
      const dobParts = dobFormatter.formatToParts(dob);
      const dobMonth = parseInt(dobParts.find(p => p.type === 'month')?.value || '0', 10);
      const dobDay = parseInt(dobParts.find(p => p.type === 'day')?.value || '0', 10);

      // Extract month and day in UTC fallback
      const utcMonth = dob.getUTCMonth() + 1;
      const utcDay = dob.getUTCDate();

      // Standard birthday match
      const isRegularBirthday =
        (dobMonth === currentMonth && dobDay === currentDay) ||
        (utcMonth === currentMonth && utcDay === currentDay);

      // Leap day handling: if born on Feb 29 and current year is non-leap, celebrate on Feb 28
      const isBornOnLeapDay = (dobMonth === 2 && dobDay === 29) || (utcMonth === 2 && utcDay === 29);
      const isLeapCelebrationToday = isBornOnLeapDay && !currentIsLeap && (currentMonth === 2 && currentDay === 28);

      return isRegularBirthday || isLeapCelebrationToday;
    });

    // Check if birthday wishes were already sent today to avoid duplicate notifications
    const matchedEmployeeIds = birthdayEmployees.map(e => e.id);
    const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const alreadySentRecipients = matchedEmployeeIds.length > 0
      ? await prisma.campaignRecipient.findMany({
          where: {
            employeeId: { in: matchedEmployeeIds },
            createdAt: { gte: dayStart },
            campaign: {
              notificationType: 'BIRTHDAY_WISHES',
            },
          },
          select: { employeeId: true },
        })
      : [];

    const alreadySentSet = new Set(alreadySentRecipients.map(r => r.employeeId));

    return birthdayEmployees.map(emp => ({
      ...emp,
      alreadyWished: alreadySentSet.has(emp.id),
    }));
  }

  /**
   * Send birthday wishes to celebrating employees (with duplicate prevention per day)
   */
  async sendBirthdayWishes(options?: {
    employeeIds?: number[];
    customTitle?: string;
    customMessage?: string;
    imageUrl?: string;
    broadcastToAll?: boolean;
    timezone?: string;
  }) {
    const tz = options?.timezone || 'Asia/Kolkata';
    const birthdayEmployees = await this.getTodayBirthdays(tz);

    const targetEmployees = options?.employeeIds && options.employeeIds.length > 0
      ? birthdayEmployees.filter(e => options.employeeIds!.includes(e.id))
      : birthdayEmployees;

    if (targetEmployees.length === 0) {
      return { message: 'No eligible employees celebrating birthdays today.', count: 0 };
    }

    const sentResults = [];

    for (const emp of targetEmployees) {
      // Check if birthday wish was already sent today to avoid duplicate notifications
      const alreadySent = await prisma.campaignRecipient.findFirst({
        where: {
          employeeId: emp.id,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
          campaign: {
            notificationType: 'BIRTHDAY_WISHES',
          },
        },
      });

      if (alreadySent) {
        console.log(`ℹ️ [BirthdayNotification] Birthday wish already sent today for ${emp.firstName} ${emp.lastName}`);
        continue;
      }

      const title = options?.customTitle || `🎂 Happy Birthday, ${emp.firstName}!`;
      const message = options?.customMessage ||
        `Warmest birthday wishes to ${emp.firstName} ${emp.lastName}! May your special day bring you immense joy, success, and prosperity! 🎉`;

      // Create individual or broadcast campaign
      const campaign = await this.createCampaign({
        title,
        message,
        notificationType: 'BIRTHDAY_WISHES',
        imageUrl: options?.imageUrl || '/images/birthday-banner.png',
        audienceType: options?.broadcastToAll ? 'ALL_EMPLOYEES' : 'SELECTED_EMPLOYEES',
        audienceCriteria: options?.broadcastToAll ? {} : { employeeIds: [emp.id] },
        status: 'DRAFT',
        createdBy: 'HR Birthday Automation',
      });

      const result = await this.sendCampaign(campaign.id, 'HR Birthday Automation');
      sentResults.push({ employeeId: emp.id, name: `${emp.firstName} ${emp.lastName}`, result });
    }

    return {
      message: `Processed birthday wishes for ${sentResults.length} employees`,
      count: sentResults.length,
      details: sentResults,
    };
  }

  /**
   * Save uploaded image to disk with validation
   */
  async saveUploadedImage(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<string> {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new Error(`Invalid file type ${file.mimetype}. Only JPEG, PNG, WEBP, and GIF are allowed.`);
    }

    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_SIZE) {
      throw new Error('Image file exceeds maximum allowable size of 5MB');
    }

    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `campaign_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`;

    const uploadsDir = path.join(process.cwd(), 'uploads', 'campaigns');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filePath = path.join(uploadsDir, filename);
    await fs.promises.writeFile(filePath, file.buffer);

    return `/uploads/campaigns/${filename}`;
  }
}

export default new CampaignService();
