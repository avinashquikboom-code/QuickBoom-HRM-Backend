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

async function checkExistingTables() {
  console.log('🔍 [CHECK] Checking existing tables in Supabase...');

  try {
    // Get all tables from information_schema
    const result = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;

    const existingTables = result.map((row: any) => row.table_name);
    console.log('📊 Existing tables in database:');
    existingTables.forEach((table: string, index: number) => {
      console.log(`   ${index + 1}. ${table}`);
    });

    // Expected tables from Prisma schema
    const expectedTables = [
      'User',
      'Profile', 
      'Office',
      'Department',
      'Employee',
      'Attendance',
      'Comment',
      'LiveLocation',
      'LeaveRequest',
      'LeaveBalance',
      'Expense',
      'Task',
      'Shift',
      'ShiftAssignment',
      'Notification',
      'Holiday',
      'Document',
      'AttendanceCorrection',
      'Announcement',
      'PricingPlan',
      'RolePermission',
      'UserPermission',
      'SystemSetting',
      'Payslip',
      'FCMToken'
    ];

    console.log('\n📋 Expected tables from Prisma schema:');
    expectedTables.forEach((table, index) => {
      const exists = existingTables.includes(table);
      console.log(`   ${index + 1}. ${table} ${exists ? '✅' : '❌'}`);
    });

    // Find missing tables
    const missingTables = expectedTables.filter(table => !existingTables.includes(table));
    
    if (missingTables.length > 0) {
      console.log('\n❌ Missing tables that need to be created:');
      missingTables.forEach((table, index) => {
        console.log(`   ${index + 1}. ${table}`);
      });
    } else {
      console.log('\n✅ All expected tables exist in the database!');
    }

    return { existingTables, missingTables };

  } catch (error) {
    console.error('❌ Error checking tables:', error);
    throw error;
  }
}

// Run the check
checkExistingTables()
  .catch((error) => {
    console.error('Check failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
