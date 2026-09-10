'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createRoomStore } = require('../src/lib/room-store');
const { registerMembershipRoutes } = require('../src/domains/membership/membership-routes');

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

function leaveRoute({ membership = { role: 'member' }, leaveStatus = 'left', prepared = true } = {}) {
  const handlers = {};
  const onLeftCalls = [];
  registerMembershipRoutes({
    app: {
      get() {},
      delete(route, handler) { handlers[route] = handler; }
    },
    resolveUser: async () => ({ user: { id: 'user-1' } }),
    membershipService: {
      async getMembership() { return membership; },
      async leaveRoom() { return { status: leaveStatus }; }
    },
    prepareLeave: async () => prepared,
    onLeft: async ({ roomId, user }) => { onLeftCalls.push({ roomId, userId: user.id }); }
  });
  const handler = handlers['/api/rooms/:roomId/memberships/me'];
  return {
    onLeftCalls,
    async call() {
      const reply = {};
      reply.code = (statusCode) => ({ send: (payload) => { reply.statusCode = statusCode; reply.payload = payload; return reply; } });
      await handler({ params: { roomId: 'static-room' } }, reply);
      return reply;
    }
  };
}

test('leaving a room also takes it off the list, including a retry after the membership is gone', async () => {
  const left = leaveRoute();
  assert.deepEqual((await left.call()).payload, { ok: true, left: true });
  assert.deepEqual(left.onLeftCalls, [{ roomId: 'static-room', userId: 'user-1' }]);

  const retried = leaveRoute({ membership: null, leaveStatus: 'not_active' });
  assert.deepEqual((await retried.call()).payload, { ok: true, left: false });
  assert.deepEqual(retried.onLeftCalls, [{ roomId: 'static-room', userId: 'user-1' }]);
});

test('owners, failed leaves and refused disconnects keep the room on the list', async () => {
  const owner = leaveRoute({ membership: { role: 'owner' } });
  assert.equal((await owner.call()).statusCode, 409);

  const failed = leaveRoute({ leaveStatus: 'invalid' });
  assert.equal((await failed.call()).statusCode, 409);

  const refused = leaveRoute({ prepared: false });
  assert.equal((await refused.call()).statusCode, 503);

  assert.deepEqual([...owner.onLeftCalls, ...failed.onLeftCalls, ...refused.onLeftCalls], []);
});

test('the API wires leaving a room to the room store that owns the list', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
  const start = source.indexOf('registerMembershipRoutes({');
  const wiring = source.slice(start, source.indexOf('\n    });', start));
  assert.match(wiring, /onLeft: async \(\{ roomId, user \}\) => \{\s*await getRoomStore\(\)\.removeRoomBookmarkForUser\(user\.id, roomId\);/);
});
