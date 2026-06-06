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

async function cleanupTestData() {
  console.log('🧹 [CLEANUP] Starting test data cleanup...');

  try {
    // 1. Delete AttendanceHistory records
    console.log('📊 [CLEANUP] 1. Deleting AttendanceHistory records...');
    const historyCount = await prisma.attendanceHistory.count();
    if (historyCount > 0) {
      await prisma.attendanceHistory.deleteMany({});
      console.log(`✅ Deleted ${historyCount} AttendanceHistory records`);
    } else {
      console.log('ℹ️ No AttendanceHistory records found');
    }

    // 2. Delete LeaveBalance records
    console.log('📋 [CLEANUP] 2. Deleting LeaveBalance records...');
    const balanceCount = await prisma.leaveBalance.count();
    if (balanceCount > 0) {
      await prisma.leaveBalance.deleteMany({});
      console.log(`✅ Deleted ${balanceCount} LeaveBalance records`);
    } else {
      console.log('ℹ️ No LeaveBalance records found');
    }

    // 3. Drop AttendanceHistory table
    console.log('🗂️ [CLEANUP] 3. Dropping AttendanceHistory table...');
    try {
      await prisma.$executeRaw`DROP TABLE IF EXISTS "AttendanceHistory" CASCADE`;
      console.log('✅ AttendanceHistory table dropped successfully');
    } catch (error) {
      console.log('ℹ️ AttendanceHistory table might not exist or already dropped');
    }

    // 4. Verify cleanup
    console.log('🔍 [CLEANUP] 4. Verifying cleanup...');
    
    const remainingHistory = await prisma.$queryRaw`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'AttendanceHistory'`;
    const remainingBalance = await prisma.leaveBalance.count();
    
    console.log('\n📊 Cleanup Summary:');
    console.log(`   AttendanceHistory table exists: ${remainingHistory[0]?.count > 0 ? 'YES' : 'NO'}`);
    console.log(`   Remaining LeaveBalance records: ${remainingBalance}`);
    
    if (remainingHistory[0]?.count === 0 && remainingBalance === 0) {
      console.log('🎉 All test data cleaned up successfully!');
    } else {
      console.log('⚠️ Some data might still remain. Please check manually.');
    }

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  }
}

// Run the cleanup
cleanupTestData()
  .catch((error) => {
    console.error('Cleanup failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
