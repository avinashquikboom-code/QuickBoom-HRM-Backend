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

async function seedLeaveBalance() {
  console.log('🌱 [LEAVE BALANCE] Starting leave balance seed...');

  try {
    // Get all employees
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        status: true,
        designation: true,
      },
    });

    console.log(`👥 Found ${employees.length} employees`);

    // Get existing leave balances for 2026
    const existingBalances = await prisma.leaveBalance.findMany({
      where: { fiscalYear: '2026' },
      select: { employeeId: true },
    });

    const existingEmployeeIds = new Set(existingBalances.map(b => b.employeeId));
    const employeesNeedingBalance = employees.filter(emp => !existingEmployeeIds.has(emp.id));

    console.log(`📊 ${employeesNeedingBalance.length} employees need leave balance records`);

    if (employeesNeedingBalance.length === 0) {
      console.log('✅ All employees already have leave balance records for 2026');
      return;
    }

    // Create leave balance records
    const leaveBalanceData = employeesNeedingBalance.map(employee => {
      const isActive = employee.status === 'active';
      
      // Random usage for realistic data
      const casualUsed = isActive ? Math.floor(Math.random() * 3) : 0; // 0-2 for active
      const sickUsed = isActive ? Math.floor(Math.random() * 2) : 0;    // 0-1 for active  
      const earnedUsed = isActive ? Math.floor(Math.random() * 5) : 0;  // 0-4 for active

      return {
        employeeId: employee.id,
        fiscalYear: '2026',
        casualTotal: isActive ? 12 : 6,
        casualUsed,
        sickTotal: isActive ? 10 : 5,
        sickUsed,
        earnedTotal: isActive ? 15 : 8,
        earnedUsed,
        createdBy: 'system',
      };
    });

    console.log('💾 Creating leave balance records...');
    
    // Insert in batches to avoid timeouts
    const batchSize = 50;
    for (let i = 0; i < leaveBalanceData.length; i += batchSize) {
      const batch = leaveBalanceData.slice(i, i + batchSize);
      await prisma.leaveBalance.createMany({
        data: batch,
        skipDuplicates: true,
      });
      console.log(`✅ Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(leaveBalanceData.length / batchSize)}`);
    }

    // Verify the results
    const totalBalances = await prisma.leaveBalance.count({
      where: { fiscalYear: '2026' },
    });

    const activeBalances = await prisma.leaveBalance.findMany({
      where: { fiscalYear: '2026' },
      include: {
        employee: {
          select: {
            employeeCode: true,
            firstName: true,
            lastName: true,
            status: true,
          },
        },
      },
    });

    console.log('\n📊 Leave Balance Summary:');
    console.log(`Total employees with leave balance: ${totalBalances}`);
    
    // Show sample records
    console.log('\n📋 Sample Leave Balance Records:');
    activeBalances.slice(0, 5).forEach((balance, index) => {
      const emp = balance.employee;
      const casualRemaining = balance.casualTotal - balance.casualUsed;
      const sickRemaining = balance.sickTotal - balance.sickUsed;
      const earnedRemaining = balance.earnedTotal - balance.earnedUsed;
      
      console.log(`${index + 1}. ${emp.firstName} ${emp.lastName} (${emp.employeeCode}) - ${emp.status}`);
      console.log(`   Casual: ${casualRemaining}/${balance.casualTotal}, Sick: ${sickRemaining}/${balance.sickTotal}, Earned: ${earnedRemaining}/${balance.earnedTotal}`);
    });

    // Statistics
    const stats = await prisma.leaveBalance.aggregate({
      where: { fiscalYear: '2026' },
      _sum: {
        casualTotal: true,
        casualUsed: true,
        sickTotal: true,
        sickUsed: true,
        earnedTotal: true,
        earnedUsed: true,
      },
      _count: true,
    });

    console.log('\n📈 Overall Statistics:');
    console.log(`Total Records: ${stats._count}`);
    console.log(`Casual Leaves: ${stats._sum.casualUsed || 0}/${stats._sum.casualTotal || 0} used`);
    console.log(`Sick Leaves: ${stats._sum.sickUsed || 0}/${stats._sum.sickTotal || 0} used`);
    console.log(`Earned Leaves: ${stats._sum.earnedUsed || 0}/${stats._sum.earnedTotal || 0} used`);

    console.log('\n🎉 Leave balance seed completed successfully!');

  } catch (error) {
    console.error('❌ Error seeding leave balance:', error);
    throw error;
  }
}

// Run the seed if this file is executed directly
if (require.main === module) {
  seedLeaveBalance()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export default seedLeaveBalance;
