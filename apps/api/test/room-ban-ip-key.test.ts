// A guest without an account is banned from a room by their address, yet the
// database keeps only the address's key, the one their stay in voice keeps: a
// rejoin from the same address, or from the same IPv6 /64, is refused, another
// network is let in, and bans stored by address before 2.10.4 are keyed by the
// running API and keep banning.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { registerAccount, request, startApiServer } from './fakes/server-process.ts';
import { joinVoiceRoom, openWs, sendWs, waitForWsType, type WsSession } from './ws-harness.ts';

const skip = !process.env.TEST_DATABASE_URL;
const GUEST_IP = '2001:db8:4:2::10';
const SAME_NETWORK_IP = '2001:db8:4:2:abcd::99';
const OTHER_NETWORK_IP = '2001:db8:4:3::10';
const KEY = /^[0-9a-f]{16}$/;

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function guestFrom(socketPath: string, ip: string, sessions: WsSession[]): WsSession {
  const session = openWs(socketPath, { headers: { 'X-Forwarded-For': ip } });
  sessions.push(session);
  return session;
}

async function refusedJoin(session: WsSession, peerId: string): Promise<void> {
  await session.ready;
  const since = session.frames.length;
  sendWs(session.ws, 'room.join', { roomId: 'porch', peerId, sessionToken: 'r'.repeat(32), name: 'Петя' });
  await waitForWsType(session.frames, 'room.banned', (frame) => frame.payload.roomId === 'porch', 5000, since);
}

test('a guest ban keeps the key of the address and refuses it and its /64 on rejoin', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-ban-key-',
    env: { AUTH_RATE_LIMIT: '0', TRUST_PROXY: '1' }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  const sessions: WsSession[] = [];
  t.after(() => sessions.forEach((session) => session.ws.close()));

  const owner = await registerAccount(socketPath, 'porchowner');
  await pool.query(
    `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name)
     SELECT 'porch', '', true, id, 'Крыльцо' FROM users WHERE login = 'porchowner'`
  );
  await pool.query(
    `INSERT INTO room_memberships (id, room_id, user_id, role)
     SELECT 'ms-owner', 'porch', id, 'owner' FROM users WHERE login = 'porchowner'`
  );

  const guest = guestFrom(socketPath, GUEST_IP, sessions);
  await guest.ready;
  await joinVoiceRoom(guest, { roomId: 'porch', peerId: 'guest-peer', sessionToken: 'g'.repeat(32), name: 'Петя' });
  const banned = await request(socketPath, {
    method: 'POST',
    pathname: '/api/rooms/porch/ban',
    body: { peerId: 'guest-peer' },
    cookie: owner
  });
  assert.equal(banned.status, 201);

  const stored = await pool.query<{ ip: string; user_id: string | null; row: string }>(
    `SELECT ip, user_id, row_to_json(b)::text AS row FROM room_bans b`
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0]?.user_id, null);
  assert.match(stored.rows[0]?.ip ?? '', KEY);
  assert.equal(stored.rows[0]?.row.includes('2001:db8'), false, 'the address is not stored');
  const stay = await waitFor(
    () => pool.query<{ ip_key: string | null }>(`SELECT ip_key FROM voice_sessions`).then((r) => r.rows[0]),
    (row) => Boolean(row?.ip_key)
  );
  assert.equal(stored.rows[0]?.ip, stay?.ip_key, 'the ban and the stay in voice keep the same key');

  await refusedJoin(guestFrom(socketPath, GUEST_IP, sessions), 'guest-again');
  await refusedJoin(guestFrom(socketPath, SAME_NETWORK_IP, sessions), 'guest-rotated');
  const peers = await request(socketPath, {
    pathname: '/api/rooms/porch/peers',
    headers: { 'X-Forwarded-For': SAME_NETWORK_IP }
  });
  assert.equal(peers.status, 403);
  assert.equal(peers.body.code, 'room_banned');

  const neighbour = guestFrom(socketPath, OTHER_NETWORK_IP, sessions);
  await neighbour.ready;
  const snapshot = await joinVoiceRoom(neighbour, {
    roomId: 'porch',
    peerId: 'neighbour',
    sessionToken: 'n'.repeat(32),
    name: 'Сосед'
  });
  assert.equal(snapshot.payload.roomId, 'porch', 'another network is not banned');
});

test('a guest ban stored by address is keyed by the running API and still bans', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-ban-rekey-',
    env: { TRUST_PROXY: '1', ROOM_PRUNE_INTERVAL_MS: '200' }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  const sessions: WsSession[] = [];
  t.after(() => sessions.forEach((session) => session.ws.close()));

  await pool.query(`INSERT INTO rooms (id, creator_ip, is_static, name) VALUES ('porch', '', true, 'Крыльцо')`);
  await pool.query(
    `INSERT INTO room_bans (id, room_id, user_id, ip) VALUES ('old-v6', 'porch', NULL, $1), ('old-v4', 'porch', NULL, '198.51.100.23')`,
    [GUEST_IP]
  );

  const keyed = await waitFor(
    () => pool.query<{ id: string; ip: string }>(`SELECT id, ip FROM room_bans ORDER BY id`).then((r) => r.rows),
    (rows) => rows.every((row) => KEY.test(row.ip))
  );
  assert.deepEqual(
    keyed.map((row) => [row.id, KEY.test(row.ip)]),
    [
      ['old-v4', true],
      ['old-v6', true]
    ]
  );

  await refusedJoin(guestFrom(socketPath, SAME_NETWORK_IP, sessions), 'guest-v6');
  await refusedJoin(guestFrom(socketPath, '198.51.100.23', sessions), 'guest-v4');
  const peers = await request(socketPath, {
    pathname: '/api/rooms/porch/peers',
    headers: { 'X-Forwarded-For': '198.51.100.24' }
  });
  assert.equal(peers.status, 200, 'the next IPv4 address is another address');
});
