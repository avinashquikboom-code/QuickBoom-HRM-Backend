import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding FeatureAccess for all employees...');
  const employees = await prisma.employee.findMany();
  const features = [
    'punch', 'leave', 'task', 'remote-work',
    'shift-request', 'expense-claim',
    'attendance-correction', 'commission', 'salary-view'
  ];

  let count = 0;
  for (const employee of employees) {
    for (const feature of features) {
      const existing = await prisma.featureAccess.findUnique({
        where: {
          employeeId_featureName: {
            employeeId: employee.id,
            featureName: feature,
          }
        }
      });
      if (!existing) {
        await prisma.featureAccess.create({
          data: {
            employeeId: employee.id,
            featureName: feature,
            isEnabled: true,
          }
        });
        count++;
      }
    }
  }
  console.log(`Successfully seeded ${count} new FeatureAccess records.`);
  await prisma.$disconnect();
}

seed().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
