'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const { createRoomStore } = require('../src/lib/room-store');
const { createUserStore } = require('../src/lib/user-store');
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
  const store = createRoomStore({ databaseUrl });
  t.after(async () => {
    await store.close();
    await reopened.close();
    await cleanup();
  });

  const room = await store.createRoom({ creatorIp: '127.0.0.1', isStatic: true, roomId: 'roompersist1', now: 1000 });
  const message = await store.appendMessage(room.id, {
    createdAt: 1100,
    id: 'msg-persist-1',
    name: 'Ada',
    peerId: 'peer-persist',
    text: 'hello'
  }, 1100);

  assert.equal(room.isStatic, true);
  assert.equal(message.roomId, room.id);

  const reopened = createRoomStore({ databaseUrl });
  const restoredRoom = await reopened.getRoom(room.id);
  const restoredMessages = await reopened.listMessages(room.id, { now: 2000, limit: 10 });

  assert.equal(restoredRoom.id, room.id);
  assert.equal(restoredRoom.isStatic, true);
  assert.deepEqual(restoredMessages.map((entry) => entry.text), ['hello']);
});

test('PostgreSQL room store never expires or trims room history, even when a message asks for an expiry', async (t) => {
  const store = await createMigratedStore(t);
  const room = await store.createRoom({ creatorIp: '127.0.0.1', isStatic: true, roomId: 'roomkeep1', now: 1000 });

  for (let index = 1; index <= 3; index += 1) {
    await store.appendMessage(room.id, {
      id: `msg-keep-${index}`,
      text: `message ${index}`,
      createdAt: 1000 + index,
      expiresAt: 1500
    }, 1000 + index);
  }

  const stored = await store.listMessages(room.id, { now: 2000, limit: 10 });
  assert.deepEqual(stored.map((message) => message.id), ['msg-keep-1', 'msg-keep-2', 'msg-keep-3']);
  assert.deepEqual(stored.map((message) => message.expiresAt), [null, null, null]);

  // A year later the cleanup sweep still has nothing to expire.
  await store.pruneRooms(1000 + 365 * 24 * 60 * 60 * 1000);
  const survived = await store.listMessages(room.id, { now: 1000 + 365 * 24 * 60 * 60 * 1000, limit: 10 });
  assert.deepEqual(survived.map((message) => message.id), ['msg-keep-1', 'msg-keep-2', 'msg-keep-3']);
});

test('PostgreSQL room store returns the latest limited chat messages in display order', async (t) => {
  const store = await createMigratedStore(t);
  const room = await store.createRoom({ creatorIp: '127.0.0.1', isStatic: true, roomId: 'roomlatest1', now: 1000 });

  for (let index = 1; index <= 5; index += 1) {
    await store.appendMessage(room.id, {
      id: `msg-latest-${index}`,
      text: `message ${index}`,
      createdAt: 1000 + index
    }, 1000 + index);
  }

  const messages = await store.listMessages(room.id, { now: 2000, limit: 3 });
  assert.deepEqual(messages.map((message) => message.id), ['msg-latest-3', 'msg-latest-4', 'msg-latest-5']);
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

test('PostgreSQL room store can reconcile active temporary rooms after process restart', async (t) => {
  const store = await createMigratedStore(t, { roomIdleTtlMs: 1000 });
  const temp = await store.createRoom({ creatorIp: 'ip-restart', isStatic: false, roomId: 'temprestart1', now: 1000 });
  const permanent = await store.createRoom({ creatorIp: 'ip-restart', isStatic: true, roomId: 'staticrestart1', now: 1000 });

  await store.markRoomActive(temp.id, 1200);
  await store.markRoomActive(permanent.id, 1200);

  assert.equal((await store.getRoom(temp.id)).emptySince, null);
  assert.equal(await store.markActiveTemporaryRoomsEmpty(2000), 1);
  assert.equal((await store.getRoom(temp.id)).emptySince, 2000);
  assert.equal((await store.getRoom(permanent.id)).emptySince, null);
  assert.equal(await store.pruneRooms(3500), true);
  assert.equal(await store.getRoom(temp.id), null);
  assert.ok(await store.getRoom(permanent.id));
});

test('PostgreSQL room bans match account or IP and undo stays scoped to its room', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} } });
  const store = createRoomStore({ databaseUrl });
  const users = createUserStore({ databaseUrl, logger: { error() {} } });
  t.after(async () => {
    await Promise.all([store.close(), users.close()]);
    await cleanup();
  });

  const { user } = await users.createUser({ login: 'room-ban-user', password: 'password123' });
  await store.createRoom({ creatorIp: 'owner-ip', isStatic: true, roomId: 'ban-room-one', now: 1000 });
  await store.createRoom({ creatorIp: 'owner-ip', isStatic: true, roomId: 'ban-room-two', now: 1000 });

  const accountBan = await store.createRoomBan({
    roomId: 'ban-room-one',
    userId: user.id,
    ip: '203.0.113.8',
    metadata: { peerId: 'peer-banned' },
    now: 2000
  });
  assert.equal(accountBan.status, 'created');
  assert.equal(accountBan.ban.userId, user.id);
  assert.equal(accountBan.ban.ip, '');
  assert.deepEqual(accountBan.ban.metadata, { peerId: 'peer-banned' });

  assert.equal((await store.findActiveRoomBan({ roomId: 'ban-room-one', userId: user.id, ip: '198.51.100.1' })).id, accountBan.ban.id);
  assert.equal(await store.findActiveRoomBan({ roomId: 'ban-room-one', ip: '203.0.113.8' }), null);
  assert.equal(await store.findActiveRoomBan({ roomId: 'ban-room-two', userId: user.id, ip: '203.0.113.8' }), null);

  assert.equal((await store.deleteRoomBan({ roomId: 'ban-room-two', banId: accountBan.ban.id })).status, 'not_found');
  assert.ok(await store.findActiveRoomBan({ roomId: 'ban-room-one', userId: user.id }));
  assert.equal((await store.deleteRoomBan({ roomId: 'ban-room-one', banId: accountBan.ban.id })).status, 'deleted');
  assert.equal(await store.findActiveRoomBan({ roomId: 'ban-room-one', userId: user.id, ip: '203.0.113.8' }), null);
});

test('PostgreSQL room ban cap is enforced per room and physical room purge cascades bans', async (t) => {
  const store = await createMigratedStore(t);
  await store.createRoom({ creatorIp: 'owner-ip', isStatic: true, roomId: 'ban-cap-room', now: 1000 });
  await store.createRoom({ creatorIp: 'owner-ip', isStatic: true, roomId: 'ban-other-room', now: 1000 });

  assert.equal((await store.createRoomBan({ roomId: 'ban-cap-room', ip: '192.0.2.1', maxBans: 1 })).status, 'created');
  assert.equal((await store.createRoomBan({ roomId: 'ban-cap-room', ip: '192.0.2.2', maxBans: 1 })).status, 'cap_exceeded');
  assert.equal((await store.createRoomBan({ roomId: 'ban-other-room', ip: '192.0.2.2', maxBans: 1 })).status, 'created');

  await store.deleteRoom('ban-cap-room', 2000);
  await store.purgeDeleted({ olderThanMs: 1, now: 3000 });
  assert.equal(await store.findActiveRoomBan({ roomId: 'ban-cap-room', ip: '192.0.2.1' }), null);
  assert.ok(await store.findActiveRoomBan({ roomId: 'ban-other-room', ip: '192.0.2.2' }));
});

test('purging deleted messages and deleted rooms unbinds their attachments for media cleanup', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} } });
  const store = createRoomStore({ databaseUrl });
  const users = createUserStore({ databaseUrl, logger: { error() {} } });
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => {
    await Promise.all([store.close(), users.close(), pool.end()]);
    await cleanup();
  });

  const { user } = await users.createUser({ login: 'purge-author', password: 'password123' });
  await store.createRoom({ creatorIp: 'owner-ip', isStatic: true, roomId: 'purge-room', now: 1000 });
  await store.createRoom({ creatorIp: 'owner-ip', isStatic: true, roomId: 'purge-gone-room', now: 1000 });
  const post = (roomId, id) => store.appendMessage(roomId, { id, text: id, authorUserId: user.id, createdAt: 1100 }, 1100);
  await post('purge-room', 'purge-deleted');
  await post('purge-room', 'purge-kept');
  await post('purge-gone-room', 'purge-in-gone-room');
  const attach = async (messageId) => {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO message_attachments (id, owner_id, context, state, room_message_id, attachment_order, bound_at)
       VALUES ($1, $2, 'room', 'processing', $3, 0, current_timestamp)`,
      [id, user.id, messageId]
    );
    return id;
  };
  const deletedAttachment = await attach('purge-deleted');
  const keptAttachment = await attach('purge-kept');
  const roomAttachment = await attach('purge-in-gone-room');

  assert.equal(await store.softDeleteMessage('purge-room', 'purge-deleted'), true);
  await store.deleteRoom('purge-gone-room', 2000);
  const purged = await store.purgeDeleted({ olderThanMs: 1, now: Date.now() + 60_000 });
  assert.equal(purged.messages, 1);
  assert.equal(purged.rooms, 1);

  const { rows } = await pool.query(
    `SELECT id, state, room_message_id, attachment_order, bound_at, deleted_at FROM message_attachments`
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of [deletedAttachment, roomAttachment]) {
    const row = byId.get(id);
    assert.equal(row.state, 'deleted');
    assert.equal(row.room_message_id, null);
    assert.equal(row.attachment_order, null);
    assert.equal(row.bound_at, null);
    assert.ok(row.deleted_at);
  }
  assert.equal(byId.get(keptAttachment).state, 'processing');
  assert.equal(byId.get(keptAttachment).room_message_id, 'purge-kept');
  assert.deepEqual((await store.listMessages('purge-room', { limit: 10 })).map((message) => message.id), ['purge-kept']);
});

test('PostgreSQL peer identity invalidation rejects the prior session token', async (t) => {
  const store = await createMigratedStore(t);
  await store.createRoom({ creatorIp: 'owner-ip', isStatic: true, roomId: 'peer-invalidate-room', now: 1000 });
  const identity = {
    roomId: 'peer-invalidate-room',
    peerId: 'peer-invalidate',
    sessionToken: 'peer-session-token-before-kick',
    displayName: 'Guest',
    now: 2000
  };
  assert.equal((await store.getOrCreatePeerIdentity(identity)).status, 'created');
  assert.equal(await store.invalidatePeerIdentity({ roomId: identity.roomId, peerId: identity.peerId, now: 3000 }), true);
  assert.equal((await store.getOrCreatePeerIdentity({ ...identity, now: 4000 })).status, 'token_mismatch');
});
