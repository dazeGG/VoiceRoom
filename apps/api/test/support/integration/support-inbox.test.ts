// The admin app's support inbox against a real server: a person's message to
// VoiceRoom opens a thread, reading it changes nothing, staff mark it read
// without touching the person's read state, answer as VoiceRoom (live event,
// notification and push, no staff identity anywhere in the payload; a retried
// answer is sent once), leave notes and resolve; the next message reopens it.
// Every route needs `support.reply`; every staff action is logged; after the
// person deletes the conversation the thread keeps its status and notes and
// answering is refused.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Pool } from 'pg';
import { Type } from 'typebox';
import { SignedIn } from '@voiceroom/shared/contracts/account';
import { AccountDetail } from '@voiceroom/shared/contracts/admin';
import {
  SupportNoted,
  SupportRead,
  SupportReplied,
  SupportResolved,
  SupportThread,
  SupportThreadList,
  SupportUnread
} from '@voiceroom/shared/contracts/support';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { hashPassword } from '../../../src/lib/password.ts';
import { cookieFrom, request, startApiServer } from '../../fakes/server-process.ts';
import { checked } from '../../helpers/checked.ts';
import { staffCookie } from '../../staff-session.ts';
import { openWs, waitForWsType } from '../../ws-harness.ts';

const ROOT_ID = '00000000-0000-4000-8000-0000000000ad';
const SECOND_ID = '00000000-0000-4000-8000-0000000000ae';

type Account = { id: string; cookie: string };

async function setup(t: test.TestContext, env: Record<string, string> = {}) {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-support-',
    env: { AUTH_RATE_LIMIT: '0', DM_RATE_LIMIT: '0', PLATFORM_ADMIN_USER_IDS: `${ROOT_ID},${SECOND_ID}`, ...env }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  async function account(login: string): Promise<Account> {
    const response = await request(
      socketPath,
      {
        method: 'POST',
        pathname: '/api/auth/register',
        body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
      },
      SignedIn
    );
    assert.equal(response.status, 201);
    return { id: response.body.user.id, cookie: cookieFrom(response.setCookie) };
  }
  async function staff(id: string, login: string, displayName: string, role: string | null = null) {
    await pool.query(
      `INSERT INTO users (id, login, display_name, password_hash, staff_role) VALUES ($1, $2, $3, $4, $5)`,
      [id, login, displayName, await hashPassword('password123'), role]
    );
    const signedIn = await request(socketPath, {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login, password: 'password123' }
    });
    return staffCookie(socketPath, cookieFrom(signedIn.setCookie));
  }
  const write = (from: Account, text: string) =>
    request(socketPath, {
      method: 'POST',
      pathname: `/api/dm/${OFFICIAL_ACCOUNT_ID}`,
      cookie: from.cookie,
      body: { text }
    });
  const support = (cookie: string, path: string, body?: object) =>
    request(socketPath, {
      method: body ? 'POST' : 'GET',
      pathname: `/api/admin/support/${path}`,
      cookie,
      body
    });
  const actions = async () =>
    (
      await pool.query<{ action: string; admin_user_id: string; target_user_id: string }>(
        `SELECT action, admin_user_id, target_user_id FROM admin_actions WHERE action LIKE 'support_%' ORDER BY created_at, id`
      )
    ).rows;
  return { socketPath, pool, account, staff, write, support, actions };
}

test('the official account gets the brand avatar as an ordinary avatar file', async (t) => {
  const lab = await setup(t);
  const { rows } = await lab.pool.query<{ avatar_key: string | null; avatar_accent: string | null }>(
    'SELECT avatar_key, avatar_accent FROM users WHERE id = $1',
    [OFFICIAL_ACCOUNT_ID]
  );
  const key = rows[0]?.avatar_key ?? '';
  assert.match(key, new RegExp(`^av_${OFFICIAL_ACCOUNT_ID}_[0-9a-f]{8}\\.webp$`));
  assert.ok(rows[0]?.avatar_accent);
  const image = await request(lab.socketPath, { pathname: `/api/avatars/${key}` }, Type.Unknown());
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/webp');
});

test('a person writes, staff read, answer as VoiceRoom, note, resolve, and the next message reopens', async (t) => {
  const lab = await setup(t);
  const root = await lab.staff(ROOT_ID, 'root', 'Root');
  const alice = await lab.account('alice');
  const aliceWs = openWs(lab.socketPath, { cookie: alice.cookie });
  t.after(() => aliceWs.ws.close());
  await aliceWs.ready;

  assert.equal((await lab.write(alice, 'После сна пропадает звук')).status, 201);
  assert.deepEqual((await lab.support(root, 'unread')).body, { ok: true, openUnread: 1 });
  const open = await request(
    lab.socketPath,
    { pathname: '/api/admin/support/threads?status=open', cookie: root },
    SupportThreadList
  );
  assert.deepEqual(open.body.counts, { open: 1, resolved: 0 });
  assert.equal(open.body.openUnread, 1);
  const [summary] = open.body.threads;
  assert.equal(summary?.person.id, alice.id);
  assert.equal(summary?.unread, true);
  assert.deepEqual(summary?.lastMessage && { ...summary.lastMessage, at: 0 }, {
    text: 'После сна пропадает звук',
    at: 0,
    fromStaff: false,
    hasAttachments: false
  });

  // Reading the thread changes nothing; staff mark it read on their own.
  const read = await request(
    lab.socketPath,
    { pathname: `/api/admin/support/threads/${alice.id}`, cookie: root },
    SupportThread
  );
  assert.equal(read.status, 200);
  assert.equal(read.body.status, 'open');
  assert.equal(read.body.conversationDeleted, false);
  assert.deepEqual(
    read.body.messages.map((message) => [message.fromPerson, message.body, message.staffName]),
    [[true, 'После сна пропадает звук', null]]
  );
  const unread = await lab.pool.query<{ id: string }>(
    'SELECT id FROM direct_messages WHERE recipient_id = $1 AND read_at IS NULL',
    [OFFICIAL_ACCOUNT_ID]
  );
  assert.equal(unread.rowCount, 1);
  const staffRead = async () =>
    (await lab.pool.query<{ at: Date | null }>('SELECT staff_read_at AS at FROM support_threads')).rows[0]?.at ?? null;
  assert.equal(await staffRead(), null);
  assert.deepEqual(
    (await request(lab.socketPath, { pathname: '/api/admin/support/unread', cookie: root }, SupportUnread)).body,
    { ok: true, openUnread: 1 }
  );
  // Marking it read is for staff only: the person's message stays unread by VoiceRoom.
  const marked = await request(
    lab.socketPath,
    { method: 'POST', pathname: `/api/admin/support/threads/${alice.id}/read`, cookie: root, body: {} },
    SupportRead
  );
  assert.deepEqual(marked.body, { ok: true, openUnread: 0 });
  assert.ok(await staffRead());
  assert.equal(
    (
      await lab.pool.query('SELECT id FROM direct_messages WHERE recipient_id = $1 AND read_at IS NULL', [
        OFFICIAL_ACCOUNT_ID
      ])
    ).rowCount,
    1
  );
  assert.equal(
    aliceWs.frames.some((frame) => frame.type === 'dm.read'),
    false
  );
  assert.deepEqual(
    (await request(lab.socketPath, { pathname: '/api/admin/support/unread', cookie: root }, SupportUnread)).body,
    {
      ok: true,
      openUnread: 0
    }
  );

  // The answer reaches the person at once as VoiceRoom; the staff member stays out of every payload.
  const replied = await request(
    lab.socketPath,
    {
      method: 'POST',
      pathname: `/api/admin/support/threads/${alice.id}/reply`,
      cookie: root,
      body: { text: 'Спасибо, чиним' }
    },
    SupportReplied
  );
  assert.equal(replied.status, 200);
  assert.equal(replied.body.message.fromPerson, false);
  assert.equal(replied.body.message.staffName, 'Root');
  const live = await waitForWsType(
    aliceWs.frames,
    'dm.message',
    (frame) => frame.payload.message.body === 'Спасибо, чиним'
  );
  assert.equal(live.payload.message.senderId, OFFICIAL_ACCOUNT_ID);
  const notice = await waitForWsType(aliceWs.frames, 'notification.dm.message');
  assert.equal(notice.payload.peer.id, OFFICIAL_ACCOUNT_ID);
  for (const frame of [live, notice]) {
    const text = JSON.stringify(frame);
    assert.equal(text.includes(ROOT_ID), false);
    assert.equal(text.includes('Root'), false);
    assert.equal(text.includes('staff'), false);
  }
  const outbox = await lab.pool.query<{ payload: unknown }>('SELECT payload FROM message_delivery_outbox');
  assert.equal(JSON.stringify(outbox.rows).includes(ROOT_ID), false);
  const thread = await request(lab.socketPath, { pathname: `/api/dm/${OFFICIAL_ACCOUNT_ID}`, cookie: alice.cookie });
  assert.equal(JSON.stringify(thread.body).includes(ROOT_ID), false);
  const attributed = await lab.pool.query<{ staff_id: string }>('SELECT staff_id FROM support_replies');
  assert.equal(attributed.rows[0]?.staff_id, ROOT_ID);

  const noted = await request(
    lab.socketPath,
    {
      method: 'POST',
      pathname: `/api/admin/support/threads/${alice.id}/notes`,
      cookie: root,
      body: { text: '  Теряется устройство вывода  ' }
    },
    SupportNoted
  );
  assert.equal(noted.body.note.body, 'Теряется устройство вывода');
  assert.equal(noted.body.note.authorName, 'Root');
  const resolved = await request(
    lab.socketPath,
    { method: 'POST', pathname: `/api/admin/support/threads/${alice.id}/resolve`, cookie: root, body: {} },
    SupportResolved
  );
  assert.equal(resolved.body.status, 'resolved');
  const afterResolve = await request(
    lab.socketPath,
    { pathname: '/api/admin/support/threads?status=resolved', cookie: root },
    SupportThreadList
  );
  assert.deepEqual(afterResolve.body.counts, { open: 0, resolved: 1 });
  assert.equal(afterResolve.body.threads[0]?.lastMessage?.fromStaff, true);

  // AC-A6: the person writes again and the thread is open and unread again.
  assert.equal((await lab.write(alice, 'Снова пропал')).status, 201);
  const reopened = await request(
    lab.socketPath,
    { pathname: '/api/admin/support/threads', cookie: root },
    SupportThreadList
  );
  assert.deepEqual(reopened.body.counts, { open: 1, resolved: 0 });
  assert.equal(reopened.body.threads[0]?.unread, true);
  const state = await lab.pool.query<{ status: string; resolved_at: Date | null; resolved_by: string | null }>(
    'SELECT status, resolved_at, resolved_by FROM support_threads WHERE user_id = $1',
    [alice.id]
  );
  assert.deepEqual(state.rows, [{ status: 'open', resolved_at: null, resolved_by: null }]);

  // AC-A7: every staff action is in the log.
  assert.deepEqual(
    (await lab.actions()).map((row) => [row.action, row.admin_user_id, row.target_user_id]),
    [
      ['support_reply', ROOT_ID, alice.id],
      ['support_note', ROOT_ID, alice.id],
      ['support_resolve', ROOT_ID, alice.id]
    ]
  );
  const card = await request(
    lab.socketPath,
    { pathname: `/api/admin/accounts/${alice.id}`, cookie: root },
    AccountDetail
  );
  assert.deepEqual(
    card.body.actions.map((entry) => entry.action),
    ['support_resolve', 'support_note', 'support_reply']
  );
});

test('notes and status survive the person deleting the conversation; answering is refused afterwards', async (t) => {
  const lab = await setup(t);
  const root = await lab.staff(ROOT_ID, 'root', 'Root');
  const alice = await lab.account('alice');
  assert.equal((await lab.write(alice, 'Помогите')).status, 201);
  assert.equal((await lab.support(root, `threads/${alice.id}/reply`, { text: 'Слушаем' })).status, 200);
  assert.equal((await lab.support(root, `threads/${alice.id}/notes`, { text: 'Важно' })).status, 200);
  assert.equal((await lab.support(root, `threads/${alice.id}/resolve`, {})).status, 200);

  const deleted = await request(lab.socketPath, {
    method: 'DELETE',
    pathname: `/api/dm/${OFFICIAL_ACCOUNT_ID}`,
    cookie: alice.cookie
  });
  assert.equal(deleted.status, 204);
  assert.equal((await lab.pool.query('SELECT 1 FROM support_replies')).rowCount, 0);

  const view = await request(
    lab.socketPath,
    { pathname: `/api/admin/support/threads/${alice.id}`, cookie: root },
    SupportThread
  );
  assert.equal(view.body.status, 'resolved');
  assert.equal(view.body.conversationDeleted, true);
  assert.deepEqual(view.body.messages, []);
  assert.deepEqual(
    view.body.notes.map((note) => note.body),
    ['Важно']
  );
  const listed = await request(
    lab.socketPath,
    { pathname: '/api/admin/support/threads?status=resolved', cookie: root },
    SupportThreadList
  );
  assert.equal(listed.body.threads[0]?.lastMessage, null);
  const refused = await lab.support(root, `threads/${alice.id}/reply`, { text: 'Вы тут?' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'support_conversation_deleted');
  assert.equal((await lab.pool.query('SELECT 1 FROM direct_messages')).rowCount, 0);
});

test('every support route needs support.reply; unknown threads and empty text are refused', async (t) => {
  const lab = await setup(t);
  const root = await lab.staff(ROOT_ID, 'root', 'Root');
  const admin = await lab.staff('00000000-0000-4000-8000-0000000000af', 'boss', 'Boss', 'admin');
  const moderator = await lab.staff('00000000-0000-4000-8000-0000000000b0', 'mod', 'Mod', 'moderator');
  const alice = await lab.account('alice');
  assert.equal((await lab.write(alice, 'Вопрос')).status, 201);
  const routes: Array<[string, object | undefined]> = [
    ['threads', undefined],
    ['threads?status=resolved', undefined],
    ['unread', undefined],
    [`threads/${alice.id}`, undefined],
    [`threads/${alice.id}/read`, {}],
    [`threads/${alice.id}/reply`, { text: 'Ответ' }],
    [`threads/${alice.id}/notes`, { text: 'Заметка' }],
    [`threads/${alice.id}/resolve`, {}],
    ['attachments/00000000-0000-4000-8000-000000000001/preview', undefined]
  ];
  for (const cookie of [admin, moderator]) {
    for (const [path, body] of routes) {
      const refused = await lab.support(cookie, path, body);
      assert.equal(refused.status, 403, path);
    }
  }
  for (const [path, body] of routes) assert.equal((await lab.support('', path, body)).status, 401, path);
  assert.equal((await lab.support(alice.cookie, 'threads')).status, 403);
  assert.deepEqual(await lab.actions(), []);

  const stranger = await lab.account('stranger');
  for (const path of [`threads/${stranger.id}`, `threads/${stranger.id}/resolve`, `threads/${stranger.id}/read`]) {
    const missing = await lab.support(root, path, path === `threads/${stranger.id}` ? undefined : {});
    assert.equal(missing.status, 404, path);
    assert.equal(missing.body.code, 'support_thread_not_found');
  }
  assert.equal((await lab.support(root, `threads/${stranger.id}/reply`, { text: 'Привет' })).status, 404);
  assert.equal((await lab.support(root, `threads/${stranger.id}/notes`, { text: 'Привет' })).status, 404);
  for (const path of [`threads/${alice.id}/reply`, `threads/${alice.id}/notes`]) {
    const empty = await lab.support(root, path, { text: '   ' });
    assert.equal(empty.status, 400, path);
    assert.equal(empty.body.code, 'empty_message');
  }
  const missingImage = await lab.support(root, 'attachments/00000000-0000-4000-8000-000000000001/preview');
  assert.equal(missingImage.status, 404);
});

test('answers are rate-limited per staff member, apart from the person and from other staff', async (t) => {
  const lab = await setup(t, { DM_RATE_LIMIT: '2', DM_RATE_WINDOW_MS: '60000' });
  const root = await lab.staff(ROOT_ID, 'root', 'Root');
  const second = await lab.staff(SECOND_ID, 'second', 'Second');
  const alice = await lab.account('alice');
  assert.equal((await lab.write(alice, 'Раз')).status, 201);
  const answer = (cookie: string) => lab.support(cookie, `threads/${alice.id}/reply`, { text: 'Ответ' });
  assert.equal((await answer(root)).status, 200);
  assert.equal((await answer(root)).status, 200);
  const limited = await answer(root);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'message_rate_limited');
  assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal((await answer(second)).status, 200);
  // The person's own budget is theirs alone.
  assert.equal((await lab.write(alice, 'Два')).status, 201);
  const names = await lab.pool.query<{ display_name: string }>(
    `SELECT u.display_name FROM support_replies r JOIN users u ON u.id = r.staff_id ORDER BY u.display_name`
  );
  assert.deepEqual(
    names.rows.map((row) => row.display_name),
    ['Root', 'Root', 'Second']
  );
});

test('a person who wrote again after staff looked keeps the thread open until staff read it', async (t) => {
  const lab = await setup(t);
  const root = await lab.staff(ROOT_ID, 'root', 'Root');
  const alice = await lab.account('alice');
  assert.equal((await lab.write(alice, 'Вопрос')).status, 201);
  assert.equal((await lab.support(root, `threads/${alice.id}/read`, {})).status, 200);
  assert.equal((await lab.write(alice, 'Ещё вопрос')).status, 201);
  const refused = await lab.support(root, `threads/${alice.id}/resolve`, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'support_thread_changed');
  assert.deepEqual((await lab.support(root, 'unread')).body, { ok: true, openUnread: 1 });
  assert.equal((await lab.support(root, `threads/${alice.id}/read`, {})).status, 200);
  assert.equal((await lab.support(root, `threads/${alice.id}/resolve`, {})).status, 200);
});

test('a retried answer with the same Idempotency-Key is sent once', async (t) => {
  const lab = await setup(t);
  const root = await lab.staff(ROOT_ID, 'root', 'Root');
  const second = await lab.staff(SECOND_ID, 'second', 'Second');
  const alice = await lab.account('alice');
  assert.equal((await lab.write(alice, 'Помогите')).status, 201);
  const answer = (cookie: string, key: string, text = 'Смотрим') =>
    request(
      lab.socketPath,
      {
        method: 'POST',
        pathname: `/api/admin/support/threads/${alice.id}/reply`,
        cookie,
        headers: { 'Idempotency-Key': key },
        body: { text }
      },
      Type.Unknown()
    );
  const first = await answer(root, 'reply-key-0001');
  const again = await answer(root, 'reply-key-0001');
  assert.equal(first.status, 200);
  assert.equal(again.status, 200);
  const messageOf = (body: unknown) => {
    assert.ok(typeof body === 'object' && body !== null && 'message' in body);
    const { message } = body;
    assert.ok(typeof message === 'object' && message !== null && 'id' in message);
    return message.id;
  };
  assert.equal(messageOf(again.body), messageOf(first.body));
  const sent = async () =>
    (await lab.pool.query('SELECT 1 FROM direct_messages WHERE sender_id = $1', [OFFICIAL_ACCOUNT_ID])).rowCount;
  assert.equal(await sent(), 1);
  assert.equal((await lab.pool.query("SELECT 1 FROM admin_actions WHERE action = 'support_reply'")).rowCount, 1);
  // The key is the staff member's: the same key from someone else is another answer.
  assert.equal((await answer(second, 'reply-key-0001')).status, 200);
  assert.equal(await sent(), 2);
  // The same key with another text is refused, not sent.
  const conflict = await answer(root, 'reply-key-0001', 'Другой текст');
  assert.equal(conflict.status, 409);
  assert.equal(await sent(), 2);
});

test('the answer is pushed to the person offline as VoiceRoom, with no staff identity', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-push-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const capture = path.join(dir, 'pushes.jsonl');
  const preload = pathToFileURL(path.join(import.meta.dirname, '../../fakes/capture-rustore-push.ts')).href;
  const lab = await setup(t, {
    RUSTORE_PUSH_PROJECT_ID: 'project-1',
    RUSTORE_PUSH_SERVICE_TOKEN: 'secret',
    RUSTORE_CAPTURE_FILE: capture,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`.trim()
  });
  const root = await lab.staff(ROOT_ID, 'root', 'Root');
  const alice = await lab.account('alice');
  // Alice's phone holds a token; no socket of hers is open.
  const device = await request(lab.socketPath, {
    method: 'POST',
    pathname: '/api/push/devices',
    cookie: alice.cookie,
    headers: { 'User-Agent': 'VoiceRoom-Android/1.2.3 (Linux; Android 12)' },
    body: { provider: 'rustore', token: 'alice-phone' }
  });
  assert.equal(device.status, 201);
  assert.equal((await lab.write(alice, 'Помогите')).status, 201);
  assert.equal((await lab.support(root, `threads/${alice.id}/reply`, { text: 'Уже чиним' })).status, 200);

  const pushes = await waitForPushes(capture);
  assert.equal(pushes.length, 1);
  const [push] = pushes;
  assert.equal(push?.message.token, 'alice-phone');
  assert.equal(push?.message.notification?.title, 'VoiceRoom');
  assert.equal(push?.message.notification?.body, 'Уже чиним');
  assert.equal(push?.message.data?.peerUserId, OFFICIAL_ACCOUNT_ID);
  const text = JSON.stringify(push);
  assert.equal(text.includes(ROOT_ID), false);
  assert.equal(text.includes('Root'), false);
  assert.equal(text.includes('root'), false);
});

const CapturedPush = Type.Object({
  message: Type.Object({
    token: Type.String(),
    notification: Type.Optional(
      Type.Object({ title: Type.Optional(Type.String()), body: Type.Optional(Type.String()) })
    ),
    data: Type.Optional(Type.Record(Type.String(), Type.String()))
  })
});

// The push leaves the server process after the answer; read what it sent once it is there.
async function waitForPushes(file: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
    if (lines.length > 0) return lines.map((line) => checked(CapturedPush, JSON.parse(line), 'captured push'));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return [];
}
