// The admin panel sees who sat in a room's voice and from where, without an
// IP address: a guest's name and lasting browser id, the client, system and
// browser of the socket, and a keyed hash of the address. Live and in the
// history alike; the address itself is never answered or stored.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Value } from 'typebox/value';
import { LiveRooms, RoomHistory } from '@voice-room/shared/contracts/admin';
import { hashPassword } from '../src/lib/password.ts';
import { cookieFrom, request, startApiServer } from './fakes/server-process.ts';
import { joinVoiceRoom, openWs, sendWs } from './ws-harness.ts';

const skip = !process.env.TEST_DATABASE_URL;
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const GUEST_IP = '203.0.113.77';
const GUEST_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('a guest stay keeps its name, browser id, device and keyed address, never the address', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-stay-origin-',
    env: { AUTH_RATE_LIMIT: '0', TRUST_PROXY: '1', PLATFORM_ADMIN_USER_IDS: ADMIN_ID }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());

  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ADMIN_ID,
    await hashPassword('password123')
  ]);
  const signedIn = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: { login: 'root', password: 'password123' }
  });
  const admin = cookieFrom(signedIn.setCookie);
  await pool.query(`INSERT INTO rooms (id, creator_ip, is_static, name) VALUES ('porch', '', false, 'Крыльцо')`);

  const guest = openWs(socketPath, { headers: { 'User-Agent': WINDOWS_CHROME, 'X-Forwarded-For': GUEST_IP } });
  await guest.ready;
  const seat = { roomId: 'porch', peerId: 'guest-peer-1', sessionToken: 'g'.repeat(32) };
  await joinVoiceRoom(guest, { ...seat, name: 'Петя', guestId: GUEST_ID });

  const live = async () => {
    const { body } = await request(socketPath, { pathname: '/api/admin/rooms', cookie: admin });
    if (!Value.Check(LiveRooms, body)) throw new Error('no live rooms answer');
    return body;
  };
  const seated = await waitFor(live, (body) => body.rooms.length === 1);
  const peer = seated.rooms[0]?.peers[0];
  assert.equal(peer?.name, 'Петя');
  assert.equal(peer?.client, 'browser');
  assert.equal(peer?.os, 'Windows');
  assert.equal(peer?.browser, 'Chrome');
  assert.equal(peer?.guestId, GUEST_ID);
  assert.match(peer?.ipKey ?? '', /^[0-9a-f]{16}$/);
  assert.equal(JSON.stringify(seated).includes(GUEST_IP), false, 'the live answer never carries the address');

  sendWs(guest.ws, 'room.leave', seat);
  const history = async () => {
    const { body } = await request(socketPath, { pathname: '/api/admin/rooms/history?roomId=porch', cookie: admin });
    if (!Value.Check(RoomHistory, body)) throw new Error('no room history answer');
    return body;
  };
  const after = await waitFor(history, (body) => body.stays.length === 1);
  const stay = after.stays[0];
  assert.equal(stay?.account, null);
  assert.equal(stay?.guestName, 'Петя');
  assert.equal(stay?.guestId, GUEST_ID);
  assert.equal(stay?.client, 'browser');
  assert.equal(stay?.os, 'Windows');
  assert.equal(stay?.browser, 'Chrome');
  assert.equal(stay?.ipKey, peer?.ipKey, 'the same address gives the same key live and in the history');

  const stored = await pool.query<{ row: string }>(`SELECT row_to_json(s)::text AS row FROM voice_sessions s`);
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0]?.row.includes(GUEST_IP), false, 'the address is not stored');

  guest.ws.close();
});

test('past the kept days a stay forgets whose and where from it was', { skip }, async (t) => {
  const { databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-stay-forget-',
    env: { ROOM_PRUNE_INTERVAL_MS: '200' }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());

  await pool.query(
    `INSERT INTO voice_sessions (room_id, user_id, guest_name, guest_id, client, os, browser, ip_key, location, joined_at, left_at)
     VALUES ('old-room', NULL, 'Петя', $1, 'browser', 'Windows', 'Chrome', '0123456789abcdef', 'Москва, Россия',
             now() - interval '91 days', now() - interval '91 days' + interval '1 hour')`,
    [GUEST_ID]
  );
  const forgotten = await waitFor(
    () =>
      pool
        .query<{
          room_id: string | null;
          guest_name: string | null;
          guest_id: string | null;
          ip_key: string | null;
          location: string | null;
          os: string | null;
        }>(`SELECT room_id, guest_name, guest_id, ip_key, location, os FROM voice_sessions`)
        .then((r) => r.rows[0]),
    (row) => row?.room_id === null
  );
  assert.deepEqual(forgotten, {
    room_id: null,
    guest_name: null,
    guest_id: null,
    ip_key: null,
    location: null,
    os: 'Windows'
  });
});
