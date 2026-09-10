'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRoomStore } = require('../src/lib/room-store');
const { createMembershipRepository } = require('../src/domains/membership/membership-repository');
const { createMembershipService } = require('../src/domains/membership/membership-service');

function createFakePool(handler) {
  const calls = [];
  const client = {
    query: async (text, values = []) => {
      calls.push({ scope: 'client', text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      return handler(text, values, calls);
    },
    release() {
      calls.push({ scope: 'client', text: 'release', values: [] });
    }
  };
  return {
    calls,
    client,
    async query(text, values = []) {
      calls.push({ scope: 'pool', text, values });
      return handler(text, values, calls);
    },
    async connect() {
      calls.push({ scope: 'pool', text: 'connect', values: [] });
      return client;
    },
    async end() {}
  };
}

const STATIC_ROOM_ROW = {
  id: 'static-room',
  creator_ip: '',
  is_static: true,
  owner_id: 'owner-user',
  name: 'Room',
  created_at: new Date(1000),
  updated_at: new Date(1000),
  empty_since: null,
  deleted_at: null
};

function roomListHandler({ owner = false, banned = false } = {}) {
  return (text) => {
    if (/SELECT \* FROM rooms WHERE id = \$1 AND deleted_at IS NULL/.test(text)) {
      return { rows: [STATIC_ROOM_ROW], rowCount: 1 };
    }
    if (/role = 'owner'/.test(text)) return { rows: owner ? [{ exists: 1 }] : [], rowCount: owner ? 1 : 0 };
    if (/FROM room_bans/.test(text)) {
      return banned
        ? { rows: [{ id: 'ban', room_id: 'static-room', user_id: 'user-1', ip: '', created_at: new Date(1000), expires_at: null }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/DELETE FROM room_bookmarks/.test(text)) return { rows: [{ id: 'bookmark' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  };
}

const indexOf = (calls, pattern) => calls.findIndex((call) => pattern.test(call.text));

test('adding a room to the list makes the user a member inside the same transaction', async () => {
  const pool = createFakePool(roomListHandler());
  const store = createRoomStore({ pool });

  const result = await store.addRoomBookmarkForUser('user-1', 'static-room', 5000);

  assert.equal(result.status, 'bookmarked');
  const insert = pool.calls.find((call) => /INSERT INTO room_memberships/.test(call.text));
  assert.ok(insert, 'membership insert expected');
  assert.equal(insert.scope, 'client');
  assert.match(insert.text, /'member'/);
  assert.match(insert.text, /ON CONFLICT \(room_id, user_id\) DO NOTHING/);
  assert.deepEqual(insert.values.slice(1), ['static-room', 'user-1', new Date(5000)]);
  const banLookup = pool.calls[indexOf(pool.calls, /FROM room_bans/)];
  assert.equal(banLookup.scope, 'client');
  assert.ok(indexOf(pool.calls, /INSERT INTO room_bookmarks/) < indexOf(pool.calls, /FROM room_bans/));
  assert.ok(indexOf(pool.calls, /FROM room_bans/) < indexOf(pool.calls, /INSERT INTO room_memberships/));
  assert.ok(indexOf(pool.calls, /INSERT INTO room_memberships/) < indexOf(pool.calls, /^COMMIT$/));
});

test('a user banned from the room keeps the list entry but does not become a member', async () => {
  const pool = createFakePool(roomListHandler({ banned: true }));
  const store = createRoomStore({ pool });

  const result = await store.addRoomBookmarkForUser('user-1', 'static-room', 5000);

  assert.equal(result.status, 'bookmarked');
  assert.ok(pool.calls.some((call) => /INSERT INTO room_bookmarks/.test(call.text)));
  assert.equal(indexOf(pool.calls, /INSERT INTO room_memberships/), -1);
});

test('the owner adding their own room gets no extra member row and no ban lookup', async () => {
  const pool = createFakePool(roomListHandler({ owner: true }));
  const store = createRoomStore({ pool });

  const result = await store.addRoomBookmarkForUser('owner-user', 'static-room', 5000);

  assert.equal(result.status, 'bookmarked');
  assert.equal(indexOf(pool.calls, /FROM room_bans/), -1);
  assert.equal(indexOf(pool.calls, /INSERT INTO room_memberships/), -1);
});

test('removing a room from the list also ends the non-owner membership', async () => {
  const pool = createFakePool(roomListHandler());
  const store = createRoomStore({ pool });

  const result = await store.removeRoomBookmarkForUser('user-1', 'static-room');

  assert.deepEqual(result, { removed: true, status: 'removed' });
  const membershipDelete = pool.calls.find((call) => /DELETE FROM room_memberships/.test(call.text));
  assert.ok(membershipDelete, 'membership delete expected');
  assert.equal(membershipDelete.scope, 'client');
  assert.match(membershipDelete.text, /role = 'member'/);
  assert.deepEqual(membershipDelete.values, ['static-room', 'user-1']);
});

test('owners cannot remove their room from the list and keep their membership', async () => {
  const pool = createFakePool(roomListHandler({ owner: true }));
  const store = createRoomStore({ pool });

  const result = await store.removeRoomBookmarkForUser('owner-user', 'static-room');

  assert.deepEqual(result, { removed: false, status: 'owner' });
  assert.equal(indexOf(pool.calls, /DELETE FROM/), -1);
});

function serviceWith(repository) {
  const pool = createFakePool(() => ({ rows: [], rowCount: 0 }));
  return { pool, service: createMembershipService({ pool, repository }) };
}

test('leaving a room also removes it from the list inside the same transaction', async () => {
  const bookmarkDeletes = [];
  const { pool, service } = serviceWith({
    async getActive() { return { id: 'membership', role: 'member' }; },
    async deleteActive() { return { id: 'membership', role: 'member' }; },
    async deleteBookmark(roomId, userId, options) { bookmarkDeletes.push({ roomId, userId, client: options.client }); return true; }
  });

  const result = await service.leaveRoom({ roomId: 'static-room', userId: 'user-1' });

  assert.equal(result.status, 'left');
  assert.deepEqual(bookmarkDeletes, [{ roomId: 'static-room', userId: 'user-1', client: pool.client }]);
});

test('owners, non-members and lost deletes leave the list untouched', async () => {
  const bookmarkDeletes = [];
  const deleteBookmark = async () => { bookmarkDeletes.push(true); return true; };

  const owner = serviceWith({ async getActive() { return { id: 'm', role: 'owner' }; }, deleteBookmark });
  assert.equal((await owner.service.leaveRoom({ roomId: 'r', userId: 'u' })).status, 'owner_required');

  const outsider = serviceWith({ async getActive() { return null; }, deleteBookmark });
  assert.equal((await outsider.service.leaveRoom({ roomId: 'r', userId: 'u' })).status, 'not_active');

  const raced = serviceWith({
    async getActive() { return { id: 'm', role: 'member' }; },
    async deleteActive() { return null; },
    deleteBookmark
  });
  assert.equal((await raced.service.leaveRoom({ roomId: 'r', userId: 'u' })).status, 'not_active');

  assert.deepEqual(bookmarkDeletes, []);
});

test('membership repository deletes a list entry and reports whether one existed', async () => {
  const pool = createFakePool((text) => ({ rows: [], rowCount: /DELETE FROM room_bookmarks/.test(text) ? 1 : 0 }));
  const repository = createMembershipRepository({ pool });

  assert.equal(await repository.deleteBookmark('static-room', 'user-1'), true);
  assert.deepEqual(pool.calls.at(-1).values, ['static-room', 'user-1']);
  assert.equal(await repository.deleteBookmark('', 'user-1'), false);
  assert.equal(pool.calls.length, 1);
});
