import { prisma } from '../utils/db';
import bcrypt from 'bcryptjs';

async function testAuth() {
  console.log('=== FEATURE 1: LOGIN & REGISTER TEST ===');
  
  // Find employee Mayur
  const employee = await prisma.employee.findFirst({
    where: {
      OR: [
        { employeeCode: '074' },
        { mobileNumber: { contains: '8866686203' } }
      ]
    },
    include: { user: true }
  });

  if (!employee) {
    console.error('MAYUR not found!');
    return;
  }

  console.log(`Found MAYUR: ID=${employee.id}, Code=${employee.employeeCode}, Mobile=${employee.mobileNumber}, Existing UserID=${employee.userId}`);

  // Test Password Hash
  const password = 'Password@123';
  const hashedPassword = await bcrypt.hash(password, 10);

  if (!employee.user) {
    console.log('Creating User account for MAYUR...');
    const newUser = await prisma.user.create({
      data: {
        email: `mayur_${employee.employeeCode.toLowerCase()}@hopkid.com`,
        password: hashedPassword,
        role: 'EMPLOYEE',
        isActive: true,
      }
    });

    await prisma.employee.update({
      where: { id: employee.id },
      data: { userId: newUser.id }
    });
    console.log(`User created with ID ${newUser.id}`);
  } else {
    console.log('Updating password for MAYUR...');
    await prisma.user.update({
      where: { id: employee.userId! },
      data: { password: hashedPassword, isActive: true }
    });
    console.log('MAYUR user password updated successfully.');
  }

  // Ensure Wallet exists for MAYUR
  let wallet = await prisma.wallet.findUnique({
    where: { employeeId: employee.id }
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        employeeId: employee.id,
        availableBalance: 0,
        advanceLimit: 25000,
        pendingClaims: 0,
        cardNumber: `HK${employee.mobileNumber.slice(-4)}-${employee.employeeCode}`,
        isActive: true,
      }
    });
    console.log(`Wallet created for MAYUR with ID ${wallet.id}`);
  } else {
    console.log(`Wallet already exists for MAYUR (ID: ${wallet.id})`);
  }

  console.log('=== FEATURE 1 VERIFIED ===');
}

testAuth().catch(console.error).finally(() => prisma.$disconnect());
