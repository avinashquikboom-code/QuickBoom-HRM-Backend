import { prisma } from '../src/utils/db';
import { ensureDefaultNotificationRules } from '../src/routes/notificationManagementRoutes';
import { runDailyRuleChecks, executeRuleManually } from '../src/services/notificationRuleScheduler';

async function main() {
  console.log('🧪 Testing Notification Rules and Management...');

  // 1. Ensure default notification rules are seeded
  await ensureDefaultNotificationRules();

  // 2. Query rules
  const rules = await prisma.notificationRule.findMany();
  console.log(`✅ Rules in database: ${rules.length}`);
  if (rules.length < 7) {
    throw new Error(`Expected at least 7 rules, got ${rules.length}`);
  }

  // 3. Query templates
  const templates = await prisma.notificationTemplate.findMany();
  console.log(`✅ Templates in database: ${templates.length}`);
  if (templates.length < 7) {
    throw new Error(`Expected at least 7 templates, got ${templates.length}`);
  }

  // 4. Test manual trigger on a rule
  const birthdayRule = rules.find(r => r.event === 'EMPLOYEE_BIRTHDAY');
  if (birthdayRule) {
    const triggerRes = await executeRuleManually(birthdayRule.id);
    console.log('✅ Trigger birthday rule result:', triggerRes);
  }

  // 5. Test stats calculation
  const total = await prisma.notification.count();
  const unread = await prisma.notification.count({ where: { isRead: false } });
  const sent = await prisma.notification.count({ where: { deliveryStatus: 'SENT' } });
  const failed = await prisma.notification.count({ where: { deliveryStatus: 'FAILED' } });
  console.log(`✅ Notification Stats: total=${total}, unread=${unread}, sent=${sent}, failed=${failed}`);

  console.log('🎉 All notification rule tests passed!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
