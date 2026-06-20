import { prisma } from '../src/utils/db';

async function updateRadius() {
  try {
    console.log('Connecting to database...');
    
    // Update all offices where maxPunchRadiusMeters is less than 25 to 25
    const result = await prisma.office.updateMany({
      where: {
        maxPunchRadiusMeters: {
          lt: 25
        }
      },
      data: {
        maxPunchRadiusMeters: 25,
        idealRadiusMeters: 25
      }
    });
    
    console.log(`Successfully updated ${result.count} office(s) to 25m geofence radius.`);
    
    // Log current offices
    const offices = await prisma.office.findMany({
      select: {
        id: true,
        name: true,
        maxPunchRadiusMeters: true,
        idealRadiusMeters: true
      }
    });
    console.log('Current offices:', offices);
    
  } catch (e: any) {
    console.error('Failed to update offices:', e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

updateRadius();
