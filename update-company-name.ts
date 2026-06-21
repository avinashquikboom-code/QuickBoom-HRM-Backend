import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const isLocalDb = process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  try {
    const record = await prisma.systemSetting.findUnique({ where: { id: 1 } });
    if (record) {
      const company: any = record.company || {};
      company.name = 'HRM';
      await prisma.systemSetting.update({
        where: { id: 1 },
        data: { company },
      });
      console.log('Successfully updated company name to HRM in database settings.');
    } else {
      // Create it if it doesn't exist
      await prisma.systemSetting.create({
        data: {
          id: 1,
          company: {
            name: 'HRM',
            logo: '',
            timezone: 'Asia/Kolkata',
            workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            workingHours: { start: '09:00', end: '18:00' },
          },
        }
      });
      console.log('Successfully created system settings with company name HRM.');
    }
  } catch (err) {
    console.error('Failed to update company name:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
