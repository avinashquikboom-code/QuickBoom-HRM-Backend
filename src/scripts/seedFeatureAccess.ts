import { prisma } from '../utils/db';

const FEATURES = ['punch', 'leave', 'task', 'remote-work', 'expense'];

async function seedFeatureAccess() {
  console.log('Fetching employees...');
  const employees = await prisma.employee.findMany();
  
  console.log(`Found ${employees.length} employees. Seeding FeatureAccess...`);
  
  let createdCount = 0;
  
  for (const emp of employees) {
    for (const feature of FEATURES) {
      // Check if exists
      const existing = await prisma.featureAccess.findUnique({
        where: {
          employeeId_featureName: {
            employeeId: emp.id,
            featureName: feature
          }
        }
      });
      
      if (!existing) {
        await prisma.featureAccess.create({
          data: {
            employeeId: emp.id,
            featureName: feature,
            isEnabled: true, // Default to true
            grantedBy: 'SYSTEM',
            reason: 'Default access granted during initialization',
          }
        });
        createdCount++;
      }
    }
  }
  
  console.log(`Successfully seeded ${createdCount} feature access records.`);
}

seedFeatureAccess()
  .catch(e => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
