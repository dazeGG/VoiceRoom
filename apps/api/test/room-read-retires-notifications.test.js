'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

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
