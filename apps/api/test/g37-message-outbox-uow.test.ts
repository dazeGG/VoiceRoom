import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createMessageOutboxRepository } from '../src/domains/messaging/message-outbox-repository.ts';
import { transaction } from '../src/platform/db/pool.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

test(
  'G37-A01 logical event identity deduplicates inside the active transaction',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} } });
    const repo = createMessageOutboxRepository({ pool });
    const input = {
      eventId: 'e1',
      type: 'message.created',
      conversation: { type: 'room', id: 'r' },
      messageId: 'm',
      message: { id: 'm' }
    };
    const [first, second] = await transaction(pool, async (client) => [
      await repo.enqueue(client, input),
      await repo.enqueue(client, { ...input, eventId: 'e2' })
    ]);
    assert.equal(first?.logicalKey, second?.logicalKey);
    assert.equal(second?.eventId, 'e1', 'the second enqueue answers with the queued event');
    const rows = await pool.query<{ event_id: string }>('SELECT event_id FROM message_delivery_outbox');
    assert.deepEqual(
      rows.rows.map((row) => row.event_id),
      ['e1']
    );
  }
);

test('G37-A02 schema is inert, additive, lock-bounded and retains poison evidence', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/migrations/20260718125000_create_message_delivery_outbox.cjs'),
    'utf8'
  );
  assert.match(source, /SET LOCAL lock_timeout = '5s'/);
  assert.match(source, /status IN \('pending', 'processing', 'delivered', 'dead'\)/);
  assert.match(source, /logical_key[\s\S]*unique: true/);
});
