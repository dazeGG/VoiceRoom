'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

function statementAfter(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${marker}`);
  return source.slice(start, source.indexOf('RETURNING', start));
}

test('the cursor room read writes only columns room_chat_reads actually has', () => {
  const repository = read('../src/domains/messaging/message-read-repository.js');
  const migration = read('../src/migrations/20260718122000_add_message_read_cursors.js');
  const write = statementAfter(repository, 'INSERT INTO room_chat_reads');

  // 20260718122000 added updated_at only to the new direct_message_read_cursors
  // table. Writing it to room_chat_reads failed every cursor-based room read in
  // the database, so no read was stored and the unread count came back on
  // every reload.
  assert.doesNotMatch(write, /updated_at/);
  assert.match(write, /last_read_at, last_read_message_created_at, last_read_message_id/);

  const cursorsTable = migration.slice(migration.indexOf('direct_message_read_cursors'));
  assert.match(cursorsTable, /updated_at timestamptz NOT NULL DEFAULT current_timestamp/);
  assert.doesNotMatch(read('../src/migrations/20260714120000_create_room_chat_reads.js'), /updated_at/);
});

test('the DM read still stamps updated_at, which its table does have', () => {
  const repository = read('../src/domains/messaging/message-read-repository.js');
  const write = statementAfter(repository, 'INSERT INTO direct_message_read_cursors');

  assert.match(write, /updated_at/);
});

test('read writes bind the cursor\'s exact microseconds, never a millisecond Date', () => {
  const repository = read('../src/domains/messaging/message-read-repository.js');

  // node-pg returns created_at as a JS Date, which keeps only milliseconds.
  // Direct messages are stored to the microsecond, so binding that Date as the
  // read bound excluded the newest message itself: its read_at stayed NULL and
  // the unread badge came back on every reload.
  assert.doesNotMatch(repository, /message\.rows\[0\]\.created_at/);

  const exact = /TIMESTAMPTZ 'epoch' \+ \$3::bigint \* INTERVAL '1 microsecond'/;
  assert.match(statementAfter(repository, 'INSERT INTO room_chat_reads'), exact);
  assert.match(statementAfter(repository, 'INSERT INTO direct_message_read_cursors'), exact);

  const update = repository.slice(repository.indexOf('UPDATE direct_messages SET read_at'));
  assert.match(update.slice(0, update.indexOf('`,')), /\(created_at, id\) <= \(TIMESTAMPTZ 'epoch' \+ \$3::bigint \* INTERVAL '1 microsecond', \$4\)/);
  assert.match(repository, /\[userId, peerId, tuple\.createdAtMicros, message\.rows\[0\]\.id\]/);
  assert.match(repository, /\[peerId, userId, tuple\.createdAtMicros, message\.rows\[0\]\.id\]/);
  assert.match(repository, /\[roomId, userId, tuple\.createdAtMicros, message\.rows\[0\]\.id\]/);
});
