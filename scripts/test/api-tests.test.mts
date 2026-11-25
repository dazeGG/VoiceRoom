import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { apiLanes, compareFixtures, runTestFiles } from '../ci/api-tests.mts';

const runner = new URL('../ci/api-tests.mts', import.meta.url);
const api = 'apps/api/test';
const unit = api + '/no-db.test.ts';
const integration = api + '/nested/no-db.test.ts';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'vr-api-lanes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, api, 'nested'), { recursive: true });
  writeFileSync(join(root, unit), '');
  writeFileSync(join(root, integration), '');
  const manifest = (files: string[]) => writeFileSync(join(root, api, 'no-db-files.json'), JSON.stringify(files));
  manifest([unit]);
  return { root, manifest };
}

test('an unproved API test defaults to integration; duplicate or stale admissions are an error', (t) => {
  const { root, manifest } = fixture(t);
  assert.deepEqual(apiLanes(root), { unit: [unit], integration: [integration] });
  manifest([unit, unit]);
  assert.throws(() => apiLanes(root), /unique/);
  manifest([api + '/absent.test.ts']);
  assert.throws(() => apiLanes(root), /Unknown API test file/);
});

function child(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env };
  delete env.TEST_DATABASE_URL;
  delete env.DATABASE_URL;
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...env, ...extraEnv } });
}

test('integration fails before starting workers if the test URL is absent or PostgreSQL cannot be reached', () => {
  const args = [fileURLToPath(runner), '--fixture', 'integration'];
  const absent = child(args, { DATABASE_URL: 'postgres://unused' });
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /TEST_DATABASE_URL is required/);
  const unreachable = child(args, { TEST_DATABASE_URL: 'postgres://test:private@127.0.0.1:1/unused' });
  assert.equal(unreachable.status, 1);
  assert.match(unreachable.stderr, /Cannot connect to PostgreSQL/);
  assert.doesNotMatch(unreachable.stderr, /private/);
  const unknown = child([fileURLToPath(runner), '--fixture', 'bogus']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Expected --fixture/);
});

test('unit workers run only the explicit files and inherit neither database URL', (t) => {
  const { root } = fixture(t);
  writeFileSync(
    join(root, unit),
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('isolated', () => { assert.equal(process.env.DATABASE_URL, undefined); assert.equal(process.env.TEST_DATABASE_URL, undefined); });"
  );
  writeFileSync(join(root, integration), "throw Error('integration should not execute')");
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: 'must-not-leak', TEST_DATABASE_URL: 'must-not-leak' };
  delete env.NODE_TEST_CONTEXT;
  runTestFiles(apiLanes(root).unit, 'unit', env, root);
});

test('fixture comparison requires complete, identical positive case evidence (including conditional cases)', () => {
  const result = {
    success: true,
    passed: 1,
    failed: 0,
    skipped: 0,
    dbAttempt: false,
    observed: true,
    cases: ['first']
  };
  for (const difference of [
    { cases: ['other'] },
    { passed: 0, cases: [] },
    { observed: false },
    { success: false },
    { skipped: 1 },
    { dbAttempt: true }
  ]) {
    assert.deepEqual(compareFixtures({ test: result }, { test: { ...result, ...difference } }).accepted, []);
  }
  assert.throws(() => compareFixtures({ test: result }, { other: result }), /same non-empty candidate set/);
  assert.deepEqual(compareFixtures({ test: result }, { test: result }).accepted, ['test']);
});

test('proof observes a swallowed PostgreSQL connection and a skipped case, but admits a true unit', (t) => {
  const { root } = fixture(t);
  const driver = createRequire(import.meta.url).resolve('pg');
  writeFileSync(join(root, unit), "import test from 'node:test'; test('independent', () => {});");
  writeFileSync(
    join(root, integration),
    `import {createRequire} from 'node:module'; import test from 'node:test';
    const pg = createRequire(import.meta.url)(${JSON.stringify(driver)});
    test('swallowed error', async () => { const c = new pg.Client({port: 1, host: '127.0.0.1'}); await c.connect().catch(() => {}); await c.end(); });
    test.skip('conditional', () => {});`
  );
  const driverPath = join(root, 'measure.mjs');
  writeFileSync(
    driverPath,
    `import {fixtureReport, compareFixtures} from ${JSON.stringify(runner.href)};
    const report = await fixtureReport(${JSON.stringify([unit, integration])}, ${JSON.stringify(root)});
    console.log(JSON.stringify(compareFixtures(report, report)));`
  );
  const result = child([driverPath]);
  assert.equal(result.status, 0, result.stderr);
  const measured: unknown = JSON.parse(result.stdout);
  assert.deepEqual(measured, {
    accepted: [unit],
    rejected: {
      [integration]: [
        'db: attempted PostgreSQL connection',
        'db: skipped/todo cases',
        'db: incomplete case evidence',
        'no-db: attempted PostgreSQL connection',
        'no-db: skipped/todo cases',
        'no-db: incomplete case evidence'
      ]
    }
  });
});
