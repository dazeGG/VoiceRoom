// The official VoiceRoom account per the hardening matrix: it cannot sign in
// or manage a password, recovery codes or sessions; nobody befriends, blocks,
// rings or calls it, and it does none of that; staff cannot ban or delete it;
// search skips it; anyone writes to it past friendship, settings and caps,
// while the sender's own DM rate limit still holds.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { SignedIn } from '@voiceroom/shared/contracts/account';
import { RoomCreated } from '@voiceroom/shared/contracts/rooms';
import { FriendSearch } from '@voiceroom/shared/contracts/social';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { UNUSABLE_PASSWORD_HASH } from '../../../src/domains/account/account-deletion.repository.ts';
import { hashSessionToken } from '../../../src/domains/account/user-records.ts';
import { hashPassword } from '../../../src/lib/password.ts';
import { cookieFrom, request, startApiServer } from '../../fakes/server-process.ts';
import { staffCookie } from '../../staff-session.ts';

const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';

type Account = { id: string; cookie: string };

async function setup(t: test.TestContext, env: Record<string, string> = {}) {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-official-',
    env: {
      AUTH_RATE_LIMIT: '0',
      DM_RATE_LIMIT: '0',
      VOICE_CALLS_ENABLED: 'true',
      PLATFORM_ADMIN_USER_IDS: ADMIN_ID,
      ...env
    }
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
  // Nothing issues the official account a session; a planted row proves each route refuses it anyway.
  async function plantedOfficialSession(): Promise<Account> {
    const token = randomUUID();
    await pool.query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [
      hashSessionToken(token),
      OFFICIAL_ACCOUNT_ID
    ]);
    return { id: OFFICIAL_ACCOUNT_ID, cookie: `vr_session=${token}` };
  }
  async function admin(): Promise<string> {
    await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
      ADMIN_ID,
      await hashPassword('password123')
    ]);
    const signedIn = await request(socketPath, {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login: 'root', password: 'password123' }
    });
    return staffCookie(socketPath, cookieFrom(signedIn.setCookie));
  }
  const send = (from: Account, to: string, text = 'Привет') =>
    request(socketPath, { method: 'POST', pathname: `/api/dm/${to}`, cookie: from.cookie, body: { text } });
  return { socketPath, pool, account, plantedOfficialSession, admin, send };
}

test('the migration creates @voiceroom with the official badge and a hash no password matches', async (t) => {
  const lab = await setup(t);
  const { rows } = await lab.pool.query<{
    login: string;
    display_name: string;
    badge: string;
    password_hash: string;
  }>('SELECT login, display_name, badge, password_hash FROM users WHERE id = $1', [OFFICIAL_ACCOUNT_ID]);
  assert.deepEqual(rows, [
    { login: 'voiceroom', display_name: 'VoiceRoom', badge: 'official', password_hash: UNUSABLE_PASSWORD_HASH }
  ]);
});

test('nobody signs in as the official account, and a planted session manages nothing', async (t) => {
  const lab = await setup(t);
  const login = (password: string) =>
    request(lab.socketPath, { method: 'POST', pathname: '/api/auth/login', body: { login: 'voiceroom', password } });
  for (const password of ['', '!', 'password123']) assert.equal((await login(password)).status, 401);
  // Even with a real password hash the account gets no session.
  await lab.pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
    OFFICIAL_ACCOUNT_ID,
    await hashPassword('password123')
  ]);
  const withHash = await login('password123');
  assert.equal(withHash.status, 401);
  assert.equal(withHash.body.code, 'invalid_credentials');
  const recover = await request(lab.socketPath, {
    method: 'POST',
    pathname: '/api/auth/recover',
    body: { login: 'voiceroom', code: 'AAAA-BBBB-CCCC', newPassword: 'password123' }
  });
  assert.equal(recover.status, 401);

  const official = await lab.plantedOfficialSession();
  const refused: Array<[string, string, object | undefined]> = [
    ['POST', '/api/auth/password', { currentPassword: 'x', newPassword: 'password456' }],
    ['POST', '/api/auth/recovery-codes', { currentPassword: 'x' }],
    ['POST', '/api/auth/recovery-codes/reminder/snooze', undefined],
    ['GET', '/api/auth/sessions', undefined],
    ['POST', '/api/auth/sessions/revoke-others', undefined],
    ['DELETE', `/api/auth/sessions/${randomUUID()}`, undefined]
  ];
  for (const [method, pathname, body] of refused) {
    const response = await request(lab.socketPath, { method, pathname, cookie: official.cookie, body });
    assert.equal(response.status, 403, pathname);
    assert.equal(response.body.code, 'official_account', pathname);
  }
});

test('no friend request, block, ring or call reaches or leaves the official account', async (t) => {
  const lab = await setup(t);
  const alice = await lab.account('alice');
  const official = await lab.plantedOfficialSession();
  const friendRequest = (from: Account, body: object) =>
    request(lab.socketPath, { method: 'POST', pathname: '/api/friends/requests', cookie: from.cookie, body });
  for (const body of [{ login: 'voiceroom' }, { userId: OFFICIAL_ACCOUNT_ID }]) {
    const refused = await friendRequest(alice, body);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'friend_request_refused');
  }
  const outgoing = await friendRequest(official, { login: 'alice' });
  assert.equal(outgoing.body.code, 'friend_request_refused');

  const block = (from: Account, target: string) =>
    request(lab.socketPath, { method: 'PUT', pathname: `/api/blocks/${target}`, cookie: from.cookie, body: {} });
  for (const [from, target] of [
    [alice, OFFICIAL_ACCOUNT_ID],
    [official, alice.id]
  ] as const) {
    const refused = await block(from, target);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, 'cannot_block_user');
  }
  assert.equal((await lab.pool.query('SELECT 1 FROM user_blocks')).rowCount, 0);

  // Even with calls open to everyone on both sides.
  await lab.pool.query(`UPDATE users SET calls_from = 'everyone'`);
  const room = await request(
    lab.socketPath,
    { method: 'POST', pathname: '/api/rooms', cookie: alice.cookie, body: { isStatic: true, name: 'Комната' } },
    RoomCreated
  );
  const ring = await request(lab.socketPath, {
    method: 'POST',
    pathname: `/api/rooms/${room.body.roomId}/ring`,
    cookie: alice.cookie,
    body: { userId: OFFICIAL_ACCOUNT_ID }
  });
  assert.equal(ring.status, 403);
  assert.equal(ring.body.code, 'relationship_blocked');
  const call = (from: Account, peerUserId: string) =>
    request(lab.socketPath, {
      method: 'POST',
      pathname: '/api/call-rings',
      cookie: from.cookie,
      body: { peerUserId, clientRequestId: randomUUID() }
    });
  for (const [from, peer] of [
    [alice, OFFICIAL_ACCOUNT_ID],
    [official, alice.id]
  ] as const) {
    const refused = await call(from, peer);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'relationship_blocked');
  }
  assert.equal((await lab.pool.query(`SELECT 1 FROM room_rings`)).rowCount, 0);
});

test('staff cannot block, sign out, delete or unmark the official account', async (t) => {
  const lab = await setup(t);
  const admin = await lab.admin();
  const act = (action: string, body: object) =>
    request(lab.socketPath, {
      method: 'POST',
      pathname: `/api/admin/accounts/${OFFICIAL_ACCOUNT_ID}/${action}`,
      cookie: admin,
      body
    });
  const actions: Array<[string, object]> = [
    ['block', { duration: 'forever', reason: 'spam' }],
    ['sign-out', {}],
    ['delete', { login: 'voiceroom', reason: 'spam' }],
    ['badge', { badge: null }]
  ];
  for (const [action, body] of actions) {
    const refused = await act(action, body);
    assert.equal(refused.status, 403, action);
    assert.equal(refused.body.code, 'official_account', action);
  }
  const { rows } = await lab.pool.query<{ badge: string; blocked: boolean; deleting: boolean }>(
    `SELECT badge, blocked_at IS NOT NULL AS blocked, deletion_requested_at IS NOT NULL AS deleting
     FROM users WHERE id = $1`,
    [OFFICIAL_ACCOUNT_ID]
  );
  assert.deepEqual(rows, [{ badge: 'official', blocked: false, deleting: false }]);
});

test('people search and «Новый чат» skip the official account', async (t) => {
  const lab = await setup(t);
  const alice = await lab.account('alice');
  await lab.account('voicefan');
  for (const q of ['voiceroom', 'VoiceRoom', 'voice']) {
    const search = await request(
      lab.socketPath,
      { pathname: `/api/friends/search?q=${encodeURIComponent(q)}`, cookie: alice.cookie },
      FriendSearch
    );
    assert.equal(search.status, 200);
    assert.equal(
      search.body.results.some((result) => result.user.id === OFFICIAL_ACCOUNT_ID),
      false,
      q
    );
  }
  const fan = await request(
    lab.socketPath,
    { pathname: '/api/friends/search?q=voicefan', cookie: alice.cookie },
    FriendSearch
  );
  assert.equal(fan.body.results.length, 1);
});

test('anyone writes to the official account past friendship, settings and caps; the rate limit still holds', async (t) => {
  const lab = await setup(t, { DM_RATE_LIMIT: '6', DM_NEW_CHAT_DAILY_LIMIT: '1', DM_UNANSWERED_LIMIT: '2' });
  const [alice, bob] = [await lab.account('alice'), await lab.account('bob')];
  await lab.pool.query(`UPDATE users SET messages_from = 'friends' WHERE id = $1`, [OFFICIAL_ACCOUNT_ID]);
  // The one new stranger chat of the day goes to bob…
  assert.equal((await lab.send(alice, bob.id)).status, 201);
  // …yet writing to VoiceRoom spends no budget, and no unanswered cap applies.
  for (let index = 0; index < 5; index += 1) assert.equal((await lab.send(alice, OFFICIAL_ACCOUNT_ID)).status, 201);
  const limited = await lab.send(alice, OFFICIAL_ACCOUNT_ID);
  assert.equal(limited.status, 429);
  // The official account never writes through the ordinary path.
  const official = await lab.plantedOfficialSession();
  const refused = await lab.send(official, alice.id);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'relationship_blocked');
  const thread = await request(lab.socketPath, { pathname: `/api/dm/${OFFICIAL_ACCOUNT_ID}`, cookie: alice.cookie });
  assert.equal(thread.status, 200);
  assert.equal(thread.body.canMessage, true);
  assert.equal(thread.body.canCall, false);
});
