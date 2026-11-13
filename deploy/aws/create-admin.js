// ============================================================================
// HRM — create the first SUPER_ADMIN (and the default pricing plans) in an empty
// database. Run by create-admin.sh inside the backend image (cwd /app), which
// has @prisma/client, @prisma/adapter-pg, pg and bcryptjs. Not part of the app.
//
// Replaces prisma/seed.ts on a real server: that file is DEMO data, wipes every
// table first and uses fixed passwords — never run it against production.
//
// Env: DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, [ADMIN_NAME], [ADMIN_RESET=1]
// Exit: 0 = created (or password reset), 10 = user already exists, left unchanged.
// ============================================================================
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const DEFAULT_PLANS = [
  {
    name: 'Basic', monthlyPrice: 1200.0, yearlyPrice: 12000.0,
    seatsLabel: 'Up to 50 active seats',
    description: 'Essential features for growing startups.',
    features: ['Standard dashboard analytics', 'Up to 5 geofences', 'Email support', '1-year logs retention'],
  },
  {
    name: 'Pro', monthlyPrice: 4500.0, yearlyPrice: 45000.0,
    seatsLabel: 'Up to 250 active seats',
    description: 'Advanced controls for professional enterprises.',
    features: ['Real-time live location tracking', 'Unlimited geofencing alerts', '24/7 priority support', 'Custom report building', 'SSO & Multi-admin access'],
  },
  {
    name: 'Enterprise', monthlyPrice: 12400.0, yearlyPrice: 124000.0,
    seatsLabel: 'Unlimited seats & servers',
    description: 'State-of-the-art power for global organizations.',
    features: ['Dedicated account architect', 'Custom backend API pipelines', 'Tailored hardware integrations', 'Unlimited logs & backups', 'Whiteglove data onboarding'],
  },
];

(async () => {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const fullName = process.env.ADMIN_NAME || 'Super Admin';
  if (!process.env.DATABASE_URL || !email || !password) {
    console.error('DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD are required');
    process.exit(2);
  }

  const bcryptMod = await import('bcryptjs');
  const bcrypt = bcryptMod.default || bcryptMod;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  let code = 0;
  try {
    // Default pricing plans: only added when missing, never overwritten.
    for (const plan of DEFAULT_PLANS) {
      await prisma.pricingPlan.upsert({ where: { name: plan.name }, update: {}, create: plan });
    }
    console.log('pricing plans: ok (' + DEFAULT_PLANS.map((p) => p.name).join(', ') + ')');

    const hash = await bcrypt.hash(password, 10);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (process.env.ADMIN_RESET === '1') {
        await prisma.user.update({ where: { id: existing.id }, data: { password: hash, isActive: true } });
        console.log('user ' + email + ': password reset');
      } else {
        console.log('user ' + email + ': already exists, left unchanged (set ADMIN_RESET=1 to reset the password)');
        code = 10;
      }
    } else {
      await prisma.user.create({
        data: {
          email,
          password: hash,
          role: 'SUPER_ADMIN',
          isActive: true,
          profile: {
            create: {
              email,
              fullName,
              bio: 'Global Platform Administrator',
              clearanceLevel: 4,
              clearanceLabel: 'Level 4 (Super Admin)',
              twoFactorEnabled: false,
              twoFactorStatus: 'disabled',
            },
          },
        },
      });
      console.log('user ' + email + ': created as SUPER_ADMIN');
    }
  } catch (e) {
    console.error('create-admin failed:', e && e.message ? e.message : e);
    code = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
  }
  process.exit(code);
})();
