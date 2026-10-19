// The accounts of the admin panel over HTTP: the list counts what each
// account did and finds it by name, filter and sort; a block ends the
// account's sessions and sockets and tells it why and until when at sign-in,
// and lifts itself when its time is over; an administrator's deletion blocks
// at once and only an administrator calls it off; the mark is public; nobody
// acts on an administrator's account; every action lands in the log.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { AccountFailure, Me, SignedIn } from '@voice-room/shared/contracts/account';
import { AccountDetail, AccountsPage } from '@voice-room/shared/contracts/admin';
import { Failure } from '@voice-room/shared/contracts/http';
import { BadgeList } from '@voice-room/shared/contracts/users';
import { hashPassword } from '../src/lib/password.ts';
import { hashSessionToken } from '../src/domains/account/user-records.ts';
import type { TSchema } from 'typebox';
import { cookieFrom, registerAccount, request, startApiServer } from './fakes/server-process.ts';
import { openWs } from './ws-harness.ts';
import { defined } from './helpers/assert-defined.ts';

const skip = !process.env.TEST_DATABASE_URL;
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const DAY_MS = 24 * 60 * 60 * 1000;

async function setup(t: test.TestContext) {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-admin-accounts-',
    env: { AUTH_RATE_LIMIT: '0', PLATFORM_ADMIN_USER_IDS: ADMIN_ID }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ADMIN_ID,
    await hashPassword('password123')
  ]);
  const admin = cookieFrom(
    (
      await request(
        socketPath,
        {
          method: 'POST',
          pathname: '/api/auth/login',
          body: { login: 'root', password: 'password123' }
        },
        SignedIn
      )
    ).setCookie
  );
  const signInOptions = (login: string) => ({
    method: 'POST',
    pathname: '/api/auth/login',
    body: { login, password: 'password123' }
  });
  /** A sign-in whose answer only its status and cookie matter for. */
  const signIn = (login: string) => request(socketPath, signInOptions(login));
  /** A sign-in that must be refused, read as the refusal. */
  const refusedSignIn = (login: string) => request(socketPath, signInOptions(login), AccountFailure);
  const idOf = async (cookie: string) =>
    defined((await request(socketPath, { pathname: '/api/auth/me', cookie }, Me)).body.user, 'the signed-in user').id;
  const actionOptions = (userId: string, action: string, body: unknown, cookie: string) => ({
    method: 'POST',
    pathname: `/api/admin/accounts/${userId}/${action}`,
    body,
    cookie
  });
  /** An action whose answer only its status matters for. */
  const act = (userId: string, action: string, body: unknown = {}, cookie = admin) =>
    request(socketPath, actionOptions(userId, action, body, cookie));
  /** An action whose answer is read, checked against `schema`. */
  const actAs = <const Schema extends TSchema>(
    schema: Schema,
    userId: string,
    action: string,
    body: unknown = {},
    cookie = admin
  ) => request(socketPath, actionOptions(userId, action, body, cookie), schema);
  const card = (userId: string) =>
    request(socketPath, { pathname: `/api/admin/accounts/${userId}`, cookie: admin }, AccountDetail);
  const list = (query = '') =>
    request(socketPath, { pathname: `/api/admin/accounts${query}`, cookie: admin }, AccountsPage);
  return { socketPath, pool, admin, signIn, refusedSignIn, idOf, act, actAs, card, list };
}

test('the account list counts what each account did and finds it by name, filter and sort', { skip }, async (t) => {
  const { socketPath, pool, admin, list, card, idOf } = await setup(t);
  const alice = await registerAccount(socketPath, 'alice');
  const aliceId = await idOf(alice);
  const bobId = '00000000-0000-4000-8000-000000000b0b';
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash, created_at)
     VALUES ($1, 'bob', 'Bobby Tables', 'x', now() - interval '40 days')`,
    [bobId]
  );
  await pool.query(
    `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name) VALUES ('kitchen', '', true, $1, 'Кухня')`,
    [aliceId]
  );
  await pool.query(
    `INSERT INTO room_memberships (id, room_id, user_id, role) VALUES ('ms-1', 'kitchen', $1, 'owner')`,
    [aliceId]
  );
  await pool.query(
    `INSERT INTO room_messages (id, room_id, peer_id, name, text, author_user_id)
     VALUES ('m1', 'kitchen', 'p', 'alice', 'привет', $1), ('m2', 'kitchen', 'p', 'alice', 'купи', $1)`,
    [aliceId]
  );
  await pool.query(`INSERT INTO direct_messages (id, sender_id, recipient_id, body) VALUES ('dm-1', $1, $2, 'эй')`, [
    aliceId,
    bobId
  ]);
  await pool.query(
    `INSERT INTO voice_sessions (room_id, user_id, joined_at, left_at)
     VALUES ('kitchen', $1, now() - interval '1 hour', now() - interval '30 minutes')`,
    [aliceId]
  );
  await pool.query(
    `INSERT INTO content_reports (reporter_user_id, target_kind, room_id, message_id, reason)
     VALUES ($1, 'room_message', 'kitchen', 'm2', 'spam')`,
    [bobId]
  );

  assert.equal((await request(socketPath, { pathname: '/api/admin/accounts' })).status, 401);
  const denied = await request(socketPath, { pathname: '/api/admin/accounts', cookie: alice }, Failure);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'platform_admin_required');
  assert.equal((await request(socketPath, { pathname: `/api/admin/accounts/${bobId}`, cookie: alice })).status, 403);

  const all = (await list()).body;
  assert.equal(all.total, 3);
  // Newest first by default; bob registered 40 days ago.
  assert.equal(all.accounts.at(-1)?.login, 'bob');
  const aliceRow = defined(
    all.accounts.find((row) => row.login === 'alice'),
    'alice in the account list'
  );
  assert.deepEqual(
    {
      messages: aliceRow.messages,
      voiceMinutes: aliceRow.voiceMinutes,
      ownedRooms: aliceRow.ownedRooms,
      reportsAgainst: aliceRow.reportsAgainst,
      status: aliceRow.status,
      admin: aliceRow.admin,
      badge: aliceRow.badge
    },
    { messages: 3, voiceMinutes: 30, ownedRooms: 1, reportsAgainst: 1, status: 'active', admin: false, badge: null }
  );
  assert.equal(all.accounts.find((row) => row.login === 'root')?.admin, true);

  assert.deepEqual(
    (await list('?q=tables')).body.accounts.map((row) => row.login),
    ['bob'],
    'found by display name'
  );
  assert.deepEqual(
    (await list('?q=ALI')).body.accounts.map((row) => row.login),
    ['alice']
  );
  assert.deepEqual((await list('?q=%25')).body.accounts, [], 'a percent sign is a character, not a wildcard');
  assert.deepEqual(
    (await list('?filter=gone')).body.accounts.map((row) => row.login),
    ['bob']
  );
  assert.deepEqual(
    (await list('?filter=new&sort=messages&order=desc')).body.accounts.map((row) => row.login),
    ['alice', 'root']
  );
  assert.deepEqual(
    (await list('?sort=name&order=asc')).body.accounts.map((row) => row.login),
    ['alice', 'bob', 'root']
  );
  assert.equal((await list('?page=2')).body.accounts.length, 0);
  assert.equal(
    (await request(socketPath, { pathname: '/api/admin/accounts?filter=bogus', cookie: admin })).status,
    400
  );

  const aliceSocket = openWs(socketPath, { cookie: alice });
  await aliceSocket.ready;
  assert.deepEqual(
    (await list('?filter=online')).body.accounts.map((row) => row.login),
    ['alice']
  );
  const detail = (await card(aliceId)).body;
  assert.equal(detail.account.online, true);
  aliceSocket.ws.close();
  assert.deepEqual(detail.ownedRooms, [{ id: 'kitchen', name: 'Кухня', members: 1 }]);
  assert.equal(detail.memberOf, 1);
  assert.deepEqual(detail.reports, { against: 1, againstOpen: 1, filed: 0 });
  assert.equal(detail.days.length, 90);
  assert.equal(
    detail.days.reduce((sum, day) => sum + day.messages, 0),
    3
  );
  assert.equal(detail.devices.length, 1);
  assert.equal(detail.block, null);
  assert.equal(detail.deletion, null);
  assert.equal((await request(socketPath, { pathname: '/api/admin/accounts/nobody', cookie: admin })).status, 404);
});

test('a block ends the sessions, tells the account why at sign-in, and lifts itself when over', { skip }, async (t) => {
  const { socketPath, pool, admin, signIn, refusedSignIn, idOf, act, actAs, card } = await setup(t);
  const alice = await registerAccount(socketPath, 'alice');
  const aliceId = await idOf(alice);
  const socket = openWs(socketPath, { cookie: alice });
  await socket.ready;
  const closed = new Promise<void>((resolve) => socket.ws.once('close', () => resolve()));

  assert.equal((await act(aliceId, 'block', { duration: 'week', reason: '   ' })).status, 400);
  assert.equal((await act(aliceId, 'block', { duration: 'year', reason: 'спам' })).status, 400);
  const blocked = await actAs(AccountDetail, aliceId, 'block', { duration: 'week', reason: 'Спам  в чатах' });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.account.status, 'blocked');
  assert.equal(blocked.body.block?.reason, 'Спам в чатах');
  const until = defined(defined(blocked.body.block, 'the block').until, 'the block end');
  assert.ok(Math.abs(until - (Date.now() + 7 * DAY_MS)) < 60_000);
  await closed;
  assert.equal((await request(socketPath, { pathname: '/api/auth/me', cookie: alice }, Me)).body.user, null);

  const refused = await refusedSignIn('alice');
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'account_blocked');
  assert.equal(refused.body.blockedUntil, until);
  assert.equal(refused.body.blockReason, 'Спам в чатах');
  const wrongPassword = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login: 'alice', password: 'wrong-password' }
    },
    Failure
  );
  assert.equal(wrongPassword.body.code, 'invalid_credentials', 'the block is told only with the right password');

  // A session opened anyway (say, in the same instant) does not work either.
  const token = 'slipped'.padEnd(43, 's');
  await pool.query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [
    hashSessionToken(token),
    aliceId
  ]);
  const slipped = `${alice.split('=')[0]}=${token}`;
  assert.equal((await request(socketPath, { pathname: '/api/auth/me', cookie: slipped }, Me)).body.user, null);
  const listed = (
    await request(socketPath, { pathname: '/api/admin/accounts?filter=blocked', cookie: admin }, AccountsPage)
  ).body;
  assert.deepEqual(
    listed.accounts.map((row) => row.login),
    ['alice']
  );

  // Its time over, the block lifts itself.
  await pool.query(`UPDATE users SET blocked_until = now() - interval '1 second' WHERE id = $1`, [aliceId]);
  assert.equal((await signIn('alice')).status, 200);
  assert.equal((await card(aliceId)).body.account.status, 'active');

  await act(aliceId, 'block', { duration: 'forever', reason: 'Мошенничество' });
  const forever = await refusedSignIn('alice');
  assert.equal(forever.body.blockedUntil, null);
  const lifted = await actAs(AccountDetail, aliceId, 'unblock');
  assert.equal(lifted.body.block, null);
  assert.equal((await signIn('alice')).status, 200);

  assert.deepEqual(
    lifted.body.actions.map((entry) => [entry.action, entry.reason, entry.adminName]),
    [
      ['unblock', '', 'Root'],
      ['block', 'Мошенничество', 'Root'],
      ['block', 'Спам в чатах', 'Root']
    ]
  );
  assert.equal(lifted.body.actions[1]?.until, null);
  assert.equal(lifted.body.actions[2]?.until, until);
});

test('signing out everywhere ends every session but keeps the account usable', { skip }, async (t) => {
  const { socketPath, signIn, idOf, actAs } = await setup(t);
  const alice = await registerAccount(socketPath, 'alice');
  const second = cookieFrom((await signIn('alice')).setCookie);
  const aliceId = await idOf(alice);
  const result = await actAs(AccountDetail, aliceId, 'sign-out');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.devices, []);
  for (const cookie of [alice, second]) {
    assert.equal((await request(socketPath, { pathname: '/api/auth/me', cookie }, Me)).body.user, null);
  }
  assert.equal((await signIn('alice')).status, 200);
  assert.equal(result.body.actions[0]?.action, 'logout');
});

test(
  'an administrator deletion blocks at once, offers no restore, and an administrator calls it off',
  { skip },
  async (t) => {
    const { socketPath, signIn, refusedSignIn, idOf, actAs, card } = await setup(t);
    const alice = await registerAccount(socketPath, 'alice');
    const aliceId = await idOf(alice);

    const mismatch = await actAs(Failure, aliceId, 'delete', { login: 'alicia', reason: 'Спам-бот' });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.code, 'confirmation_mismatch');

    const deleted = await actAs(AccountDetail, aliceId, 'delete', { login: ' Alice ', reason: 'Спам-бот' });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.account.status, 'deleting');
    assert.equal(deleted.body.account.displayName, 'Удалённый аккаунт');
    assert.equal(deleted.body.deletion?.byAdmin, true);
    assert.equal(deleted.body.block?.until, null);
    assert.equal((await request(socketPath, { pathname: '/api/auth/me', cookie: alice }, Me)).body.user, null);

    const refused = await refusedSignIn('alice');
    assert.equal(refused.body.code, 'account_blocked', 'blocked, not offered a restore');
    assert.equal(refused.body.blockReason, 'Спам-бот');
    const restore = await request(
      socketPath,
      {
        method: 'POST',
        pathname: '/api/auth/account/restore',
        body: { login: 'alice', password: 'password123' }
      },
      AccountFailure
    );
    assert.equal(restore.status, 403);
    assert.equal(restore.body.code, 'account_blocked');

    const cancelled = await actAs(AccountDetail, aliceId, 'cancel-deletion');
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.account.status, 'active');
    assert.equal(cancelled.body.account.displayName, 'alice');
    assert.equal(cancelled.body.block, null);
    assert.equal((await signIn('alice')).status, 200);

    // A deletion the owner asked for stays the owner's to call off.
    const bob = await registerAccount(socketPath, 'bob');
    const bobId = await idOf(bob);
    await request(socketPath, {
      method: 'POST',
      pathname: '/api/auth/account/deletion',
      body: { currentPassword: 'password123' },
      cookie: bob
    });
    assert.equal((await card(bobId)).body.deletion?.byAdmin, false);
    const notOurs = await actAs(Failure, bobId, 'cancel-deletion');
    assert.equal(notOurs.status, 409);
    assert.equal(notOurs.body.code, 'deletion_not_by_admin');
  }
);

test('nobody blocks or deletes an administrator, and only an administrator acts', { skip }, async (t) => {
  const { socketPath, admin, idOf, act, actAs } = await setup(t);
  const alice = await registerAccount(socketPath, 'alice');
  const aliceId = await idOf(alice);
  for (const [action, body] of [
    ['block', { duration: 'day', reason: 'x' }],
    ['sign-out', {}],
    ['delete', { login: 'root', reason: 'x' }],
    ['unblock', {}]
  ] as const) {
    const refused = await actAs(Failure, ADMIN_ID, action, body, admin);
    assert.equal(refused.status, 403, action);
    assert.equal(refused.body.code, 'cannot_moderate_admin', action);
    assert.equal((await act(aliceId, action, body, alice)).status, 403, `${action} by a non-admin`);
  }
  assert.equal((await act(ADMIN_ID, 'badge', { badge: 'official' })).status, 200, 'a mark is not a sanction');
  assert.equal((await act('nobody', 'block', { duration: 'day', reason: 'x' })).status, 404);
});

test('the mark is public, and only the official account may carry the service name', { skip }, async (t) => {
  const { socketPath, idOf, act, actAs } = await setup(t);
  const alice = await registerAccount(socketPath, 'alice');
  const aliceId = await idOf(alice);

  for (const body of [
    { login: 'voiceroom', displayName: 'x' },
    { login: 'voice_room_team', displayName: 'x' },
    { login: 'ada', displayName: 'VoiceRoom' },
    { login: 'ada', displayName: 'Войс Рум' }
  ]) {
    const refused = await request(
      socketPath,
      {
        method: 'POST',
        pathname: '/api/auth/register',
        body: { ...body, password: 'password123', passwordConfirm: 'password123' }
      },
      Failure
    );
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.equal(refused.body.code, 'reserved_name');
  }
  const rename = (cookie: string) =>
    request(socketPath, {
      method: 'POST',
      pathname: '/api/auth/profile',
      body: { displayName: 'VoiceRoom' },
      cookie
    });
  assert.equal((await rename(alice)).body.code, 'reserved_name');

  assert.deepEqual((await request(socketPath, { pathname: '/api/badges' }, BadgeList)).body.badges, []);
  const marked = await actAs(AccountDetail, aliceId, 'badge', { badge: 'official' });
  assert.equal(marked.body.account.badge, 'official');
  assert.deepEqual(
    (await request(socketPath, { pathname: '/api/badges' }, BadgeList)).body.badges,
    [{ userId: aliceId, badge: 'official' }],
    'guests read it too'
  );
  assert.equal((await rename(alice)).status, 200, 'the official account may carry the name');

  const unmarked = await actAs(AccountDetail, aliceId, 'badge', { badge: null });
  assert.equal(unmarked.body.account.badge, null);
  assert.deepEqual(
    unmarked.body.actions.map((entry) => [entry.action, entry.badge]),
    [
      ['badge', null],
      ['badge', 'official']
    ]
  );
  assert.equal((await act(aliceId, 'badge', { badge: 'gold' })).status, 400);
});
