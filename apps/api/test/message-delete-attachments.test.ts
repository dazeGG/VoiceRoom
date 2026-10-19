// Deleting a message takes its attachments with it: the author deleting a room
// or direct message, and the service operator removing a reported direct
// message, mark the message's attachments deleted and queue their cleanup in
// the deletion's own transaction. The maintenance worker then removes the
// files, and the sender's quota stops counting them at once.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { Me, SignedIn } from '@voice-room/shared/contracts/account';
import { AdminReportPage } from '@voice-room/shared/contracts/reports';
import { DirectMessageAnswer, RoomMessageAnswer } from '@voice-room/shared/contracts/messages';
import { RoomCreated } from '@voice-room/shared/contracts/rooms';
import { createAttachmentRepository } from '../src/domains/media/attachment.repository.ts';
import { revokeMessageAttachments } from '../src/domains/media/attachment-revocation.service.ts';
import { createDmThreadRepository } from '../src/domains/messaging/dm-thread.repository.ts';
import { createRoomChatRepository } from '../src/domains/messaging/room-chat.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { hashPassword } from '../src/lib/password.ts';
import { kyselyOn } from '../src/platform/db/kysely.ts';
import { createTestDatabase } from './db-harness.ts';
import {
  acceptFirstFriendRequest,
  cookieFrom,
  registerAccount,
  request,
  sendFriendRequest,
  startApiServer
} from './fakes/server-process.ts';

const skip = !process.env.TEST_DATABASE_URL;
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const BYTES = 1000;

async function setup(t: TestContext) {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-media-'));
  t.after(() => fs.rmSync(storageDir, { recursive: true, force: true }));
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-message-delete-',
    env: { AUTH_RATE_LIMIT: '0', MEDIA_STORAGE_DIR: storageDir, PLATFORM_ADMIN_USER_IDS: ADMIN_ID }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());

  const alice = await registerAccount(socketPath, 'alice');
  const bob = await registerAccount(socketPath, 'bob');
  const idOf = async (cookie: string) => {
    const user = (await request(socketPath, { pathname: '/api/auth/me', cookie }, Me)).body.user;
    assert.ok(user);
    return user.id;
  };
  const aliceId = await idOf(alice);
  const bobId = await idOf(bob);
  await sendFriendRequest(socketPath, alice, 'bob');
  await acceptFirstFriendRequest(socketPath, bob);

  // A processed upload of Alice's, ready to be bound to a message.
  const readyAttachment = async (context: 'room' | 'dm') => {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO message_attachments (id, owner_id, context, state, mime_type, original_bytes, processed_bytes,
         preview_bytes, width, height, original_storage_key, processed_storage_key, preview_storage_key, ready_at)
       VALUES ($1::uuid, $2, $3, 'ready', 'image/jpeg', $4, 8, 4, 2, 2, $1::text || '/original',
         $1::text || '/processed', $1::text || '/preview', current_timestamp)`,
      [id, aliceId, context, BYTES]
    );
    return id;
  };
  const stored = async (attachmentId: string) => ({
    state: (await pool.query<{ state: string }>(`SELECT state FROM message_attachments WHERE id = $1`, [attachmentId]))
      .rows[0]?.state,
    jobs: (
      await pool.query<{ kind: string }>(`SELECT kind FROM media_processing_jobs WHERE attachment_id = $1`, [
        attachmentId
      ])
    ).rows.map((row) => row.kind)
  });
  const attachments = createAttachmentRepository({ pool });
  const usedBytes = async () => (await attachments.quotaUsage(aliceId)).usedBytes;

  const sendDm = async (attachmentId: string) => {
    const sent = await request(
      socketPath,
      {
        method: 'POST',
        pathname: `/api/dm/${bobId}`,
        cookie: alice,
        body: { text: 'look', attachmentIds: [attachmentId] }
      },
      DirectMessageAnswer
    );
    assert.equal(sent.status, 201);
    return sent.body.message.id;
  };

  return { socketPath, pool, alice, bob, aliceId, bobId, readyAttachment, stored, usedBytes, sendDm };
}

test('the author deleting a room message deletes its attachment and queues its cleanup', { skip }, async (t) => {
  const { socketPath, alice, readyAttachment, stored, usedBytes } = await setup(t);
  const room = await request(
    socketPath,
    { method: 'POST', pathname: '/api/rooms', cookie: alice, body: { isStatic: true, name: 'files' } },
    RoomCreated
  );
  assert.equal(room.status, 201);
  const attachmentId = await readyAttachment('room');
  const sent = await request(
    socketPath,
    {
      method: 'POST',
      pathname: `/api/rooms/${room.body.roomId}/chat`,
      cookie: alice,
      body: { text: 'look', attachmentIds: [attachmentId] }
    },
    RoomMessageAnswer
  );
  assert.equal(sent.status, 201);
  assert.equal(await usedBytes(), BYTES);

  const removed = await request(socketPath, {
    method: 'DELETE',
    pathname: `/api/rooms/${room.body.roomId}/chat/${sent.body.message.id}`,
    cookie: alice
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(await stored(attachmentId), { state: 'deleted', jobs: ['cleanup'] });
  assert.equal(await usedBytes(), 0);
});

test('the sender deleting a direct message deletes its attachment and frees the quota', { skip }, async (t) => {
  const { socketPath, alice, bobId, readyAttachment, stored, usedBytes, sendDm } = await setup(t);
  const attachmentId = await readyAttachment('dm');
  const messageId = await sendDm(attachmentId);
  assert.equal(await usedBytes(), BYTES);

  const removed = await request(socketPath, {
    method: 'DELETE',
    pathname: `/api/dm/${bobId}/messages/${messageId}`,
    cookie: alice
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(await stored(attachmentId), { state: 'deleted', jobs: ['cleanup'] });
  assert.equal(await usedBytes(), 0);
});

test('the operator removing a reported direct message deletes its attachment', { skip }, async (t) => {
  const { socketPath, pool, bob, readyAttachment, stored, usedBytes, sendDm } = await setup(t);
  const attachmentId = await readyAttachment('dm');
  const messageId = await sendDm(attachmentId);
  const reported = await request(socketPath, {
    method: 'POST',
    pathname: '/api/reports',
    cookie: bob,
    body: { target: { kind: 'direct_message', messageId }, reason: 'spam' }
  });
  assert.equal(reported.status, 201);

  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ADMIN_ID,
    await hashPassword('password123')
  ]);
  const signedIn = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login: 'root', password: 'password123' }
    },
    SignedIn
  );
  assert.equal(signedIn.status, 200);
  const admin = cookieFrom(signedIn.setCookie);
  const open = await request(socketPath, { pathname: '/api/admin/reports', cookie: admin }, AdminReportPage);
  const report = open.body.reports[0];
  assert.ok(report);
  const resolved = await request(socketPath, {
    method: 'POST',
    pathname: `/api/admin/reports/${report.id}/resolve`,
    cookie: admin,
    body: { action: 'remove_message' }
  });
  assert.equal(resolved.status, 200);
  assert.deepEqual(await stored(attachmentId), { state: 'deleted', jobs: ['cleanup'] });
  assert.equal(await usedBytes(), 0);
});

test('a failing cleanup keeps the message and its attachment as they were', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} } });
  await pool.query(`
    INSERT INTO users (id, login, display_name, password_hash) VALUES ('owner', 'owner', 'Owner', 'x'), ('peer', 'peer', 'Peer', 'x');
    INSERT INTO rooms (id, is_static) VALUES ('room', true);
    INSERT INTO room_messages (id, room_id, text) VALUES ('room-message', 'room', 'file');
    INSERT INTO direct_messages (id, sender_id, recipient_id, body) VALUES ('dm-message', 'owner', 'peer', 'file');
    INSERT INTO message_attachments (id, owner_id, context, state, room_message_id, attachment_order, bound_at)
      VALUES ('${crypto.randomUUID()}', 'owner', 'room', 'processing', 'room-message', 0, current_timestamp);
    INSERT INTO message_attachments (id, owner_id, context, state, direct_message_id, attachment_order, bound_at)
      VALUES ('${crypto.randomUUID()}', 'owner', 'dm', 'processing', 'dm-message', 0, current_timestamp)`);
  const attachments = createAttachmentRepository({ pool });
  const failingJobs = {
    async enqueue(): Promise<null> {
      throw new Error('queue unavailable');
    }
  };
  const revoke = (context: 'room' | 'dm', messageId: string) => (client: Pick<PoolClient, 'query'>) =>
    revokeMessageAttachments({ attachments, jobs: failingJobs, context, messageId, client });

  const room = createRoomChatRepository({ db: kyselyOn(pool), pool });
  await assert.rejects(
    room.softDeleteMessage('room', 'room-message', { unitOfWork: revoke('room', 'room-message') }),
    /queue unavailable/
  );
  const dm = createDmThreadRepository({ pool });
  await assert.rejects(
    dm.softDeleteMessage('dm-message', { unitOfWork: revoke('dm', 'dm-message') }),
    /queue unavailable/
  );

  const kept = await pool.query<{ deleted: boolean }>(`
    SELECT deleted_at IS NOT NULL AS deleted FROM room_messages
    UNION ALL SELECT deleted_at IS NOT NULL FROM direct_messages`);
  assert.deepEqual(
    kept.rows.map((row) => row.deleted),
    [false, false]
  );
  const states = await pool.query<{ state: string }>(`SELECT state FROM message_attachments`);
  assert.deepEqual(
    states.rows.map((row) => row.state),
    ['processing', 'processing']
  );
});
