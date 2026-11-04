// What the admin panel's redesigned pages read: a call in full, finished or
// still going on, with what went on in it and the answers about it; the
// persistent rooms with their numbers; an account's voice and computer over 30
// days; and the overview's calls, reports and answers. The new table and columns
// roll back and forth cleanly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { SignedIn } from '@voice-room/shared/contracts/account';
import { Failure } from '@voice-room/shared/contracts/http';
import { RoomCallDetail } from '@voice-room/shared/contracts/feedback';
import { StaticRooms } from '@voice-room/shared/contracts/admin';
import type { StaffPermission } from '@voice-room/shared/contracts/staff';
import { createAdminAccountsRepository } from '../src/domains/admin/admin-accounts.repository.ts';
import { createAdminRoomsRepository } from '../src/domains/admin/admin-rooms.repository.ts';
import { createAdminRoomsService } from '../src/domains/admin/admin-rooms.service.ts';
import { createAdminStatsRepository } from '../src/domains/admin/admin-stats.repository.ts';
import { createCallFeedbackRepository } from '../src/domains/feedback/call-feedback.repository.ts';
import type { PresencePeer } from '../src/domains/rooms/room-views.ts';
import {
  createVoiceSessionRepository,
  type StayEvent,
  type VoiceMinuteSample
} from '../src/domains/rooms/voice-session.repository.ts';
import { hashPassword } from '../src/lib/password.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { cookieFrom, registerAccount, request, startApiServer } from './fakes/server-process.ts';
import { rollBackThrough } from './migration-steps.ts';
import { staffCookie } from './staff-session.ts';
import { defined } from './helpers/assert-defined.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const ALICE_ID = '00000000-0000-4000-8000-00000000a11c';
const BOB_ID = '00000000-0000-4000-8000-00000000b0b0';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Every moment is counted back from the last whole minute, for a minute's row to start on one.
const NOW = Math.floor(Date.now() / MINUTE) * MINUTE;

const minute = (at: number, polls: VoiceMinuteSample['polls'], cpu?: VoiceMinuteSample['cpu']): VoiceMinuteSample => ({
  at,
  polls,
  heard: { packets: 0, lost: 0, concealedSamples: 0, gaps: 0 },
  heardBy: { packets: 0, lost: 0, concealedSamples: 0, gaps: 0 },
  rttMsSum: 2000,
  rttPolls: 20,
  jitterBufferMsSum: 600,
  jitterBufferPolls: 20,
  uplink: { packets: 1000, lost: 50 },
  mic: { expectedMs: 0, deliveredMs: 0, contextMs: 0, reopens: 0, replacements: 0 },
  transport: 'udp',
  cpu
});

const GOOD = { good: 20, unstable: 0, bad: 0 };
const BAD = { good: 0, unstable: 0, bad: 20 };

const stay = (
  roomId: string,
  joinedAt: number,
  leftAt: number,
  who: { userId?: string; guestName?: string } = {},
  minutes: VoiceMinuteSample[] = [],
  events: StayEvent[] = []
) => ({
  roomId,
  userId: who.userId ?? null,
  guestName: who.guestName ?? null,
  guestId: null,
  client: null,
  os: '',
  browser: '',
  ip: '',
  joinedAt,
  leftAt,
  minutes,
  events
});

async function seedPeople(pool: Pool) {
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash)
     VALUES ($1, 'alice', 'Алиса', 'x'), ($2, 'bob', 'Боб', 'x')`,
    [ALICE_ID, BOB_ID]
  );
}

async function seedRoom(pool: Pool, id: string, name: string, ownerId: string, isStatic = true) {
  await pool.query(`INSERT INTO rooms (id, creator_ip, is_static, owner_id, name) VALUES ($1, '', $2, $3, $4)`, [
    id,
    isStatic,
    ownerId,
    name
  ]);
}

async function answer(pool: Pool, roomId: string, at: number, rating: 'good' | 'bad', tags: string[] = []) {
  await pool.query(
    `INSERT INTO call_feedback (rating, tags, room_id, duration_s, peers, platform, created_at)
     VALUES ($1, $2, $3, 60, 2, 'browser', $4)`,
    [rating, tags, roomId, new Date(at)]
  );
}

function serviceOver(pool: Pool, presence: { id: string; peers: Map<string, PresencePeer> }[] = []) {
  const permissions: Record<string, readonly StaffPermission[]> = {
    admin: ['rooms.view', 'origin.view', 'stats.view'],
    moderator: ['rooms.view']
  };
  const feedback = createCallFeedbackRepository({ pool });
  return createAdminRoomsService({
    staff: { can: (userId, permission) => Promise.resolve(permissions[userId]?.includes(permission) ?? false) },
    presenceRooms: () => presence,
    repository: () => createAdminRoomsRepository({ pool }),
    describeAddress: () => Promise.resolve({ ipKey: 'key', location: 'Москва' }),
    feedbackInRoom: async (roomId, from, until) =>
      (await feedback.listForRoomSpan(roomId, new Date(from), new Date(until))).map(
        ({ userId: _userId, guestId: _guestId, ...entry }) => entry
      ),
    now: () => NOW
  });
}

test('a finished call comes whole: its stays, what went on and the answers about it', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await seedPeople(pool);
  await seedRoom(pool, 'kitchen', 'Кухня', ALICE_ID);
  const start = NOW - 2 * HOUR;
  await createVoiceSessionRepository({ pool }).recordSessions([
    stay(
      'kitchen',
      start,
      start + 3 * MINUTE,
      { userId: ALICE_ID },
      [
        minute(start, GOOD, { appPctSum: 40, systemPctSum: 180, polls: 2, pressureMax: 'critical', relieved: true }),
        minute(start + MINUTE, BAD)
      ],
      [
        { at: start + 30_000, kind: 'screen_on' },
        { at: start + 40_000, kind: 'cpu_critical' }
      ]
    ),
    stay('kitchen', start + MINUTE, start + 2 * MINUTE, { guestName: 'Петя' })
  ]);
  // During it and soon after; the later one is about the next call, the earlier about none.
  await answer(pool, 'kitchen', start - MINUTE, 'good');
  await answer(pool, 'kitchen', start + 4 * MINUTE, 'bad', ['echo_noise']);
  await answer(pool, 'kitchen', start + 50 * MINUTE, 'good');

  const service = serviceOver(pool);
  const page = defined(await service.calls('admin', { roomId: 'kitchen' }), 'the calls');
  const listed = defined(page.calls[0], 'the call');
  assert.equal(listed.badFeedback, 1, 'the bad answer belongs to it');

  const detail = defined(await service.call('admin', listed.id), 'the call in full');
  assert.equal(detail.call.stays.length, 2);
  const first = defined(detail.call.stays[0]?.minutes?.[0], 'the first minute');
  assert.deepEqual(
    [first.cpuAppPct, first.cpuSystemPct, first.cpuPressure, first.relieved],
    [20, 90, 'critical', true],
    'the sums read back as averages'
  );
  assert.equal(detail.call.stays[0]?.minutes?.[1]?.cpuAppPct, undefined, 'a minute without a report carries nothing');
  assert.deepEqual(
    detail.events?.map((event) => [event.at - start, event.kind, event.detail]),
    [
      [0, 'join', undefined],
      [30_000, 'screen_on', undefined],
      [40_000, 'cpu_critical', undefined],
      [MINUTE, 'network', 'bad'],
      [MINUTE, 'join', undefined],
      [2 * MINUTE, 'leave', undefined],
      [3 * MINUTE, 'leave', undefined]
    ]
  );
  assert.deepEqual(
    detail.feedback?.map((entry) => [entry.rating, entry.tags]),
    [['bad', ['echo_noise']]]
  );

  const moderator = defined(await service.call('moderator', listed.id), 'the call for a moderator');
  assert.equal(moderator.feedback, undefined, 'answers are for those who read the numbers');
  assert.equal(moderator.call.badFeedback, undefined, 'and so is how many were bad');
  const moderatorPage = defined(await service.calls('moderator', { roomId: 'kitchen' }), 'the calls for a moderator');
  assert.equal(moderatorPage.calls[0]?.badFeedback, undefined);
  assert.equal(moderator.call.stays[0]?.location, null, 'where a stay came from is not for a moderator');

  assert.equal(await service.call('admin', '00000000-0000-4000-8000-000000000000'), undefined);
  assert.equal(await service.call('stranger', listed.id), null);

  await createVoiceSessionRepository({ pool }).forgetRoomsBefore(new Date(NOW));
  const { rows } = await pool.query<{ one: number }>('SELECT 1 AS one FROM voice_call_events');
  assert.equal(rows.length, 0, 'the events go with the history');
});

test('an answer given once the next call began is about that one, on its page as in the list', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const start = NOW - 2 * HOUR;
  await createVoiceSessionRepository({ pool }).recordSessions([
    stay('kitchen', start, start + 3 * MINUTE, { guestName: 'Петя' }),
    stay('kitchen', start + 10 * MINUTE, start + 12 * MINUTE, { guestName: 'Вася' })
  ]);
  await answer(pool, 'kitchen', start + 5 * MINUTE, 'bad');
  await answer(pool, 'kitchen', start + 11 * MINUTE, 'bad');
  await answer(pool, 'kitchen', start + 13 * MINUTE, 'bad');

  const service = serviceOver(pool);
  const page = defined(await service.calls('admin', { roomId: 'kitchen' }), 'the calls');
  assert.deepEqual(
    page.calls.map((call) => call.badFeedback),
    [2, 1],
    'the latest call first'
  );
  assert.equal(Object.hasOwn(defined(page.calls[0], 'the call'), 'feedbackUntil'), false);
  const [later, earlier] = page.calls;
  const detailOf = async (id: string | undefined) =>
    defined(await service.call('admin', defined(id, 'the call id')), 'the call in full').feedback?.length;
  assert.equal(await detailOf(earlier?.id), 1);
  assert.equal(await detailOf(later?.id), 2);
});

test('a call going on joins those still in it to those already gone, and ends with it', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await seedPeople(pool);
  await seedRoom(pool, 'kitchen', 'Кухня', ALICE_ID);
  const start = NOW - 10 * MINUTE;
  await createVoiceSessionRepository({ pool }).recordSessions([
    // Joined a moment before the room counted its call as begun, and gone already.
    stay('kitchen', start - 1, start + 40_000, { guestName: 'Первый' }),
    stay('kitchen', start + MINUTE, start + 2 * MINUTE, { guestName: 'Петя' }),
    stay('kitchen', start - HOUR, start - 50 * MINUTE, { guestName: 'Прошлый звонок' })
  ]);
  const peer: PresencePeer = {
    id: 'p-1',
    joinedAt: start,
    accountUserId: ALICE_ID,
    ip: '127.0.0.1',
    voice: {
      reportedAt: NOW - 1000,
      rttMs: null,
      jitterBufferMs: null,
      heard: new Map(),
      uplink: [],
      verdict: null,
      minutes: [minute(start, GOOD)],
      events: [{ at: start + 30_000, kind: 'camera_on' }],
      cpuPressure: 'fair',
      relieved: false
    }
  };
  const service = serviceOver(pool, [{ id: 'kitchen', peers: new Map([['p-1', peer]]) }]);

  const detail = defined(await service.liveCall('admin', 'kitchen'), 'the live call');
  assert.equal(detail.call.endedAt, NOW);
  assert.deepEqual(
    detail.call.stays.map((one) => one.account?.login ?? one.guestName),
    ['Первый', 'alice', 'Петя']
  );
  assert.equal(detail.call.stays[1]?.location, 'Москва');
  assert.equal(detail.call.stays[1]?.minutes?.[0]?.level, 'good');
  assert.deepEqual(
    detail.events?.map((event) => event.kind),
    ['join', 'join', 'camera_on', 'leave', 'join', 'leave'],
    'someone still in it has not left'
  );

  assert.equal(await service.liveCall('admin', 'empty'), undefined);
  assert.equal(await service.liveCall('stranger', 'kitchen'), null);
  const live = defined(await service.live('admin'), 'the live rooms');
  assert.equal(live.rooms[0]?.peers[0]?.cpuPressure, 'fair');

  // A tab that stopped polling no longer says how its computer is doing.
  if (peer.voice) peer.voice.reportedAt = NOW - 10 * MINUTE;
  const stale = defined(await service.live('admin'), 'the live rooms');
  assert.equal(stale.rooms[0]?.peers[0]?.cpuPressure, null);
});

test('the persistent rooms carry their 30 days; a filter counts whatever is searched', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await seedPeople(pool);
  await seedRoom(pool, 'busy', 'Рейд', ALICE_ID);
  await seedRoom(pool, 'rough', 'Лобби', BOB_ID);
  await seedRoom(pool, 'silent', 'Тишина', BOB_ID);
  await seedRoom(pool, 'throwaway', '', ALICE_ID, false);
  await pool.query(
    `INSERT INTO room_memberships (id, room_id, user_id) VALUES (gen_random_uuid(), 'busy', $1), (gen_random_uuid(), 'busy', $2)`,
    [ALICE_ID, BOB_ID]
  );
  const yesterday = NOW - DAY;
  await createVoiceSessionRepository({ pool }).recordSessions([
    stay('busy', yesterday, yesterday + 30 * MINUTE, { userId: ALICE_ID }, [minute(yesterday, GOOD)]),
    stay('busy', yesterday + MINUTE, yesterday + 20 * MINUTE, { userId: BOB_ID }),
    stay('busy', yesterday + HOUR, yesterday + 2 * HOUR, { userId: ALICE_ID }),
    stay('rough', NOW - 20 * DAY, NOW - 20 * DAY + 5 * MINUTE, { guestName: 'Петя' }, [
      minute(NOW - 20 * DAY, BAD),
      minute(NOW - 20 * DAY + MINUTE, GOOD)
    ]),
    stay('throwaway', yesterday, yesterday + MINUTE, { guestName: 'Вася' })
  ]);

  const service = serviceOver(pool, [{ id: 'silent', peers: new Map([['p-1', { id: 'p-1', joinedAt: NOW }]]) }]);
  const all = defined(await service.staticRooms('admin', { sort: 'voice' }), 'the rooms');
  assert.deepEqual(
    all.rooms.map((room) => room.id),
    ['busy', 'rough', 'silent'],
    'a temporary room is not listed, the most minutes come first'
  );
  assert.deepEqual(all.counts, { all: 3, active: 2, trouble: 1, quiet: 0 });
  assert.equal(all.total, 3);
  const busy = defined(all.rooms[0], 'busy');
  assert.deepEqual(
    [busy.calls30d, busy.voiceMinutes30d, busy.members, busy.live, busy.owner?.login],
    [2, 109, 2, false, 'alice']
  );
  assert.deepEqual(busy.quality30d, { good: 1, unstable: 0, bad: 0 });
  assert.equal(busy.lastCallAt, yesterday + 2 * HOUR);
  assert.equal(all.rooms[2]?.live, true, 'someone in its voice now');
  assert.equal(all.rooms[2]?.quality30d, null);

  const trouble = defined(await service.staticRooms('admin', { filter: 'trouble' }), 'the rooms in trouble');
  assert.deepEqual(
    trouble.rooms.map((room) => room.id),
    ['rough']
  );
  const searched = defined(await service.staticRooms('admin', { q: 'bob' }), 'found by the owner');
  assert.deepEqual(searched.rooms.map((room) => room.id).sort(), ['rough', 'silent']);
  assert.equal(searched.total, 2);
  assert.equal(searched.counts.all, 3, 'what a filter holds does not depend on the search');
  const quiet = defined(await serviceOver(pool).staticRooms('admin', { filter: 'quiet' }), 'the empty rooms');
  assert.deepEqual(
    quiet.rooms.map((room) => room.id),
    ['silent'],
    'nobody is in it now, and no call was ever kept'
  );
  assert.equal(await service.staticRooms('stranger'), null);
});

test('an account shows its voice and its computer of 30 days, and its calls can be picked', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await seedPeople(pool);
  await seedRoom(pool, 'kitchen', 'Кухня', ALICE_ID);
  const cpu = (pressureMax: 'critical' | 'fair', relieved = false) => ({
    appPctSum: 30,
    systemPctSum: 150,
    polls: 2,
    pressureMax,
    relieved
  });
  const start = NOW - DAY;
  await createVoiceSessionRepository({ pool }).recordSessions([
    stay('kitchen', start, start + 3 * MINUTE, { userId: ALICE_ID }, [
      minute(start, BAD, cpu('critical', true)),
      minute(start + MINUTE, GOOD, cpu('fair')),
      minute(start + 2 * MINUTE, GOOD)
    ]),
    stay('kitchen', start + HOUR, start + HOUR + MINUTE, { userId: BOB_ID }, [minute(start + HOUR, GOOD)]),
    // Older than the 30 days: it counts for nothing here.
    stay('kitchen', NOW - 40 * DAY, NOW - 40 * DAY + MINUTE, { userId: BOB_ID }, [minute(NOW - 40 * DAY, BAD)])
  ]);

  const accounts = createAdminAccountsRepository({ pool });
  const query = {
    q: '',
    filter: 'all' as const,
    sort: 'quality' as const,
    order: 'desc' as const,
    page: 1,
    onlineIds: [BOB_ID]
  };
  const list = await accounts.list(query, NOW);
  assert.deepEqual(
    list.accounts.map((account) => [account.login, account.voiceQuality30d]),
    [
      ['alice', { good: 2, unstable: 0, bad: 1 }],
      ['bob', { good: 1, unstable: 0, bad: 0 }]
    ]
  );
  assert.equal(list.total, 2);
  assert.equal(list.counts.all, 2);
  assert.equal(list.counts.online, 1);
  assert.equal(list.counts.trouble, 1);
  assert.equal(list.cpuOverloaded, 1, 'alice overloaded in her one reported stay');

  const trouble = await accounts.list({ ...query, filter: 'trouble', q: 'ali' }, NOW);
  assert.deepEqual(
    trouble.accounts.map((account) => account.login),
    ['alice']
  );
  const nobody = await accounts.list({ ...query, q: 'nobody' }, NOW);
  assert.equal(nobody.total, 0);
  assert.equal(nobody.counts.all, 2, 'what a filter holds does not depend on the search');

  const alice = defined(await accounts.detail(ALICE_ID, NOW), 'alice');
  assert.deepEqual(alice.voice30d, {
    minutes: 3,
    quality: { good: 2, unstable: 0, bad: 1 },
    rttAvgMs: 100,
    uplinkLossPct: 5,
    jitterBufferAvgMs: 30,
    transport: { udp: 100, tcp: 0, relay: 0 }
  });
  assert.deepEqual(alice.cpu30d, { appAvgPct: 15, systemAvgPct: 75, calls: 1, criticalCalls: 1, relievedCalls: 1 });
  const bob = defined(await accounts.detail(BOB_ID, NOW), 'bob');
  assert.equal(bob.cpu30d, null, 'his client reported nothing');
  const nothing = await accounts.list({ ...query, q: 'alice', filter: 'gone' }, NOW);
  assert.equal(nothing.accounts.length, 0);

  const service = serviceOver(pool);
  const calls = defined(await service.calls('admin', { accountId: BOB_ID }), "bob's calls");
  assert.equal(calls.calls.length, 2, "his two calls, each whole, and nothing of alice's alone");
});

test('the overview counts finished calls, leaves those going on, and names the open reports', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const stats = createAdminStatsRepository({ pool });
  const none = await stats.overview();
  assert.deepEqual([none.callsToday, none.callsYesterday], [0, 0]);
  assert.equal(none.oldestOpenReportAt, null);
  assert.deepEqual(none.openReportReasons, []);

  // Moscow's day starts here; the moments are placed around it.
  const { rows } = await pool.query<{ start: Date }>(
    `SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow' AS start`
  );
  const today = defined(rows[0], 'the day').start.getTime();
  await createVoiceSessionRepository({ pool }).recordSessions([
    // Across midnight: it belongs to both days.
    stay('a', today - MINUTE, today + MINUTE, { guestName: 'Петя' }),
    stay('b', today - 3 * HOUR, today - 2 * HOUR, { guestName: 'Петя' }),
    stay('old', today - 3 * DAY, today - 3 * DAY + MINUTE, { guestName: 'Петя' }),
    // Already gone from a call that goes on.
    stay('live', today + 10_000, today + 20_000, { guestName: 'Петя' })
  ]);
  const counted = await stats.overview([{ roomId: 'live', since: today }]);
  assert.deepEqual([counted.callsToday, counted.callsYesterday], [1, 2]);
  const withLive = await stats.overview();
  assert.equal(withLive.callsToday, 2, 'once over, it counts');

  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'alice', 'Алиса', 'x')`, [
    ALICE_ID
  ]);
  const oldest = NOW - 5 * HOUR;
  await pool.query(
    `INSERT INTO content_reports (target_kind, room_id, message_id, reporter_user_id, reason, created_at, status, resolved_at)
     VALUES ('room_message', 'a', gen_random_uuid(), $1, 'spam', $2, 'open', NULL),
            ('room_message', 'a', gen_random_uuid(), $1, 'abuse', $3, 'open', NULL),
            ('room_message', 'a', gen_random_uuid(), $1, 'other', $2, 'dismissed', $2)`,
    [ALICE_ID, new Date(oldest), new Date(NOW)]
  );
  const reported = await stats.overview();
  assert.equal(reported.oldestOpenReportAt, oldest);
  assert.deepEqual(reported.openReportReasons.sort(), ['abuse', 'spam']);
});

test('over HTTP a call is for staff only, and an unknown one is not found', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-admin-call-',
    env: { AUTH_RATE_LIMIT: '0', PLATFORM_ADMIN_USER_IDS: ADMIN_ID }
  });
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
  const start = NOW - HOUR;
  await createVoiceSessionRepository({ pool }).recordSessions([
    stay('kitchen', start, start + MINUTE, { guestName: 'Петя' }, [minute(start, GOOD)])
  ]);
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM voice_sessions');
  const callId = defined(rows[0], 'the stay').id;

  const pathname = `/api/admin/rooms/calls/${callId}`;
  assert.equal((await request(socketPath, { pathname })).status, 401);
  const denied = await request(socketPath, { pathname, cookie: alice }, Failure);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'platform_admin_required');

  const found = await request(socketPath, { pathname, cookie: admin }, RoomCallDetail);
  assert.equal(found.status, 200);
  assert.equal(found.body.call.stays[0]?.guestName, 'Петя');

  const missing = await request(
    socketPath,
    { pathname: '/api/admin/rooms/calls/00000000-0000-4000-8000-000000000000', cookie: admin },
    Failure
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'call_not_found');
  const notLive = await request(socketPath, { pathname: '/api/admin/rooms/live/kitchen', cookie: admin }, Failure);
  assert.equal(notLive.status, 404);
  assert.equal(notLive.body.code, 'call_not_found');
  assert.equal((await request(socketPath, { pathname: '/api/admin/rooms/calls/nope', cookie: admin })).status, 400);

  const rooms = await request(socketPath, { pathname: '/api/admin/rooms/static', cookie: admin }, StaticRooms);
  assert.equal(rooms.status, 200);
  assert.deepEqual(rooms.body.counts, { all: 0, active: 0, trouble: 0, quiet: 0 });
  assert.equal((await request(socketPath, { pathname: '/api/admin/rooms/static', cookie: alice })).status, 403);
});

test('the call page data rolls back and forth cleanly', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await createVoiceSessionRepository({ pool }).recordSessions([
    stay(
      'kitchen',
      NOW - HOUR,
      NOW - HOUR + MINUTE,
      {},
      [minute(NOW - HOUR, GOOD, { appPctSum: 1, systemPctSum: 2, polls: 1, pressureMax: 'fair', relieved: false })],
      [{ at: NOW - HOUR, kind: 'screen_on' }]
    )
  ]);
  await assert.rejects(
    pool.query(`INSERT INTO voice_call_events (stay_id, at, kind) SELECT id, now(), 'nonsense' FROM voice_sessions`),
    /voice_call_events_kind_check/
  );

  await rollBackThrough(databaseUrl, '20261104120000_keep_voice_stay_cpu_and_events');
  await assert.rejects(pool.query('SELECT 1 FROM voice_call_events'), /does not exist/);
  await assert.rejects(pool.query('SELECT cpu_polls FROM voice_session_samples'), /does not exist/);
  const kept = await pool.query<{ one: number }>('SELECT 1 AS one FROM voice_session_samples');
  assert.equal(kept.rows.length, 1, 'the minutes stay');

  await runMigrations({ databaseUrl, logger: SILENT });
  const { rows } = await pool.query<{ cpu_polls: number; cpu_relieved: boolean }>(
    'SELECT cpu_polls, cpu_relieved FROM voice_session_samples'
  );
  assert.deepEqual(rows, [{ cpu_polls: 0, cpu_relieved: false }], 'older minutes read as nothing reported');
});
