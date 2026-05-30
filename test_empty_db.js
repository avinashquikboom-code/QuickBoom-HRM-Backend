require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const { fetchCompanyStats } = require('./src/controllers/adminController');

async function test() {
  const req = {
    user: { id: 13, email: 'admin@hrm.com', role: 'SUPER_ADMIN' }
  };
  
  const res = {
    status: function(code) {
      console.log('STATUS:', code);
      return this;
    },
    json: function(data) {
      console.log('JSON RESPONSE:', JSON.stringify(data, null, 2));
      return this;
    }
  };
  
  console.log('--- CALLING fetchCompanyStats ---');
  await fetchCompanyStats(req, res);
}

test()
  .catch(e => console.error('CRITICAL TEST ERROR:', e))
  .finally(() => prisma.$disconnect());
