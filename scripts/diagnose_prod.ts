import { prisma } from '../src/utils/db';
import * as fs from 'fs';
import * as path from 'path';

async function diagnose() {
  try {
    console.log('🔍 Starting Database Diagnosis on Production...');

    // 1. Check backup files on server
    const possibleBackupPaths = [
      '/opt/quickboom/backup_before_migration.sql',
      '/opt/quickboom/backup_before_migration',
      '/opt/quickboom/backup/backup_before_migration',
      '/opt/quickboom/backup/backup_before_migration.sql',
      '/opt/quickboom/backup_before_migration.tar.gz'
    ];
    console.log('\n--- 1. Checking for backup files ---');
    for (const bp of possibleBackupPaths) {
      if (fs.existsSync(bp)) {
        const stats = fs.statSync(bp);
        console.log(`✅ Found backup file: ${bp} (${stats.size} bytes)`);
      } else {
        console.log(`❌ Backup path not found: ${bp}`);
      }
    }

    // 2. Fetch all employees
    const employees = await prisma.employee.findMany({
      include: {
        user: true,
        _count: { select: { attendances: true } }
      }
    });

    // 3. Fetch all users
    const users = await prisma.user.findMany({
      include: { employee: true }
    });

    console.log(`\n--- 2. Counts ---`);
    console.log(`Total Employees in DB: ${employees.length}`);
    console.log(`Total Users in DB: ${users.length}`);
    console.log(`HopKid employees: ${employees.filter(e => e.source === 'HOPKID').length}`);
    console.log(`Manual employees: ${employees.filter(e => e.source === 'MANUAL').length}`);

    // 4. Trace cases where employeeID / GUID link breaks
    console.log(`\n--- 3. Tracing GUID cases ---`);
    const unlinkedHopkid = employees.filter(e => e.source === 'HOPKID' && !e.userId);
    console.log(`Unlinked HopKid employees (no userId): ${unlinkedHopkid.length}`);
    
    for (const emp of unlinkedHopkid.slice(0, 5)) {
      console.log(`\nUnlinked Employee:`);
      console.log(`  ID (Int): ${emp.id}`);
      console.log(`  Code: ${emp.employeeCode}`);
      console.log(`  Name: ${emp.firstName} ${emp.lastName}`);
      console.log(`  EmployeeID (GUID in DB): "${emp.employeeID}"`);
      console.log(`  Mobile: ${emp.mobileNumber}`);
      console.log(`  Punches count: ${emp._count.attendances}`);

      // Check if there is a User with same employeeID (case-insensitive)
      const matchingUserByGuid = users.find(u => 
        u.employeeID && emp.employeeID && u.employeeID.toLowerCase() === emp.employeeID.toLowerCase()
      );
      if (matchingUserByGuid) {
        console.log(`  ⚠️ MATCHING USER FOUND BY employeeID (GUID):`);
        console.log(`    User ID: ${matchingUserByGuid.id}`);
        console.log(`    User Email: ${matchingUserByGuid.email}`);
        console.log(`    User employeeID (GUID in DB): "${matchingUserByGuid.employeeID}"`);
        console.log(`    Current Employee linked to this User: ${matchingUserByGuid.employee ? `ID ${matchingUserByGuid.employee.id} (${matchingUserByGuid.employee.firstName})` : 'None'}`);
      } else {
        console.log(`  ❌ No user matches this employee's employeeID (GUID)`);
      }

      // Check if there is a User with same email (if email is known) or code
      const matchingUserByEmail = users.find(u => 
        u.email.toLowerCase() === `${emp.firstName.toLowerCase()}@${emp.lastName.toLowerCase()}.com` ||
        u.email.toLowerCase() === `${emp.firstName.toLowerCase()}@gmail.com`
      );
      if (matchingUserByEmail) {
        console.log(`  💡 Potential user match by email pattern: ${matchingUserByEmail.email} (User ID: ${matchingUserByEmail.id})`);
      }
    }

    // 5. Look for users with employeeID set but NO linked employee or linked to a different employee
    console.log(`\n--- 4. Tracing Users with employeeID ---`);
    const usersWithGuid = users.filter(u => u.employeeID);
    console.log(`Users with employeeID set: ${usersWithGuid.length}`);
    for (const u of usersWithGuid) {
      const linkedEmp = employees.find(e => e.userId === u.id);
      const matchedEmpByGuid = employees.find(e => e.employeeID && u.employeeID && e.employeeID.toLowerCase() === u.employeeID.toLowerCase());
      
      if (!linkedEmp || linkedEmp.id !== matchedEmpByGuid?.id) {
        console.log(`\nUser ID ${u.id} (${u.email}):`);
        console.log(`  User.employeeID (GUID): "${u.employeeID}"`);
        console.log(`  Linked Employee ID: ${linkedEmp ? linkedEmp.id : 'None'}`);
        console.log(`  Matched Employee by GUID: ${matchedEmpByGuid ? `ID ${matchedEmpByGuid.id} (Code: ${matchedEmpByGuid.employeeCode})` : 'None'}`);
      }
    }

  } catch (error: any) {
    console.error('❌ Error during diagnosis:', error.message || error);
  } finally {
    await prisma.$disconnect();
  }
}

diagnose();
