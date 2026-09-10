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
