// The message delivery outbox over a migrated database: one worker lease with
// a moving fence, claims only under that lease, delivery and retries that
// check the fence, and dead events kept as evidence.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';

import {
  MessageDeliveryFenceError,
  createMessageOutboxRepository
} from '../src/domains/messaging/message-outbox-repository.ts';
import { transaction } from '../src/platform/db/pool.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const IDENTITY = 'message-delivery';

async function setup(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const outbox = createMessageOutboxRepository({ pool });
  const enqueue = (messageId: string) =>
    transaction(pool, (client) =>
      outbox.enqueue(client, {
        eventId: `event-${messageId}`,
        type: 'message.created',
        conversation: { type: 'room', id: 'room-1' },
        messageId,
        message: { id: messageId }
      })
    );
  return { pool, outbox, enqueue };
}

async function expire(pool: pg.Pool) {
  await pool.query(`UPDATE message_delivery_leases SET expires_at = current_timestamp - interval '1 second'`);
}

test('the lease belongs to one owner at a time and every takeover moves the fence', { skip }, async (t) => {
  const { pool, outbox } = await setup(t);
  const first = await outbox.acquireLease({ identity: IDENTITY, ownerId: 'worker-1', leaseMs: 60_000 });
  assert.ok(first.acquired);
  assert.equal(first.fencingToken, 1);
  assert.deepEqual(await outbox.acquireLease({ identity: IDENTITY, ownerId: 'worker-2' }), { acquired: false });
  const again = await outbox.acquireLease({ identity: IDENTITY, ownerId: 'worker-1' });
  assert.ok(again.acquired);
  assert.equal(again.fencingToken, 2, 'the owner re-acquiring moves the fence too');

  const lease = { identity: IDENTITY, ownerId: 'worker-1', fencingToken: 2 };
  assert.equal((await outbox.renewLease({ ...lease, leaseMs: 'bad' })).renewed, true);
  assert.deepEqual(await outbox.renewLease({ ...lease, fencingToken: 1 }), { renewed: false });
  assert.equal(await outbox.recordHeartbeat({ ...lease, ready: true }), true);
  const ready = await pool.query<{ ready: boolean }>('SELECT ready FROM message_delivery_leases');
  assert.equal(ready.rows[0]?.ready, true);

  await outbox.releaseLease(lease);
  assert.equal(await outbox.recordHeartbeat(lease), false, 'a released lease has expired');
  const taken = await outbox.acquireLease({ identity: IDENTITY, ownerId: 'worker-2' });
  assert.ok(taken.acquired);
  assert.equal(taken.fencingToken, 3);
});

test('events are claimed under the lease, delivered or retried under its fence', { skip }, async (t) => {
  const { pool, outbox, enqueue } = await setup(t);
  const queued = await enqueue('m1');
  await enqueue('m2');
  assert.equal((await outbox.getEvent(queued.eventId))?.messageId, 'm1');
  assert.equal(await outbox.getEvent('missing'), null);

  assert.deepEqual(
    await outbox.claimBatch({ identity: IDENTITY, ownerId: 'worker-1', fencingToken: 1 }),
    [],
    'nothing is claimed without the lease'
  );
  const lease = await outbox.acquireLease({ identity: IDENTITY, ownerId: 'worker-1' });
  assert.ok(lease.acquired);
  const held = { identity: IDENTITY, ownerId: 'worker-1', fencingToken: lease.fencingToken };

  const claimed = await outbox.claimBatch({ ...held, limit: 1 });
  assert.deepEqual(
    claimed.map((event) => [event.messageId, event.attempts, event.fencingToken]),
    [['m1', 1, held.fencingToken]]
  );
  const [second] = await outbox.claimBatch({ ...held, limit: 'bad', staleClaimMs: 60_000 });
  assert.equal(second?.messageId, 'm2');
  assert.deepEqual(await outbox.claimBatch(held), [], 'a fresh claim is not reclaimed');

  await outbox.markDelivered(queued.eventId, held);
  await assert.rejects(() => outbox.markDelivered(queued.eventId, held), MessageDeliveryFenceError);
  await assert.rejects(
    () => outbox.markDelivered(second?.eventId ?? '', { ...held, fencingToken: held.fencingToken + 1 }),
    MessageDeliveryFenceError
  );

  await outbox.reschedule(second?.eventId ?? '', held, { delayMs: 60_000, error: new Error('socket closed') });
  const retried = await pool.query<{ status: string; last_error: string; available_at: Date }>(
    'SELECT status, last_error, available_at FROM message_delivery_outbox WHERE event_id = $1',
    [second?.eventId]
  );
  assert.equal(retried.rows[0]?.status, 'pending');
  assert.equal(retried.rows[0]?.last_error, 'socket closed');
  assert.ok((retried.rows[0]?.available_at.getTime() ?? 0) > Date.now() + 30_000);

  await pool.query(`UPDATE message_delivery_outbox SET available_at = current_timestamp WHERE event_id = $1`, [
    second?.eventId
  ]);
  const [again] = await outbox.claimBatch(held);
  assert.equal(again?.attempts, 2);
  await outbox.reschedule(again?.eventId ?? '', held, { maxAttempts: 2, error: 'gone' });
  const dead = await pool.query<{ status: string; dead_at: Date | null }>(
    'SELECT status, dead_at FROM message_delivery_outbox WHERE event_id = $1',
    [again?.eventId]
  );
  assert.equal(dead.rows[0]?.status, 'dead', 'out of attempts: kept as evidence');
  assert.ok(dead.rows[0]?.dead_at);
  await assert.rejects(() => outbox.reschedule(again?.eventId ?? '', held), MessageDeliveryFenceError);

  await enqueue('m3');
  const [stale] = await outbox.claimBatch(held);
  assert.ok(stale);
  await expire(pool);
  await assert.rejects(() => outbox.markDelivered(stale.eventId, held), MessageDeliveryFenceError, 'the lease ran out');
  const next = await outbox.acquireLease({ identity: IDENTITY, ownerId: 'worker-2' });
  assert.ok(next.acquired);
  const [reclaimed] = await outbox.claimBatch({
    identity: IDENTITY,
    ownerId: 'worker-2',
    fencingToken: next.fencingToken,
    staleClaimMs: 1
  });
  assert.equal(reclaimed?.eventId, stale.eventId, 'a stale claim goes to the new lease holder');
});

test('an event is announced on its notification channel', { skip }, async (t) => {
  const { pool, outbox } = await setup(t);
  const listener = await pool.connect();
  try {
    const received = new Promise<string>((resolve) =>
      listener.on('notification', (message) => resolve(message.payload ?? ''))
    );
    await listener.query('LISTEN voice_room_message_delivery');
    await outbox.publishPostgres({ eventId: 'event-1' });
    assert.deepEqual(JSON.parse(await received), { eventId: 'event-1' });
  } finally {
    await listener.query('UNLISTEN *');
    listener.release();
  }
  await assert.rejects(
    () => outbox.publishPostgres({ eventId: 'x' }, { channel: 'bad channel' }),
    /Invalid PostgreSQL/
  );
});
