import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const dbUrl = process.env.DATABASE_URL;
console.log('Database URL:', dbUrl);

const isLocalDb = dbUrl?.includes('localhost') || dbUrl?.includes('127.0.0.1');
const pool = new Pool({
  connectionString: dbUrl,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Testing DB connection...');
  try {
    const leaves = await prisma.leaveRequest.findMany({
      include: {
        employee: true
      }
    });
    console.log('Successfully fetched leave requests count:', leaves.length);
    console.log('Leaves:', JSON.stringify(leaves, null, 2));
  } catch (error) {
    console.error('Error fetching leaves from DB:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
