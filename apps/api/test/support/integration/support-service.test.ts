// The support service and its repository in process, on a real database: the
// send hook opens and reopens a thread, reading a thread changes nothing,
// marking it read leaves the person's read state alone and reads up to the
// person's last message, resolving needs every message read, answers are
// attributed in the side table and logged, notes and resolves are logged, a
// deleted conversation or a gone account refuses an answer under the pair
// lock, and only `support.reply` gets anywhere. The official account also
// stays out of friendships, blocks, the admin list and the admin numbers.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import type pg from 'pg';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { createFriendStore } from '../../../src/app/friend-store.ts';
import { createSessionRepository } from '../../../src/domains/account/session.repository.ts';
import { SessionIssuanceError } from '../../../src/domains/account/session-proof.ts';
import { createAdminAccountsRepository } from '../../../src/domains/admin/admin-accounts.repository.ts';
import { createAdminActionRepository } from '../../../src/domains/admin/admin-action.repository.ts';
import { createAdminStatsRepository } from '../../../src/domains/admin/admin-stats.repository.ts';
import type { DirectMessagesService } from '../../../src/domains/messaging/direct-messages.service.ts';
import {
  authorizeOfficialReply,
  createDmThreadRepository,
  hasLiveDirectMessage
} from '../../../src/domains/messaging/dm-thread.repository.ts';
import { markThreadRead, recordPersonMessage, resolveThread } from '../../../src/domains/support/support.repository.ts';
import { createSupportService, recordSupportThread } from '../../../src/domains/support/support.service.ts';
import { kyselyOn } from '../../../src/platform/db/kysely.ts';
import { createTestDatabase } from '../../db-harness.ts';

const STAFF = '00000000-0000-4000-8000-0000000000ad';
const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-000000000b0b';

type Opened = { attachmentId: string; variant: string; viewerId: string };

async function setup(t: TestContext, { media = true }: { media?: boolean } = {}) {
  const { pool } = await createTestDatabase(t);
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash) VALUES
      ($1, 'root', 'Root', 'x'), ($2, 'alice', 'Alice', 'x'), ($3, 'bob', 'Bob', 'x')`,
    [STAFF, ALICE, BOB]
  );
  const threads = createDmThreadRepository({ pool });
  const opened = new Array<Opened>();
  // The person's send, with the hook messaging runs in its transaction.
  const write = (senderId: string, recipientId: string, body: string) =>
    threads.sendMessage({
      senderId,
      recipientId,
      body,
      unitOfWork: (client, inserted) => recordSupportThread(client, inserted)
    });
  // Messaging's official send, reduced to what the service relies on: the
  // authorization under the pair lock and the caller's afterInsert.
  const sendAsOfficial: DirectMessagesService['sendAsOfficial'] = async (input) => {
    if (input.body === 'too many') return { status: 'rate_limited', retryAfterSeconds: 5 };
    const message = await threads.sendMessage({
      senderId: OFFICIAL_ACCOUNT_ID,
      recipientId: input.recipientId,
      body: String(input.body),
      beforeUnitOfWork: async (client) => {
        const refusal = await authorizeOfficialReply(kyselyOn(client), input.recipientId);
        if (refusal) throw refusal;
        return null;
      },
      unitOfWork: async (client, inserted) => {
        await input.afterInsert?.(client, inserted);
      }
    });
    return { status: 'sent', message };
  };
  const support = createSupportService({
    pool: () => pool,
    staff: { can: async (userId, permission) => userId === STAFF && permission === 'support.reply' },
    sendAsOfficial,
    hasLiveConversation: (userId) => hasLiveDirectMessage(kyselyOn(pool), userId, OFFICIAL_ACCOUNT_ID),
    projectMedia: async (_context, message) => ({
      ...message,
      attachments:
        message.body === 'с картинкой'
          ? [
              {
                id: 'att-1',
                context: 'dm',
                order: 0,
                mimeType: 'image/webp',
                bytes: 10,
                width: 4,
                height: 3,
                state: 'ready',
                url: '/api/media/attachments/att-1/preview'
              },
              {
                id: 'att-2',
                context: 'dm',
                order: 1,
                mimeType: 'image/webp',
                bytes: null,
                width: null,
                height: null,
                state: 'processing',
                url: null
              }
            ]
          : []
    }),
    visibility: () =>
      media
        ? {
            async open(input: Opened) {
              opened.push(input);
              return {
                bytes: 1,
                extension: 'webp' as const,
                mimeType: 'image/webp' as const,
                stream: Readable.from([])
              };
            }
          }
        : null
  });
  const rows = async <Row extends pg.QueryResultRow>(text: string, values: unknown[] = []) =>
    (await pool.query<Row>(text, values)).rows;
  return { pool, support, write, opened, rows };
}

test('the send hook opens a thread only for a person writing to VoiceRoom, and reopens it', async (t) => {
  const lab = await setup(t);
  await lab.write(ALICE, BOB, 'не в поддержку');
  assert.deepEqual(await lab.rows('SELECT user_id FROM support_threads'), []);
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'Помогите');
  const first = await lab.rows<{ status: string; last_user_message_at: Date }>(
    'SELECT status, last_user_message_at FROM support_threads WHERE user_id = $1',
    [ALICE]
  );
  assert.equal(first[0]?.status, 'open');
  // Nobody has read it yet: it stays open.
  assert.deepEqual(await lab.support.resolve(STAFF, ALICE), { status: 'changed' });
  assert.deepEqual(await lab.support.markRead(STAFF, ALICE), { status: 'read', openUnread: 0 });
  assert.equal((await lab.support.resolve(STAFF, ALICE)).status, 'resolved');
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'Снова');
  assert.deepEqual(
    await lab.rows('SELECT status, resolved_at, resolved_by FROM support_threads WHERE user_id = $1', [ALICE]),
    [{ status: 'open', resolved_at: null, resolved_by: null }]
  );
  // A message from the official account itself records nothing.
  await recordSupportThread(lab.pool, {
    id: 'x',
    senderId: OFFICIAL_ACCOUNT_ID,
    recipientId: OFFICIAL_ACCOUNT_ID,
    body: '',
    createdAt: null,
    editedAt: null,
    readAt: null,
    invite: null
  });
  assert.equal((await lab.rows('SELECT 1 FROM support_threads')).length, 1);
});

test('only support.reply reads, answers, notes, resolves or opens an image', async (t) => {
  const lab = await setup(t);
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'Вопрос');
  for (const result of [
    await lab.support.list(BOB, 'open'),
    await lab.support.unread(BOB),
    await lab.support.read(BOB, ALICE),
    await lab.support.markRead(BOB, ALICE),
    await lab.support.reply(BOB, ALICE, 'Ответ'),
    await lab.support.note(BOB, ALICE, 'Заметка'),
    await lab.support.resolve(BOB, ALICE),
    await lab.support.attachment(BOB, 'att-1', 'preview')
  ])
    assert.equal(result.status, 'forbidden');
  assert.deepEqual(await lab.rows("SELECT 1 FROM admin_actions WHERE action LIKE 'support_%'"), []);
  assert.deepEqual(lab.opened, []);
});

test('a thread is listed, read for staff only, answered as VoiceRoom, noted and resolved', async (t) => {
  const lab = await setup(t);
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'После сна пропадает звук');
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'с картинкой');
  await lab.write(BOB, OFFICIAL_ACCOUNT_ID, 'А у меня микрофон');

  const listed = await lab.support.list(STAFF, 'open');
  assert.ok(listed.status === 'listed');
  assert.deepEqual(listed.counts, { open: 2, resolved: 0 });
  assert.equal(listed.openUnread, 2);
  assert.deepEqual(
    listed.threads.map((thread) => [thread.person.login, thread.unread, thread.lastMessage?.text]).sort(),
    [
      ['alice', true, 'с картинкой'],
      ['bob', true, 'А у меня микрофон']
    ]
  );
  assert.deepEqual(await lab.support.unread(STAFF), { status: 'counted', openUnread: 2 });

  const read = await lab.support.read(STAFF, ALICE);
  assert.ok(read.status === 'read');
  assert.equal(read.person.avatarUrl, null);
  assert.equal(read.personState, 'active');
  assert.equal(read.official.displayName, 'VoiceRoom');
  assert.equal(read.official.avatarColorKey, 'olive');
  assert.equal(read.threadStatus, 'open');
  assert.equal(read.conversationDeleted, false);
  assert.deepEqual(
    read.messages.map((message) => [message.fromPerson, message.body, message.staffName]),
    [
      [true, 'После сна пропадает звук', null],
      [true, 'с картинкой', null]
    ]
  );
  assert.deepEqual(read.messages[1]?.attachments, [
    { id: 'att-1', mimeType: 'image/webp', width: 4, height: 3, url: '/api/admin/support/attachments/att-1/preview' },
    { id: 'att-2', mimeType: 'image/webp', width: null, height: null, url: null }
  ]);
  // Reading the thread has no side effect; marking it read does, for staff only.
  assert.deepEqual(await lab.support.unread(STAFF), { status: 'counted', openUnread: 2 });
  assert.deepEqual(await lab.support.markRead(STAFF, ALICE), { status: 'read', openUnread: 1 });
  assert.deepEqual(await lab.rows('SELECT id FROM direct_messages WHERE read_at IS NOT NULL'), []);
  assert.deepEqual(await lab.support.unread(STAFF), { status: 'counted', openUnread: 1 });

  const replied = await lab.support.reply(STAFF, ALICE, 'Спасибо, чиним');
  assert.ok(replied.status === 'sent');
  assert.equal(replied.message.fromPerson, false);
  assert.equal(replied.message.staffName, 'Root');
  assert.deepEqual(await lab.rows('SELECT staff_id FROM support_replies'), [{ staff_id: STAFF }]);
  assert.deepEqual(await lab.support.reply(STAFF, ALICE, 'too many'), {
    status: 'rate_limited',
    retryAfterSeconds: 5
  });

  assert.deepEqual(await lab.support.note(STAFF, ALICE, '   '), { status: 'empty' });
  const noted = await lab.support.note(STAFF, ALICE, '  Теряется устройство  ');
  assert.ok(noted.status === 'noted');
  assert.equal(noted.note.body, 'Теряется устройство');
  assert.equal(noted.note.authorName, 'Root');

  const resolved = await lab.support.resolve(STAFF, ALICE);
  assert.equal(resolved.status, 'resolved');
  const after = await lab.support.read(STAFF, ALICE);
  assert.ok(after.status === 'read');
  assert.equal(after.threadStatus, 'resolved');
  assert.ok(after.resolvedAt);
  assert.deepEqual(
    after.messages.map((message) => message.staffName),
    [null, null, 'Root']
  );
  assert.deepEqual(
    after.notes.map((note) => note.body),
    ['Теряется устройство']
  );
  const resolvedList = await lab.support.list(STAFF, 'resolved');
  assert.ok(resolvedList.status === 'listed');
  assert.equal(resolvedList.threads[0]?.lastMessage?.fromStaff, true);
  assert.equal(resolvedList.threads[0]?.unread, false);

  const log = await createAdminActionRepository({ pool: lab.pool }).listFor(ALICE);
  assert.deepEqual(
    log.map((entry) => [entry.action, entry.adminName]),
    [
      ['support_resolve', 'Root'],
      ['support_note', 'Root'],
      ['support_reply', 'Root']
    ]
  );
  const subjects = await lab.rows<{ action: string; subject: string | null }>(
    `SELECT action, details->>'subjectId' AS subject FROM admin_actions ORDER BY created_at, id`
  );
  assert.deepEqual(
    subjects.map((row) => [row.action, Boolean(row.subject)]),
    [
      ['support_reply', true],
      ['support_note', true],
      ['support_resolve', false]
    ]
  );
});

test('a deleted conversation keeps notes and status; answering it or a gone account is refused', async (t) => {
  const lab = await setup(t);
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'Помогите');
  assert.equal((await lab.support.note(STAFF, ALICE, 'Важно')).status, 'noted');
  assert.equal(await hasLiveDirectMessage(kyselyOn(lab.pool), ALICE, OFFICIAL_ACCOUNT_ID), true);
  await lab.pool.query('DELETE FROM direct_messages');
  assert.equal(await hasLiveDirectMessage(kyselyOn(lab.pool), ALICE, OFFICIAL_ACCOUNT_ID), false);
  const read = await lab.support.read(STAFF, ALICE);
  assert.ok(read.status === 'read');
  assert.equal(read.conversationDeleted, true);
  assert.deepEqual(read.messages, []);
  assert.deepEqual(
    read.notes.map((note) => note.body),
    ['Важно']
  );
  const listed = await lab.support.list(STAFF, 'open');
  assert.ok(listed.status === 'listed');
  assert.equal(listed.threads[0]?.lastMessage, null);
  await assert.rejects(lab.support.reply(STAFF, ALICE, 'Ау'), { code: 'support_conversation_deleted' });

  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'Снова здесь');
  await lab.pool.query('UPDATE users SET deletion_requested_at = now() WHERE id = $1', [ALICE]);
  await assert.rejects(lab.support.reply(STAFF, ALICE, 'Ау'), { code: 'account_deleted' });
  assert.deepEqual(await lab.rows('SELECT 1 FROM support_replies'), []);
});

test('unknown threads are not found; images open as the official account sees them', async (t) => {
  const lab = await setup(t);
  assert.deepEqual(await lab.support.read(STAFF, BOB), { status: 'not_found' });
  assert.deepEqual(await lab.support.markRead(STAFF, BOB), { status: 'not_found' });
  assert.deepEqual(await lab.support.reply(STAFF, BOB, 'Привет'), { status: 'not_found' });
  assert.deepEqual(await lab.support.note(STAFF, BOB, 'Заметка'), { status: 'not_found' });
  assert.deepEqual(await lab.support.resolve(STAFF, BOB), { status: 'not_found' });
  const image = await lab.support.attachment(STAFF, 'att-1', 'preview');
  assert.equal(image.status, 'opened');
  assert.deepEqual(lab.opened, [{ attachmentId: 'att-1', variant: 'preview', viewerId: OFFICIAL_ACCOUNT_ID }]);
  const withoutMedia = await setup(t, { media: false });
  await assert.rejects(withoutMedia.support.attachment(STAFF, 'att-1', 'preview'), { code: 'media_uploads_disabled' });
});

test('the official account takes no friendship or block, and stays out of the admin list and numbers', async (t) => {
  const lab = await setup(t);
  const friends = createFriendStore({ pool: lab.pool });
  assert.deepEqual(
    await friends.sendRequest({ requesterId: ALICE, addresseeUserId: OFFICIAL_ACCOUNT_ID, addresseeLogin: '' }),
    { status: 'blocked' }
  );
  assert.deepEqual(await friends.blockUser({ userId: ALICE, targetId: OFFICIAL_ACCOUNT_ID }), { status: 'invalid' });
  assert.deepEqual(await friends.blockUser({ userId: OFFICIAL_ACCOUNT_ID, targetId: ALICE }), { status: 'invalid' });
  assert.equal(
    (await friends.searchUsers({ query: 'voice', excludeUserId: ALICE })).some(
      (user) => user.id === OFFICIAL_ACCOUNT_ID
    ),
    false
  );

  // A chat with VoiceRoom never offers a call.
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'Привет');
  const [chat] = await createDmThreadRepository({ pool: lab.pool }).listConversations(ALICE);
  assert.equal(chat?.peer.id, OFFICIAL_ACCOUNT_ID);
  assert.equal(chat?.canCall, false);

  const accounts = await createAdminAccountsRepository({ pool: lab.pool }).list({
    q: '',
    filter: 'all',
    sort: 'created',
    order: 'desc',
    page: 1,
    onlineIds: []
  });
  assert.equal(accounts.total, 3);
  assert.equal(
    accounts.accounts.some((account) => account.id === OFFICIAL_ACCOUNT_ID),
    false
  );
  const stats = createAdminStatsRepository({ pool: lab.pool });
  const overview = await stats.overview();
  assert.equal(overview.accounts, 3);
  assert.equal(overview.newToday, 3);
  const { day } = overview;
  const product = await stats.productDays(day, day);
  assert.equal(product.days[0]?.newAccounts, 3);
  assert.equal(product.accountsBefore, 0);
  assert.equal(await stats.firstAccountDay(), day);
  assert.equal((await stats.retention(1))[0]?.accounts, 3);
});

test('no session is issued to the official account, whatever proof is offered', async (t) => {
  const lab = await setup(t);
  const sessions = createSessionRepository({ pool: lab.pool });
  await assert.rejects(
    sessions.createSession({ credentialProof: { userId: OFFICIAL_ACCOUNT_ID, passwordHash: '!' } }),
    (error: unknown) => error instanceof SessionIssuanceError
  );
  assert.deepEqual(await lab.rows('SELECT 1 FROM sessions'), []);
});

test('reading changes nothing; marking read takes the last message time, not the time of the read', async (t) => {
  const lab = await setup(t);
  const db = kyselyOn(lab.pool);
  // A send that started a minute ago committed only now: its created_at is older than the read.
  const sentAt = new Date(Date.now() - 60_000);
  await recordPersonMessage(db, ALICE, sentAt);
  const before = await lab.rows('SELECT staff_read_at FROM support_threads WHERE user_id = $1', [ALICE]);
  assert.ok((await lab.support.read(STAFF, ALICE)).status === 'read');
  assert.deepEqual(await lab.rows('SELECT staff_read_at FROM support_threads WHERE user_id = $1', [ALICE]), before);
  assert.equal(await markThreadRead(db, ALICE), true);
  const [read] = await lab.rows<{ staff_read_at: Date }>(
    'SELECT staff_read_at FROM support_threads WHERE user_id = $1',
    [ALICE]
  );
  assert.equal(read?.staff_read_at.getTime(), sentAt.getTime());
  // A message that commits after the read, however old its created_at, is unread again.
  await recordPersonMessage(db, ALICE, new Date(sentAt.getTime() + 1));
  assert.deepEqual(await lab.support.unread(STAFF), { status: 'counted', openUnread: 1 });
  assert.equal(await markThreadRead(db, BOB), false);
});

test('a thread with an unread message cannot be resolved; once read it can', async (t) => {
  const lab = await setup(t);
  const db = kyselyOn(lab.pool);
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'Первое');
  await lab.support.markRead(STAFF, ALICE);
  // The person writes again after staff looked.
  await recordPersonMessage(db, ALICE, new Date(Date.now() + 1_000));
  assert.equal(await resolveThread(db, { userId: ALICE, staffId: STAFF }), 'changed');
  assert.deepEqual(await lab.rows('SELECT status FROM support_threads'), [{ status: 'open' }]);
  assert.deepEqual(await lab.rows("SELECT 1 FROM admin_actions WHERE action = 'support_resolve'"), []);
  await lab.support.markRead(STAFF, ALICE);
  const resolved = await resolveThread(db, { userId: ALICE, staffId: STAFF });
  assert.ok(resolved && resolved !== 'changed');
  assert.deepEqual(await lab.rows('SELECT status FROM support_threads'), [{ status: 'resolved' }]);
  assert.equal(await resolveThread(db, { userId: BOB, staffId: STAFF }), null);
});

test('the view says whether the person is active, blocked or deleted', async (t) => {
  const lab = await setup(t);
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'Помогите');
  const state = async () => {
    const read = await lab.support.read(STAFF, ALICE);
    assert.ok(read.status === 'read');
    return read.personState;
  };
  assert.equal(await state(), 'active');
  await lab.pool.query(
    "UPDATE users SET blocked_at = now(), blocked_until = now() - interval '1 minute' WHERE id = $1",
    [ALICE]
  );
  assert.equal(await state(), 'active');
  await lab.pool.query('UPDATE users SET blocked_until = NULL WHERE id = $1', [ALICE]);
  assert.equal(await state(), 'blocked');
  await assert.rejects(lab.support.reply(STAFF, ALICE, 'Ау'), { code: 'account_deleted' });
  await lab.pool.query("UPDATE users SET blocked_until = now() + interval '1 day' WHERE id = $1", [ALICE]);
  assert.equal(await state(), 'blocked');
  await lab.pool.query('UPDATE users SET deletion_requested_at = now() WHERE id = $1', [ALICE]);
  assert.equal(await state(), 'deleted');
  await lab.pool.query(
    'UPDATE users SET deletion_requested_at = NULL, blocked_at = NULL, blocked_until = NULL, deleted_at = now() WHERE id = $1',
    [ALICE]
  );
  assert.equal(await state(), 'deleted');
});

test('the conversation is live while the person has a message, however many answers follow it', async (t) => {
  const lab = await setup(t);
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'Вопрос');
  // More answers than the view lists: the person's message is out of the page, the conversation is not deleted.
  await lab.pool.query(
    `INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at)
      SELECT 'answer-' || n, $1, $2, 'Ответ ' || n, now() + n * interval '1 second' FROM generate_series(1, 200) AS n`,
    [OFFICIAL_ACCOUNT_ID, ALICE]
  );
  const read = await lab.support.read(STAFF, ALICE);
  assert.ok(read.status === 'read');
  assert.equal(read.messages.length, 200);
  assert.equal(
    read.messages.some((message) => message.fromPerson),
    false
  );
  assert.equal(read.conversationDeleted, false);
});

test('without the official account row the view falls back to its name and colour', async (t) => {
  const lab = await setup(t);
  await lab.write(ALICE, OFFICIAL_ACCOUNT_ID, 'Вопрос');
  await lab.pool.query('UPDATE users SET display_name = $2, avatar_key = $3, avatar_accent = $4 WHERE id = $1', [
    OFFICIAL_ACCOUNT_ID,
    'Поддержка',
    'av_official.webp',
    '#c1f100'
  ]);
  const named = await lab.support.read(STAFF, ALICE);
  assert.ok(named.status === 'read');
  assert.deepEqual(named.official, {
    displayName: 'Поддержка',
    avatarUrl: '/api/avatars/av_official.webp',
    avatarColorKey: 'olive',
    avatarAccent: '#c1f100'
  });
  await lab.pool.query('DELETE FROM users WHERE id = $1', [OFFICIAL_ACCOUNT_ID]);
  const fallback = await lab.support.read(STAFF, ALICE);
  assert.ok(fallback.status === 'read');
  assert.deepEqual(fallback.official, {
    displayName: 'VoiceRoom',
    avatarUrl: null,
    avatarColorKey: 'olive',
    avatarAccent: null
  });
});
