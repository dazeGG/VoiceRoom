'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRoomStore } = require('../src/lib/room-store');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');

async function createMigratedStore(t, options = {}) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} } });
  const store = createRoomStore({ databaseUrl, ...options });
  t.after(async () => {
    await store.close();
    await cleanup();
  });
  return store;
}

test('PostgreSQL room store persists registry and message shape across store instances', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} } });
  const store = createRoomStore({ databaseUrl, maxMessagesPerRoom: 10, messageTtlMs: 60000 });
  t.after(async () => {
    await store.close();
    await reopened.close();
    await cleanup();
  });

  const room = await store.createRoom({ creatorIp: '127.0.0.1', isStatic: true, roomId: 'roompersist1', now: 1000 });
  const message = await store.appendMessage(room.id, {
    createdAt: 1100,
    expiresAt: 61000,
    id: 'msg-persist-1',
    name: 'Ada',
    peerId: 'peer-persist',
    text: 'hello'
  }, 1100);

  assert.equal(room.isStatic, true);
  assert.equal(message.roomId, room.id);

  const reopened = createRoomStore({ databaseUrl, maxMessagesPerRoom: 10, messageTtlMs: 60000 });
  const restoredRoom = await reopened.getRoom(room.id);
  const restoredMessages = await reopened.listMessages(room.id, { now: 2000, limit: 10 });

  assert.equal(restoredRoom.id, room.id);
  assert.equal(restoredRoom.isStatic, true);
  assert.deepEqual(restoredMessages.map((entry) => entry.text), ['hello']);
});

test('PostgreSQL room store prunes expired chat messages during active cleanup', async (t) => {
  const store = await createMigratedStore(t, { maxMessagesPerRoom: 10, messageTtlMs: 1000 });
  const room = await store.createRoom({ creatorIp: '127.0.0.1', isStatic: true, roomId: 'roomprune1', now: 1000 });

  await store.appendMessage(room.id, { id: 'expired-msg', text: 'old', createdAt: 1000, expiresAt: 1500 }, 1000);
  await store.appendMessage(room.id, { id: 'fresh-msg', text: 'fresh', createdAt: 2000, expiresAt: 5000 }, 2000);

  assert.equal(await store.pruneRooms(2500), true);
  const messages = await store.listMessages(room.id, { now: 2500, limit: 10 });
  assert.deepEqual(messages.map((message) => message.id), ['fresh-msg']);
});

test('PostgreSQL room store caps retained chat messages per room', async (t) => {
  const store = await createMigratedStore(t, { maxMessagesPerRoom: 2, messageTtlMs: 60000 });
  const room = await store.createRoom({ creatorIp: '127.0.0.1', isStatic: true, roomId: 'roomcap1', now: 1000 });

  await store.appendMessage(room.id, { id: 'msg-1', text: 'one', createdAt: 1000, expiresAt: 60000 }, 1000);
  await store.appendMessage(room.id, { id: 'msg-2', text: 'two', createdAt: 2000, expiresAt: 60000 }, 2000);
  await store.appendMessage(room.id, { id: 'msg-3', text: 'three', createdAt: 3000, expiresAt: 60000 }, 3000);

  const messages = await store.listMessages(room.id, { now: 4000, limit: 10 });
  assert.deepEqual(messages.map((message) => message.id), ['msg-2', 'msg-3']);
});

test('PostgreSQL room store counts only temporary rooms for IP quota and prunes idle dynamic rooms', async (t) => {
  const store = await createMigratedStore(t, { roomIdleTtlMs: 1000 });
  await store.createRoom({ creatorIp: 'ip-a', isStatic: true, roomId: 'staticquota1', now: 1000 });
  await store.createRoom({ creatorIp: 'ip-a', isStatic: false, roomId: 'emptyquota1', now: 1000 });

  assert.equal(await store.countQuotaRoomsForIp('ip-a'), 1);
  assert.equal(await store.pruneRooms(2500), true);
  assert.equal(await store.getRoom('emptyquota1'), null);
  assert.ok(await store.getRoom('staticquota1'));
});
