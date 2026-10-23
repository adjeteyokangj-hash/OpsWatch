/* Disposable localhost database only. Never connects to the configured app DB. */
const { createRequire } = require('node:module');
const { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, openSync, closeSync } = require('node:fs');
const { resolve, join, dirname, basename } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const apiRequire = createRequire(resolve('apps/api/package.json'));
const { Client } = apiRequire('pg');
const dotenv = apiRequire('dotenv');

async function main() {
  const source = process.argv[2] ? dotenv.parse(readFileSync(resolve(process.argv[2]))) : process.env;
  const original = new URL(source.DIRECT_URL || source.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(original.hostname)) throw new Error('Only a localhost test server is allowed');
  const name = `opswatch_issue19_test_${Date.now()}`;
  const adminUrl = new URL(original); adminUrl.pathname = '/postgres'; adminUrl.search = '';
  const testUrl = new URL(original); testUrl.pathname = `/${name}`; testUrl.search = '';
  const admin = new Client({ connectionString: adminUrl.toString() });
  const tempRoot = resolve(tmpdir());
  const scratch = mkdtempSync(join(tempRoot, 'opswatch-issue19-test-'));
  let created = false;
  const browserMode = process.env.RUN_ISSUE19_BROWSER === 'true';
  const servers = [];
  const logHandles = [];
  const env = { ...process.env, DATABASE_URL: testUrl.toString(), DIRECT_URL: testUrl.toString(),
    RUN_DATABASE_E2E: 'true', NODE_ENV: 'test', JWT_SECRET: 'issue19-isolated-test-jwt-secret-32-characters',
    OPSWATCH_CRON_SECRET: 'issue19-test-cron', WORKER_INTERNAL_SECRET: 'issue19-test-worker' };
  const child = (file, args, extra = {}) => {
    const result = spawnSync(process.execPath, [file, ...args], { env, encoding: 'utf8', ...extra });
    if (result.error) throw result.error;
    return result;
  };
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    console.log(`Created disposable localhost database ${name}`);
    const baseline = spawnSync('git', ['show', '66f61d7b8a2dbeb2aad84d5a418d6102f34d8fc8:apps/api/prisma/schema.prisma'], { encoding: 'utf8' });
    if (baseline.status !== 0) throw new Error('Baseline schema unavailable');
    const schemaPath = join(scratch, 'baseline.prisma'); writeFileSync(schemaPath, baseline.stdout);
    const diff = child(apiRequire.resolve('prisma/build/index.js'), ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script']);
    if (diff.status !== 0) throw new Error('Could not generate disposable baseline: ' + diff.stderr);
    const db = new Client({ connectionString: testUrl.toString() });
    try {
      await db.connect(); await db.query(diff.stdout);
      await db.query(readFileSync('apps/api/prisma/migrations/20261023090000_module_catalogue_assignments/migration.sql', 'utf8'));
      const currentSchema = resolve('apps/api/prisma/schema.prisma');
      const parity = child(apiRequire.resolve('prisma/build/index.js'), ['migrate', 'diff', '--from-schema-datasource', currentSchema,
        '--to-schema-datamodel', currentSchema, '--exit-code']);
      if (parity.status !== 0) throw new Error('Additive migration differs from Prisma schema: ' + parity.stdout + parity.stderr);
      const fixtureOrg = randomUUID(), fixtureProject = randomUUID();
      await db.query('INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ($1,$2,$3,now())', [fixtureOrg, 'Disposable integration fixture', 'issue19-fixture']);
      await db.query('INSERT INTO "Project" (id,name,slug,"clientName",environment,"apiKey","signingSecret","organizationId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())',
        [fixtureProject, 'Disposable Noble Express', 'noble-express', 'Test only', 'test', randomUUID(), randomUUID(), fixtureOrg]);
      if (browserMode) {
        const otherOrg = randomUUID(), mobileProject = randomUUID();
        await db.query('UPDATE "Project" SET description=$1 WHERE id=$2', ['Oware gameplay and two-player game engine', fixtureProject]);
        await db.query('INSERT INTO "Project" (id,name,slug,"clientName",environment,"apiKey","signingSecret","organizationId","updatedAt",description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)',
          [mobileProject, 'Disposable mobile game', 'issue19-mobile', 'Test only', 'test', randomUUID(), randomUUID(), fixtureOrg, 'Oware gameplay and two-player game engine']);
        await db.query('INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ($1,$2,$3,now())', [otherOrg, 'Other isolated organisation', 'issue19-other']);
        const hash = await apiRequire('bcryptjs').hash('Issue19!DisposableBrowserOnly', 10);
        for (const [email, org] of [['issue19-admin@example.test', fixtureOrg], ['issue19-other@example.test', otherOrg]]) {
          await db.query('INSERT INTO "User" (id,name,email,"passwordHash",role,"organizationId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', [randomUUID(), 'Disposable browser user', email, hash, 'ADMIN', org]);
        }
        Object.assign(env, { ISSUE19_PROJECT: fixtureProject, ISSUE19_MOBILE_PROJECT: mobileProject, PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3109' });
      }
      console.log('Baseline plus additive migration applied; database schema matches Prisma');
    } finally { await db.end(); }
    if (browserMode) {
      mkdirSync('test-artifacts', { recursive: true });
      const launch = (label, file, args, cwd, serverEnv) => {
        const log = openSync(`test-artifacts/issue19-${label}.log`, 'w'); logHandles.push(log);
        const server = spawn(process.execPath, [file, ...args], { cwd, env: serverEnv, stdio: ['ignore', log, log] }); servers.push(server);
      };
      launch('api', resolve('apps/api/dist/index.js'), [], resolve('apps/api'), { ...env, PORT: '4109', OPSWATCH_WEB_URL: 'http://127.0.0.1:3109' });
      launch('web', require.resolve('next/dist/bin/next'), ['start', '-p', '3109'], resolve('apps/web'), { ...env, NODE_ENV: 'production', OPSWATCH_API_ORIGIN: 'http://127.0.0.1:4109', OPSWATCH_EMBEDDED_API: 'false' });
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (servers.some(server => server.exitCode !== null)) throw new Error('A browser test server exited; inspect test-artifacts/issue19-*.log');
        try { if ((await fetch('http://127.0.0.1:3109/login', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
        await new Promise(done => setTimeout(done, 500));
      }
      if (!ready) throw new Error('Local browser test server was not ready');
      const webRequire = createRequire(resolve('apps/web/package.json'));
      const result = child(join(dirname(webRequire.resolve('@playwright/test/package.json')), 'cli.js'), ['test', '--config', 'playwright.issue19.config.ts'], { cwd: resolve('apps/web'), stdio: 'inherit' });
      process.exitCode = result.status ?? 1;
    } else {
      const files = process.argv.slice(3);
      const workerOnly = files[0] === '--worker-only';
      if (!workerOnly) {
        const result = child(join(dirname(apiRequire.resolve('vitest/package.json')), 'vitest.mjs'), ['run', '--no-file-parallelism', '--hookTimeout=30000', '--config', 'vitest.config.ts', ...files], { cwd: resolve('apps/api'), stdio: 'inherit' });
        process.exitCode = result.status ?? 1;
      }
      if (!files.length || workerOnly) {
        const workerRequire = createRequire(resolve('apps/worker/package.json'));
        const result = child(join(dirname(workerRequire.resolve('vitest/package.json')), 'vitest.mjs'), ['run', '--no-file-parallelism', '--hookTimeout=30000', '--config', 'vitest.config.ts'], { cwd: resolve('apps/worker'), stdio: 'inherit' });
        if (result.status !== 0) process.exitCode = result.status ?? 1;
      }
    }
  } finally {
    for (const server of servers) server.kill();
    for (const log of logHandles) closeSync(log);
    if (created) { await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); console.log(`Removed disposable database ${name}`); }
    await admin.end();
    if (dirname(resolve(scratch)) !== tempRoot || !basename(scratch).startsWith('opswatch-issue19-test-')) throw new Error('Unexpected temporary cleanup target');
    rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('Disposable database verification failed:', String(error.message).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted database URL]')); process.exitCode = 1; });
