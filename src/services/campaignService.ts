import { Prisma, Role } from '@prisma/client';
import { prisma } from '../utils/db';
import { firebaseNotificationService } from './firebaseNotificationService';
import {
  Audience,
  CampaignError,
  birthdayMatches,
  localDate,
  normalizeAudienceMode,
} from './campaignPolicy';
import { safeFcmError } from '../utils/fcmErrors';
import { campaignImages, withCampaignImageLock, validateManagedImage, canonicalCampaignImage } from './campaignImageService';

export class CampaignService {
  /**
   * Determine actor scope for role-based scoping (Store Managers, etc.)
   */
  async actorScope(actorId?: number): Promise<Prisma.EmployeeWhereInput> {
    if (!actorId) return {};
    const user = await prisma.user.findUnique({
      where: { id: actorId },
      include: { employee: true },
    });
    if (!user || !user.isActive) throw new CampaignError(403, 'Active campaign actor required');

    // Platform / Super Admins / Admins have company-wide access
    if (['SUPER_ADMIN', 'ADMIN', 'PLATFORM_ADMIN'].includes(user.role)) {
      return {};
    }

    // HR and Store Managers can only target within their assigned store/branch
    if (user.employee?.storeId) {
      return { storeId: user.employee.storeId };
    }
    if (user.employee?.branchId) {
      return { branchId: user.employee.branchId };
    }

    throw new CampaignError(403, 'Campaign actor has no assigned store or branch');
  }

  /**
   * Resolve audience based on criteria and scoping
   */
  async resolveAudience(
    audienceType: string,
    criteria: Audience,
    actorId?: number,
    targetDateStr?: string
  ) {
    const mode = normalizeAudienceMode(audienceType);
    const scope = await this.actorScope(actorId);

    const conditions: Prisma.EmployeeWhereInput[] = [
      { status: { in: ['active', 'ACTIVE'] } },
      { user: { isActive: true } },
    ];

    if (Object.keys(scope).length > 0) {
      conditions.push(scope);
    }

    switch (mode) {
      case 'STORES':
        if (!criteria.storeIds?.length && !criteria.storeId) return [];
        if (criteria.storeIds?.length > 0) {
          conditions.push({ storeId: { in: criteria.storeIds } });
        } else if (criteria.storeId) {
          conditions.push({ storeId: criteria.storeId });
        }
        break;

      case 'BRANCHES':
        if (!criteria.branchIds?.length && !criteria.branchId) return [];
        if (criteria.branchIds?.length > 0) {
          conditions.push({ branchId: { in: criteria.branchIds } });
        } else if (criteria.branchId) {
          conditions.push({ branchId: criteria.branchId });
        }
        break;

      case 'DEPARTMENTS':
        if (!criteria.departmentIds?.length && !criteria.departmentId) return [];
        if (criteria.departmentIds?.length > 0) {
          conditions.push({ departmentId: { in: criteria.departmentIds } });
        } else if (criteria.departmentId) {
          conditions.push({ departmentId: criteria.departmentId });
        }
        break;

      case 'ROLES':
        if (!criteria.roles?.length && !criteria.designationId) return [];
        if (criteria.roles?.length > 0) {
          conditions.push({ user: { role: { in: criteria.roles } } });
        }
        if (criteria.designationId) {
          conditions.push({ designationId: criteria.designationId });
        }
        break;

      case 'EMPLOYEES':
        if (criteria.employeeIds?.length > 0) {
          conditions.push({ id: { in: criteria.employeeIds } });
        } else {
          return [];
        }
        break;

      case 'COMBINED': {
        const orClauses: Prisma.EmployeeWhereInput[] = [];
        if (criteria.storeIds?.length) orClauses.push({ storeId: { in: criteria.storeIds } });
        if (criteria.branchIds?.length) orClauses.push({ branchId: { in: criteria.branchIds } });
        if (criteria.departmentIds?.length) orClauses.push({ departmentId: { in: criteria.departmentIds } });
        if (criteria.roles?.length) orClauses.push({ user: { role: { in: criteria.roles } } });
        if (criteria.employeeIds?.length) orClauses.push({ id: { in: criteria.employeeIds } });
        if (orClauses.length === 0) return [];
        conditions.push({ OR: orClauses });
        break;
      }

      case 'ALL_EMPLOYEES':
        break;
      default:
        throw new CampaignError(400, 'Invalid campaign audience');
    }

    const employees = await prisma.employee.findMany({
      where: { AND: conditions },
      select: {
        id: true,
        userId: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        designation: true,
        department: { select: { id: true, name: true } },
        store: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true } },
        designationRelation: { select: { id: true, name: true } },
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
            devices: {
              select: { fcmToken: true },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    if (criteria.birthdayOnly) {
      const date = targetDateStr || localDate(new Date(), criteria.timezone || 'Asia/Kolkata');
      return employees.filter(e => birthdayMatches(e.dateOfBirth, date));
    }

    return employees;
  }

  /**
   * Preview audience before sending
   */
  async previewAudience(audienceType: string, criteria: Audience, actorId?: number) {
    const employees = await this.resolveAudience(audienceType, criteria, actorId);

    const formatted = employees.map(emp => {
      const userTokens = [
        ...(emp.user?.fcmTokens?.map(t => t.token) || []),
        ...(emp.user?.devices?.map(d => d.fcmToken) || []),
      ].filter((t): t is string => Boolean(t?.trim()));

      return {
        id: emp.id,
        userId: emp.userId,
        employeeCode: emp.employeeCode,
        name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee',
        designation: emp.designationRelation?.name || emp.designation || 'Staff',
        department: emp.department?.name || 'General',
        store: emp.store?.name || emp.branch?.name || 'Headquarters',
        hasPushToken: userTokens.length > 0,
      };
    });

    return {
      totalCount: formatted.length,
      reachableByPush: formatted.filter(e => e.hasPushToken).length,
      preview: formatted.slice(0, 50),
    };
  }

  /**
   * Create Campaign
   */
  async createCampaign(data: any, actorId?: number) {
    let status = data.status || (data.scheduledAt ? 'SCHEDULED' : 'DRAFT');

    data = { ...data, imageUrl: await canonicalCampaignImage(data.imageUrl) };
    const campaign = await withCampaignImageLock(async tx => {
      await validateManagedImage(data.imageUrl);
      return tx.campaign.create({
      data: {
        title: data.title,
        message: data.message,
        description: data.description || null,
        notificationType: data.notificationType || 'GENERAL_ANNOUNCEMENT',
        imageUrl: data.imageUrl || null,
        actionUrl: data.actionUrl || null,
        audienceType: data.audienceType || 'ALL_EMPLOYEES',
        audienceCriteria: data.audienceCriteria as any,
        status,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        createdById: actorId || null,
        totalRecipients: data.totalRecipients || 0,
      },
    });
    });

    return campaign;
  }

  /**
   * Update Campaign
   */
  async updateCampaign(id: string, data: any, actorId?: number) {
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) {
      throw new CampaignError(404, 'Campaign not found');
    }
    if (['SENDING', 'SENT', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'DELIVERY_UNKNOWN'].includes(existing.status)) {
      throw new CampaignError(409, 'Cannot modify campaign that has already been dispatched');
    }

    data = { ...data, imageUrl: await canonicalCampaignImage(data.imageUrl) };
    const updateData: Prisma.CampaignUpdateInput = {};
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
      if (!['DRAFT', 'SCHEDULED', 'AUTOMATIC'].includes(data.status)) throw new CampaignError(400, 'Invalid campaign status');
      updateData.status = data.status;
    }

    return withCampaignImageLock(async tx => {
      await validateManagedImage(data.imageUrl);
      const result = await tx.campaign.updateMany({
        where: { id, status: { in: ['DRAFT', 'SCHEDULED', 'CANCELLED', 'FAILED', 'AUTOMATIC'] } },
        data: updateData as Prisma.CampaignUpdateManyMutationInput,
      });
      if (result.count !== 1) throw new CampaignError(409, 'Campaign can no longer be modified');
      return tx.campaign.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Deliver Campaign Notifications immediately (FCM Multicast + In-App DB records)
   */
  async sendCampaign(id: string, actorId?: number) {
    let campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new CampaignError(404, 'Campaign not found');
    }

    // Guard against duplicate send requests
    if (campaign.status === 'SENDING') {
      throw new CampaignError(409, 'Campaign is currently being dispatched');
    }
    if (['SENT', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'DELIVERY_UNKNOWN'].includes(campaign.status)) {
      throw new CampaignError(409, 'Campaign has already been dispatched');
    }

    // Set status to SENDING with a lock timestamp
    const claim = await prisma.campaign.updateMany({
      where: { id, status: { in: ['DRAFT', 'SCHEDULED', 'FAILED'] } },
      data: { status: 'SENDING', lockedAt: new Date() },
    });
    if (claim.count !== 1) throw new CampaignError(409, 'Campaign cannot be dispatched in its current state');

    try {
      campaign = (await prisma.campaign.findUnique({ where: { id } }))!;
      const audienceCriteria = (campaign.audienceCriteria as any) || {};
      const employees = await this.resolveAudience(
        campaign.audienceType,
        audienceCriteria,
        campaign.createdById || actorId || undefined
      );

      if (employees.length === 0) {
        await prisma.campaign.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            totalRecipients: 0,
            sentCount: 0,
            failedCount: 0,
            sentAt: new Date(),
            lockedAt: null,
          },
        });
        return {
          success: true,
          message: 'Audience resolved to 0 recipients. No messages dispatched.',
          totalRecipients: 0,
          sentCount: 0,
          failedCount: 0,
        };
      }

      // Collect all employee user IDs to fetch FCM tokens in bulk
      const validUserIds = employees
        .map(e => e.userId)
        .filter((uid): uid is number => typeof uid === 'number' && uid > 0);

      const [fcmRows, deviceRows] = await Promise.all([
        prisma.fCMToken.findMany({
          where: { userId: { in: validUserIds }, isActive: true },
          select: { userId: true, token: true },
        }),
        prisma.device.findMany({
          where: { userId: { in: validUserIds } },
          select: { userId: true, fcmToken: true },
        }),
      ]);

      // Map tokens by userId
      const userTokensMap = new Map<number, Set<string>>();
      for (const row of fcmRows) {
        if (row.token?.trim()) {
          if (!userTokensMap.has(row.userId)) userTokensMap.set(row.userId, new Set());
          userTokensMap.get(row.userId)!.add(row.token.trim());
        }
      }
      for (const row of deviceRows) {
        if (row.fcmToken?.trim()) {
          if (!userTokensMap.has(row.userId)) userTokensMap.set(row.userId, new Set());
          userTokensMap.get(row.userId)!.add(row.fcmToken.trim());
        }
      }

      // 1. Create in-app Notification records and CampaignRecipient records
      const employeeNotificationMap = new Map<number, number>(); // employeeId -> notificationId

      for (const emp of employees) {
        try {
          // Upsert CampaignRecipient
          await prisma.campaignRecipient.upsert({
            where: {
              campaignId_employeeId: {
                campaignId: campaign.id,
                employeeId: emp.id,
              },
            },
            update: {
              deliveryStatus: 'PENDING',
              userId: emp.userId,
            },
            create: {
              campaignId: campaign.id,
              employeeId: emp.id,
              userId: emp.userId,
              deliveryStatus: 'PENDING',
            },
          });

          // In-App Notification record
          const existingNotif = await prisma.notification.findFirst({
            where: {
              campaignId: campaign.id,
              employeeId: emp.id,
            },
          });

          let notifId = existingNotif?.id;
          if (!notifId) {
            const notif = await prisma.notification.create({
              data: {
                employeeId: emp.id,
                userId: emp.userId,
                campaignId: campaign.id,
                title: campaign.title,
                body: campaign.message,
                category: 'CAMPAIGN',
                actionType: 'CAMPAIGN',
                actionId: campaign.id,
                imageUrl: campaign.imageUrl || null,
                actionUrl: campaign.actionUrl || null,
                deliveryStatus: 'PENDING',
                isRead: false,
              },
            });
            notifId = notif.id;
          }
          employeeNotificationMap.set(emp.id, notifId);
        } catch (dbErr) {
          console.error('[CampaignDispatch] In-app record failed', { campaignId: id, employeeId: emp.id });
          throw dbErr;
        }
      }

      // 2. Aggregate all tokens across recipients for multicast push
      const tokenToRecipientsMap = new Map<string, number[]>(); // token -> employeeIds[]

      for (const emp of employees) {
        if (emp.userId && userTokensMap.has(emp.userId)) {
          const tokens = Array.from(userTokensMap.get(emp.userId)!);
          for (const token of tokens) {
            if (!tokenToRecipientsMap.has(token)) tokenToRecipientsMap.set(token, []);
            tokenToRecipientsMap.get(token)!.push(emp.id);
          }
        }
      }

      const allTokens = Array.from(tokenToRecipientsMap.keys());
      let acceptedTokenCount = 0;
      let failedTokenCount = 0;
      const recipientStatusMap = new Map<number, { success: boolean; messageId?: string; error?: string }>();

      // Initialize recipient status for employees with no registered tokens
      for (const emp of employees) {
        const hasTokens = emp.userId && userTokensMap.has(emp.userId) && userTokensMap.get(emp.userId)!.size > 0;
        if (!hasTokens) {
          recipientStatusMap.set(emp.id, { success: true }); // In-app delivered, no tokens
        }
      }

      const pushImageUrl = await campaignImages.notificationUrl(campaign.imageUrl);
      // Push payload specification as requested by mobile client
      const payloadData: Record<string, string> = {
        campaignId: String(campaign.id),
        type: 'CAMPAIGN',
        category: 'CAMPAIGN',
        notificationType: 'CAMPAIGN',
        actionType: 'CAMPAIGN',
        actionId: String(campaign.id),
        actionUrl: campaign.actionUrl || '',
        imageUrl: pushImageUrl || '',
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      };

      const notificationOptions = {
        imageUrl: pushImageUrl,
        priority: { high: true },
      };

      // 3. Dispatch FCM multicast in batches of 500 (FCM limit)
      const BATCH_SIZE = 500;
      for (let i = 0; i < allTokens.length; i += BATCH_SIZE) {
        const batch = allTokens.slice(i, i + BATCH_SIZE);
        try {
          const batchResult = await firebaseNotificationService.sendNotificationToTokens(
            batch,
            campaign.title,
            Array.from(campaign.message).slice(0, 180).join(''),
            payloadData,
            notificationOptions
          );

          acceptedTokenCount += batchResult.successCount;
          failedTokenCount += batchResult.failureCount;

          batch.forEach((tok, idx) => {
            const resp = batchResult.responses[idx];
            const empIds = tokenToRecipientsMap.get(tok) || [];
            for (const empId of empIds) {
              const current = recipientStatusMap.get(empId);
              if (resp?.success) {
                recipientStatusMap.set(empId, {
                  success: true,
                  messageId: resp.messageId,
                });
              } else if (!current || !current.success) {
                recipientStatusMap.set(empId, {
                  success: false,
                  error: safeFcmError(resp?.error, batch).message,
                });
              }
            }
          });
        } catch (fcmBatchErr) {
          console.error('[CampaignDispatch] FCM batch failure', { campaignId: id, ...safeFcmError(fcmBatchErr, batch) });
          failedTokenCount += batch.length;
          batch.forEach(tok => {
            const empIds = tokenToRecipientsMap.get(tok) || [];
            for (const empId of empIds) {
              if (recipientStatusMap.get(empId)?.success) continue;
              recipientStatusMap.set(empId, {
                success: false,
                error: safeFcmError(fcmBatchErr, batch).message,
              });
            }
          });
        }
      }

      // 4. Update recipient records with actual outcomes
      let totalSentRecipients = 0;
      let totalFailedRecipients = 0;

      for (const emp of employees) {
        const hasTokens = emp.userId && userTokensMap.has(emp.userId) && userTokensMap.get(emp.userId)!.size > 0;
        const statusObj = recipientStatusMap.get(emp.id);

        let finalDeliveryStatus = 'IN_APP_ONLY';
        let failureReason: string | null = null;
        let fcmMessageId: string | null = null;

        if (hasTokens) {
          if (statusObj?.success) {
            finalDeliveryStatus = 'SENT';
            fcmMessageId = statusObj.messageId || null;
            totalSentRecipients++;
          } else {
            finalDeliveryStatus = 'FAILED';
            failureReason = statusObj?.error || 'Push delivery rejected';
            totalFailedRecipients++;
          }
        } else {
          totalSentRecipients++; // In-app notification successful
        }

        const notifId = employeeNotificationMap.get(emp.id);
        await Promise.all([
          prisma.campaignRecipient.updateMany({
            where: { campaignId: campaign.id, employeeId: emp.id },
            data: {
              deliveryStatus: finalDeliveryStatus,
              failureReason,
              fcmMessageId,
            },
          }),
          notifId
            ? prisma.notification.update({
                where: { id: notifId },
                data: {
                  deliveryStatus: finalDeliveryStatus,
                  failureReason,
                  fcmMessageId,
                },
              })
            : Promise.resolve(),
        ]);
      }

      // 5. Finalize Campaign Status
      const finalCampaignStatus = totalFailedRecipients > 0 ? 'COMPLETED_WITH_ERRORS' : 'SENT';

      const updatedCampaign = await prisma.campaign.update({
        where: { id },
        data: {
          status: finalCampaignStatus,
          totalRecipients: employees.length,
          sentCount: totalSentRecipients,
          failedCount: totalFailedRecipients,
          sentAt: new Date(),
          lockedAt: null,
        },
      });

      console.log(`📢 [CampaignService] Campaign "${campaign.title}" (${campaign.id}) dispatched:`, {
        recipients: employees.length,
        tokensSent: allTokens.length,
        tokensAccepted: acceptedTokenCount,
        tokensFailed: failedTokenCount,
        finalStatus: finalCampaignStatus,
      });

      return {
        success: true,
        message: `Campaign sent to ${employees.length} recipient(s). ${acceptedTokenCount} device token(s) accepted.`,
        campaign: updatedCampaign,
        delivery: {
          recipients: employees.length,
          acceptedTokens: acceptedTokenCount,
          failedTokens: failedTokenCount,
          sentCount: totalSentRecipients,
          failedCount: totalFailedRecipients,
        },
      };
    } catch (err: any) {
      console.error('[CampaignService] Delivery error', { campaignId: id, ...safeFcmError(err) });
      await prisma.campaign.update({
        where: { id },
        data: { status: 'DELIVERY_UNKNOWN', lockedAt: null },
      });
      throw err;
    }
  }

  /**
   * Schedule campaign
   */
  async scheduleCampaign(id: string, scheduledAt: string | Date) {
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new CampaignError(404, 'Campaign not found');

    if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) throw new CampaignError(409, 'Only unsent campaigns can be scheduled');
    const date = new Date(scheduledAt);
    if (!Number.isFinite(date.getTime()) || date <= new Date()) {
      throw new CampaignError(400, 'Scheduled date must be in the future');
    }

    const updated = await prisma.campaign.updateMany({
      where: { id, status: { in: ['DRAFT', 'SCHEDULED'] } },
      data: { scheduledAt: date, status: 'SCHEDULED' },
    });
    if (updated.count !== 1) throw new CampaignError(409, 'Campaign can no longer be scheduled');
    return prisma.campaign.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Cancel campaign
   */
  async cancelCampaign(id: string) {
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new CampaignError(404, 'Campaign not found');
    if (['SENDING', 'SENT', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'DELIVERY_UNKNOWN'].includes(campaign.status)) {
      throw new CampaignError(409, 'Cannot cancel a campaign that has already been dispatched');
    }

    const updated = await prisma.campaign.updateMany({
      where: { id, status: { in: ['DRAFT', 'SCHEDULED', 'FAILED', 'AUTOMATIC'] } },
      data: { status: 'CANCELLED' },
    });
    if (updated.count !== 1) throw new CampaignError(409, 'Campaign can no longer be cancelled');
    return prisma.campaign.findUniqueOrThrow({ where: { id } });
  }

  /** Permanent deletion preserves notification history and its image references. */
  async deleteCampaign(id: string) {
    return withCampaignImageLock(async tx => {
      const campaign = await tx.campaign.findUnique({ where: { id } });
      if (!campaign) throw new CampaignError(404, 'Campaign not found');
      if (campaign.status === 'SENDING') throw new CampaignError(409, 'Cannot delete a campaign being dispatched');
      const deleted = await tx.campaign.deleteMany({ where: { id, status: { not: 'SENDING' } } });
      if (!deleted.count) throw new CampaignError(409, 'Campaign is being dispatched');
      console.info('[Campaign] Permanently deleted', { campaignId: id });
      return { id };
    });
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

    if (!campaign) throw new CampaignError(404, 'Campaign not found');
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

    const where: Prisma.CampaignWhereInput = {};
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
   * Get campaign analytics
   */
  async getCampaignAnalytics(id: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        recipients: {
          take: 100,
          orderBy: { createdAt: 'desc' },
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

    if (!campaign) throw new CampaignError(404, 'Campaign not found');

    const totalRecipients = campaign.totalRecipients || campaign.recipients.length;
    const sentCount = campaign.sentCount || campaign.recipients.filter(r => r.deliveryStatus === 'SENT').length;
    const failedCount = campaign.failedCount || campaign.recipients.filter(r => r.deliveryStatus === 'FAILED').length;
    const readCount = await prisma.notification.count({
      where: { campaignId: id, isRead: true },
    });

    const deliveryRate = totalRecipients > 0 ? Math.round((sentCount / totalRecipients) * 100) : 0;
    const readRate = sentCount > 0 ? Math.round((readCount / sentCount) * 100) : 0;

    return {
      campaignId: campaign.id,
      title: campaign.title,
      status: campaign.status,
      notificationType: campaign.notificationType,
      sentAt: campaign.sentAt,
      scheduledAt: campaign.scheduledAt,
      totalRecipients,
      sentCount,
      failedCount,
      readCount,
      deliveryRate,
      readRate,
      recipients: campaign.recipients,
    };
  }

  /**
   * Get target options for campaign modal dropdowns
   */
  async getTargetOptions() {
    const [stores, departments, designations, employees] = await Promise.all([
      prisma.store.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      prisma.department.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      prisma.designation.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.employee.findMany({
        where: { status: { in: ['active', 'ACTIVE'] } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          storeId: true,
          departmentId: true,
          designationId: true,
        },
        orderBy: { firstName: 'asc' },
      }),
    ]);

    const roles = [
      { id: 'SUPER_ADMIN', name: 'Super Admin' },
      { id: 'ADMIN', name: 'Admin' },
      { id: 'HR', name: 'HR Manager' },
      { id: 'PLATFORM_ADMIN', name: 'Platform Admin' },
      { id: 'STORE_MANAGER', name: 'Store Manager' },
      { id: 'EMPLOYEE', name: 'Employee' },
      { id: 'SALESMAN', name: 'Salesman' },
      { id: 'HELPER', name: 'Helper' },
    ];

    return {
      stores,
      departments,
      designations,
      roles,
      employees: employees.map(e => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        employeeCode: e.employeeCode,
        storeId: e.storeId,
        departmentId: e.departmentId,
        designationId: e.designationId,
      })),
    };
  }

  /**
   * Get employees celebrating their birthday today
   */
  async getTodayBirthdays(options?: { timezone?: string; storeId?: number; branchId?: number }) {
    const tz = options?.timezone || 'Asia/Kolkata';
    const todayStr = localDate(new Date(), tz);

    const where: Prisma.EmployeeWhereInput = {
      status: { in: ['active', 'ACTIVE'] },
      dateOfBirth: { not: null },
      ...(options?.storeId ? { storeId: options.storeId } : {}),
      ...(options?.branchId ? { branchId: options.branchId } : {}),
    };

    const employees = await prisma.employee.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        dateOfBirth: true,
        department: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    const celebrating = employees.filter(e => birthdayMatches(e.dateOfBirth, todayStr));

    // Check if wished today
    const celebrationIds = celebrating.map(e => e.id);
    const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const alreadySent = celebrationIds.length > 0
      ? await prisma.campaignRecipient.findMany({
          where: {
            employeeId: { in: celebrationIds },
            createdAt: { gte: dayStart },
            campaign: { notificationType: 'BIRTHDAY_WISHES' },
          },
          select: { employeeId: true },
        })
      : [];

    const alreadySentSet = new Set(alreadySent.map(r => r.employeeId));

    return celebrating.map(emp => ({
      ...emp,
      alreadyWished: alreadySentSet.has(emp.id),
    }));
  }

  /**
   * Send birthday wishes
   */
  async sendBirthdayWishes(options: {
    employeeIds?: number[];
    customTitle?: string;
    customMessage?: string;
    imageUrl?: string;
    broadcastToAll?: boolean;
    timezone?: string;
    actorId?: number;
  }) {
    const tz = options.timezone || 'Asia/Kolkata';
    const date = localDate(new Date(), tz);
    const birthdays = await this.getTodayBirthdays({ timezone: tz });

    const targetEmployees = options.employeeIds?.length
      ? birthdays.filter(b => options.employeeIds!.includes(b.id))
      : birthdays;

    if (!targetEmployees.length) {
      return { message: 'No eligible birthday employees found for today', count: 0, details: [] };
    }

    const results = [];
    for (const emp of targetEmployees) {
      const dedupeKey = `birthday-wish:${emp.id}:${date}`;
      const existing = await prisma.campaign.findFirst({ where: { dedupeKey } });
      if (existing) {
        results.push({ employeeId: emp.id, status: 'SKIPPED_ALREADY_SENT' });
        continue;
      }

      const title = options.customTitle || `🎂 Happy Birthday, ${emp.firstName}!`;
      const message = options.customMessage ||
        `Warmest birthday wishes to ${emp.firstName} ${emp.lastName}! May your special day bring you immense joy, happiness, and success! 🎉`;

      const campaign = await prisma.campaign.create({
        data: {
          title,
          message,
          notificationType: 'BIRTHDAY_WISHES',
          imageUrl: options.imageUrl || '/images/birthday-banner.png',
          audienceType: options.broadcastToAll ? 'ALL_EMPLOYEES' : 'SELECTED_EMPLOYEES',
          audienceCriteria: options.broadcastToAll
            ? { birthdayOnly: false, automaticBirthday: false, timezone: tz }
            : { employeeIds: [emp.id], birthdayOnly: false, automaticBirthday: false, timezone: tz },
          createdById: options.actorId || null,
          createdBy: 'HR Birthday Greetings',
          status: 'DRAFT',
          dedupeKey,
        },
      });

      const sendResult = await this.sendCampaign(campaign.id, options.actorId);
      results.push({ employeeId: emp.id, campaignId: campaign.id, result: sendResult });
    }

    return {
      message: `Processed birthday wishes for ${results.length} employee(s)`,
      count: results.length,
      details: results,
    };
  }

  /**
   * Upload campaign banner image
   */
  async saveUploadedImage(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<string> {
    return campaignImages.upload(file);
  }
}

export const campaignService = new CampaignService();
