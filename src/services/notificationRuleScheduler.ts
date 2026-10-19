import cron from 'node-cron';
import { prisma } from '../utils/db';
import { firebaseNotificationService } from './firebaseNotificationService';

/**
 * Executes a specific rule for an event or checks all daily scheduled rules.
 */
export async function runDailyRuleChecks() {
  console.log('🔄 [NotificationRules] Running daily automated rule checks...');
  try {
    const rules = await prisma.notificationRule.findMany({
      where: { status: 'ACTIVE' }
    });

    const activeEvents = new Set(rules.map(r => r.event));

    // 1. Employee Birthdays
    if (activeEvents.has('EMPLOYEE_BIRTHDAY')) {
      await checkAndSendBirthdayGreetings();
    }

    // 2. Work Anniversaries
    if (activeEvents.has('WORK_ANNIVERSARY')) {
      await checkAndSendAnniversaryGreetings();
    }

    // 3. Upcoming Holidays
    if (activeEvents.has('UPCOMING_HOLIDAY')) {
      await checkAndSendHolidayAlerts();
    }
  } catch (error) {
    console.error('❌ [NotificationRules] Error during daily rule checks:', error);
  }
}

/**
 * Birthday Greetings check
 */
async function checkAndSendBirthdayGreetings() {
  try {
    const rule = await prisma.notificationRule.findUnique({
      where: { event: 'EMPLOYEE_BIRTHDAY' }
    });
    if (!rule || rule.status !== 'ACTIVE') return;

    const template = await prisma.notificationTemplate.findUnique({
      where: { event: 'EMPLOYEE_BIRTHDAY' }
    });

    // Find employees whose birthday is today using raw SQL on dateOfBirth
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    const dateStr = today.toISOString().split('T')[0];

    const birthdayEmployees: Array<{ id: number; userId: number | null; firstName: string; lastName: string }> =
      await prisma.$queryRawUnsafe(`
        SELECT id, "userId", "firstName", "lastName"
        FROM "Employee"
        WHERE "status" = 'active'
          AND "dateOfBirth" IS NOT NULL
          AND EXTRACT(MONTH FROM "dateOfBirth") = ${currentMonth}
          AND EXTRACT(DAY FROM "dateOfBirth") = ${currentDay}
      `);

    for (const emp of birthdayEmployees) {
      if (!emp.userId) continue;

      // Deduplication: check if already notified today for birthday
      const existing = await prisma.notification.findFirst({
        where: {
          employeeId: emp.id,
          category: 'GREETINGS',
          actionType: 'BIRTHDAY',
          createdAt: { gte: new Date(`${dateStr}T00:00:00.000Z`) }
        }
      });
      if (existing) continue;

      const title = (template?.title || '🎂 Happy Birthday {firstName}!')
        .replace('{firstName}', emp.firstName)
        .replace('{name}', `${emp.firstName} ${emp.lastName}`);
      const body = (template?.message || 'Wishing you a very Happy Birthday from all of us!')
        .replace('{firstName}', emp.firstName)
        .replace('{name}', `${emp.firstName} ${emp.lastName}`);

      if (rule.inApp) {
        await prisma.notification.create({
          data: {
            employeeId: emp.id,
            userId: emp.userId,
            title,
            body,
            category: 'GREETINGS',
            actionType: 'BIRTHDAY',
            deliveryStatus: 'SENT',
            isRead: false
          }
        });
      }

      if (rule.push) {
        try {
          await firebaseNotificationService.sendNotificationToUser(emp.userId, title, body, {
            type: 'GREETINGS',
            category: 'GREETINGS',
            actionType: 'BIRTHDAY'
          });
        } catch (err) {
          console.warn(`[Birthday Push] Failed to deliver push to user ${emp.userId}:`, err);
        }
      }
      console.log(`🎉 [NotificationRules] Sent Birthday greeting to ${emp.firstName} ${emp.lastName}`);
    }
  } catch (error) {
    console.error('❌ [NotificationRules] Error checking birthdays:', error);
  }
}

/**
 * Work Anniversary check
 */
async function checkAndSendAnniversaryGreetings() {
  try {
    const rule = await prisma.notificationRule.findUnique({
      where: { event: 'WORK_ANNIVERSARY' }
    });
    if (!rule || rule.status !== 'ACTIVE') return;

    const template = await prisma.notificationTemplate.findUnique({
      where: { event: 'WORK_ANNIVERSARY' }
    });

    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    const currentYear = today.getFullYear();
    const dateStr = today.toISOString().split('T')[0];

    const anniversaryEmployees: Array<{ id: number; userId: number | null; firstName: string; lastName: string; joiningYear: number }> =
      await prisma.$queryRawUnsafe(`
        SELECT id, "userId", "firstName", "lastName", EXTRACT(YEAR FROM "joiningDate")::int as "joiningYear"
        FROM "Employee"
        WHERE "status" = 'active'
          AND "joiningDate" IS NOT NULL
          AND EXTRACT(MONTH FROM "joiningDate") = ${currentMonth}
          AND EXTRACT(DAY FROM "joiningDate") = ${currentDay}
          AND EXTRACT(YEAR FROM "joiningDate") < ${currentYear}
      `);

    for (const emp of anniversaryEmployees) {
      if (!emp.userId) continue;

      const years = currentYear - emp.joiningYear;
      if (years <= 0) continue;

      const existing = await prisma.notification.findFirst({
        where: {
          employeeId: emp.id,
          category: 'GREETINGS',
          actionType: 'ANNIVERSARY',
          createdAt: { gte: new Date(`${dateStr}T00:00:00.000Z`) }
        }
      });
      if (existing) continue;

      const title = (template?.title || '🎉 Happy Work Anniversary {firstName}!')
        .replace('{firstName}', emp.firstName)
        .replace('{name}', `${emp.firstName} ${emp.lastName}`)
        .replace('{years}', String(years));
      const body = (template?.message || `Congratulations on completing ${years} year(s) with our company! Thank you for your dedication.`)
        .replace('{firstName}', emp.firstName)
        .replace('{years}', String(years));

      if (rule.inApp) {
        await prisma.notification.create({
          data: {
            employeeId: emp.id,
            userId: emp.userId,
            title,
            body,
            category: 'GREETINGS',
            actionType: 'ANNIVERSARY',
            deliveryStatus: 'SENT',
            isRead: false
          }
        });
      }

      if (rule.push) {
        try {
          await firebaseNotificationService.sendNotificationToUser(emp.userId, title, body, {
            type: 'GREETINGS',
            category: 'GREETINGS',
            actionType: 'ANNIVERSARY'
          });
        } catch (err) {
          console.warn(`[Anniversary Push] Failed for user ${emp.userId}:`, err);
        }
      }
      console.log(`🎉 [NotificationRules] Sent Work Anniversary greeting to ${emp.firstName} ${emp.lastName} (${years} years)`);
    }
  } catch (error) {
    console.error('❌ [NotificationRules] Error checking work anniversaries:', error);
  }
}

/**
 * Holiday alert (checks if tomorrow is a holiday)
 */
async function checkAndSendHolidayAlerts() {
  try {
    const rule = await prisma.notificationRule.findUnique({
      where: { event: 'UPCOMING_HOLIDAY' }
    });
    if (!rule || rule.status !== 'ACTIVE') return;

    const template = await prisma.notificationTemplate.findUnique({
      where: { event: 'UPCOMING_HOLIDAY' }
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const holiday = await prisma.holiday.findFirst({
      where: { date: tomorrow }
    });
    if (!holiday) return;

    const dateStr = tomorrow.toISOString().split('T')[0];

    // Deduplication check: check if any holiday notification was already sent today for this holiday
    const existing = await prisma.notification.findFirst({
      where: {
        category: 'HOLIDAY',
        actionId: String(holiday.id),
        createdAt: { gte: new Date(new Date().toISOString().split('T')[0] + 'T00:00:00.000Z') }
      }
    });
    if (existing) return;

    const activeEmployees = await prisma.employee.findMany({
      where: { status: 'active' },
      select: { id: true, userId: true, firstName: true }
    });

    const title = (template?.title || '🌴 Upcoming Holiday: {holidayName}')
      .replace('{holidayName}', holiday.name)
      .replace('{holidayDate}', dateStr);
    const body = (template?.message || `Please note that offices will be closed tomorrow (${dateStr}) for ${holiday.name}.`)
      .replace('{holidayName}', holiday.name)
      .replace('{holidayDate}', dateStr);

    for (const emp of activeEmployees) {
      if (!emp.userId) continue;

      if (rule.inApp) {
        await prisma.notification.create({
          data: {
            employeeId: emp.id,
            userId: emp.userId,
            title,
            body,
            category: 'HOLIDAY',
            actionId: String(holiday.id),
            actionType: 'HOLIDAY',
            deliveryStatus: 'SENT',
            isRead: false
          }
        });
      }

      if (rule.push) {
        try {
          await firebaseNotificationService.sendNotificationToUser(emp.userId, title, body, {
            type: 'HOLIDAY',
            category: 'HOLIDAY',
            actionId: String(holiday.id)
          });
        } catch {
          // Non-blocking push fail
        }
      }
    }
    console.log(`🌴 [NotificationRules] Dispatched Upcoming Holiday notification for ${holiday.name} to ${activeEmployees.length} employees.`);
  } catch (error) {
    console.error('❌ [NotificationRules] Error checking upcoming holidays:', error);
  }
}

/**
 * Execute a rule manually on demand (e.g. from Admin UI trigger)
 */
export async function executeRuleManually(ruleId: number): Promise<{ success: boolean; message: string; count: number }> {
  const rule = await prisma.notificationRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new Error('Rule not found');

  if (rule.event === 'EMPLOYEE_BIRTHDAY') {
    await checkAndSendBirthdayGreetings();
    return { success: true, message: 'Birthday greetings evaluated and dispatched successfully.', count: 1 };
  } else if (rule.event === 'WORK_ANNIVERSARY') {
    await checkAndSendAnniversaryGreetings();
    return { success: true, message: 'Anniversary greetings evaluated and dispatched successfully.', count: 1 };
  } else if (rule.event === 'UPCOMING_HOLIDAY') {
    await checkAndSendHolidayAlerts();
    return { success: true, message: 'Holiday alerts evaluated and dispatched successfully.', count: 1 };
  } else {
    return { success: true, message: `Rule ${rule.event} triggered successfully.`, count: 1 };
  }
}

/**
 * Initialize rule scheduler cron at 09:00 AM IST daily
 */
export function initNotificationRuleCron() {
  cron.schedule('0 9 * * *', async () => {
    await runDailyRuleChecks();
  });
  console.log('⏰ [NotificationRules] Notification rule daily scheduler active (09:00 AM).');
}
