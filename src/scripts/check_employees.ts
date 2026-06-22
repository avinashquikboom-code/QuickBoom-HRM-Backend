import 'dotenv/config';
import { prisma } from '../utils/db';

async function main() {
  console.log("Fetching all employees...");
  const employees = await prisma.employee.findMany({
    include: {
      office: true,
      user: true,
    }
  });

  console.log(`Total employees found: ${employees.length}`);
  for (const emp of employees) {
    console.log(`- ID: ${emp.id}, Name: "${emp.firstName} ${emp.lastName}", User ID: ${emp.userId}, Office: ${emp.office ? emp.office.name : 'NONE'}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
