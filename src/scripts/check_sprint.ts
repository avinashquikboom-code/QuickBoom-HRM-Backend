import { prisma } from '../utils/db';

async function main() {
  console.log('=== Checking Employee MAYUR ===');
  
  const employees = await prisma.employee.findMany({
    where: {
      OR: [
        { firstName: { contains: 'MAYUR', mode: 'insensitive' } },
        { lastName: { contains: 'MAYUR', mode: 'insensitive' } },
      ]
    },
    include: {
      user: true,
      wallet: true,
    }
  });

  console.log(`Found ${employees.length} employee(s) matching MAYUR:`);
  for (const emp of employees) {
    console.log({
      id: emp.id,
      employeeCode: emp.employeeCode,
      name: `${emp.firstName} ${emp.lastName}`,
      mobileNumber: emp.mobileNumber,
      userId: emp.userId,
      userEmail: emp.user?.email,
      walletId: emp.wallet?.id,
      commissionPercentage: emp.commissionPercentage,
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
