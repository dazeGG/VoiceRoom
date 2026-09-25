// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { createInboxRepository } from '../src/domains/notifications/inbox-repository.ts';
import { createNotificationService } from '../src/domains/notifications/notification-service.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

// Reading a room retires the bell notifications that room produced, up to the
// read point: kept apart, the bell claimed unread mentions for messages already
// read. (The room chat service calling this on both read paths is covered in
// room-chat-domain.test.ts.)
test('retirement is scoped to the reader and the room and bounded by the read point', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const db = await createTestDatabase(t);
  await runMigrations({ databaseUrl: db.databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} }, noLock: true });
  const pool = new Pool({ connectionString: db.databaseUrl, max: 2 });
  t.after(async () => { await pool.end(); await db.cleanup(); });
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
  const service = createNotificationService({ pool, inbox });
  const unread = async () => (await pool.query<{ id: string }>(`SELECT id FROM user_notifications WHERE read_at IS NULL ORDER BY id`)).rows.map((row) => row.id);

  assert.deepEqual(await service.markRoomRead({ userId: '', roomId: 'room' }), { ok: false, code: 'invalid_request' });
  const bounded = await service.markRoomRead({ userId: 'me', roomId: 'room', through: Date.parse('2026-08-01T11:00:00Z') });
  assert.equal(bounded.updated, 1);
  assert.deepEqual(await unread(), ['new', 'other-room', 'other-user']);

  // A legacy read reports no bound: the whole room.
  await service.markRoomRead({ userId: 'me', roomId: 'room', through: null });
  assert.deepEqual(await unread(), ['other-room', 'other-user']);
});

// A client that records the UPDATE and answers the revision lookup, enough to
// see what the repository hands PostgreSQL without a database.
function recordingClient() {
  const updates = [];
  return {
    updates,
    async query(sql, params) {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/AS revision FROM user_notifications/.test(sql)) return { rows: [{ revision: 7 }] };
      if (/^UPDATE user_notifications/.test(sql)) {
        updates.push(params);
        return { rowCount: 2, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

test('a read point in epoch milliseconds reaches PostgreSQL as a time, not a number', async () => {
  const client = recordingClient();
  const repository = createInboxRepository({ pool: client });
  const readAt = 1789427934720;

  // The legacy room read reports milliseconds; that number used to reach
  // `$3::timestamptz` as "1789427934720" and fail every read of the room.
  const result = await repository.markReadForRoom({ recipientUserId: 'user-1', roomId: 'room-1', through: readAt, client });
  assert.deepEqual(result, { updated: 2, revision: 7 });
  const [recipient, room, bound, revision] = client.updates[0];
  assert.deepEqual([recipient, room, revision], ['user-1', 'room-1', 7]);
  assert.ok(bound instanceof Date);
  assert.equal(bound.getTime(), readAt);

  // A Date from a row and an ISO string mean the same point.
  await repository.markReadForRoom({ recipientUserId: 'user-1', roomId: 'room-1', through: new Date(readAt), client });
  await repository.markReadForRoom({ recipientUserId: 'user-1', roomId: 'room-1', through: new Date(readAt).toISOString(), client });
  assert.equal(client.updates[1][2].getTime(), readAt);
  assert.equal(client.updates[2][2].getTime(), readAt);

  // No bound still means the whole room.
  await repository.markReadForRoom({ recipientUserId: 'user-1', roomId: 'room-1', through: null, client });
  assert.equal(client.updates[3][2], null);

  // All notifications are bounded the same way.
  await repository.markAllRead({ recipientUserId: 'user-1', through: readAt, client });
  assert.equal(client.updates[4][1].getTime(), readAt);
});

test('a read point that is not a time retires nothing instead of the whole room', async () => {
  const client = recordingClient();
  const repository = createInboxRepository({ pool: client });

  assert.deepEqual(
    await repository.markReadForRoom({ recipientUserId: 'user-1', roomId: 'room-1', through: 'not a time', client }),
    { updated: 0, revision: null }
  );
  assert.deepEqual(await repository.markAllRead({ recipientUserId: 'user-1', through: Number.NaN, client }), { updated: 0, revision: null });
  assert.equal(client.updates.length, 0);
});
