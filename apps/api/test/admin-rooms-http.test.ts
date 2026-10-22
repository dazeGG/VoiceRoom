// The admin panel's rooms section over HTTP: only an administrator sees who
// is in which room's voice now (accounts with their login, guests by the name
// they gave) and the finished stays, a page at a time. A stay keeps its room
// for VOICE_HISTORY_KEEP_DAYS, then the maintenance sweep forgets it; the
// migration that allows that rolls back cleanly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Me, SignedIn } from '@voice-room/shared/contracts/account';
import { Failure } from '@voice-room/shared/contracts/http';
import { ROOM_HISTORY_PAGE_SIZE, LiveRooms, RoomHistory } from '@voice-room/shared/contracts/admin';
import { hashPassword } from '../src/lib/password.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { cookieFrom, registerAccount, request, startApiServer } from './fakes/server-process.ts';
import { staffCookie } from './staff-session.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';
import { joinVoiceRoom, openWs, sendWs } from './ws-harness.ts';
import { defined } from './helpers/assert-defined.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const DESKTOP_APP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) VoiceRoom/1.4.6 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('an administrator sees who is in voice now and the stays before, a page at a time', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-admin-rooms-',
    env: { AUTH_RATE_LIMIT: '0', ROOM_PRUNE_INTERVAL_MS: '200', PLATFORM_ADMIN_USER_IDS: ADMIN_ID }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());

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
  const admin = await staffCookie(socketPath, cookieFrom(signedIn.setCookie));
  const alice = await registerAccount(socketPath, 'alice');
  const aliceId = defined(
    (await request(socketPath, { pathname: '/api/auth/me', cookie: alice }, Me)).body.user,
    'alice'
  ).id;
  await pool.query(
    `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name) VALUES ('kitchen', '', true, $1, 'Кухня')`,
    [aliceId]
  );

  // Alice sits in the desktop app, the guest on a phone; the socket's user agent tells.
  const aliceWs = openWs(socketPath, { cookie: alice, headers: { 'User-Agent': DESKTOP_APP_UA } });
  const guestWs = openWs(socketPath, { headers: { 'User-Agent': IPHONE_UA } });
  await Promise.all([aliceWs.ready, guestWs.ready]);
  const aliceVoice = { roomId: 'kitchen', peerId: 'alice-peer', sessionToken: 'a'.repeat(32) };
  await joinVoiceRoom(aliceWs, { ...aliceVoice, name: 'Алиса' });
  await joinVoiceRoom(guestWs, { roomId: 'kitchen', peerId: 'guest-peer', sessionToken: 'g'.repeat(32), name: 'Петя' });

  for (const pathname of ['/api/admin/rooms', '/api/admin/rooms/history']) {
    assert.equal((await request(socketPath, { pathname })).status, 401, pathname);
    const denied = await request(socketPath, { pathname, cookie: alice }, Failure);
    assert.equal(denied.status, 403, pathname);
    assert.equal(denied.body.code, 'platform_admin_required');
  }

  const live = await request(socketPath, { pathname: '/api/admin/rooms', cookie: admin }, LiveRooms);
  assert.equal(live.status, 200);
  assert.equal(live.body.rooms.length, 1);
  const kitchen = defined(live.body.rooms[0], 'the live kitchen');
  assert.equal(kitchen.roomId, 'kitchen');
  assert.equal(kitchen.name, 'Кухня');
  assert.equal(kitchen.isStatic, true);
  assert.equal(kitchen.owner?.login, 'alice');
  // An account goes by its profile name whatever it typed on joining; a guest by what it typed.
  assert.deepEqual(
    kitchen.peers.map((peer) => [peer.name, peer.account?.id ?? null, peer.account?.login ?? null]),
    [
      ['alice', aliceId, 'alice'],
      ['Петя', null, null]
    ]
  );
  assert.equal(kitchen.since, defined(kitchen.peers[0], 'the first peer').joinedAt);
  assert.deepEqual(
    kitchen.peers.map((peer) => peer.client),
    ['desktop_app', 'mobile']
  );

  // Alice leaves: her stay is the history's latest, and the guest stays in the room.
  sendWs(aliceWs.ws, 'room.leave', aliceVoice);
  const history = () =>
    request(socketPath, { pathname: '/api/admin/rooms/history', cookie: admin }, RoomHistory).then((r) => r.body);
  const afterLeave = await waitFor(history, (body) => body.stays.length === 1);
  const left = defined(afterLeave.stays[0], 'the stay of alice');
  assert.equal(left.roomName, 'Кухня');
  assert.equal(left.account?.login, 'alice');
  assert.equal(afterLeave.keepDays, 90);
  const stillIn = await request(socketPath, { pathname: '/api/admin/rooms', cookie: admin }, LiveRooms);
  assert.deepEqual(
    defined(stillIn.body.rooms[0], 'the live kitchen').peers.map((peer) => peer.name),
    ['Петя']
  );

  // A full page and then some, a stay in a room that is gone, and one too old to keep its room.
  await pool.query(
    `INSERT INTO voice_sessions (room_id, user_id, joined_at, left_at)
     SELECT 'kitchen', NULL, now() - make_interval(hours => n + 2), now() - make_interval(hours => n + 1)
     FROM generate_series(1, ${ROOM_HISTORY_PAGE_SIZE}) AS n`
  );
  await pool.query(
    `INSERT INTO voice_sessions (room_id, user_id, joined_at, left_at)
     VALUES ('gone-room', $1, now() - interval '30 minutes', now() - interval '20 minutes'),
            ('kitchen', $1, now() - interval '91 days', now() - interval '91 days' + interval '1 hour')`,
    [aliceId]
  );
  const forgotten = await waitFor(
    () =>
      pool
        .query<{ n: number }>(`SELECT count(*)::int AS n FROM voice_sessions WHERE room_id IS NULL`)
        .then((r) => r.rows[0]?.n),
    (n) => n === 1
  );
  assert.equal(forgotten, 1, 'the stay older than the kept days has lost its room');

  const first = await history();
  assert.equal(first.stays.length, ROOM_HISTORY_PAGE_SIZE);
  assert.equal(defined(first.stays[0], 'the latest stay').account?.login, 'alice', 'the latest end comes first');
  const goneStay = defined(first.stays[1], 'the stay in the gone room');
  assert.equal(goneStay.roomId, 'gone-room');
  assert.equal(goneStay.roomName, null);
  assert.ok(first.next);
  const second = await request(
    socketPath,
    {
      pathname: `/api/admin/rooms/history?after=${encodeURIComponent(first.next)}`,
      cookie: admin
    },
    RoomHistory
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.stays.length, 2);
  assert.equal(second.body.next, null);
  const ids = [...first.stays, ...second.body.stays].map((stay) => stay.id);
  assert.equal(new Set(ids).size, ROOM_HISTORY_PAGE_SIZE + 2, 'no stay on two pages, the forgotten one on none');

  const gone = await request(
    socketPath,
    {
      pathname: '/api/admin/rooms/history?roomId=gone-room',
      cookie: admin
    },
    RoomHistory
  );
  assert.deepEqual(
    gone.body.stays.map((stay) => stay.roomId),
    ['gone-room']
  );
  const malformed = await request(socketPath, { pathname: '/api/admin/rooms/history?after=yesterday', cookie: admin });
  assert.equal(malformed.status, 400);

  aliceWs.ws.close();
  guestWs.ws.close();
});

test('a stay may lose its room, and the rollback keeps the forgotten stays as usage rows', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(
    `INSERT INTO voice_sessions (room_id, user_id, joined_at, left_at)
     VALUES (NULL, NULL, now() - interval '1 hour', now()), ('kitchen', NULL, now() - interval '1 hour', now())`
  );

  await rollBackThrough(databaseUrl, '20261019120000_forget_old_voice_rooms');
  const { rows } = await pool.query<{ room_id: string }>(`SELECT room_id FROM voice_sessions ORDER BY room_id`);
  assert.deepEqual(
    rows.map((row) => row.room_id),
    ['', 'kitchen']
  );
  await assert.rejects(
    pool.query(`INSERT INTO voice_sessions (room_id, joined_at, left_at) VALUES (NULL, now(), now())`),
    /null value/
  );

  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(`INSERT INTO voice_sessions (room_id, joined_at, left_at) VALUES (NULL, now(), now())`);
});
