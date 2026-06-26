import { prisma } from './utils/db';

async function main() {
  try {
    console.log('DATABASE_URL:', process.env.DATABASE_URL);
    const count = await prisma.employee.count();
    console.log('Total Employee count:', count);
    
    const employees = await prisma.employee.findMany();
    for (const emp of employees) {
      console.log(`Employee ID: ${emp.id}, Name: ${emp.firstName} ${emp.lastName}, userId: ${emp.userId}`);
    }

    const emp11 = await prisma.employee.findUnique({
      where: { id: 11 }
    });
    console.log('Employee 11 details:', emp11);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
