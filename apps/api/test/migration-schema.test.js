
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const migration = require('../src/migrations/20260614144500_create_rooms_and_room_messages');

function createRecorder() {
  const calls = [];
  return {
    calls,
    func(value) {
      return { raw: value };
    },
    createTable(name, columns) {
      calls.push({ type: 'createTable', name, columns });
    },
    createIndex(table, columns, options) {
      calls.push({ type: 'createIndex', table, columns, options });
    },
    dropTable(name) {
      calls.push({ type: 'dropTable', name });
    }
  };
}

test('rooms and room_messages migration captures durable schema contract', () => {
  const pgm = createRecorder();
  migration.up(pgm);

  const rooms = pgm.calls.find((call) => call.type === 'createTable' && call.name === 'rooms');
  const messages = pgm.calls.find((call) => call.type === 'createTable' && call.name === 'room_messages');

  assert.ok(rooms, 'rooms table is created');
  assert.ok(messages, 'room_messages table is created');
  for (const column of ['id', 'creator_ip', 'is_static', 'created_at', 'updated_at', 'empty_since', 'deleted_at', 'metadata']) {
    assert.ok(rooms.columns[column], `rooms.${column} exists`);
  }
  for (const column of ['id', 'room_id', 'peer_id', 'name', 'text', 'created_at', 'expires_at', 'deleted_at', 'metadata']) {
    assert.ok(messages.columns[column], `room_messages.${column} exists`);
  }

  assert.equal(rooms.columns.metadata.type, 'jsonb');
  assert.equal(messages.columns.metadata.type, 'jsonb');
  assert.equal(messages.columns.room_id.references, 'rooms(id)');
  assert.equal(messages.columns.room_id.onDelete, 'CASCADE');
});

test('rooms and room_messages migration defines lookup, quota, idle, listing, and expiry indexes', () => {
  const pgm = createRecorder();
  migration.up(pgm);

  const indexes = new Map(
    pgm.calls
      .filter((call) => call.type === 'createIndex')
      .map((call) => [call.options.name, call])
  );

  assert.deepEqual(indexes.get('rooms_active_id_idx').columns, ['id']);
  assert.match(indexes.get('rooms_active_id_idx').options.where, /deleted_at IS NULL/);
  assert.deepEqual(indexes.get('rooms_quota_idx').columns, ['creator_ip', 'is_static']);
  assert.deepEqual(indexes.get('rooms_idle_prune_idx').columns, ['empty_since']);
  assert.deepEqual(indexes.get('room_messages_room_created_idx').columns, ['room_id', 'created_at', 'id']);
  assert.deepEqual(indexes.get('room_messages_expiry_idx').columns, ['expires_at']);
});

test('rooms migration down drops child table before parent table', () => {
  const pgm = createRecorder();
  migration.down(pgm);

  assert.deepEqual(
    pgm.calls.filter((call) => call.type === 'dropTable').map((call) => call.name),
    ['room_messages', 'rooms']
  );
});
