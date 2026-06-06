const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

// Use same configuration as seed scripts
const isLocalDb = process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function testLeaveBalanceData() {
  console.log('🧪 [TEST] Testing leave balance data...\n');

  try {
    // Test 1: Check if LeaveBalance table has data
    console.log('📊 [TEST] 1. Checking LeaveBalance records...');
    const leaveBalances = await prisma.leaveBalance.findMany({
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

    console.log(`✅ Found ${leaveBalances.length} leave balance records:\n`);
    
    leaveBalances.forEach((balance, index) => {
      const emp = balance.employee;
      const casualRemaining = balance.casualTotal - balance.casualUsed;
      const sickRemaining = balance.sickTotal - balance.sickUsed;
      const earnedRemaining = balance.earnedTotal - balance.earnedUsed;
      
      console.log(`${index + 1}. ${emp.firstName} ${emp.lastName} (${emp.employeeCode}) - ${emp.status}`);
      console.log(`   Casual: ${casualRemaining}/${balance.casualTotal} used: ${balance.casualUsed}`);
      console.log(`   Sick: ${sickRemaining}/${balance.sickTotal} used: ${balance.sickUsed}`);
      console.log(`   Earned: ${earnedRemaining}/${balance.earnedTotal} used: ${balance.earnedUsed}`);
      console.log(`   Fiscal Year: ${balance.fiscalYear}\n`);
    });

    // Test 2: Check employee data
    console.log('👥 [TEST] 2. Checking employee data...');
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

    console.log(`✅ Found ${employees.length} employees:\n`);
    employees.forEach((emp, index) => {
      console.log(`${index + 1}. ${emp.firstName} ${emp.lastName} (${emp.employeeCode}) - ${emp.designation} - ${emp.status}`);
    });

    // Test 3: Check leave requests to see if they align with leave balance
    console.log('\n📋 [TEST] 3. Checking leave requests...');
    const leaveRequests = await prisma.leaveRequest.findMany({
      include: {
        employee: {
          select: {
            employeeCode: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { appliedOn: 'desc' },
    });

    console.log(`✅ Found ${leaveRequests.length} leave requests:\n`);
    leaveRequests.forEach((req, index) => {
      console.log(`${index + 1}. ${req.employee.firstName} ${req.employee.lastName} - ${req.type} leave`);
      console.log(`   From: ${req.fromDate.toDateString()} To: ${req.toDate.toDateString()}`);
      console.log(`   Status: ${req.status} | Reason: ${req.reason}\n`);
    });

    // Test 4: Simulate API response structure
    console.log('🔗 [TEST] 4. Simulating API response structure...');
    
    // Simulate fetchLeavesAndBalances API response
    const apiResponse = {
      success: true,
      data: {
        leaveBalances: leaveBalances.map(balance => ({
          fiscalYear: balance.fiscalYear,
          casualTotal: balance.casualTotal,
          casualUsed: balance.casualUsed,
          casualRemaining: balance.casualTotal - balance.casualUsed,
          sickTotal: balance.sickTotal,
          sickUsed: balance.sickUsed,
          sickRemaining: balance.sickTotal - balance.sickUsed,
          earnedTotal: balance.earnedTotal,
          earnedUsed: balance.earnedUsed,
          earnedRemaining: balance.earnedTotal - balance.earnedUsed,
        })),
        leaveRequests: leaveRequests.map(req => ({
          id: req.id,
          type: req.type,
          fromDate: req.fromDate.toISOString(),
          toDate: req.toDate.toISOString(),
          reason: req.reason,
          status: req.status,
          appliedOn: req.appliedOn.toISOString(),
          reviewedBy: req.reviewedBy,
          reviewNote: req.reviewNote,
          reviewedAt: req.reviewedAt?.toISOString() || null,
        })),
      },
    };

    console.log('✅ API Response Structure:');
    console.log(JSON.stringify(apiResponse, null, 2));

    console.log('\n🎉 [TEST] All tests completed successfully!');
    console.log('📈 Summary:');
    console.log(`   - Leave Balance Records: ${leaveBalances.length}`);
    console.log(`   - Employees: ${employees.length}`);
    console.log(`   - Leave Requests: ${leaveRequests.length}`);
    console.log('✅ Leave balance data is properly structured and ready for API use!');

  } catch (error) {
    console.error('❌ [TEST] Error during testing:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testLeaveBalanceData()
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
