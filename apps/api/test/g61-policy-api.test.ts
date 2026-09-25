import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { normalizeNotificationLevel } from '@voice-room/shared/notifications';
import { createNotificationService, type RoomLevelStore } from '../src/domains/notifications/notification-service.ts';
import type { InboxRepository } from '../src/domains/notifications/inbox-repository.ts';
import { createNotificationStore } from '../src/lib/notification-store.ts';
import { createRoomStore } from '../src/lib/room-store.ts';
import { createUserStore } from '../src/lib/user-store.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { fake, fakeDb } from './fakes/index.ts';
const SILENT = { log() {}, info() {}, warn() {}, error() {} };
async function fixture(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const users = createUserStore({ pool, logger: SILENT });
  const rooms = createRoomStore({ pool });
  const created = await users.createUser({ login: 'g61-user', displayName: 'G61 User', password: 'password123' });
  assert.equal(created.status, 'created');
  assert.ok(created.user);
  await rooms.createRoomWithQuota({
    roomId: 'g61-room',
    creatorIp: '127.0.0.1',
    isStatic: true,
    ownerId: created.user.id
  });
  return { cleanup, databaseUrl, pool, rooms, users, userId: created.user.id, roomId: 'g61-room' };
}
test('G61-A01 only all mentions none validate', () => {
  assert.equal(normalizeNotificationLevel('all'), 'all');
  assert.equal(normalizeNotificationLevel('mentions'), 'mentions');
  assert.equal(normalizeNotificationLevel('none'), 'none');
  assert.equal(normalizeNotificationLevel('loud'), 'mentions');
});
test('G61-A02 PostgreSQL persists explicit levels across restart and keeps missing rows conservative', async (t) => {
  const f = await fixture(t);
  let store = createNotificationStore({ pool: f.pool });
  t.after(async () => {
    await f.cleanup();
  });
  assert.equal(await store.getRoomLevel(f), 'mentions');
  assert.deepEqual(await store.setRoomLevel({ ...f, level: 'all' }), { ok: true, level: 'all' });
  assert.equal(await store.getRoomLevel(f), 'all');
  store = createNotificationStore({ pool: f.pool });
  assert.equal(await store.getRoomLevel(f), 'all');
  for (const level of ['mentions', 'none']) {
    assert.deepEqual(await store.setRoomLevel({ ...f, level }), { ok: true, level });
    assert.equal(await store.getRoomLevel(f), level);
  }
  assert.equal(await store.isRoomMuted(f), true);
  await f.pool.query('DELETE FROM notification_room_mutes WHERE user_id = $1 AND room_id = $2', [f.userId, f.roomId]);
  assert.equal(await store.getRoomLevel(f), 'mentions');
});
test('G61-A03 explicit all replaces legacy mute and concurrent updates retain one valid preference', async (t) => {
  const f = await fixture(t);
  const store = createNotificationStore({ pool: f.pool });
  const pool = f.pool;
  t.after(async () => {
    await f.cleanup();
  });
  assert.equal((await store.setRoomMute({ ...f, muted: true })).status, 'muted');
  assert.equal(await store.getRoomLevel(f), 'none');
  assert.equal((await store.setRoomMute({ ...f, muted: false })).status, 'unmuted');
  assert.equal(await store.getRoomLevel(f), 'all');
  await store.setRoomMute({ ...f, muted: true });
  await store.setRoomLevel({ ...f, level: 'all' });
  assert.equal(await store.getRoomLevel(f), 'all');
  assert.equal(await store.isRoomMuted(f), false);
  assert.deepEqual((await store.getPreferences(f.userId)).mutedRoomIds, []);
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      store.setRoomLevel({ ...f, level: ['all', 'mentions', 'none'][index % 3] })
    )
  );
  const rows = await pool.query('SELECT level FROM notification_room_mutes WHERE user_id = $1 AND room_id = $2', [
    f.userId,
    f.roomId
  ]);
  assert.equal(rows.rowCount, 1);
  assert.ok(['all', 'mentions', 'none'].includes(rows.rows[0].level));
  await store.setRoomLevel({ ...f, level: 'all' });
  assert.equal(await store.getRoomLevel(f), 'all');
});
test('G61-A04 service preserves the explicit store level on GET and PUT paths', async () => {
  const calls: unknown[][] = [];
  const notificationStore: RoomLevelStore = {
    async getRoomLevel(value) {
      calls.push(['get', value]);
      return 'all' as const;
    },
    async setRoomLevel(value) {
      calls.push(['set', value]);
      return { ok: true, level: value.level };
    }
  };
  const service = createNotificationService({ pool: fakeDb(), inbox: fake<InboxRepository>(), notificationStore });

  assert.equal(await service.getRoomLevel({ userId: 'user', roomId: 'room' }), 'all');
  assert.deepEqual(await service.setRoomLevel({ userId: 'user', roomId: 'room', level: 'all' }), {
    ok: true,
    level: 'all'
  });
  assert.deepEqual(calls, [
    ['get', { userId: 'user', roomId: 'room' }],
    ['set', { userId: 'user', roomId: 'room', level: 'all' }]
  ]);
});
