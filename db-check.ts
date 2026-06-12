import { prisma } from './src/utils/db';

async function check() {
  try {
    console.log('Connecting to database...');
    const totalEntities = await prisma.office.count();
    const globalSeats = await prisma.employee.count();
    console.log('Connection successful!');
    console.log('Total entities (offices):', totalEntities);
    console.log('Global seats (employees):', globalSeats);
  } catch (e: any) {
    console.error('Database connection failed:', e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
