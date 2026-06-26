/**
 * fix_wallet.ts
 * 
 * Run this on production to fix the wallet issue for users whose
 * Employee records are not linked to their User accounts.
 * 
 * Usage: npx ts-node src/scripts/fix_wallet.ts
 * Or in Docker: docker exec hrm-backend node dist/scripts/fix_wallet.js
 */

import { prisma } from '../utils/db';

async function fixWallets() {
  console.log('=== Wallet Fix Script ===\n');

  try {
    // 1. Find all users who have a logged-in session but no linked employee
    console.log('Step 1: Finding all users...');
    const allUsers = await prisma.user.findMany({
      include: { employee: true },
    });

    console.log(`Found ${allUsers.length} total users\n`);

    for (const user of allUsers) {
      if (!user.employee) {
        console.log(`⚠️  User "${user.email}" (ID: ${user.id}) has NO linked Employee record`);
      }
    }

    // 2. Find all employees with null userId
    console.log('\nStep 2: Finding employees with no linked user...');
    const unlinkedEmployees = await prisma.employee.findMany({
      where: { userId: null },
    });
    console.log(`Found ${unlinkedEmployees.length} employees with null userId:`);
    for (const emp of unlinkedEmployees) {
      console.log(`  - Employee: ${emp.firstName} ${emp.lastName} (ID: ${emp.id})`);
    }

    // 3. Find all employees and their wallet status
    console.log('\nStep 3: Checking wallet status for all employees...');
    const allEmployees = await prisma.employee.findMany({
      include: {
        wallet: true,
        user: true,
      },
    });

    let walletsCreated = 0;
    for (const employee of allEmployees) {
      console.log(`\nEmployee: ${employee.firstName} ${employee.lastName} (ID: ${employee.id})`);
      console.log(`  LinkedUser: ${employee.user?.email ?? 'NONE'}`);
      console.log(`  Wallet: ${employee.wallet ? `ID ${employee.wallet.id}` : 'MISSING'}`);

      if (!employee.wallet) {
        console.log(`  → Creating wallet...`);
        const wallet = await prisma.wallet.create({
          data: {
            employeeId: employee.id,
            availableBalance: 0,
            advanceLimit: 25000,
            pendingClaims: 0,
            cardNumber: `QB-${employee.employeeCode.replace(/\D/g, '')}-XXXX`,
            isActive: true,
          },
        });
        console.log(`  ✅ Wallet created (ID: ${wallet.id})`);
        walletsCreated++;
      }
    }

    // 4. Try to auto-link employees to users by matching email in profile
    console.log('\nStep 4: Attempting to auto-link unlinked employees to users by profile email...');
    for (const emp of unlinkedEmployees) {
      // Find a user whose profile email matches this employee's name
      const matchingUser = await prisma.user.findFirst({
        where: {
          employee: null, // user not already linked to another employee
          profile: {
            fullName: {
              contains: emp.firstName,
              mode: 'insensitive',
            },
          },
        },
        include: { profile: true },
      });

      if (matchingUser) {
        console.log(`  → Linking Employee "${emp.firstName} ${emp.lastName}" to User "${matchingUser.email}"`);
        await prisma.employee.update({
          where: { id: emp.id },
          data: { userId: matchingUser.id },
        });
        await prisma.user.update({
          where: { id: matchingUser.id },
          data: {},
        });
        console.log(`  ✅ Linked!`);
      } else {
        console.log(`  ⚠️  No matching user found for employee "${emp.firstName} ${emp.lastName}"`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Wallets created: ${walletsCreated}`);
    console.log(`Unlinked employees found: ${unlinkedEmployees.length}`);
    console.log('\nDone! ✅');

  } catch (error: any) {
    console.error('❌ Error:', error.message || error);
  } finally {
    await prisma.$disconnect();
  }
}

fixWallets();
