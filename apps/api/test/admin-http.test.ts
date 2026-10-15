// The admin panel over HTTP: any account learns whether it is an
// administrator, only an administrator reads the numbers, and the numbers are
// what the tables hold — today's activity, the day series of a range, the
// registration cohorts and the server's own minutes — over the span asked
// for, and a new report reaches the administrators online at once.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import type { Me, SignedIn } from '@voice-room/shared/contracts/account';
import type { Failure } from '@voice-room/shared/contracts/http';
import type { AdminAccess, AdminOverview, ProductStats, SystemStats } from '@voice-room/shared/contracts/admin';
import type { AdminReportPage } from '@voice-room/shared/contracts/reports';
import { hashPassword } from '../src/lib/password.ts';
import { cookieFrom, registerAccount, request, startApiServer, wait } from './fakes/server-process.ts';
import { openWs, waitForWsType } from './ws-harness.ts';

const skip = !process.env.TEST_DATABASE_URL;
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const BOB_ID = '00000000-0000-4000-8000-000000000b0b';

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('only a platform administrator reads the panel, and its numbers come from the tables', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-admin-',
    env: { AUTH_RATE_LIMIT: '0', ROOM_PRUNE_INTERVAL_MS: '200', PLATFORM_ADMIN_USER_IDS: ADMIN_ID }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());

  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ADMIN_ID,
    await hashPassword('password123')
  ]);
  const signedIn = await request<SignedIn>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: { login: 'root', password: 'password123' }
  });
  assert.equal(signedIn.status, 200);
  const admin = cookieFrom(signedIn.setCookie);
  const alice = await registerAccount(socketPath, 'alice');
  const aliceId = (await request<Me>(socketPath, { pathname: '/api/auth/me', cookie: alice })).body.user!.id;

  // Bob signed up 20 days ago and came back on his third day.
  await pool.query(
    `INSERT INTO users (id, login, password_hash, created_at) VALUES ($1, 'bob', 'x', now() - interval '20 days')`,
    [BOB_ID]
  );
  await pool.query(
    `INSERT INTO user_activity_days (user_id, day, browser)
     VALUES ($1, ((now() - interval '20 days') AT TIME ZONE 'Europe/Moscow')::date + 3, true)`,
    [BOB_ID]
  );
  await pool.query(
    `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name) VALUES ('kitchen', '', true, $1, 'Кухня')`,
    [aliceId]
  );
  await pool.query(`INSERT INTO rooms (id, creator_ip, is_static) VALUES ('temp', '', false)`);
  await pool.query(
    `INSERT INTO room_messages (id, room_id, peer_id, name, text, author_user_id)
     VALUES ('m-alice', 'kitchen', 'p-alice', 'alice', 'привет', $1), ('m-guest', 'temp', 'p-guest', 'Гость', 'купи', NULL)`,
    [aliceId]
  );
  await pool.query(`INSERT INTO direct_messages (id, sender_id, recipient_id, body) VALUES ('dm-1', $1, $2, 'эй')`, [
    aliceId,
    ADMIN_ID
  ]);
  // Stays start now so they fall on today's Moscow day at any hour.
  await pool.query(
    `INSERT INTO voice_sessions (room_id, user_id, joined_at, left_at)
     VALUES ('kitchen', $1, now(), now() + interval '30 minutes'), ('temp', NULL, now(), now() + interval '15 minutes')`,
    [aliceId]
  );
  await pool.query(
    `INSERT INTO product_snapshots (at, online_accounts, guest_connections, voice_peers, voice_rooms)
     VALUES (date_bin('15 minutes', now(), TIMESTAMPTZ '2000-01-01'), 3, 2, 4, 2)
     -- The running API's own tick may have written this quarter hour already (with zeros).
     ON CONFLICT (at) DO UPDATE SET online_accounts = 3, guest_connections = 2, voice_peers = 4, voice_rooms = 2`
  );
  const adminSocket = openWs(socketPath, { cookie: admin });
  const aliceSocket = openWs(socketPath, { cookie: alice });
  await Promise.all([adminSocket.ready, aliceSocket.ready]);
  const reported = await request(socketPath, {
    method: 'POST',
    pathname: '/api/reports',
    cookie: alice,
    body: { target: { kind: 'room_message', roomId: 'temp', messageId: 'm-guest' }, reason: 'spam' }
  });
  assert.equal(reported.status, 201);
  const announced = await waitForWsType(adminSocket.frames, 'admin.reports');
  assert.deepEqual(announced.payload, {
    openReports: 1,
    filed: { reason: 'spam', targetKind: 'room_message', roomName: null }
  });
  await wait(100);
  assert.ok(!aliceSocket.frames.some((frame) => frame.type === 'admin.reports'), 'only administrators hear of reports');

  // Whether the entry shows: anyone signed in may ask, only the operator's account is told yes.
  assert.equal((await request(socketPath, { pathname: '/api/admin/access' })).status, 401);
  const asAlice = await request<AdminAccess>(socketPath, { pathname: '/api/admin/access', cookie: alice });
  assert.deepEqual(asAlice.body, { ok: true, admin: false, openReports: 0 });
  const asAdmin = await request<AdminAccess>(socketPath, { pathname: '/api/admin/access', cookie: admin });
  assert.deepEqual(asAdmin.body, { ok: true, admin: true, openReports: 1 });

  for (const pathname of ['/api/admin/overview', '/api/admin/product', '/api/admin/system']) {
    assert.equal((await request(socketPath, { pathname })).status, 401, pathname);
    const denied = await request<Failure>(socketPath, { pathname, cookie: alice });
    assert.equal(denied.status, 403, pathname);
    assert.equal(denied.body.code, 'platform_admin_required');
  }

  // The signed-in requests above mark admin and alice active today; the mark is written in the background.
  const overview = await waitFor(
    async () => (await request<AdminOverview>(socketPath, { pathname: '/api/admin/overview', cookie: admin })).body,
    (body) => body.today?.activeAccounts === 2 && body.system !== null
  );
  assert.equal(overview.ok, true);
  // Both sockets above are still open.
  assert.deepEqual(overview.live, { onlineAccounts: 2, guestConnections: 0, voicePeers: 0, voiceRooms: 0 });
  assert.deepEqual(
    { ...overview.today, day: undefined },
    { day: undefined, activeAccounts: 2, newAccounts: 2, messages: 3, voiceJoins: 2, voiceMinutes: 45 }
  );
  assert.match(overview.today.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(overview.totals, {
    accounts: 3,
    staticRooms: 1,
    temporaryRooms: 1,
    messages: 3,
    weeklyActive: 2,
    monthlyActive: 3
  });
  assert.equal(overview.openReports, 1);
  assert.equal(typeof overview.livekit, 'boolean');
  assert.match(overview.version, /^\d+\.\d+\.\d+/);
  assert.ok(overview.startedAt <= Date.now());
  assert.ok(overview.system!.memTotalBytes > 0);
  assert.ok(overview.system!.apiRssBytes > 0);
  assert.ok(overview.system!.dbBytes! > 0);

  const todayDay = overview.today.day;
  const weekAgo = new Date(Date.parse(`${todayDay}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  for (const query of ['from=yesterday', 'to=2026-1-5']) {
    const bogus = await request<Failure>(socketPath, { pathname: `/api/admin/product?${query}`, cookie: admin });
    assert.equal(bogus.status, 400, query);
  }

  const product = await request<ProductStats>(socketPath, {
    pathname: `/api/admin/product?from=${weekAgo}&to=${todayDay}`,
    cookie: admin
  });
  assert.equal(product.status, 200);
  assert.deepEqual([product.body.from, product.body.to], [weekAgo, todayDay]);
  assert.equal(product.body.trackingSince, '2026-10-15');
  assert.equal(product.body.days.length, 7);
  assert.equal(product.body.accountsBefore, 1, 'bob signed up before the week');
  // Reversed ends are swapped, and a day past today is today.
  const reversed = await request<ProductStats>(socketPath, {
    pathname: `/api/admin/product?from=2999-01-01&to=${weekAgo}`,
    cookie: admin
  });
  assert.deepEqual([reversed.body.from, reversed.body.to], [weekAgo, todayDay]);
  const today = product.body.days.at(-1)!;
  assert.equal(today.day, overview.today.day);
  assert.deepEqual(
    {
      activeAccounts: today.activeAccounts,
      newAccounts: today.newAccounts,
      roomMessages: today.roomMessages,
      directMessages: today.directMessages,
      messageAuthors: today.messageAuthors,
      staticRoomsCreated: today.staticRoomsCreated,
      temporaryRoomsCreated: today.temporaryRoomsCreated,
      voiceAccountHours: today.voiceAccountHours,
      voiceGuestHours: today.voiceGuestHours,
      voiceJoins: today.voiceJoins,
      voiceAccounts: today.voiceAccounts,
      peakOnline: today.peakOnline,
      peakGuests: today.peakGuests,
      peakVoicePeers: today.peakVoicePeers,
      peakVoiceRooms: today.peakVoiceRooms
    },
    {
      activeAccounts: 2,
      newAccounts: 2,
      roomMessages: 2,
      directMessages: 1,
      messageAuthors: 1,
      staticRoomsCreated: 1,
      temporaryRoomsCreated: 1,
      voiceAccountHours: 0.5,
      voiceGuestHours: 0.25,
      voiceJoins: 2,
      voiceAccounts: 1,
      peakOnline: 3,
      peakGuests: 2,
      peakVoicePeers: 4,
      peakVoiceRooms: 2
    }
  );
  const quiet = product.body.days[0]!;
  assert.equal(quiet.activeAccounts + quiet.newAccounts + quiet.roomMessages + quiet.voiceJoins, 0);
  assert.deepEqual(
    product.body.retention.map(({ accounts, returnedWeek1Pct, returnedWeek2Pct, returnedMonth1Pct }) => ({
      accounts,
      returnedWeek1Pct,
      returnedWeek2Pct,
      returnedMonth1Pct
    })),
    [
      { accounts: 2, returnedWeek1Pct: 0, returnedWeek2Pct: 0, returnedMonth1Pct: 0 },
      { accounts: 1, returnedWeek1Pct: 100, returnedWeek2Pct: 0, returnedMonth1Pct: 0 }
    ]
  );
  // Without a span, the last 30 days, but never before the first account (bob, 20 days ago).
  const month = await request<ProductStats>(socketPath, { pathname: '/api/admin/product', cookie: admin });
  assert.equal(month.body.days.length, 21);
  assert.equal(month.body.days[0]!.newAccounts, 1);
  assert.equal(month.body.accountsBefore, 0);

  assert.equal((await request(socketPath, { pathname: '/api/admin/system?from=soon', cookie: admin })).status, 400);
  const to = Date.now();
  const system = await request<SystemStats>(socketPath, {
    pathname: `/api/admin/system?from=${to - 6 * 3_600_000}&to=${to}`,
    cookie: admin
  });
  assert.equal(system.status, 200);
  assert.deepEqual([system.body.from, system.body.to], [to - 6 * 3_600_000, to]);
  assert.equal(system.body.bucketSeconds, 60);
  assert.ok(system.body.samples.length >= 1);
  assert.ok(system.body.samples.every((sample) => sample.memTotalBytes > 0));
  const day = await request<SystemStats>(socketPath, { pathname: '/api/admin/system', cookie: admin });
  assert.equal(day.body.to - day.body.from, 24 * 3_600_000);
  assert.equal(day.body.bucketSeconds, 300);

  // Deciding a report tells the administrators the new count, with nothing filed.
  const open = await request<AdminReportPage>(socketPath, { pathname: '/api/admin/reports', cookie: admin });
  const seen = adminSocket.frames.length;
  const dismissed = await request(socketPath, {
    method: 'POST',
    pathname: `/api/admin/reports/${open.body.reports[0]!.id}/resolve`,
    cookie: admin,
    body: { action: 'dismiss' }
  });
  assert.equal(dismissed.status, 200);
  const settled = await waitForWsType(adminSocket.frames, 'admin.reports', () => true, 5000, seen);
  assert.deepEqual(settled.payload, { openReports: 0, filed: null });

  adminSocket.ws.close();
  aliceSocket.ws.close();
});
