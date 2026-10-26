import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';
import { runMigrations } from '../src/lib/migrate.ts';
import { queryRow } from './helpers/checked.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';
const skip = !process.env.TEST_DATABASE_URL;
const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test(
  'channel migration backfills legacy rows, constrains IDs and rolls back without deleting tokens',
  { skip },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await rollBackThrough(databaseUrl, '20261026150200_add_device_notification_channels');
    await pool.query("INSERT INTO users (id, login, password_hash) VALUES ('ada', 'ada', 'x')");
    await pool.query("INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', 'ada', now() + interval '1 day')");
    await pool.query(
      "INSERT INTO device_tokens (id, user_id, session_id, provider, token) VALUES ('d1', 'ada', 's1', 'rustore', 'legacy')"
    );
    await runMigrations({ databaseUrl, logger: SILENT });
    const capabilities = async () =>
      (
        await queryRow(
          pool,
          Type.Object({ notification_channels: Type.Array(Type.String()) }),
          "SELECT notification_channels FROM device_tokens WHERE id = 'd1'"
        )
      ).notification_channels;
    assert.deepEqual(await capabilities(), []);
    await pool.query("UPDATE device_tokens SET notification_channels = ARRAY['messages', 'mentions']");
    assert.deepEqual(await capabilities(), ['messages', 'mentions']);
    for (const value of [
      "ARRAY['unknown']",
      'NULL',
      "ARRAY['messages', 'mentions', 'calls', 'messages']",
      'ARRAY[NULL]::text[]'
    ]) {
      await assert.rejects(pool.query('UPDATE device_tokens SET notification_channels = ' + value));
    }
    await rollBackThrough(databaseUrl, '20261026150200_add_device_notification_channels');
    assert.equal(
      (await queryRow(pool, Type.Object({ count: Type.Integer() }), 'SELECT count(*)::int AS count FROM device_tokens'))
        .count,
      1
    );
    await assert.rejects(pool.query('SELECT notification_channels FROM device_tokens'), /does not exist/);
    await runMigrations({ databaseUrl, logger: SILENT });
    assert.deepEqual(await capabilities(), []);
  }
);
