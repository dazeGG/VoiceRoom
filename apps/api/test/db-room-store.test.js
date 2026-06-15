
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRoomStore, mapMessage, mapRoom } = require('../src/lib/room-store');

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
    async end() {
      calls.push({ scope: 'pool', text: 'end', values: [] });
    }
  };
}

test('mapRoom maps PostgreSQL row shape to API room shape with ephemeral peers map', () => {
  const room = mapRoom({
    id: 'abc123',
    creator_ip: '127.0.0.1',
    is_static: true,
    created_at: new Date(1000),
    updated_at: new Date(2000),
    empty_since: null
  });

  assert.equal(room.id, 'abc123');
  assert.equal(room.creatorIp, '127.0.0.1');
  assert.equal(room.isStatic, true);
  assert.equal(room.createdAt, 1000);
  assert.equal(room.updatedAt, 2000);
  assert.equal(room.emptySince, null);
  assert.ok(room.peers instanceof Map);
});

test('createRoom inserts durable room row with parameterized SQL', async () => {
  const pool = createFakePool(() => ({
    rows: [{
      id: 'room1', creator_ip: 'ip', is_static: true,
      created_at: new Date(1000), updated_at: new Date(1000), empty_since: new Date(1000)
    }],
    rowCount: 1
  }));
  const store = createRoomStore({ pool });

  const room = await store.createRoom({ roomId: 'room1', creatorIp: 'ip', isStatic: true, now: 1000 });

  assert.equal(room.id, 'room1');
  assert.match(pool.calls[0].text, /INSERT INTO rooms/);
  assert.deepEqual(pool.calls[0].values.slice(0, 3), ['room1', 'ip', true]);
});

test('appendMessage uses a transaction, verifies room existence, inserts row, and enforces cap', async () => {
  const pool = createFakePool((text) => {
    if (/SELECT id FROM rooms/.test(text)) return { rows: [{ id: 'room1' }], rowCount: 1 };
    if (/INSERT INTO room_messages/.test(text)) {
      return {
        rows: [{
          id: 'msg1', room_id: 'room1', peer_id: 'peer1', name: 'Ada', text: 'hello',
          created_at: new Date(1000), expires_at: new Date(2000)
        }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ maxMessagesPerRoom: 2, pool });

  const message = await store.appendMessage('room1', {
    id: 'msg1', peerId: 'peer1', name: 'Ada', text: 'hello', createdAt: 1000, expiresAt: 2000
  }, 1000);

  assert.deepEqual(message, {
    id: 'msg1', roomId: 'room1', peerId: 'peer1', name: 'Ada', text: 'hello', createdAt: 1000, expiresAt: 2000
  });
  assert.ok(pool.calls.some((call) => call.text === 'BEGIN'));
  assert.ok(pool.calls.some((call) => /INSERT INTO room_messages/.test(call.text)));
  assert.ok(pool.calls.some((call) => /row_number\(\) OVER/.test(call.text)));
  assert.ok(pool.calls.some((call) => call.text === 'COMMIT'));
});

test('listMessages soft-deletes expired messages before selecting active rows', async () => {
  const pool = createFakePool((text) => {
    if (/SELECT \*/.test(text)) {
      return {
        rows: [{
          id: 'msg1', room_id: 'room1', peer_id: '', name: '', text: 'hello',
          created_at: new Date(1000), expires_at: new Date(2000)
        }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const messages = await store.listMessages('room1', { now: 1500, limit: 10 });

  assert.deepEqual(messages, [mapMessage({
    id: 'msg1', room_id: 'room1', peer_id: '', name: '', text: 'hello',
    created_at: new Date(1000), expires_at: new Date(2000)
  })]);
  assert.match(pool.calls[0].text, /UPDATE room_messages/);
  assert.match(pool.calls[1].text, /ORDER BY created_at ASC, id ASC/);
});


test('createRoomWithQuota enforces room limits inside one advisory-locked transaction', async () => {
  const pool = createFakePool((text) => {
    if (/COUNT\(\*\)::int AS count/.test(text)) return { rows: [{ count: 0 }], rowCount: 1 };
    if (/INSERT INTO rooms/.test(text)) {
      return {
        rows: [{
          id: 'room-quota', creator_ip: 'ip', is_static: false,
          created_at: new Date(1000), updated_at: new Date(1000), empty_since: new Date(1000)
        }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.createRoomWithQuota({
    creatorIp: 'ip',
    isStatic: false,
    maxTempRoomsPerIp: 1,
    maxRooms: 10,
    roomId: 'room-quota',
    now: 1000
  });

  assert.equal(result.status, 'created');
  assert.equal(result.room.id, 'room-quota');
  assert.ok(pool.calls.some((call) => call.text === 'BEGIN'));
  assert.ok(pool.calls.some((call) => /pg_advisory_xact_lock/.test(call.text)));
  assert.ok(pool.calls.some((call) => /creator_ip = \$1/.test(call.text)));
  assert.ok(pool.calls.some((call) => /is_static = false/.test(call.text)));
  assert.ok(pool.calls.some((call) => /SELECT COUNT\(\*\)::int AS count FROM rooms/.test(call.text)));
  assert.ok(pool.calls.some((call) => /INSERT INTO rooms/.test(call.text)));
  assert.ok(pool.calls.some((call) => call.text === 'COMMIT'));
});

test('createRoomWithQuota creates owner membership for authenticated static rooms', async () => {
  const pool = createFakePool((text) => {
    if (/room_memberships rm/.test(text)) return { rows: [{ count: 0 }], rowCount: 1 };
    if (/SELECT COUNT\(\*\)::int AS count FROM rooms/.test(text)) return { rows: [{ count: 0 }], rowCount: 1 };
    if (/INSERT INTO rooms/.test(text)) {
      return {
        rows: [{
          id: 'owned-room', creator_ip: 'ip', is_static: true, owner_id: 'user-1',
          created_at: new Date(1000), updated_at: new Date(1000), empty_since: new Date(1000)
        }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.createRoomWithQuota({
    creatorIp: 'ip',
    isStatic: true,
    ownerId: 'user-1',
    maxOwnedStaticRoomsPerUser: 3,
    maxRooms: 10,
    roomId: 'owned-room',
    now: 1000
  });

  assert.equal(result.status, 'created');
  assert.equal(result.room.ownerId, 'user-1');
  assert.ok(pool.calls.some((call) => /JOIN rooms r ON r.id = rm.room_id/.test(call.text)));
  assert.ok(pool.calls.some((call) => /INSERT INTO room_memberships/.test(call.text)));
});

test('createRoomWithQuota requires an owner for static rooms', async () => {
  const pool = createFakePool((text) => {
    if (/INSERT INTO rooms/.test(text)) throw new Error('insert should not run');
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.createRoomWithQuota({
    creatorIp: 'ip',
    isStatic: true,
    maxOwnedStaticRoomsPerUser: 3,
    maxRooms: 10,
    roomId: 'anon-static'
  });

  assert.deepEqual(result, { room: null, status: 'auth_required' });
});

test('createRoomWithQuota enforces static ownership quota per user', async () => {
  const pool = createFakePool((text) => {
    if (/room_memberships rm/.test(text)) return { rows: [{ count: 3 }], rowCount: 1 };
    if (/INSERT INTO rooms/.test(text)) throw new Error('insert should not run');
    return { rows: [], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.createRoomWithQuota({
    creatorIp: 'ip',
    isStatic: true,
    ownerId: 'user-1',
    maxOwnedStaticRoomsPerUser: 3,
    maxRooms: 10,
    roomId: 'owned-room-4'
  });

  assert.deepEqual(result, { room: null, status: 'quota_exceeded' });
});

test('createRoomWithQuota returns quota status without inserting when per-IP temp cap is full', async () => {
  const pool = createFakePool((text) => {
    if (/creator_ip = \$1/.test(text)) return { rows: [{ count: 1 }], rowCount: 1 };
    if (/INSERT INTO rooms/.test(text)) throw new Error('insert should not run');
    return { rows: [{ count: 0 }], rowCount: 1 };
  });
  const store = createRoomStore({ pool });

  const result = await store.createRoomWithQuota({
    creatorIp: 'ip',
    maxTempRoomsPerIp: 1,
    maxRooms: 10,
    roomId: 'blocked-room'
  });

  assert.deepEqual(result, { room: null, status: 'quota_exceeded' });
  assert.equal(pool.calls.some((call) => /INSERT INTO rooms/.test(call.text)), false);
});
