require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const users = await prisma.user.count();
  const offices = await prisma.office.count();
  const employees = await prisma.employee.count();
  const roles = await prisma.user.groupBy({
    by: ['role'],
    _count: true
  });
  
  console.log('--- DATABASE COUNT ---');
  console.log('Users:', users);
  console.log('Offices:', offices);
  console.log('Employees:', employees);
  console.log('Roles breakdown:', roles);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
