import { prisma } from './src/utils/db';

async function check() {
  try {
    console.log('Querying SystemSetting...');
    const settings = await prisma.systemSetting.findMany();
    console.log('Current SystemSetting records:', JSON.stringify(settings, null, 2));

    console.log('Attempting upsert...');
    const category = 'company';
    const updatedSettings = {
      name: 'HRM Portal Test',
      logo: '',
      timezone: 'Asia/Kolkata',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      workingHours: { start: '09:00', end: '18:00' },
    };

    const updateData: any = {};
    updateData[category] = updatedSettings;

    const record = await prisma.systemSetting.upsert({
      where: { id: 1 },
      update: updateData,
      create: {
        id: 1,
        ...updateData,
      },
    });

    console.log('Upsert successful:', JSON.stringify(record, null, 2));
  } catch (e: any) {
    console.error('Upsert failed with error:');
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
