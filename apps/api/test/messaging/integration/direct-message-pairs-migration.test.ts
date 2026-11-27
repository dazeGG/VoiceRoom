import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../../src/lib/migrate.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { rollBackThrough } from '../../migration-steps.ts';

const name = '20261127120000_index_direct_message_pairs';
const quiet = { log() {}, info() {}, warn() {}, error() {} };

test(
  'the direct message pair index rolls back and can be applied again',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, databaseUrl, cleanup } = await createTestDatabase(t);
    t.after(cleanup);
    const definition = async () =>
      (
        await pool.query<{ indexdef: string }>(
          "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'direct_messages_pair_activity_idx'"
        )
      ).rows[0]?.indexdef;

    const before = await definition();
    assert.match(
      before ?? '',
      /least\(sender_id, recipient_id\), greatest\(sender_id, recipient_id\), created_at DESC/i
    );
    await rollBackThrough(databaseUrl, name);
    assert.equal(await definition(), undefined);
    await runMigrations({ databaseUrl, logger: quiet });
    assert.equal(await definition(), before);
  }
);
