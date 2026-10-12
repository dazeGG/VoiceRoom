// A history page over a migrated database carries each message's attachments,
// reply quote and reactions, and reads them for the whole page at once: a
// longer page costs no more queries than a short one.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type pg from 'pg';

import { createAttachmentRepository } from '../src/domains/media/attachment.repository.ts';
import { createHistoryModule } from '../src/domains/messaging/history.module.ts';
import { createMessageProjection } from '../src/domains/messaging/message-projection.ts';
import { createReactionRepository } from '../src/domains/messaging/reaction.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

async function setup(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash) VALUES ('ada', 'ada', 'Ада', 'x'), ('bob', 'bob', 'Боб', 'x');
     INSERT INTO friendships (id, user_a_id, user_b_id) VALUES ('f1', 'ada', 'bob');
     INSERT INTO rooms (id, is_static) VALUES ('room-1', true);
     INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at)
     SELECT 'dm-' || n, CASE WHEN n % 2 = 0 THEN 'ada' ELSE 'bob' END, CASE WHEN n % 2 = 0 THEN 'bob' ELSE 'ada' END,
            'сообщение ' || n, now() - (20 - n) * interval '1 minute'
     FROM generate_series(1, 11) AS n;
     INSERT INTO direct_messages (id, sender_id, recipient_id, body, reply_to_message_id)
     VALUES ('dm-12', 'ada', 'bob', 'сообщение 12', 'dm-11');
     INSERT INTO room_messages (id, room_id, text, author_user_id, created_at)
     SELECT 'm' || n, 'room-1', 'сообщение ' || n, 'ada', now() - (20 - n) * interval '1 minute'
     FROM generate_series(1, 11) AS n;
     INSERT INTO room_messages (id, room_id, text, author_user_id, reply_to_message_id)
     VALUES ('m12', 'room-1', 'сообщение 12', 'ada', 'm11');`
  );
  const attachmentId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO message_attachments (id, owner_id, context, state, mime_type, original_bytes, processed_bytes,
       preview_bytes, width, height, original_storage_key, processed_storage_key, preview_storage_key, ready_at,
       bound_at, room_message_id, attachment_order)
     VALUES ($1::uuid, 'ada', 'room', 'ready', 'image/jpeg', 10, 8, 4, 2, 2, $1::text || '/original',
       $1::text || '/processed', $1::text || '/preview', now(), now(), 'm12', 0)`,
    [attachmentId]
  );
  const reactions = createReactionRepository({ client: pool });
  const react = (type: string, messageId: string, emoji: string, userId: string) =>
    reactions.transaction((client) =>
      reactions.setDesiredState({ type, messageId, emoji, userId, active: true, client })
    );
  await react('room', 'm12', '👍', 'ada');
  await react('room', 'm12', '👍', 'bob');
  await react('room', 'm10', '🎉', 'bob');
  await react('dm', 'dm-12', '❤️', 'bob');

  // Counts every query the page makes; without idleCount it is not taken for a pool.
  let queries = 0;
  const counted = {
    query: (...args: Parameters<pg.Pool['query']>) => {
      queries += 1;
      return (pool.query as (...input: unknown[]) => unknown)(...args);
    }
  } as unknown as pg.Pool;
  const attachments = createAttachmentRepository({ pool: counted });
  const projection = createMessageProjection({ attachments: () => attachments, replies: () => null });
  const history = createHistoryModule({
    pool: counted,
    cursorCodec: createCursorCodec({ keys: ['h'.repeat(32)] }),
    projectMediaMany: projection.projectMediaMany,
    canReadRoom: async () => true
  });
  return {
    attachmentId,
    history,
    queriesFor: async (run: () => Promise<unknown>) => {
      queries = 0;
      await run();
      return queries;
    }
  };
}

test('a room page carries attachments, quotes and reactions read once per page', { skip }, async (t) => {
  const { attachmentId, history, queriesFor } = await setup(t);
  const read = (limit: number) =>
    history.room.getPage({
      roomId: 'room-1',
      query: { limit: String(limit) },
      access: { authorized: true, userId: 'ada' }
    });

  const page = await read(12);
  const byId = new Map(page.messages.map((message) => [message.id, message]));
  assert.equal(page.messages.length, 12);
  assert.deepEqual(
    byId.get('m12')?.attachments?.map((attachment) => attachment.id),
    [attachmentId]
  );
  assert.deepEqual(byId.get('m12')?.replyPreview, {
    messageId: 'm11',
    deleted: false,
    author: { id: 'ada', name: 'Ада' },
    text: 'сообщение 11'
  });
  assert.deepEqual(
    byId.get('m12')?.reactions?.map(({ emoji, count, reactedByMe }) => [emoji, count, reactedByMe]),
    [['👍', 2, true]]
  );
  assert.deepEqual(
    byId.get('m10')?.reactions?.map(({ emoji, reactedByMe }) => [emoji, reactedByMe]),
    [['🎉', false]]
  );
  assert.deepEqual(byId.get('m1')?.reactions, []);
  assert.deepEqual(byId.get('m1')?.attachments, []);
  assert.equal(byId.get('m1')?.replyPreview, undefined);

  assert.equal(await queriesFor(() => read(12)), await queriesFor(() => read(3)));
});

test('a DM page carries quotes and reactions read once per page', { skip }, async (t) => {
  const { history, queriesFor } = await setup(t);
  const read = (limit: number) => history.dm.getPage({ userId: 'ada', peerId: 'bob', query: { limit: String(limit) } });

  const page = await read(12);
  const last = page.messages.at(-1);
  assert.equal(last?.id, 'dm-12');
  assert.equal(last?.replyPreview?.messageId, 'dm-11');
  assert.equal(last?.replyPreview?.deleted, false);
  assert.deepEqual(
    last?.reactions?.map(({ emoji, count, reactedByMe }) => [emoji, count, reactedByMe]),
    [['❤️', 1, false]]
  );

  assert.equal(await queriesFor(() => read(12)), await queriesFor(() => read(3)));
});
