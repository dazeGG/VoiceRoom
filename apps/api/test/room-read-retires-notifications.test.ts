import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createInboxRepository } from '../src/domains/notifications/inbox.repository.ts';
import { createNotificationService } from '../src/domains/notifications/notification.service.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const skip = !process.env.TEST_DATABASE_URL;
const READ_POINT = Date.parse('2026-08-01T11:00:00Z');

async function seed(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} }, noLock: true });
  await pool.query(`
    INSERT INTO users(id, login, display_name, password_hash) VALUES ('a', 'ra', 'A', 'x'), ('me', 'rme', 'Me', 'x'), ('other', 'rother', 'O', 'x');
    INSERT INTO rooms(id, creator_ip) VALUES ('room', ''), ('elsewhere', '');
    INSERT INTO room_messages(id, room_id, text) VALUES ('m1', 'room', 'x'), ('m2', 'room', 'x'), ('m3', 'elsewhere', 'x'), ('m4', 'room', 'x');
    INSERT INTO user_notifications(id, recipient_user_id, actor_user_id, room_id, source_message_id, reasons, revision, created_at) VALUES
      ('old', 'me', 'a', 'room', 'm1', ARRAY['mention'], 1, '2026-08-01T10:00:00Z'),
      ('new', 'me', 'a', 'room', 'm2', ARRAY['mention'], 2, '2026-08-01T12:00:00Z'),
      ('other-room', 'me', 'a', 'elsewhere', 'm3', ARRAY['mention'], 3, '2026-08-01T10:00:00Z'),
      ('other-user', 'other', 'a', 'room', 'm4', ARRAY['mention'], 4, '2026-08-01T10:00:00Z')`);
  const inbox = createInboxRepository({ pool });
  const unread = async () =>
    (await pool.query<{ id: string }>(`SELECT id FROM user_notifications WHERE read_at IS NULL ORDER BY id`)).rows.map(
      (row) => row.id
    );
  return { pool, inbox, unread };
}

// Reading a room retires the bell notifications that room produced, up to the
// read point: kept apart, the bell claimed unread mentions for messages already
// read. (The room chat service calling this on both read paths is covered in
// room-chat-domain.test.ts.)
test('retirement is scoped to the reader and the room and bounded by the read point', { skip }, async (t) => {
  const { pool, inbox, unread } = await seed(t);
  const service = createNotificationService({ pool, inbox });

  assert.deepEqual(await service.markRoomRead({ userId: '', roomId: 'room' }), {
    ok: false,
    code: 'invalid_request'
  });
  const bounded = await service.markRoomRead({ userId: 'me', roomId: 'room', through: READ_POINT });
  assert.equal(bounded.updated, 1);
  assert.deepEqual(await unread(), ['new', 'other-room', 'other-user']);

  // A legacy read reports no bound: the whole room.
  await service.markRoomRead({ userId: 'me', roomId: 'room', through: null });
  assert.deepEqual(await unread(), ['other-room', 'other-user']);
});

// The legacy room read reports milliseconds; that number used to reach
// `::timestamptz` as "1789427934720" and fail every read of the room.
test(
  'a read point in epoch milliseconds, a Date or an ISO string bounds the read the same way',
  { skip },
  async (t) => {
    for (const through of [READ_POINT, new Date(READ_POINT), new Date(READ_POINT).toISOString()]) {
      const { inbox, unread } = await seed(t);
      const result = await inbox.markReadForRoom({ recipientUserId: 'me', roomId: 'room', through });
      assert.deepEqual(result, { updated: 1, revision: 4 }, `read through ${String(through)}`);
      assert.deepEqual(await unread(), ['new', 'other-room', 'other-user']);
    }

    // All notifications are bounded the same way.
    // Revisions are counted per recipient: 'me' is at 3.
    const { inbox, unread } = await seed(t);
    assert.deepEqual(await inbox.markAllRead({ recipientUserId: 'me', through: READ_POINT }), {
      updated: 2,
      revision: 4
    });
    assert.deepEqual(await unread(), ['new', 'other-user']);
    assert.deepEqual(await inbox.markAllRead({ recipientUserId: 'me' }), { updated: 1, revision: 5 });
    assert.deepEqual(await inbox.markAllRead({ recipientUserId: 'me' }), { updated: 0, revision: null });
  }
);

test('a read point that is not a time retires nothing instead of the whole room', { skip }, async (t) => {
  const { inbox, unread } = await seed(t);
  assert.deepEqual(await inbox.markReadForRoom({ recipientUserId: 'me', roomId: 'room', through: 'not a time' }), {
    updated: 0,
    revision: null
  });
  assert.deepEqual(await inbox.markAllRead({ recipientUserId: 'me', through: Number.NaN }), {
    updated: 0,
    revision: null
  });
  assert.deepEqual(await unread(), ['new', 'old', 'other-room', 'other-user']);
});
