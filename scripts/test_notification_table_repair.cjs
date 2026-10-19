// Disposable PostgreSQL only: tests both absent-table repair and existing-data preservation.
const { mkdtempSync, readFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { spawnSync } = require('child_process');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const directory = mkdtempSync(join(tmpdir(), 'hrm-rule-repair-'));
const port = 21000 + Math.floor(Math.random() * 20000);
let started = false;
function command(name, args, env = process.env) {
  const r = spawnSync(name, args, { encoding: 'utf8', env, maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${name} failed: ${r.stderr || r.stdout || r.error}`);
  return r.stdout;
}
(async () => {
  let client;
  try {
    command('initdb', ['-D', directory, '-A', 'trust', '--no-locale', '-E', 'UTF8']);
    command('pg_ctl', ['-D', directory, '-l', join(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start']); started = true;
    command('createdb', ['-h', '127.0.0.1', '-p', String(port), 'notification_repair_test']);
    const url = `postgresql://${encodeURIComponent(process.env.USER)}@127.0.0.1:${port}/notification_repair_test`;
    client = new Client({ connectionString: url }); await client.connect();
    await client.query('CREATE TABLE preserved_history (id integer PRIMARY KEY, body text); INSERT INTO preserved_history VALUES (1, \'Original history\')');
    const repair = readFileSync('prisma/migrations/20261020090000_repair_notification_management_tables/migration.sql', 'utf8');
    await client.query(repair);
    const columns = (await client.query(`SELECT table_name,column_name,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('NotificationRule','NotificationTemplate') ORDER BY table_name,ordinal_position`)).rows;
    assert.equal(columns.filter(c => c.table_name === 'NotificationRule').length, 9);
    assert.equal(columns.filter(c => c.table_name === 'NotificationTemplate').length, 9);
    assert.equal(columns.find(c => c.column_name === 'recipients').udt_name, '_text');
    console.log('PASS missing tables repaired with baseline column definitions');
    await client.query(`INSERT INTO "NotificationRule" (event,category,recipients,"updatedAt") VALUES ('CUSTOM','GENERAL',ARRAY['EMPLOYEE'],NOW()); INSERT INTO "NotificationTemplate" (event,title,message,"updatedAt") VALUES ('CUSTOM','Original title','Original message',NOW())`);
    await client.query(repair);
    assert.equal((await client.query('SELECT title FROM "NotificationTemplate"')).rows[0].title, 'Original title');
    assert.equal((await client.query('SELECT count(*)::int n FROM "NotificationRule"')).rows[0].n, 1);
    assert.equal((await client.query('SELECT body FROM preserved_history')).rows[0].body, 'Original history');
    console.log('PASS repeat repair preserves rules, templates and unrelated history');
    await assert.rejects(() => client.query(`INSERT INTO "NotificationRule" (event,category,"updatedAt") VALUES ('CUSTOM','GENERAL',NOW())`), e => e.code === '23505');
    console.log('PASS event uniqueness prevents duplicate rules');
    // Exercise the real exported seed helper against this isolated database.
    command(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', `const assert=require('node:assert/strict');const {prisma}=require('./src/utils/db');const {ensureDefaultNotificationRules}=require('./src/routes/notificationManagementRoutes');(async()=>{await ensureDefaultNotificationRules();await ensureDefaultNotificationRules();assert.equal(await prisma.notificationRule.count(),8);assert.equal(await prisma.notificationTemplate.count(),8);assert.equal((await prisma.notificationTemplate.findUnique({where:{event:'CUSTOM'}})).title,'Original title');await prisma.$disconnect();process.exit(0)})().catch(e=>{console.error(e);process.exit(1)})`], { ...process.env, NODE_ENV: 'production', DATABASE_URL: url });
    console.log('PASS repeated transactional seeding is idempotent and preserves custom records');
    await client.query('ALTER TABLE "NotificationTemplate" RENAME TO saved_templates');
    await assert.rejects(() => client.query('SELECT * FROM "NotificationTemplate"'), e => e.code === '42P01');
    const failedSeed = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', `const assert=require('node:assert/strict');const {prisma}=require('./src/utils/db');const {ensureDefaultNotificationRules}=require('./src/routes/notificationManagementRoutes');(async()=>{await assert.rejects(()=>ensureDefaultNotificationRules());assert.equal(await prisma.notificationRule.count(),8);await prisma.$disconnect();process.exit(0)})().catch(e=>{console.error(e);process.exit(1)})`], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: url } });
    assert.equal(failedSeed.status, 0, failedSeed.stderr);
    console.log('PASS missing template table rejects seed without partial rule writes');
    console.log('All repair tests passed. Only the disposable database was modified.');
  } finally {
    if (client) await client.end();
    if (started) command('pg_ctl', ['-D', directory, '-m', 'fast', '-w', 'stop']);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
