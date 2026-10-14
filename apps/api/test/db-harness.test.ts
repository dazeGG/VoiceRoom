import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { assertMigrationReady, runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

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
    const sendTerminate = pg.Connection.prototype.end;
    pg.Connection.prototype.end = function lateEnd(...args) {
      setTimeout(() => sendTerminate.apply(this, args), 60);
    };
    try {
      await pool.end();
    } finally {
      pg.Connection.prototype.end = sendTerminate;
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
    const { rows } = await second.pool.query(`SELECT id FROM rooms WHERE id = 'harness-room'`);
    assert.deepEqual(rows, []);
  }
);
