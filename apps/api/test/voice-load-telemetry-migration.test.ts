import test from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const MIGRATION = '20261123120000_keep_voice_load_telemetry';
const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test(
  'voice load telemetry migrates existing rows forward and rolls back while retaining legacy events',
  { skip },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await rollBackThrough(databaseUrl, MIGRATION);
    const stayId = 'a5acab6c-f24d-42bf-801c-1fa590f108c9';
    await pool.query(`INSERT INTO voice_sessions (id, joined_at, left_at) VALUES ($1, now(), now())`, [stayId]);
    await pool.query(`INSERT INTO voice_session_samples (stay_id, at) VALUES ($1, now())`, [stayId]);
    await pool.query(`INSERT INTO voice_call_events (stay_id, at, kind) VALUES ($1, now(), 'relieved_ns')`, [stayId]);
    await runMigrations({ databaseUrl, logger: SILENT });

    const stays = await pool.query<{ desktop_version: string | null }>(`SELECT desktop_version FROM voice_sessions`);
    assert.deepEqual(stays.rows, [{ desktop_version: null }]);
    const samples = await pool.query<{
      window_visible_polls: number | null;
      window_hidden_polls: number | null;
      window_covered_polls: number | null;
      playout_synthesized_pct: number | null;
      playout_events: number | null;
    }>(`SELECT window_visible_polls, window_hidden_polls, window_covered_polls,
    playout_synthesized_pct, playout_events FROM voice_session_samples`);
    assert.deepEqual(samples.rows, [
      {
        window_visible_polls: null,
        window_hidden_polls: null,
        window_covered_polls: null,
        playout_synthesized_pct: null,
        playout_events: null
      }
    ]);
    await pool.query(
      `INSERT INTO voice_call_events (stay_id, at, kind, relief_kind, relief_outcome)
    VALUES ($1, now(), 'relief', 'video', 'applied')`,
      [stayId]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO voice_call_events (stay_id, at, kind)
    VALUES ($1, now(), 'relief')`,
        [stayId]
      ),
      /voice_call_events_relief_check/
    );

    // Check the lock held at the exact point where a writer could race the down migration.
    await pool.query(`CREATE FUNCTION require_voice_events_write_lock() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid()
            AND relation = 'voice_call_events'::regclass AND granted
            AND mode IN ('ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')
        ) THEN
          RAISE EXCEPTION 'voice_call_events must block writers before deleting relief rows';
        END IF;
        RETURN NULL;
      END;
    $$;
    CREATE TRIGGER require_voice_events_write_lock BEFORE DELETE ON voice_call_events
      FOR EACH STATEMENT EXECUTE FUNCTION require_voice_events_write_lock()`);
    await rollBackThrough(databaseUrl, MIGRATION);
    await pool.query(`DROP TRIGGER require_voice_events_write_lock ON voice_call_events;
      DROP FUNCTION require_voice_events_write_lock()`);
    const events = await pool.query<{ kind: string }>(`SELECT kind FROM voice_call_events`);
    assert.deepEqual(events.rows, [{ kind: 'relieved_ns' }]);
    await assert.rejects(pool.query(`SELECT desktop_version FROM voice_sessions`), /does not exist/);
    await assert.rejects(
      pool.query(`SELECT window_covered_polls, playout_events FROM voice_session_samples`),
      /does not exist/
    );
    await assert.rejects(pool.query(`SELECT relief_kind FROM voice_call_events`), /does not exist/);
    await assert.rejects(
      pool.query(
        `INSERT INTO voice_call_events (stay_id, at, kind)
    VALUES ($1, now(), 'relief')`,
        [stayId]
      ),
      /voice_call_events_kind_check/
    );
    assert.equal((await pool.query(`SELECT stay_id FROM voice_session_samples`)).rowCount, 1);
    await runMigrations({ databaseUrl, logger: SILENT });
  }
);
