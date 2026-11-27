import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { Pool } from 'pg';
import { Me } from '@voiceroom/shared/contracts/account';
import { ConversationList, DirectMessageAnswer, DirectThread } from '@voiceroom/shared/contracts/messages';
import { RingAnswer } from '@voiceroom/shared/contracts/rings';
import { createCallRingRepository } from '../../../src/domains/rings/call-rings.repository.ts';
import {
  acceptFirstFriendRequest,
  registerAccount,
  request,
  sendFriendRequest,
  startApiServer
} from '../../fakes/server-process.ts';
import { defined } from '../../helpers/assert-defined.ts';
import { openWs, waitForWsType } from '../../ws-harness.ts';

async function setup(t: TestContext) {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    env: { AUTH_RATE_LIMIT: '0', DM_RATE_LIMIT: '0', DM_NEW_CHAT_DAILY_LIMIT: '1', VOICE_CALLS_ENABLED: 'true' }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  async function account(login: string) {
    const cookie = await registerAccount(socketPath, login);
    const me = await request(socketPath, { pathname: '/api/auth/me', cookie }, Me);
    const user = defined(me.body.user, 'signed-in user');
    return { id: user.id, cookie, login, url: `/api/dm/${user.id}`, blockUrl: `/api/blocks/${user.id}` };
  }
  const alice = await account('alice');
  const bob = await account('bob');
  type Account = typeof alice;
  const send = (from: Account, to: Account, text: string, idempotencyKey = randomUUID()) =>
    request(socketPath, { method: 'POST', pathname: to.url, cookie: from.cookie, body: { text, idempotencyKey } });
  const remove = (from: Account, to: Account) =>
    request(socketPath, { method: 'DELETE', pathname: to.url, cookie: from.cookie });
  const lists = (who: Account) =>
    request(socketPath, { pathname: '/api/dm/conversations', cookie: who.cookie }, ConversationList);
  const block = (from: Account, to: Account, deleteConversation: boolean) =>
    request(socketPath, { method: 'PUT', pathname: to.blockUrl, cookie: from.cookie, body: { deleteConversation } });
  return { pool, socketPath, beforeCleanup, account, alice, bob, send, remove, lists, block };
}

test('deleting for both accounts purges messages, attachments, reactions and pending delivery and cancels invite rings', async (t) => {
  const { pool, socketPath, beforeCleanup, alice, bob, account, send, remove, lists } = await setup(t);
  const other = await account('other');
  await sendFriendRequest(socketPath, alice.cookie, bob.login);
  await acceptFirstFriendRequest(socketPath, bob.cookie);

  const sockets = [openWs(socketPath, { cookie: alice.cookie }), openWs(socketPath, { cookie: bob.cookie })];
  beforeCleanup(() => sockets.forEach(({ ws }) => ws.terminate()));
  await Promise.all(sockets.map(({ ready }) => ready));
  const message = await request(
    socketPath,
    {
      method: 'POST',
      pathname: bob.url,
      cookie: alice.cookie,
      body: { text: 'Old message', idempotencyKey: randomUUID() }
    },
    DirectMessageAnswer
  );
  assert.equal(message.status, 201);
  assert.equal((await send(other, alice, 'Keep this')).status, 201);
  const id = message.body.message.id;
  const attachmentId = randomUUID();
  await pool.query(
    `INSERT INTO message_attachments (id, owner_id, context, state, mime_type, original_bytes, processed_bytes,
        preview_bytes, width, height, original_storage_key, processed_storage_key, preview_storage_key,
        ready_at, bound_at, direct_message_id, attachment_order)
      VALUES ($1, $2, 'dm', 'ready', 'image/jpeg', 10, 8, 4, 2, 2, 'original', 'processed', 'preview', now(), now(), $3, 0)`,
    [attachmentId, alice.id, id]
  );
  assert.equal(
    (
      await request(socketPath, {
        method: 'PUT',
        pathname: `/api/reactions/dm/${alice.id}/${id}`,
        cookie: bob.cookie,
        body: { emoji: '👍', active: true }
      })
    ).status,
    200
  );
  await pool.query(
    `INSERT INTO direct_message_read_cursors (user_id, peer_user_id, last_read_message_created_at, last_read_message_id)
      SELECT $1, $2, created_at, id FROM direct_messages WHERE id = $3
      UNION ALL SELECT $2, $1, created_at, id FROM direct_messages WHERE id = $3`,
    [alice.id, bob.id, id]
  );
  await pool.query(`INSERT INTO rooms(id, name) VALUES ('invite-room', 'Invite room')`);
  const ring = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/rings',
      cookie: alice.cookie,
      body: { roomId: 'invite-room', userId: bob.id, clientRequestId: randomUUID() }
    },
    RingAnswer
  );
  assert.equal(ring.body.ring.state, 'pending');
  const calls = createCallRingRepository(pool);
  const call = await calls.start(alice.id, bob.id, randomUUID(), { count: 0, windowMs: 0 });
  assert.equal(call.status, 'created');
  assert.equal((await remove(bob, alice)).body.code, 'conversation_call_active');
  const closed = await calls.update(call.call.id, bob.id, (current, now) => ({
    call: {
      ...current,
      phase: 'closed',
      attemptResult: 'cancelled',
      endedAt: now,
      endReason: 'cancelled',
      endedByUserId: alice.id,
      aloneDeadline: null
    },
    result: null
  }));
  assert.equal(closed?.call.phase, 'closed');
  assert.equal((await calls.listMissed(bob.id))[0]?.count, 1);
  const callUrl = `/api/call-rings/${call.call.id}`;
  assert.equal((await request(socketPath, { pathname: callUrl, cookie: bob.cookie })).status, 200);

  // The inbox FK points to a room message. Exercise removal of a queued push
  // carrying the same DM dedupe key and preserve the unrelated inbox entry.
  await pool.query(`INSERT INTO room_messages (id, room_id, text) VALUES ('room-msg', 'invite-room', 'Room message')`);
  await pool.query(
    `INSERT INTO user_notifications (id, recipient_user_id, actor_user_id, room_id, source_message_id, reasons)
      VALUES ('notice', $1, $2, 'invite-room', 'room-msg', ARRAY['mention'])`,
    [bob.id, alice.id]
  );
  await pool.query(
    `INSERT INTO notification_outbox (event_id, notification_id, recipient_user_id, revision, payload)
      VALUES ('dm-push', 'notice', $1, 1, jsonb_build_object('type', 'dm.message', 'dedupeKey', $2::text)),
        ('room-push', 'notice', $1, 2, '{"type":"notification"}')`,
    [bob.id, `dm:${id}`]
  );
  assert.ok((await pool.query('SELECT 1 FROM message_delivery_outbox WHERE message_id = $1', [id])).rowCount);
  assert.ok((await pool.query('SELECT 1 FROM message_send_idempotency WHERE message_id = $1', [id])).rowCount);
  assert.equal(
    (
      await request(socketPath, {
        method: 'PUT',
        pathname: `/api/notifications/dm/${bob.id}/mute`,
        cookie: alice.cookie,
        body: { muted: true }
      })
    ).status,
    200
  );

  const deleted = await remove(bob, alice);
  assert.equal(deleted.status, 204, JSON.stringify(deleted.body));
  assert.equal((await remove(bob, alice)).status, 204);
  const [aSocket, bSocket] = sockets;
  assert.ok(aSocket && bSocket);
  assert.deepEqual((await waitForWsType(aSocket.frames, 'dm.conversation.deleted')).payload, { peerId: bob.id });
  assert.deepEqual((await waitForWsType(bSocket.frames, 'dm.conversation.deleted')).payload, { peerId: alice.id });
  assert.equal(
    (await waitForWsType(bSocket.frames, 'call.missed.updated', ({ payload }) => payload.peerUserId === alice.id))
      .payload.count,
    0
  );
  // The cancelled invitation keeps its terminal state for both participants.
  for (const who of [alice, bob]) {
    const status = await request(
      socketPath,
      { pathname: `/api/rings/${ring.body.ring.id}`, cookie: who.cookie },
      RingAnswer
    );
    assert.equal(status.status, 200);
    assert.equal(status.body.ring.state, 'cancelled');
  }
  // The closed call keeps its row for private room cleanup and its dismissal,
  // but its history pointer is gone for both participants.
  for (const who of [alice, bob]) {
    assert.equal((await request(socketPath, { pathname: callUrl, cookie: who.cookie })).status, 404);
    assert.equal(
      (await request(socketPath, { pathname: `/api/call-rings/notification/${call.call.id}`, cookie: who.cookie }))
        .status,
      404
    );
  }
  assert.ok((await pool.query('SELECT 1 FROM room_rings WHERE id = $1', [call.call.id])).rowCount);
  // The server's push worker may already have sent the dismissal; the purge
  // itself removes only the incoming and missed-call pushes.
  assert.equal(
    (
      await pool.query(
        `SELECT 1 FROM ring_delivery_outbox WHERE ring_id = $1 AND kind IN ('call-incoming', 'call-missed')`,
        [call.call.id]
      )
    ).rowCount,
    0
  );

  for (const table of [
    'direct_message_reactions',
    'direct_message_reaction_revisions',
    'direct_message_read_cursors'
  ]) {
    assert.equal((await pool.query(`SELECT 1 FROM ${table}`)).rowCount, 0, table);
  }
  for (const table of ['message_send_idempotency', 'message_delivery_outbox']) {
    assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE message_id = $1`, [id])).rowCount, 0, table);
  }
  // The incoming cue is gone; only stop signals (queued or already sent by the
  // server's worker) are left for the cancelled invitation. Their delivery to
  // both participants is covered in rings-delivery.test.ts.
  const inviteJobs = await pool.query<{ kind: string; revision: number }>(
    'SELECT kind, revision FROM ring_delivery_outbox WHERE ring_id = $1',
    [ring.body.ring.id]
  );
  assert.ok(inviteJobs.rows.every((job) => job.kind === 'terminal' && job.revision === 2));
  assert.deepEqual((await pool.query<{ event_id: string }>('SELECT event_id FROM notification_outbox')).rows, [
    { event_id: 'room-push' }
  ]);
  assert.deepEqual(
    (
      await pool.query<{
        state: string;
        direct_message_id: string | null;
        attachment_order: number | null;
        bound_at: Date | null;
        deleted: boolean;
      }>(
        `SELECT state, direct_message_id, attachment_order, bound_at, deleted_at IS NOT NULL AS deleted
      FROM message_attachments WHERE id = $1`,
        [attachmentId]
      )
    ).rows,
    [{ state: 'deleted', direct_message_id: null, attachment_order: null, bound_at: null, deleted: true }]
  );
  assert.deepEqual((await pool.query<{ body: string }>('SELECT body FROM direct_messages')).rows, [
    { body: 'Keep this' }
  ]);
  assert.deepEqual(
    (await lists(alice)).body.conversations.map(({ peer }) => peer.id),
    [other.id]
  );
  assert.deepEqual((await lists(bob)).body.conversations, []);
  assert.equal((await request(socketPath, { pathname: bob.url, cookie: alice.cookie }, DirectThread)).body.muted, true);

  assert.equal((await send(bob, alice, 'New message')).status, 201);
  const thread = await request(socketPath, { pathname: alice.url, cookie: bob.cookie }, DirectThread);
  assert.deepEqual(
    thread.body.messages.map(({ body }) => body),
    ['New message']
  );
});

test('block preserves history by default and can delete an existing blocked conversation atomically', async (t) => {
  const { pool, socketPath, alice, bob, send, block } = await setup(t);
  await sendFriendRequest(socketPath, alice.cookie, bob.login);
  await acceptFirstFriendRequest(socketPath, bob.cookie);
  assert.equal((await send(alice, bob, 'Keep until requested')).status, 201);
  const calls = createCallRingRepository(pool);
  const call = await calls.start(alice.id, bob.id, randomUUID(), { count: 0, windowMs: 0 });
  assert.equal(call.status, 'created');
  assert.equal((await block(bob, alice, true)).status, 409);
  assert.equal((await pool.query('SELECT 1 FROM user_blocks')).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM friendships')).rowCount, 1);
  assert.equal((await block(bob, alice, false)).status, 200);
  assert.ok((await pool.query('SELECT 1 FROM direct_messages WHERE body = $1', ['Keep until requested'])).rowCount);
  const closed = await calls.update(call.call.id, bob.id, (current, now) => ({
    call: {
      ...current,
      phase: 'closed',
      attemptResult: 'declined',
      endedAt: now,
      endReason: 'declined',
      endedByUserId: bob.id,
      aloneDeadline: null
    },
    result: null
  }));
  assert.equal(closed?.call.phase, 'closed');
  assert.equal((await block(bob, alice, true)).body.status, 'already_blocked');
  assert.equal((await pool.query('SELECT 1 FROM direct_messages')).rowCount, 0);
  assert.equal((await send(alice, bob, 'Still blocked')).body.code, 'relationship_blocked');
});

test('a concurrent send serializes with deletion and deletion cannot reset the stranger cap', async (t) => {
  const { pool, socketPath, alice, bob, account, send, remove } = await setup(t);
  for (let count = 0; count < 3; count++) assert.equal((await send(alice, bob, 'Before deletion')).status, 201);
  assert.equal((await remove(alice, bob)).status, 204);
  assert.equal((await send(alice, bob, 'Cannot reset cap')).body.code, 'unanswered_cap_reached');
  const other = await account('third');
  assert.equal((await send(alice, other, 'Cannot start a new pair')).body.code, 'chat_cap_reached');
  assert.equal((await send(bob, alice, 'Reply')).status, 201);

  const [sent, deleted] = await Promise.all([send(alice, bob, 'Racing send'), remove(bob, alice)]);
  assert.equal(sent.status, 201);
  assert.equal(deleted.status, 204);
  const view = await request(socketPath, { pathname: bob.url, cookie: alice.cookie }, DirectThread);
  const remaining = view.body.messages.map(({ body }) => body);
  assert.ok(remaining.length === 0 || (remaining.length === 1 && remaining[0] === 'Racing send'));
  assert.equal(
    (
      await pool.query(`SELECT 1 FROM message_send_idempotency i
    WHERE NOT EXISTS (SELECT 1 FROM direct_messages m WHERE m.id = i.message_id)`)
    ).rowCount,
    0
  );
  assert.equal(
    (
      await pool.query(`SELECT 1 FROM message_delivery_outbox o
    WHERE NOT EXISTS (SELECT 1 FROM direct_messages m WHERE m.id = o.message_id)`)
    ).rowCount,
    0
  );
});
