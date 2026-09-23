import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relative) => fs.readFileSync(path.resolve(import.meta.dirname, relative), 'utf8');

test('reading a room retires the notifications that room produced', () => {
  const server = read('../src/server.js');

  // A read and its notification are two records of the same event. Kept apart,
  // the bell went on claiming unread mentions for messages already read, and
  // said so again after every reload because nothing was ever written down.
  assert.match(server, /async function retireRoomNotifications\(roomId, userId, through\)/);
  assert.match(server, /service\.markRoomRead\(\{ userId, roomId, through: through \?\? null \}\)/);

  // Both read paths retire: the cursor one and the legacy wall-clock one.
  assert.match(server, /await retireRoomNotifications\(roomId, user\.id, result\.readThrough\)/);
  assert.match(server, /await retireRoomNotifications\(roomId, user\.id, lastReadAt\)/);

  // Best effort: a read that already succeeded must not fail over this.
  const start = server.indexOf('async function retireRoomNotifications');
  const body = server.slice(start, server.indexOf('\n}', start));
  assert.match(body, /try \{/);
  assert.match(body, /catch \(error\)/);
});

test('the read service reports how far the read reached', () => {
  const service = read('../src/domains/messaging/message-read-service.js');

  // The caller needs the read point to bound which notifications it retires.
  assert.match(service, /readThrough: state\.last_read_message_created_at \?\? null/);
});

test('retirement is scoped to one room and bounded by the read point', () => {
  const repository = read('../src/domains/notifications/inbox-repository.js');
  const service = read('../src/domains/notifications/notification-service.js');

  assert.match(repository, /async function markReadForRoom\(/);
  // Scoped to the recipient and the room, and never past what was read: a null
  // bound means the whole room, which is what a legacy read reports.
  assert.match(repository, /recipient_user_id=\$1 AND room_id=\$2 AND read_at IS NULL/);
  assert.match(repository, /\(\$3::timestamptz IS NULL OR created_at <= \$3\)/);
  assert.match(repository, /markReadForRoom,/);

  assert.match(service, /async function markRoomRead\(\{userId,roomId,through=null\}\)/);
  assert.match(service, /if\(!userId\|\|!roomId\)return \{ok:false,code:'invalid_request'\}/);
  assert.match(service, /markRoomRead,/);
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
  const { createInboxRepository } = require('../src/domains/notifications/inbox-repository');
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
  const { createInboxRepository } = require('../src/domains/notifications/inbox-repository');
  const client = recordingClient();
  const repository = createInboxRepository({ pool: client });

  assert.deepEqual(
    await repository.markReadForRoom({ recipientUserId: 'user-1', roomId: 'room-1', through: 'not a time', client }),
    { updated: 0, revision: null }
  );
  assert.deepEqual(await repository.markAllRead({ recipientUserId: 'user-1', through: Number.NaN, client }), { updated: 0, revision: null });
  assert.equal(client.updates.length, 0);
});
