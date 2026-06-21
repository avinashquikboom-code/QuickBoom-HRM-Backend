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
    const result = await prisma.office.updateMany({
      where: {
        name: { contains: 'Kamdhenu' }
      },
      data: {
        latitude: 19.103120,
        longitude: 73.012349
      }
    });
    console.log(`Successfully updated ${result.count} office coordinates.`);
  } catch (err) {
    console.error('Failed to update office coordinates:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
