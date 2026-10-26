// The admin panel reads a call against its network: a live call counts from
// the call clock however often its people rejoined, each peer's network level
// (its client's own judgement, never shown to the room) lands on its stay, and
// an answer to "how was the call?" comes with the stay it is about: a guest by
// the name they gave, from what device and where, and how the network went.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Me, SignedIn } from '@voice-room/shared/contracts/account';
import { LiveRooms, RoomCalls, RoomHistory } from '@voice-room/shared/contracts/admin';
import { AdminCallFeedbackPage, type CallFeedbackBody } from '@voice-room/shared/contracts/feedback';
import { hashPassword } from '../src/lib/password.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createCallFeedbackRepository } from '../src/domains/feedback/call-feedback.repository.ts';
import { createVoiceSessionRepository } from '../src/domains/rooms/voice-session.repository.ts';
import { createAdminRoomsRepository } from '../src/domains/admin/admin-rooms.repository.ts';
import { cookieFrom, registerAccount, request, startApiServer } from './fakes/server-process.ts';
import { staffCookie } from './staff-session.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';
import { countWsType, joinVoiceRoom, openWs, sendWs, waitForWsType, type WsSession } from './ws-harness.ts';
import { defined } from './helpers/assert-defined.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const GUEST_BROWSER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await pause(50);
  }
}

async function startWithAdmin(t: test.TestContext, prefix: string) {
  const server = await startApiServer(t, {
    prefix,
    env: { AUTH_RATE_LIMIT: '0', PLATFORM_ADMIN_USER_IDS: ADMIN_ID }
  });
  const { socketPath, databaseUrl, beforeCleanup } = server;
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ADMIN_ID,
    await hashPassword('password123')
  ]);
  const signedIn = await request(
    socketPath,
    { method: 'POST', pathname: '/api/auth/login', body: { login: 'root', password: 'password123' } },
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
  return { socketPath, pool, admin, alice, aliceId };
}

const seat = (peerId: string, letter: string) => ({ roomId: 'kitchen', peerId, sessionToken: letter.repeat(32) });

/** Joins again on the same socket: waits for the snapshot of this join, not the one before. */
function rejoin(session: WsSession, voice: ReturnType<typeof seat>, extra: { name: string; guestId?: string }) {
  const since = session.frames.length;
  sendWs(session.ws, 'room.join', { ...voice, ...extra });
  return waitForWsType(session.frames, 'room.snapshot', (frame) => frame.payload.roomId === voice.roomId, 5000, since);
}

function reportNetwork(session: WsSession, voice: ReturnType<typeof seat>, network: 'good' | 'unstable' | 'bad') {
  sendWs(session.ws, 'room.peer.update', { ...voice, patch: { network } });
}

test('a live call counts from its call clock, and a stay keeps how its network went', { skip }, async (t) => {
  const { socketPath, pool, admin, alice } = await startWithAdmin(t, 'voice-room-call-network-');
  await pool.query(`UPDATE rooms SET avatar_key = 'room-kitchen.webp' WHERE id = 'kitchen'`);
  const aliceWs = openWs(socketPath, { cookie: alice });
  const guestWs = openWs(socketPath, { headers: { 'User-Agent': CHROME_UA } });
  await Promise.all([aliceWs.ready, guestWs.ready]);

  const beforeCall = Date.now();
  const aliceFirst = seat('alice-peer-1', 'a');
  await joinVoiceRoom(aliceWs, { ...aliceFirst, name: 'Алиса' });
  const guestFirst = seat('guest-peer-1', 'g');
  await joinVoiceRoom(guestWs, { ...guestFirst, name: 'Петя', guestId: GUEST_BROWSER });

  // Both rejoin in turn, the room never empty: the call goes on from its start.
  await pause(40);
  sendWs(aliceWs.ws, 'room.leave', aliceFirst);
  const aliceAgain = seat('alice-peer-2', 'b');
  await rejoin(aliceWs, aliceAgain, { name: 'Алиса' });
  await pause(40);
  sendWs(guestWs.ws, 'room.leave', guestFirst);
  const guestAgain = seat('guest-peer-2', 'h');
  await rejoin(guestWs, guestAgain, { name: 'Петя', guestId: GUEST_BROWSER });

  const liveKitchen = async () =>
    defined(
      (await request(socketPath, { pathname: '/api/admin/rooms', cookie: admin }, LiveRooms)).body.rooms[0],
      'the live kitchen'
    );
  const live = await liveKitchen();
  const since = defined(live.since, 'the call start');
  const joins = live.peers.map((peer) => defined(peer.joinedAt, 'a join time'));
  assert.ok(since >= beforeCall - 1000 && since < Math.min(...joins), 'the call is older than every seat in it now');
  assert.deepEqual(
    live.peers.map((peer) => peer.network),
    [null, null],
    'nobody has said how their network is yet'
  );

  // The guest's client reports its network; the room hears nothing of it.
  const aliceFramesBefore = aliceWs.frames.length;
  reportNetwork(guestWs, guestAgain, 'unstable');
  reportNetwork(guestWs, guestAgain, 'bad');
  reportNetwork(guestWs, guestAgain, 'bad');
  const reported = await waitFor(liveKitchen, (room) => room.peers.some((peer) => peer.network === 'bad'));
  assert.deepEqual(
    reported.peers.map((peer) => [peer.name, peer.network]),
    [
      ['alice', null],
      ['Петя', 'bad']
    ]
  );
  await pause(100);
  assert.equal(countWsType(aliceWs.frames, 'room.peer.updated', aliceFramesBefore), 0);

  // A patch that also changes what the room sees still reaches it.
  reportNetwork(guestWs, guestAgain, 'good');
  sendWs(guestWs.ws, 'room.peer.update', { ...guestAgain, patch: { muted: true, network: 'good' } });
  await waitFor(
    async () => countWsType(aliceWs.frames, 'room.peer.updated', aliceFramesBefore),
    (count) => count > 0
  );

  // A camera shows among the live room's people.
  sendWs(guestWs.ws, 'room.peer.update', { ...guestAgain, patch: { camera: true } });
  const filmed = await waitFor(liveKitchen, (room) => room.peers.some((peer) => peer.camera));
  assert.deepEqual(
    filmed.peers.map((peer) => peer.camera),
    [false, true]
  );

  sendWs(guestWs.ws, 'room.leave', guestAgain);
  const history = () =>
    request(socketPath, { pathname: '/api/admin/rooms/history', cookie: admin }, RoomHistory).then((r) => r.body);
  const stays = (await waitFor(history, (body) => body.stays.length === 3)).stays;
  const [guestLast, ...earlier] = stays;
  assert.equal(guestLast?.guestName, 'Петя');
  assert.deepEqual(
    guestLast?.network?.map((point) => point.level),
    ['unstable', 'bad', 'good'],
    'each change once, a repeat adds nothing'
  );
  const last = defined(guestLast, "the guest's last stay");
  for (const point of last.network ?? []) assert.ok(point.at >= last.joinedAt && point.at <= last.leftAt);
  assert.deepEqual(
    earlier.map((stay) => stay.network),
    [[], []],
    'stays whose clients never said have no changes'
  );

  // Once everyone left, the finished call carries the room's picture.
  sendWs(aliceWs.ws, 'room.leave', aliceAgain);
  const finished = await waitFor(
    () => request(socketPath, { pathname: '/api/admin/rooms/calls', cookie: admin }, RoomCalls).then((r) => r.body),
    (body) => body.calls.length === 1
  );
  assert.equal(finished.calls[0]?.avatarUrl, '/api/avatars/room-kitchen.webp');

  aliceWs.ws.close();
  guestWs.ws.close();
});

test(
  'an answer comes with the stay it is about: a guest by name, where from and how the network went',
  { skip },
  async (t) => {
    const { socketPath, admin, alice } = await startWithAdmin(t, 'voice-room-feedback-stay-');
    const guestWs = openWs(socketPath, { headers: { 'User-Agent': CHROME_UA } });
    const aliceWs = openWs(socketPath, { cookie: alice });
    await Promise.all([guestWs.ready, aliceWs.ready]);
    const guestVoice = seat('guest-peer-1', 'g');
    const aliceVoice = seat('alice-peer-1', 'a');
    await joinVoiceRoom(aliceWs, { ...aliceVoice, name: 'Алиса' });
    await joinVoiceRoom(guestWs, { ...guestVoice, name: 'выевыпк', guestId: GUEST_BROWSER });
    reportNetwork(guestWs, guestVoice, 'bad');
    await pause(50);
    sendWs(guestWs.ws, 'room.leave', guestVoice);
    sendWs(aliceWs.ws, 'room.leave', aliceVoice);

    const call: CallFeedbackBody['call'] = {
      roomId: 'kitchen',
      durationS: 60,
      peers: 1,
      platform: 'browser',
      quality: {
        rttAvgMs: 37.5,
        inboundLossAvgPct: 0.1,
        outboundLossAvgPct: 0,
        jitterAvgMs: 6.4,
        reconnects: 2,
        transport: 'udp',
        rttMaxMs: 1109,
        inboundLossMaxPct: 13.3,
        cpuPressureMax: 'critical',
        cpuRelieved: true,
        micDrops: 3
      }
    };
    const answer = (cookie: string | undefined, body: CallFeedbackBody) =>
      request(socketPath, { method: 'POST', pathname: '/api/feedback/calls', cookie, body });
    await waitFor(
      () =>
        request(socketPath, { pathname: '/api/admin/rooms/history', cookie: admin }, RoomHistory).then((r) => r.body),
      (body) => body.stays.length === 2
    );
    assert.equal(
      (await answer(undefined, { rating: 'bad', tags: ['poor_sound'], call: { ...call, guestId: GUEST_BROWSER } }))
        .status,
      201
    );
    // A guest from another browser was never in the room; an account is found by itself.
    const stranger = { ...call, guestId: '00000000-0000-4000-8000-000000000001' };
    assert.equal((await answer(undefined, { rating: 'good', tags: [], call: stranger })).status, 201);
    assert.equal(
      (await answer(alice, { rating: 'good', tags: [], call: { ...call, guestId: GUEST_BROWSER } })).status,
      201
    );

    const page = await request(socketPath, { pathname: '/api/admin/feedback', cookie: admin }, AdminCallFeedbackPage);
    assert.equal(page.status, 200);
    const [fromAlice, fromStranger, fromGuest] = page.body.entries;
    assert.equal(fromGuest?.stay?.guestName, 'выевыпк');
    assert.equal(fromGuest?.stay?.guestId, GUEST_BROWSER);
    assert.equal(fromGuest?.stay?.browser, 'Chrome');
    assert.equal(fromGuest?.stay?.os, 'Windows');
    assert.deepEqual(
      fromGuest?.stay?.network?.map((point) => point.level),
      ['bad']
    );
    assert.equal(fromGuest?.quality?.rttMaxMs, 1109);
    assert.equal(fromGuest?.quality?.micDrops, 3);
    assert.equal(fromStranger?.stay, null);
    assert.equal(fromAlice?.author?.login, 'alice');
    assert.equal(
      fromAlice?.stay?.account?.login,
      'alice',
      "an account's answer is matched by the account, not a browser"
    );

    guestWs.ws.close();
    aliceWs.ws.close();
  }
);

test(
  'the network and the guest browser of an answer are forgotten with the rest, and roll back cleanly',
  { skip },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await runMigrations({ databaseUrl, logger: SILENT });
    const old = new Date('2026-07-01T00:00:00Z');
    const network = JSON.stringify([{ at: old.getTime(), level: 'bad' }]);
    await pool.query(
      `INSERT INTO voice_sessions (room_id, joined_at, left_at, guest_id, network)
     VALUES ('r1', $1, $1, $2, $3)`,
      [old, GUEST_BROWSER, network]
    );
    await pool.query(
      `INSERT INTO call_feedback (rating, room_id, duration_s, peers, platform, guest_id, created_at)
     VALUES ('bad', 'r1', 90, 1, 'browser', $1, $2)`,
      [GUEST_BROWSER, old]
    );

    const cutoff = new Date(old.getTime() + 1000);
    assert.equal(await createVoiceSessionRepository({ pool }).forgetRoomsBefore(cutoff), 1);
    assert.equal(await createCallFeedbackRepository({ pool }).forgetAuthorsBefore(cutoff), 1);
    const stay = await pool.query<{ room_id: string | null; guest_id: string | null; network: unknown }>(
      'SELECT room_id, guest_id, network FROM voice_sessions'
    );
    assert.deepEqual(stay.rows, [{ room_id: null, guest_id: null, network: null }]);
    const answer = await pool.query<{ guest_id: string | null }>('SELECT guest_id FROM call_feedback');
    assert.deepEqual(answer.rows, [{ guest_id: null }]);

    const columns = async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
       WHERE (table_name = 'voice_sessions' AND column_name = 'network')
          OR (table_name = 'call_feedback' AND column_name = 'guest_id')
       ORDER BY column_name`
      );
      return rows.map((row) => row.column_name);
    };
    assert.deepEqual(await columns(), ['guest_id', 'network']);
    await rollBackThrough(databaseUrl, '20261026110000_keep_call_network_detail');
    assert.deepEqual(await columns(), []);
    await runMigrations({ databaseUrl, logger: SILENT });
    assert.deepEqual(await columns(), ['guest_id', 'network']);
  }
);

test(
  'an answer takes the stay that ended right before it, else the one ending just after, never a day-old one',
  { skip },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await runMigrations({ databaseUrl, logger: SILENT });
    const at = Date.UTC(2026, 9, 24, 18, 13);
    const MINUTE = 60_000;
    const add = (id: string, guestId: string, joined: number, left: number) =>
      pool.query(
        `INSERT INTO voice_sessions (id, room_id, guest_id, guest_name, joined_at, left_at)
       VALUES ($1, 'kitchen', $2, 'Петя', $3, $4)`,
        [id, guestId, new Date(joined), new Date(left)]
      );
    const OTHER = '00000000-0000-4000-8000-000000000002';
    const LATE = '00000000-0000-4000-8000-000000000003';
    const OLD = '00000000-0000-4000-8000-000000000004';
    await add('00000000-0000-4000-8000-00000000000a', GUEST_BROWSER, at - 180 * MINUTE, at - 10 * MINUTE);
    await add('00000000-0000-4000-8000-00000000000b', GUEST_BROWSER, at - 9 * MINUTE, at - MINUTE);
    // Back in the room after answering: a later stay is not the one the answer is about.
    await add('00000000-0000-4000-8000-00000000000c', GUEST_BROWSER, at + MINUTE, at + 3 * MINUTE);
    await add('00000000-0000-4000-8000-00000000000d', OTHER, at - 60 * MINUTE, at - 30 * MINUTE);
    // The seat closes after the answer when a dropped socket's lease held it.
    await add('00000000-0000-4000-8000-00000000000e', LATE, at - 60 * MINUTE, at + 2 * MINUTE);
    await add('00000000-0000-4000-8000-00000000000f', OLD, at - 3 * 24 * 60 * MINUTE, at - 2 * 24 * 60 * MINUTE);

    const repository = createAdminRoomsRepository({ pool });
    const found = await repository.lastStays([
      { roomId: 'kitchen', userId: null, guestId: GUEST_BROWSER, at },
      { roomId: 'kitchen', userId: null, guestId: LATE, at },
      { roomId: 'kitchen', userId: null, guestId: OLD, at },
      { roomId: 'other-room', userId: null, guestId: OTHER, at },
      { roomId: 'kitchen', userId: null, guestId: null, at }
    ]);
    assert.deepEqual(
      found.map((stay) => stay?.id ?? null),
      ['00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000e', null, null, null]
    );
  }
);
