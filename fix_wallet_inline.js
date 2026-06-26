// fix_wallet_inline.js - Run this directly with: docker exec -i hrm-backend node
// OR: node fix_wallet_inline.js (from inside the container with correct DATABASE_URL)

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  console.log('\n=== Wallet Fix Script ===\n');
  try {
    // 1. Report all users without linked employees
    const allUsers = await prisma.user.findMany({ include: { employee: true } });
    console.log(`Total users: ${allUsers.length}`);
    for (const u of allUsers) {
      if (!u.employee) console.log(`  ⚠️  User "${u.email}" (ID: ${u.id}) has NO linked Employee record`);
    }

    // 2. Find employees with no userId
    const unlinked = await prisma.employee.findMany({ where: { userId: null } });
    console.log(`\nEmployees with no userId: ${unlinked.length}`);
    for (const e of unlinked) {
      console.log(`  - ${e.firstName} ${e.lastName} (Employee ID: ${e.id}, Code: ${e.employeeCode})`);
    }

    // 3. Create wallets for employees that don't have one
    console.log('\nChecking/creating wallets for all employees...');
    const allEmployees = await prisma.employee.findMany({ include: { wallet: true, user: true } });
    let created = 0;
    for (const emp of allEmployees) {
      if (!emp.wallet) {
        const wallet = await prisma.wallet.create({
          data: {
            employeeId: emp.id,
            availableBalance: 0,
            advanceLimit: 25000,
            pendingClaims: 0,
            cardNumber: `QB-${emp.employeeCode.replace(/\D/g, '')}-XXXX`,
            isActive: true,
          },
        });
        console.log(`  ✅ Created wallet for ${emp.firstName} ${emp.lastName} (Wallet ID: ${wallet.id})`);
        created++;
      } else {
        console.log(`  ✓  ${emp.firstName} ${emp.lastName} already has Wallet ID: ${emp.wallet.id}`);
      }
    }

    // 4. List all users/employees for manual linking reference
    console.log('\n=== All Users (for manual linking reference) ===');
    const users = await prisma.user.findMany({ include: { profile: true, employee: true } });
    for (const u of users) {
      console.log(`User ID: ${u.id} | Email: ${u.email} | Role: ${u.role} | LinkedEmployee: ${u.employee ? `ID ${u.employee.id} (${u.employee.firstName} ${u.employee.lastName})` : 'NONE'}`);
    }

    console.log('\n=== All Employees (for manual linking reference) ===');
    for (const emp of allEmployees) {
      console.log(`Employee ID: ${emp.id} | Name: ${emp.firstName} ${emp.lastName} | Code: ${emp.employeeCode} | userId: ${emp.userId ?? 'NULL'}`);
    }

    console.log(`\n✅ Done. Wallets created: ${created}`);
  } catch (e) {
    console.error('❌ Error:', e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

fix();
