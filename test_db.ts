import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Checking Employee table for workModeId...");
  const employees = await prisma.$queryRaw`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'Employee' AND column_name = 'workModeId';
  `;
  console.log("Employee.workModeId:", employees);

  console.log("\nChecking WorkMode table...");
  const workMode = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_name = 'WorkMode';
  `;
  console.log("WorkMode Table:", workMode);

  console.log("\nChecking Foreign Keys...");
  const fks = await prisma.$queryRaw`
    SELECT
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
    FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name='Employee' AND kcu.column_name='workModeId';
  `;
  console.log("Foreign Keys:", fks);
}

main().catch(console.error).finally(() => prisma.$disconnect());
