require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const superAdmins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN' }
  });
  console.log('Super admins in DB:', superAdmins.map(u => ({ id: u.id, email: u.email })));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
