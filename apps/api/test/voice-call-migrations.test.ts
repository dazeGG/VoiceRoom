import assert from 'node:assert/strict';
import test from 'node:test';
import type { DirectMessageCall } from '@voiceroom/shared/contracts/rings';
import { createRingRepository } from '../src/domains/rings/ring.repository.ts';
import { createRoomRepository } from '../src/domains/rooms/room.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { kyselyOn } from '../src/platform/db/kysely.ts';
import { createTestDatabase } from './db-harness.ts';
import { seedVoiceCall } from './fixtures/voice-call.ts';
import { rollBackThrough, rollbackCountThrough } from './migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const ROOM_MIGRATION = '20261125120000_add_call_room_kind';
const MISSED_MIGRATION = '20261125122000_index_missed_voice_calls';
const MISSED_ORDER_MIGRATION = '20261125123000_order_missed_voice_calls';
const inviteId = 'a3f9bdb7-2264-499a-928d-75e26606a817';
const requestId = 'a3f9bdb7-2264-499a-928d-75e26606a818';

test('the call migrations preserve legacy rows and refuse rollback while call storage exists', async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  const down = () => runMigrations({ databaseUrl, direction: 'down', logger: SILENT, noLock: true });
  const steps = await rollBackThrough(databaseUrl, ROOM_MIGRATION);
  await pool.query(
    `INSERT INTO rooms (id) VALUES ('ordinary');
     INSERT INTO users (id, login, display_name, password_hash) VALUES ('alice', 'alice', 'Alice', 'x'),
       ('bob', 'bob', 'Bob', 'x');`
  );
  await pool.query(
    `INSERT INTO room_rings (id, caller_user_id, recipient_user_id, room_id, client_request_id, invite_message_id, expires_at)
       VALUES ($1, 'alice', 'bob', 'ordinary', $2, 'invite', clock_timestamp() + interval '1 hour')`,
    [inviteId, requestId]
  );
  await pool.query(
    `INSERT INTO ring_delivery_outbox (ring_id, revision, recipient_user_id, kind, deadline)
       VALUES ($1, 1, 'bob', 'incoming', clock_timestamp() + interval '1 hour')`,
    [inviteId]
  );
  await assert.rejects(pool.query(`INSERT INTO rooms (id, kind) VALUES ('private', 'call')`), /rooms_kind_check/);
  assert.equal((await runMigrations({ databaseUrl, logger: SILENT })).length, steps);

  const rooms = createRoomRepository({ db: kyselyOn(pool), roomIdleTtlMs: 1000 });
  const { room, callId } = await seedVoiceCall(pool, 'alice', 'bob', Date.now() - 2 * 24 * 60 * 60 * 1000);
  assert.deepEqual(await rooms.getRoom(room.id), room);
  await assert.rejects(
    pool.query(`INSERT INTO rooms (id, kind, is_static) VALUES ('static', 'call', true)`),
    /rooms_call_shape_check/
  );
  await assert.rejects(
    pool.query(`INSERT INTO rooms (id, kind, owner_id) VALUES ('owned', 'call', 'alice')`),
    /rooms_call_shape_check/
  );
  await assert.rejects(
    pool.query(`INSERT INTO rooms (id, kind, widget_chat_enabled) VALUES ('chat', 'call', true)`),
    /shape_check/
  );
  await assert.rejects(pool.query(`UPDATE rooms SET kind='main' WHERE id=$1`, [room.id]), /immutable/);
  await assert.rejects(seedVoiceCall(pool, 'bob', 'alice'), /room_rings_open_call_pair_idx/);
  await assert.rejects(
    pool.query(`UPDATE room_rings SET attempt_inviter_user_id='outsider' WHERE id=$1`, [callId]),
    /room_rings_call_shape_check/
  );
  await assert.rejects(
    pool.query(`UPDATE room_rings SET attempt=1 WHERE id=$1`, [inviteId]),
    /room_rings_invite_shape_check/
  );
  await assert.rejects(pool.query(`UPDATE room_rings SET revision=2 WHERE id=$1`, [inviteId]), /room_rings_state/);
  assert.equal(await rooms.countQuotaRoomsForIp(''), 1);
  await rooms.markRoomEmpty('ordinary');
  await rooms.markRoomActive(room.id);
  assert.equal(await rooms.markActiveTemporaryRoomsEmpty(), 0);
  await rooms.markRoomEmpty(room.id);
  assert.equal(await rooms.pruneRooms(Date.now() + 10_000), true, 'the ordinary room was pruned');
  assert.equal((await rooms.getRoom(room.id))?.kind, 'call');

  await pool.query(
    `INSERT INTO ring_delivery_outbox (ring_id, purpose, revision, recipient_user_id, kind, deadline, attempt)
       VALUES ($1, 'voice-call', 2, 'bob', 'call-dismissal', now() + interval '1 hour', 1),
              ($1, 'voice-call', 2, 'bob', 'call-missed', now() + interval '1 hour', 1),
              ($1, 'voice-call', 1, 'bob', 'call-incoming', now() - interval '1 hour', 1)`,
    [callId]
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO ring_delivery_outbox (ring_id, revision, recipient_user_id, kind, deadline)
         VALUES ($1, 1, 'bob', 'incoming', now() + interval '1 hour')`,
      [callId]
    ),
    /ring_delivery_outbox_ring_purpose_fkey/
  );
  const invites = createRingRepository({ pool, isBanned: async () => false });
  assert.equal(await invites.act({ ringId: callId, actorUserId: 'alice', action: 'status' }), null);
  await invites.maintenance();
  assert.equal((await invites.claim())?.ring_id, inviteId);
  assert.equal(await invites.claim(), null);
  assert.equal((await pool.query('SELECT id FROM room_rings WHERE id=$1', [callId])).rowCount, 1);
  assert.equal((await pool.query('SELECT kind FROM ring_delivery_outbox WHERE ring_id=$1', [callId])).rowCount, 3);

  const missed = {
    kind: 'voice-call',
    call: {
      callId,
      revision: 2,
      outcome: 'no_answer',
      startedAt: 1_000,
      firstConnectedAt: null,
      endedAt: 46_000,
      durationMs: 0,
      endReason: 'no_answer',
      endedByUserId: null,
      missedAt: 46_000,
      missedRevision: 2,
      missedSeenRevision: null
    } satisfies DirectMessageCall
  };
  await pool.query(
    `INSERT INTO direct_messages (id, sender_id, recipient_id, body, metadata) VALUES ('history', 'alice', 'bob', 'Call', $1)`,
    [missed]
  );
  assert.equal((await down())[0]?.name, MISSED_ORDER_MIGRATION);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    const eligible = `
      SELECT id FROM direct_messages WHERE recipient_id='bob' AND sender_id='alice' AND deleted_at IS NULL
        AND metadata->>'kind' = 'voice-call' AND jsonb_typeof(metadata->'call'->'missedAt') = 'number'
        AND metadata->'call'->>'missedAt' = '46000'`;
    const plan = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (COSTS OFF) ${eligible}`);
    assert.match(plan.rows.map((row) => row['QUERY PLAN']).join('\n'), /direct_messages_missed_voice_calls_idx/);
    assert.deepEqual((await client.query<{ id: string }>(eligible)).rows, [{ id: 'history' }]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  assert.equal((await runMigrations({ databaseUrl, logger: SILENT })).length, 1);
  assert.equal(await rollBackThrough(databaseUrl, MISSED_MIGRATION), rollbackCountThrough(MISSED_MIGRATION));
  assert.equal(
    (await pool.query<{ name: string | null }>(`SELECT to_regclass('direct_messages_missed_voice_calls_idx') AS name`))
      .rows[0]?.name,
    null
  );
  await assert.rejects(down(), /Cannot roll back Ring storage/);
  await pool.query('DELETE FROM room_rings WHERE id=$1', [callId]);
  assert.equal((await down()).length, 1);
  await rooms.deleteRoom(room.id);
  await rooms.purgeDeleted({ olderThanMs: 0, now: Date.now() + 1000 });
  await assert.rejects(down(), /rooms_kind_check/, 'a soft-deleted private room still blocks rollback');
  await pool.query('DELETE FROM rooms WHERE id=$1', [room.id]);
  assert.equal((await down()).length, 1);
  assert.equal((await pool.query('SELECT id FROM room_rings WHERE id=$1', [inviteId])).rowCount, 1);
  assert.equal((await pool.query('SELECT ring_id FROM ring_delivery_outbox WHERE ring_id=$1', [inviteId])).rowCount, 1);
  assert.deepEqual(
    (await pool.query<{ metadata: unknown }>(`SELECT metadata FROM direct_messages WHERE id='history'`)).rows[0]
      ?.metadata,
    missed
  );
  assert.equal((await runMigrations({ databaseUrl, logger: SILENT })).length, steps);
});
