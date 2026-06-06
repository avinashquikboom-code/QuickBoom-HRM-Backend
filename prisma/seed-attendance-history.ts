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

async function seedAttendanceHistory() {
  console.log('🌱 [ATTENDANCE HISTORY] Starting attendance history seed...');

  try {
    // Get a valid HR user for approvals
    const hrUser = await prisma.user.findFirst({
      where: { role: { in: ['HR', 'SUPER_ADMIN', 'ADMIN'] } },
      select: { id: true },
    });

    const approvedById = hrUser?.id || 1; // Fallback to ID 1 if no HR user found
    console.log(`👤 Using approvedBy ID: ${approvedById}`);

    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: { status: 'active' },
      include: {
        office: true,
        user: true,
      },
    });

    console.log(`👥 Found ${employees.length} active employees`);

    // Get existing attendance history to avoid duplicates
    const existingHistory = await prisma.attendanceHistory.findMany({
      select: { employeeId: true, date: true },
    });
    const existingKeys = new Set(
      existingHistory.map(h => `${h.employeeId}-${h.date}`)
    );

    console.log(`📊 Found ${existingHistory.length} existing attendance history records`);

    // Generate attendance history for the last 30 days
    const historyData = [];
    const today = new Date();
    
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      // Skip weekends (Saturday = 6, Sunday = 0)
      if (date.getDay() === 0 || date.getDay() === 6) {
        continue;
      }

      for (const employee of employees) {
        const key = `${employee.id}-${dateStr}`;
        
        // Skip if already exists
        if (existingKeys.has(key)) {
          continue;
        }

        // Random attendance pattern
        const rand = Math.random();
        let status = 'PRESENT';
        let checkIn: Date | null = null;
        let checkOut: Date | null = null;
        let workingHours = 0;
        let notes = '';

        if (rand < 0.1) {
          // 10% absent
          status = 'ABSENT';
          notes = 'Unplanned absence';
        } else if (rand < 0.15) {
          // 5% late
          status = 'LATE';
          checkIn = new Date(date);
          checkIn.setHours(9, 30 + Math.floor(Math.random() * 30), 0);
          checkOut = new Date(date);
          checkOut.setHours(18, Math.floor(Math.random() * 30), 0);
          workingHours = 8 * 60 - 30; // 8 hours minus 30 min late
          notes = 'Late arrival';
        } else if (rand < 0.18) {
          // 3% half day
          status = 'HALF_DAY';
          checkIn = new Date(date);
          checkIn.setHours(9, 15, 0);
          checkOut = new Date(date);
          checkOut.setHours(14, 0, 0);
          workingHours = 5 * 60; // 5 hours
          notes = 'Half day work';
        } else {
          // 72% present
          status = 'PRESENT';
          checkIn = new Date(date);
          checkIn.setHours(8 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 30), 0);
          checkOut = new Date(date);
          checkOut.setHours(17 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0);
          workingHours = 8 * 60 + Math.floor(Math.random() * 60) - 60; // 8 hours +/- 1 hour
          notes = 'Regular working day';
        }

        // Add some overtime randomly
        let overtimeMinutes = 0;
        if (status === 'PRESENT' && Math.random() < 0.2) {
          overtimeMinutes = Math.floor(Math.random() * 120); // 0-2 hours overtime
        }

        historyData.push({
          employeeId: employee.id,
          officeId: employee.officeId,
          date: dateStr,
          checkIn,
          checkOut,
          status,
          latitude: employee.office?.latitude || 19.0760,
          longitude: employee.office?.longitude || 72.8777,
          isFingerprintCheckIn: Math.random() < 0.7,
          isFingerprintCheckOut: Math.random() < 0.7,
          isOnBreak: false,
          totalBreakSeconds: Math.floor(Math.random() * 1800), // 0-30 min break
          workingHours,
          overtimeMinutes,
          notes,
          isApproved: true,
          approvedBy: approvedById, // HR user
          approvedAt: new Date(),
          approvalNotes: 'Auto-approved',
        });
      }
    }

    console.log(`💾 Creating ${historyData.length} attendance history records...`);

    // Insert in batches
    const batchSize = 100;
    for (let i = 0; i < historyData.length; i += batchSize) {
      const batch = historyData.slice(i, i + batchSize);
      await prisma.attendanceHistory.createMany({
        data: batch,
        skipDuplicates: true,
      });
      console.log(`✅ Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(historyData.length / batchSize)}`);
    }

    // Verify the results
    const totalRecords = await prisma.attendanceHistory.count();
    const recentRecords = await prisma.attendanceHistory.findMany({
      take: 10,
      orderBy: { date: 'desc' },
      include: {
        employee: {
          select: {
            employeeCode: true,
            firstName: true,
            lastName: true,
          },
        },
        office: {
          select: {
            name: true,
          },
        },
      },
    });

    console.log('\n📊 Attendance History Summary:');
    console.log(`Total Records: ${totalRecords}`);
    
    console.log('\n📋 Sample Records:');
    recentRecords.forEach((record, index) => {
      console.log(`${index + 1}. ${record.employee.firstName} ${record.employee.lastName} (${record.employee.employeeCode})`);
      console.log(`   Date: ${record.date} | Status: ${record.status}`);
      console.log(`   Check-in: ${record.checkIn?.toLocaleTimeString() || 'N/A'} | Check-out: ${record.checkOut?.toLocaleTimeString() || 'N/A'}`);
      console.log(`   Working Hours: ${Math.floor(record.workingHours / 60)}h ${record.workingHours % 60}m`);
      console.log(`   Office: ${record.office?.name || 'Remote'}\n`);
    });

    // Statistics
    const stats = await prisma.attendanceHistory.groupBy({
      by: ['status'],
      _count: true,
    });

    console.log('📈 Status Distribution:');
    stats.forEach(stat => {
      console.log(`   ${stat.status}: ${stat._count} records`);
    });

    console.log('\n🎉 Attendance history seed completed successfully!');

  } catch (error) {
    console.error('❌ Error seeding attendance history:', error);
    throw error;
  }
}

// Run the seed if this file is executed directly
if (require.main === module) {
  seedAttendanceHistory()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export default seedAttendanceHistory;
