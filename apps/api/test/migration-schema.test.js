
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const migration = require('../src/migrations/20260614144500_create_rooms_and_room_messages');
const membershipMigration = require('../src/migrations/20260615140000_create_room_memberships_and_bookmarks');
const visualIdentityMigration = require('../src/migrations/20260615150000_add_visual_identity_keys');
const friendsMigration = require('../src/migrations/20260627120000_create_friends_and_direct_messages');

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
    addColumns(table, columns) {
      calls.push({ type: 'addColumns', table, columns });
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
    },
    dropConstraint(table, name) {
      calls.push({ type: 'dropConstraint', table, name });
    },
    dropColumns(table, columns) {
      calls.push({ type: 'dropColumns', table, columns });
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

test('visual identity migration adds user, room, and anonymous peer visual keys', () => {
  const pgm = createRecorder();
  visualIdentityMigration.up(pgm);

  const users = pgm.calls.find((call) => call.type === 'addColumns' && call.table === 'users');
  const rooms = pgm.calls.find((call) => call.type === 'addColumns' && call.table === 'rooms');
  const peerIdentities = pgm.calls.find((call) => call.type === 'createTable' && call.name === 'room_peer_identities');

  assert.ok(users, 'users columns are extended');
  assert.equal(users.columns.avatar_color_key.type, 'varchar(32)');
  assert.equal(users.columns.avatar_color_key.notNull, true);
  assert.equal(users.columns.avatar_color_key.default, 'blurple');

  assert.ok(rooms, 'rooms columns are extended');
  assert.equal(rooms.columns.room_icon_key.type, 'varchar(32)');
  assert.equal(rooms.columns.room_icon_key.default, 'headphones');
  assert.equal(rooms.columns.room_color_key.type, 'varchar(32)');
  assert.equal(rooms.columns.room_color_key.default, 'blue');

  assert.ok(peerIdentities, 'room_peer_identities table is created');
  assert.equal(peerIdentities.columns.room_id.references, 'rooms(id)');
  assert.equal(peerIdentities.columns.room_id.onDelete, 'CASCADE');
  assert.equal(peerIdentities.columns.session_token_hash.type, 'text');
  assert.ok(peerIdentities.columns.session_token_hash.notNull, 'session tokens are represented by a required hash');
  assert.ok(!peerIdentities.columns.session_token, 'raw session tokens are not persisted');
  assert.equal(peerIdentities.columns.avatar_color_key.type, 'varchar(32)');
  assert.equal(peerIdentities.columns.metadata.type, 'jsonb');
});

test('visual identity migration constrains keys and backfills legacy users and rooms', () => {
  const pgm = createRecorder();
  visualIdentityMigration.up(pgm);

  const constraints = new Map(
    pgm.calls
      .filter((call) => call.type === 'addConstraint')
      .map((call) => [call.name, call])
  );
  assert.match(constraints.get('users_avatar_color_key_check').options.check, /blurple/);
  assert.match(constraints.get('rooms_room_icon_key_check').options.check, /headphones/);
  assert.match(constraints.get('rooms_room_color_key_check').options.check, /indigo/);
  assert.match(constraints.get('room_peer_identities_avatar_color_key_check').options.check, /slate/);

  const userBackfill = pgm.calls.find((call) => call.type === 'sql' && /UPDATE users/.test(call.text));
  assert.ok(userBackfill, 'existing users are backfilled');
  assert.match(userBackfill.text, /hashtext\(users\.id \|\| ':' \|\| users\.login\)/);
  assert.match(userBackfill.text, /avatar_color_key/);

  const roomBackfill = pgm.calls.find((call) => call.type === 'sql' && /UPDATE rooms/.test(call.text));
  assert.ok(roomBackfill, 'legacy room emojis are backfilled');
  assert.match(roomBackfill.text, /WHEN '🎧' THEN 'headphones'/);
  assert.match(roomBackfill.text, /WHEN '☀️' THEN 'sun'/);
  assert.match(roomBackfill.text, /WHEN '🎙️' THEN 'mic'/);
  assert.match(roomBackfill.text, /WHEN '🔥' THEN 'rust'/);

  const indexes = new Map(
    pgm.calls
      .filter((call) => call.type === 'createIndex')
      .map((call) => [call.options.name, call])
  );
  assert.deepEqual(indexes.get('room_peer_identities_room_peer_unique_idx').columns, ['room_id', 'peer_id']);
  assert.equal(indexes.get('room_peer_identities_room_peer_unique_idx').options.unique, true);
  assert.deepEqual(indexes.get('room_peer_identities_room_seen_idx').columns, ['room_id', 'last_seen_at']);
});

test('friends migration captures friend requests, friendships, and direct messages', () => {
  const pgm = createRecorder();
  friendsMigration.up(pgm);

  const requests = pgm.calls.find((call) => call.type === 'createTable' && call.name === 'friend_requests');
  const friendships = pgm.calls.find((call) => call.type === 'createTable' && call.name === 'friendships');
  const messages = pgm.calls.find((call) => call.type === 'createTable' && call.name === 'direct_messages');

  assert.ok(requests, 'friend_requests table is created');
  assert.ok(friendships, 'friendships table is created');
  assert.ok(messages, 'direct_messages table is created');

  for (const column of ['id', 'requester_id', 'addressee_id', 'status', 'created_at', 'responded_at']) {
    assert.ok(requests.columns[column], `friend_requests.${column} exists`);
  }
  for (const column of ['id', 'user_a_id', 'user_b_id', 'created_at']) {
    assert.ok(friendships.columns[column], `friendships.${column} exists`);
  }
  for (const column of ['id', 'sender_id', 'recipient_id', 'body', 'created_at', 'read_at']) {
    assert.ok(messages.columns[column], `direct_messages.${column} exists`);
  }

  const constraints = new Map(
    pgm.calls.filter((call) => call.type === 'addConstraint').map((call) => [call.name, call])
  );
  assert.match(constraints.get('friend_requests_status_check').options.check, /pending/);
  assert.match(constraints.get('friendships_ordered_check').options.check, /user_a_id < user_b_id/);

  const indexes = new Map(
    pgm.calls.filter((call) => call.type === 'createIndex').map((call) => [call.options.name, call])
  );
  // Only one pending request per ordered pair.
  assert.equal(indexes.get('friend_requests_pending_unique_idx').options.unique, true);
  assert.match(indexes.get('friend_requests_pending_unique_idx').options.where, /pending/);
  assert.equal(indexes.get('friendships_pair_unique_idx').options.unique, true);
});

test('friends migration down drops messages, friendships, then requests', () => {
  const pgm = createRecorder();
  friendsMigration.down(pgm);

  assert.deepEqual(
    pgm.calls.filter((call) => call.type === 'dropTable').map((call) => call.name),
    ['direct_messages', 'friendships', 'friend_requests']
  );
});

test('visual identity migration down removes peer identities before visual columns', () => {
  const pgm = createRecorder();
  visualIdentityMigration.down(pgm);

  assert.equal(pgm.calls[0].type, 'dropTable');
  assert.equal(pgm.calls[0].name, 'room_peer_identities');
  assert.deepEqual(
    pgm.calls.filter((call) => call.type === 'dropColumns').map((call) => [call.table, call.columns]),
    [
      ['rooms', ['room_icon_key', 'room_color_key']],
      ['users', ['avatar_color_key']]
    ]
  );
});
