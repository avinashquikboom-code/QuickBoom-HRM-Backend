import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Optimize connection pool for Supabase on Hostinger
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Always use SSL for Supabase
  // Optimized connection pool settings for better performance
  max: 20, // Increased from 10 for better concurrency
  min: 5,  // Increased from 2 to reduce connection wait times
  idleTimeoutMillis: 60000, // Increased from 30s to reduce connection churn
  connectionTimeoutMillis: 5000, // Decreased from 10s for faster failover
  statement_timeout: 20000, // Decreased from 30s to prevent hanging queries
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ 
  adapter,
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'error', 'warn'],
});