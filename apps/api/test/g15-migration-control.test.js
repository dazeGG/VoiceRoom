'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');
const { test } = require('node:test');
const { createTestDatabase } = require('./db-harness');
const {
  LOCK_TIMEOUT_MS,
  MIGRATION_GUARD_STATES,
  advisoryLockParts,
  assertMigrationReady,
  expectedMigrationCatalog,
  runMigrations
} = require('../src/lib/migrate');

class FakeClient {
  constructor({ guardTable = true, migrationsTable = true, migrationNames = expectedMigrationCatalog(), guardState = 'clean', loseLock = false, lockTimeout = false } = {}) {
    this.guardTable = guardTable;
    this.migrationsTable = migrationsTable;
    this.migrationNames = migrationNames;
    this.guardState = guardState;
    this.loseLock = loseLock;
    this.lockTimeout = lockTimeout;
    this.lockHeld = false;
    this.queries = [];
  }

  async connect() {}
  async end() {}

  async query(text, values = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql, values });
    if (sql.startsWith('SET statement_timeout') || sql.startsWith('SET lock_timeout')) return { rows: [] };
    if (sql.includes('pg_advisory_lock')) {
      if (this.lockTimeout) {
        const error = new Error('canceling statement due to statement timeout');
        error.code = '57014';
        throw error;
      }
      this.lockHeld = true;
      return { rows: [{}] };
    }
    if (sql.includes("locktype = 'advisory'")) {
      const held = this.lockHeld && !this.loseLock;
      this.loseLock = false;
      if (!held) this.lockHeld = false;
      return { rows: [{ held }] };
    }
    if (sql.includes('pg_advisory_unlock')) {
      const held = this.lockHeld;
      this.lockHeld = false;
      return { rows: [{ pg_advisory_unlock: held }] };
    }
    if (sql.includes('to_regclass')) return { rows: [{ guard_table: this.guardTable ? 'voiceroom_migration_guard' : null, migrations_table: this.migrationsTable ? 'pgmigrations' : null }] };
    if (sql.startsWith('CREATE TABLE')) { this.guardTable = true; return { rows: [] }; }
    if (sql.startsWith('SELECT state FROM')) return { rows: [{ state: this.guardState }] };
    if (sql.startsWith('SELECT marker FROM')) return { rows: [{ marker: 'fixture' }] };
    if (sql.startsWith('SELECT state, marker FROM')) return { rows: [{ state: this.guardState, marker: 'fixture' }] };
    if (sql.startsWith('SELECT name FROM pgmigrations')) return { rows: this.migrationNames.map((name) => ({ name })) };
    if (sql.startsWith('INSERT INTO')) {
      this.guardState = values[1];
      return { rows: [] };
    }
    return { rows: [] };
  }
}

test('G15-A01 uses the exact five-second lock timeout and stable advisory key parts', async () => {
  assert.equal(LOCK_TIMEOUT_MS, 5000);
  const parts = advisoryLockParts(7241865325823964);
  assert.deepEqual(parts, { classId: 1686128, objectId: 708954076 });

  const client = new FakeClient({ lockTimeout: true });
  await assert.rejects(
    runMigrations({ databaseUrl: 'postgres://fixture', clientFactory: () => client, migrationRunner: async () => [] }),
    /Timed out waiting 5000ms/
  );
  assert.ok(client.queries.some(({ sql }) => sql === "SET statement_timeout TO '5000ms'"));
});

test('G15-A01 serial runner holds the fence through migration completion and supports no-op', async () => {
  const client = new FakeClient();
  let observedRunning = false;
  const result = await runMigrations({
    databaseUrl: 'postgres://fixture',
    clientFactory: () => client,
    migrationRunner: async () => {
      observedRunning = client.guardState === MIGRATION_GUARD_STATES.running && client.lockHeld;
      return [];
    },
    logger: { log() {}, warn() {}, error() {}, info() {} }
  });
  assert.deepEqual(result, []);
  assert.equal(observedRunning, true);
  assert.ok(client.queries.some(({ sql }) => sql === "SET lock_timeout TO '5000ms'"));
  assert.ok(client.queries.some(({ sql }) => sql === 'SET lock_timeout TO 0'));
  assert.equal(client.guardState, MIGRATION_GUARD_STATES.clean);
  assert.equal(client.lockHeld, false);
});

test('G15-A02 lock loss aborts and leaves a dirty rollout fence', async () => {
  const client = new FakeClient();
  await assert.rejects(
    runMigrations({
      databaseUrl: 'postgres://fixture',
      clientFactory: () => client,
      migrationRunner: async () => {
        client.loseLock = true;
        return ['fixture'];
      },
      logger: { log() {}, warn() {}, error() {}, info() {} }
    }),
    /advisory lock was lost/
  );
  assert.equal(client.guardState, MIGRATION_GUARD_STATES.dirty);
});

test('G15-A02 interrupted migration leaves a dirty rollout fence', async () => {
  const client = new FakeClient();
  await assert.rejects(
    runMigrations({
      databaseUrl: 'postgres://fixture',
      clientFactory: () => client,
      migrationRunner: async () => { throw new Error('interrupted fixture'); },
      logger: { log() {}, warn() {}, error() {}, info() {} }
    }),
    /interrupted fixture/
  );
  assert.equal(client.guardState, MIGRATION_GUARD_STATES.dirty);
});

test('G15-A02 rollout requires a clean guard and the exact migration catalog/head', async () => {
  for (const guardState of [MIGRATION_GUARD_STATES.running, MIGRATION_GUARD_STATES.dirty]) {
    await assert.rejects(
      assertMigrationReady({ databaseUrl: 'postgres://fixture', clientFactory: () => new FakeClient({ guardState }) }),
      new RegExp(`migration guard state ${guardState}`)
    );
  }

  await assert.rejects(assertMigrationReady({ databaseUrl: 'postgres://fixture', clientFactory: () => new FakeClient({ guardTable: false }) }), /guard or catalog is absent/);
  await assert.rejects(assertMigrationReady({ databaseUrl: 'postgres://fixture', clientFactory: () => new FakeClient({ migrationsTable: false }) }), /guard or catalog is absent/);
  const stale = expectedMigrationCatalog().slice(0, -1);
  await assert.rejects(assertMigrationReady({ databaseUrl: 'postgres://fixture', clientFactory: () => new FakeClient({ migrationNames: stale }) }), /catalog\/head does not match/);
  await assert.doesNotReject(assertMigrationReady({ databaseUrl: 'postgres://fixture', clientFactory: () => new FakeClient() }));
});

test('G15-A02 production rejects unfenced and down migration commands before database access', () => {
  for (const argument of ['--no-lock', 'down']) {
    const result = spawnSync(process.execPath, ['apps/api/src/scripts/migrate.js', argument], {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgres://127.0.0.1:1/unreachable' },
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Production (migrations require the fenced advisory lock|down migrations are disabled)/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ECONNREFUSED/);
  }
});

test('G15-A01 concurrent PostgreSQL runners serialize behind one advisory fence', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const order = [];
  const migrationRunner = async ({ dbClient }) => {
    const [{ backend }] = (await dbClient.query('SELECT pg_backend_pid() AS backend')).rows;
    order.push(`start:${backend}`);
    await new Promise((resolve) => setTimeout(resolve, 75));
    order.push(`end:${backend}`);
    return [];
  };
  const clientFactory = (connectionString) => new Client({ connectionString });
  await Promise.all([
    runMigrations({ databaseUrl, clientFactory, migrationRunner, logger: { log() {} } }),
    runMigrations({ databaseUrl, clientFactory, migrationRunner, logger: { log() {} } })
  ]);
  assert.match(order.join(','), /^start:\d+,end:\d+,start:\d+,end:\d+$/);
});

test('G15-A03 an existing PostgreSQL database is unready until the exact guarded catalog reaches this build head', { skip:!process.env.TEST_DATABASE_URL }, async (t) => {
  const db=await createTestDatabase(t); t.after(()=>db.cleanup());
  await assert.rejects(assertMigrationReady({databaseUrl:db.databaseUrl}),/guard or catalog is absent/);
  await runMigrations({databaseUrl:db.databaseUrl,logger:{log(){},info(){},warn(){},error(){}}});
  await assert.doesNotReject(assertMigrationReady({databaseUrl:db.databaseUrl}));
});
