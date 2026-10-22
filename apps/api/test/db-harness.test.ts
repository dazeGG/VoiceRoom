import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import pg from 'pg';
import { assertMigrationReady, runMigrations } from '../src/lib/migrate.ts';
import { readDatabaseConfig } from '../src/lib/config.ts';
import { createTestDatabase, lostTemplateRace } from './db-harness.ts';
import { settleAll } from './helpers/settle.ts';

// A pool resolves end() once its clients are out of the pool, before their
// sockets have closed. On a loaded runner the goodbye leaves a moment later, so
// a cleanup that terminated straight away reached backends that were still up:
// the client got "terminating connection due to administrator command", the
// pool re-emitted it as its own 'error', and with no listener in the test,
// node:test pinned the uncaught exception on whichever test was running.
test(
  'cleanup lets an ended pool finish closing instead of terminating it',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = await createTestDatabase(t);
    const pool = new pg.Pool({ connectionString: db.databaseUrl, max: 8 });
    const errors: unknown[] = [];
    pool.on('error', (error) => errors.push(error.message));
    await Promise.all(Array.from({ length: 24 }, () => pool.query('SELECT pg_sleep(0.002)')));

    // Make every client say goodbye a little late, the way a busy CI runner does.
    const connection: { end: (this: pg.Connection) => void } = pg.Connection.prototype;
    const sendTerminate = connection.end;
    connection.end = function lateEnd() {
      setTimeout(() => sendTerminate.call(this), 60);
    };
    try {
      await pool.end();
    } finally {
      connection.end = sendTerminate;
    }

    await db.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(errors, [], 'no client of the ended pool was cut off by cleanup');
  }
);

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test(
  'a test database comes fully migrated, so running the migrations again changes nothing',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = await createTestDatabase(t);
    t.after(db.cleanup);
    assert.equal(await assertMigrationReady({ databaseUrl: db.databaseUrl }), true);
    assert.deepEqual(await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT }), []);
  }
);

test(
  'an empty test database has no schema until the migrations run',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = await createTestDatabase(t, { empty: true });
    t.after(db.cleanup);
    await assert.rejects(assertMigrationReady({ databaseUrl: db.databaseUrl }), /absent/);
    assert.ok((await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT })).length > 0);
    assert.equal(await assertMigrationReady({ databaseUrl: db.databaseUrl }), true);
  }
);

test(
  'test databases copied from the same template do not share rows',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const first = await createTestDatabase(t);
    const second = await createTestDatabase(t);
    t.after(async () => {
      await first.cleanup();
      await second.cleanup();
    });
    await first.pool.query(`INSERT INTO rooms (id, creator_ip) VALUES ('harness-room', '')`);
    const { rowCount } = await second.pool.query(`SELECT id FROM rooms WHERE id = 'harness-room'`);
    assert.equal(rowCount, 0);
  }
);

// Test processes build the migrated template at the same time and keep the
// first one renamed into place. Two renames that run at once fail on the
// catalog's unique index (23505) rather than with duplicate_database (42P04);
// the loser must recognise either as a lost race, or its test fails.
test(
  'a template rename that loses to a concurrent one is recognised as a lost race',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const { url } = readDatabaseConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL });
    const name = () => `voice_room_race_${crypto.randomBytes(6).toString('hex')}`;
    const first = new pg.Pool({ connectionString: url, max: 1 });
    const second = new pg.Pool({ connectionString: url, max: 1 });
    const created: string[] = [];
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const target = name();
        const [one, two] = [name(), name()];
        for (const scratch of [one, two]) {
          await first.query(`CREATE DATABASE "${scratch}"`);
          created.push(scratch);
        }
        created.push(target);
        const renames = await settleAll([
          first.query(`ALTER DATABASE "${one}" RENAME TO "${target}"`),
          second.query(`ALTER DATABASE "${two}" RENAME TO "${target}"`)
        ]);
        const losers = renames.flatMap((result) => (result.ok ? [] : [result.error]));
        assert.equal(losers.length, 1, 'exactly one rename wins');
        assert.ok(lostTemplateRace(losers[0]), `the loser's error ${String(losers[0])} counts as a lost race`);
      }
      // What a CI runner got when both renames ran at once (CI run 39473397319).
      const catalogRace = Object.assign(
        new Error('duplicate key value violates unique constraint "pg_database_datname_index"'),
        { code: '23505' }
      );
      assert.ok(lostTemplateRace(catalogRace));
    } finally {
      for (const db of created) await first.query(`DROP DATABASE IF EXISTS "${db}"`).catch(() => {});
      await Promise.all([first.end(), second.end()]);
    }
  }
);
