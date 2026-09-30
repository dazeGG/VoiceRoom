// Replies over a migrated database: a reply points at its target, the preview
// names the author as they are now, a DM target is only found between its two
// users, and a missing or deleted target becomes a tombstone.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { createReplyRepository } from '../src/domains/messaging/reply.repository.ts';
import { createContentRepository } from '../src/domains/messaging/content.repository.ts';
import { transaction } from '../src/platform/db/pool.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

async function setup(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash)
     VALUES ('ada', 'ada', 'Ада', 'x'), ('bob', 'bob', '', 'x'), ('eve', 'eve', 'Eve', 'x');
     INSERT INTO rooms (id, is_static) VALUES ('room-1', true);
     INSERT INTO room_messages (id, room_id, text, author_user_id) VALUES ('from-ada', 'room-1', 'привет', 'ada');
     INSERT INTO room_messages (id, room_id, peer_id, name, text) VALUES ('from-guest', 'room-1', 'peer-1', 'Гость', 'hi');
     INSERT INTO direct_messages (id, sender_id, recipient_id, body) VALUES ('dm-1', 'bob', 'ada', 'как дела');`
  );
  return { pool, replies: createReplyRepository({ client: pool }) };
}

test('a room reply points at its target, and the preview names the author as they are now', { skip }, async (t) => {
  const { pool, replies } = await setup(t);
  const reply = await replies.insertRoomReply({
    roomId: 'room-1',
    targetMessageId: 'from-ada',
    message: {
      id: 'reply-1',
      peerId: 'peer-2',
      authorUserId: 'eve',
      name: 'Stale name',
      text: 'ответ',
      createdAt: 1_000
    }
  });
  assert.deepEqual(
    [reply?.id, reply?.replyTo?.messageId, reply?.name, reply?.text],
    ['reply-1', 'from-ada', '', 'ответ'],
    'an account reply keeps no name snapshot'
  );
  assert.equal(new Date(reply?.createdAt as Date).getTime(), 1_000);
  const guest = await replies.insertRoomReply({
    roomId: 'room-1',
    targetMessageId: 'from-guest',
    message: { peerId: 'peer-3', name: 'Гость 2', text: 'и я' }
  });
  assert.equal(guest?.name, 'Гость 2');

  await pool.query(`UPDATE users SET display_name = 'Ада Л.' WHERE id = 'ada'`);
  assert.deepEqual(await replies.getRoomPreview({ roomId: 'room-1', messageId: 'from-ada' }), {
    messageId: 'from-ada',
    deleted: false,
    author: { id: 'ada', name: 'Ада Л.' },
    text: 'привет'
  });
  assert.equal((await replies.getRoomPreview({ roomId: 'room-1', messageId: 'from-guest' }))?.author?.name, 'Гость');
  assert.equal((await replies.getRoomPreview({ roomId: 'room-1', messageId: 'missing' }))?.deleted, true);

  await pool.query(`UPDATE room_messages SET deleted_at = now() WHERE id = 'from-ada'`);
  assert.equal((await replies.getRoomPreview({ roomId: 'room-1', messageId: 'from-ada' }))?.deleted, true);

  await transaction(pool, async (client) => {
    const locked = await replies.lockRoomTarget({ roomId: 'room-1', messageId: 'from-guest', client });
    assert.equal(locked?.name, 'Гость');
    assert.equal(await replies.lockRoomTarget({ roomId: 'other-room', messageId: 'from-guest', client }), null);
  });
});

test('a direct reply target is only found between its two users', { skip }, async (t) => {
  const { pool, replies } = await setup(t);
  const reply = await replies.insertDirectReply({
    id: 'dm-2',
    senderId: 'ada',
    recipientId: 'bob',
    targetMessageId: 'dm-1',
    body: 'хорошо'
  });
  assert.deepEqual([reply?.id, reply?.replyTo?.messageId, reply?.invite], ['dm-2', 'dm-1', null]);

  const preview = await replies.getDirectPreview({ userId: 'ada', peerId: 'bob', messageId: 'dm-1' });
  assert.deepEqual([preview?.deleted, preview?.author?.name, preview?.text], [false, 'bob', 'как дела']);
  assert.equal((await replies.getDirectPreview({ userId: 'bob', peerId: 'ada', messageId: 'dm-1' }))?.deleted, false);
  assert.equal(
    (await replies.getDirectPreview({ userId: 'eve', peerId: 'ada', messageId: 'dm-1' }))?.deleted,
    true,
    'someone else cannot quote the thread'
  );

  await transaction(pool, async (client) => {
    assert.equal(
      (await replies.lockDirectTarget({ userId: 'ada', peerId: 'bob', messageId: 'dm-1', client }))?.body,
      'как дела'
    );
    assert.equal(await replies.lockDirectTarget({ userId: 'ada', peerId: 'eve', messageId: 'dm-1', client }), null);
  });
  await assert.rejects(
    () => createReplyRepository().getRoomPreview({ roomId: 'room-1', messageId: 'x' }),
    /query client/
  );
});

test('editing structured content rewrites the text and marks the message edited', { skip }, async (t) => {
  const { pool } = await setup(t);
  const content = createContentRepository();
  const updated = await transaction(pool, (client) =>
    content.update({ client, messageId: 'from-ada', text: 'новый текст' })
  );
  assert.equal(updated?.text, 'новый текст');
  assert.ok(updated?.edited_at);
  assert.deepEqual((updated?.content as { version?: number } | null)?.version, 1);
  await pool.query(`UPDATE room_messages SET deleted_at = now() WHERE id = 'from-guest'`);
  assert.equal(
    await transaction(pool, (client) => content.update({ client, messageId: 'from-guest', text: 'x' })),
    null,
    'a deleted message is not edited'
  );
});
