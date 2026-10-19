// Real PostgreSQL integration tests in a disposable local cluster. No application .env is loaded here.
const { mkdtempSync, readFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { spawnSync } = require('child_process');
const directory = mkdtempSync(join(tmpdir(), 'hrm-campaign-tests-'));
const port = 21000 + Math.floor(Math.random() * 20000);
function command(name, args, env = process.env) {
  const result = spawnSync(name, args, { encoding: 'utf8', env, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}
let started = false;
try {
  command('initdb', ['-D', directory, '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  command('pg_ctl', ['-D', directory, '-l', join(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start']);
  started = true;
  const connection = `postgresql://${encodeURIComponent(process.env.USER)}@127.0.0.1:${port}/campaign_test`;
  command('createdb', ['-h', '127.0.0.1', '-p', String(port), 'campaign_test']);
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', 'scripts/notification_campaign_integration.ts'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: connection, NODE_ENV: 'production', CAMPAIGN_TEST_DATABASE: 'true' } });
  process.exitCode = result.status || 0;
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { if (started) { try { command('pg_ctl', ['-D', directory, '-m', 'fast', '-w', 'stop']); } catch (e) { console.error(e.message); } } }
