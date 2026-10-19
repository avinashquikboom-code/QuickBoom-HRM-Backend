require('dotenv').config({ quiet: true });
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    await c.query('BEGIN READ ONLY');
    const columns = await c.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('Employee','Notification','Campaign','CampaignRecipient') ORDER BY table_name, ordinal_position`);
    console.log(JSON.stringify({ columns: columns.rows }, null, 2));
    const migrations = await c.query('SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at');
    console.log(JSON.stringify({ migrations: migrations.rows }, null, 2));
    await c.query('ROLLBACK');
  } catch (e) { console.error('Read-only schema inspection failed:', e.code || e.name); process.exitCode = 1; }
  finally { await c.end(); }
})();
