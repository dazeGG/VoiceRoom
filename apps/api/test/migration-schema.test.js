
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const migration = require('../src/migrations/20260614144500_create_rooms_and_room_messages');
const membershipMigration = require('../src/migrations/20260615140000_create_room_memberships_and_bookmarks');

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
    createIndex(table, columns, options = {}) {
      calls.push({ type: 'createIndex', table, columns, options });
    },
    addConstraint(table, name, options) {
      calls.push({ type: 'addConstraint', table, name, options });
    },
    sql(text) {
      calls.push({ type: 'sql', text });
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


test('room memberships and bookmarks migration defines authoritative ownership tables', () => {
  const pgm = createRecorder();
  membershipMigration.up(pgm);

  const memberships = pgm.calls.find((call) => call.type === 'createTable' && call.name === 'room_memberships');
  const bookmarks = pgm.calls.find((call) => call.type === 'createTable' && call.name === 'room_bookmarks');
  assert.ok(memberships, 'room_memberships table is created');
  assert.ok(bookmarks, 'room_bookmarks table is created');

  assert.equal(memberships.columns.room_id.references, 'rooms(id)');
  assert.equal(memberships.columns.user_id.references, 'users(id)');
  assert.equal(memberships.columns.role.default, 'owner'.replace('owner', 'member'));
  assert.equal(bookmarks.columns.room_id.references, 'rooms(id)');
  assert.equal(bookmarks.columns.user_id.references, 'users(id)');

  const constraints = pgm.calls.filter((call) => call.type === 'addConstraint');
  assert.ok(constraints.some((call) => call.name === 'room_memberships_role_check'));

  const indexes = new Map(
    pgm.calls
      .filter((call) => call.type === 'createIndex')
      .map((call) => [call.options.name, call])
  );
  assert.deepEqual(indexes.get('room_memberships_room_user_unique_idx').columns, ['room_id', 'user_id']);
  assert.equal(indexes.get('room_memberships_room_user_unique_idx').options.unique, true);
  assert.deepEqual(indexes.get('room_bookmarks_user_room_unique_idx').columns, ['user_id', 'room_id']);
  assert.equal(indexes.get('room_bookmarks_user_room_unique_idx').options.unique, true);

  const backfill = pgm.calls.find((call) => call.type === 'sql' && /INSERT INTO room_memberships/.test(call.text));
  assert.ok(backfill, 'owner_id compatibility rows are backfilled');
  assert.match(backfill.text, /r\.owner_id IS NOT NULL/);
  assert.match(backfill.text, /r\.is_static = true/);
});

test('room memberships migration down drops bookmarks before memberships', () => {
  const pgm = createRecorder();
  membershipMigration.down(pgm);

  assert.deepEqual(
    pgm.calls.filter((call) => call.type === 'dropTable').map((call) => call.name),
    ['room_bookmarks', 'room_memberships']
  );
});
