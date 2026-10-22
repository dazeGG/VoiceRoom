// The admin rooms section's calls over a migrated database: stays in one room
// that overlap (or touch) are one call, a gap starts another; calls come the
// latest end first, a page at a time, of one room or of a span; a call someone
// is still in stays with the live rooms; where people came from is only for
// those who may see it. And over HTTP the calls are staff-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { SignedIn } from '@voice-room/shared/contracts/account';
import { Failure } from '@voice-room/shared/contracts/http';
import { ROOM_CALLS_PAGE_SIZE, RoomCalls } from '@voice-room/shared/contracts/admin';
import type { StaffPermission } from '@voice-room/shared/contracts/staff';
import { createAdminRoomsRepository } from '../src/domains/admin/admin-rooms.repository.ts';
import { createAdminRoomsService } from '../src/domains/admin/admin-rooms.service.ts';
import { hashPassword } from '../src/lib/password.ts';
import type { PresencePeer } from '../src/domains/rooms/room-views.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { cookieFrom, registerAccount, request, startApiServer } from './fakes/server-process.ts';
import { staffCookie } from './staff-session.ts';
import { defined } from './helpers/assert-defined.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const MINUTE = 60_000;
const BASE = Date.parse('2026-10-20T10:00:00Z');
const at = (minutes: number) => new Date(BASE + minutes * MINUTE).toISOString();

type Queryable = Pick<Pool, 'query'>;

async function stay(
  pool: Queryable,
  roomId: string,
  from: number,
  to: number,
  who: { userId?: string; guestName?: string; ipKey?: string } = {}
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO voice_sessions (room_id, user_id, guest_name, ip_key, location, joined_at, left_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      roomId,
      who.userId ?? null,
      who.guestName ?? null,
      who.ipKey ?? null,
      who.ipKey ? 'Москва, Россия' : null,
      at(from),
      at(to)
    ]
  );
  return defined(rows[0], 'the stay').id;
}

function serviceOver(pool: Pool, presence: { id: string; peers: Map<string, PresencePeer> }[] = []) {
  const permissions: Record<string, readonly StaffPermission[]> = {
    admin: ['rooms.view', 'origin.view'],
    moderator: ['rooms.view']
  };
  return createAdminRoomsService({
    staff: { can: (userId, permission) => Promise.resolve(permissions[userId]?.includes(permission) ?? false) },
    presenceRooms: () => presence,
    repository: () => createAdminRoomsRepository({ pool }),
    describeAddress: () => Promise.resolve({ ipKey: null, location: '' })
  });
}

test('overlapping stays in a room are one call, a gap starts the next', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(`INSERT INTO rooms (id, creator_ip, is_static, name) VALUES ('kitchen', '', true, 'Кухня')`);

  // 10:00–11:30: Петя, then Вася while Петя is in, then Оля the minute Вася leaves.
  const first = await stay(pool, 'kitchen', 0, 60, { guestName: 'Петя', ipKey: 'aaaa' });
  await stay(pool, 'kitchen', 30, 80, { guestName: 'Вася' });
  await stay(pool, 'kitchen', 80, 90, { guestName: 'Оля' });
  // 12:00–12:30, after the voice stood empty; and a room that is gone, in the middle.
  await stay(pool, 'kitchen', 120, 150, { guestName: 'Петя' });
  await stay(pool, 'gone-room', 100, 110, { guestName: 'Кто-то' });

  const service = serviceOver(pool);
  const page = defined(await service.calls('admin', {}), 'the calls');
  assert.deepEqual(
    page.calls.map((call) => [call.roomId, call.roomName, call.startedAt, call.endedAt, call.stays.length]),
    [
      ['kitchen', 'Кухня', BASE + 120 * MINUTE, BASE + 150 * MINUTE, 1],
      ['gone-room', null, BASE + 100 * MINUTE, BASE + 110 * MINUTE, 1],
      ['kitchen', 'Кухня', BASE, BASE + 90 * MINUTE, 3]
    ]
  );
  const morning = defined(page.calls[2], 'the morning call');
  assert.equal(morning.id, first, "a call goes by its first stay's id");
  assert.deepEqual(
    morning.stays.map((one) => one.guestName),
    ['Петя', 'Вася', 'Оля'],
    'in the order people joined'
  );
  assert.equal(morning.stays[0]?.ipKey, 'aaaa');
  assert.equal(page.next, null);
  assert.equal(page.keepDays, 90);

  // A moderator sees who and when, not where from.
  const moderated = defined(await service.calls('moderator', {}), 'the calls for a moderator');
  assert.deepEqual(
    moderated.calls.flatMap((call) => call.stays.map((one) => [one.ipKey, one.location])),
    Array.from({ length: 5 }, () => [null, null])
  );
  assert.equal(await service.calls('someone', {}), null, 'nobody else');

  // One room, and the calls overlapping a span.
  const kitchen = defined(await service.calls('admin', { roomId: 'kitchen' }), 'the kitchen');
  assert.equal(kitchen.calls.length, 2);
  const span = defined(
    await service.calls('admin', { from: String(BASE + 85 * MINUTE), to: String(BASE + 105 * MINUTE) }),
    'the span'
  );
  assert.deepEqual(
    span.calls.map((call) => call.roomId),
    ['gone-room', 'kitchen']
  );
});

test('the calls come a page at a time, none on two pages', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  // Two calls end at the same moment: the cursor tells them apart by id.
  await stay(pool, 'a-room', -20, 0);
  await stay(pool, 'b-room', -10, 0);
  for (let n = 1; n <= ROOM_CALLS_PAGE_SIZE; n += 1) await stay(pool, 'a-room', n * 10, n * 10 + 5);

  const service = serviceOver(pool);
  const first = defined(await service.calls('admin', {}), 'the first page');
  assert.equal(first.calls.length, ROOM_CALLS_PAGE_SIZE);
  assert.ok(first.next);
  const second = defined(await service.calls('admin', { after: first.next }), 'the second page');
  assert.equal(second.calls.length, 2);
  assert.equal(second.next, null);
  const ids = [...first.calls, ...second.calls].map((call) => call.id);
  assert.equal(new Set(ids).size, ROOM_CALLS_PAGE_SIZE + 2);
});

test('a call someone is still in is left to the live rooms', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await stay(pool, 'kitchen', 0, 30, { guestName: 'Ушёл раньше' });
  await stay(pool, 'kitchen', 60, 70, { guestName: 'Ушёл' });

  // Someone came in at 10:65 and is still there: the 10:60–10:70 call goes on.
  const peers = new Map<string, PresencePeer>([['p-1', { id: 'p-1', joinedAt: BASE + 65 * MINUTE }]]);
  const page = defined(await serviceOver(pool, [{ id: 'kitchen', peers }]).calls('admin', {}), 'the calls');
  assert.deepEqual(
    page.calls.map((call) => call.stays.map((one) => one.guestName)),
    [['Ушёл раньше']]
  );
});

test('over HTTP the calls are for staff only, and a malformed cursor is refused', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-admin-calls-',
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
  await stay(pool, 'kitchen', 0, 30, { guestName: 'Петя' });

  const pathname = '/api/admin/rooms/calls';
  assert.equal((await request(socketPath, { pathname })).status, 401);
  const denied = await request(socketPath, { pathname, cookie: alice }, Failure);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'platform_admin_required');

  const page = await request(socketPath, { pathname, cookie: admin }, RoomCalls);
  assert.equal(page.status, 200);
  assert.deepEqual(
    page.body.calls.map((call) => call.stays.map((one) => one.guestName)),
    [['Петя']]
  );
  assert.equal((await request(socketPath, { pathname: `${pathname}?after=yesterday`, cookie: admin })).status, 400);
  assert.equal((await request(socketPath, { pathname: `${pathname}?from=soon`, cookie: admin })).status, 400);
});
