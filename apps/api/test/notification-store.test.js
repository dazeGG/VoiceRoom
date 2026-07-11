'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createFriendStore } = require('../src/lib/friend-store');
const { createNotificationStore } = require('../src/lib/notification-store');
const { createRoomStore } = require('../src/lib/room-store');
const { createUserStore } = require('../src/lib/user-store');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

async function createStores(t) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const users = createUserStore({ databaseUrl, logger: SILENT });
  const friends = createFriendStore({ databaseUrl, logger: SILENT });
  const rooms = createRoomStore({ databaseUrl, logger: SILENT });
  const notifications = createNotificationStore({ databaseUrl, logger: SILENT });
  t.after(async () => {
    await notifications.close();
    await rooms.close();
    await friends.close();
    await users.close();
    await cleanup();
  });
  return { users, friends, rooms, notifications };
}

async function makeUser(users, login) {
  const created = await users.createUser({ login, displayName: login, password: 'password123' });
  assert.equal(created.status, 'created', `created ${login}`);
  return created.user;
}

async function makeFriends(friends, alice, bob) {
  const request = await friends.sendRequest({ requesterId: alice.id, addresseeUserId: bob.id });
  assert.equal(request.status, 'sent');
  const accepted = await friends.respondRequest({ userId: bob.id, requestId: request.requestId, action: 'accept' });
  assert.equal(accepted.status, 'accepted');
}

test('notification preferences default private notifications off and update explicitly', async (t) => {
  const { users, notifications } = await createStores(t);
  const alice = await makeUser(users, 'alice');

  assert.deepEqual(await notifications.getPreferences(alice.id), {
    mutedPeerIds: [],
    mutedRoomIds: [],
    privateNotifications: false
  });

  const enabled = await notifications.setPrivateNotifications({
    userId: alice.id,
    privateNotifications: true
  });
  assert.equal(enabled.status, 'updated');
  assert.equal(enabled.preferences.privateNotifications, true);

  const disabled = await notifications.setPrivateNotifications({
    userId: alice.id,
    privateNotifications: false
  });
  assert.equal(disabled.status, 'updated');
  assert.equal(disabled.preferences.privateNotifications, false);
});

test('notification store mutes and unmutes friend DMs with validation', async (t) => {
  const { users, friends, notifications } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');
  const eve = await makeUser(users, 'eve');
  await makeFriends(friends, alice, bob);

  assert.equal((await notifications.setDmMute({ userId: alice.id, peerUserId: alice.id, muted: true })).status, 'self');
  assert.equal((await notifications.setDmMute({ userId: alice.id, peerUserId: crypto.randomUUID(), muted: true })).status, 'not_found');
  assert.equal((await notifications.setDmMute({ userId: alice.id, peerUserId: eve.id, muted: true })).status, 'not_friends');

  const muted = await notifications.setDmMute({ userId: alice.id, peerUserId: bob.id, muted: true });
  assert.equal(muted.status, 'muted');
  assert.deepEqual(muted.preferences.mutedPeerIds, [bob.id]);
  assert.equal(await notifications.isDmMuted({ userId: alice.id, peerUserId: bob.id }), true);

  const unmuted = await notifications.setDmMute({ userId: alice.id, peerUserId: bob.id, muted: false });
  assert.equal(unmuted.status, 'unmuted');
  assert.deepEqual(unmuted.preferences.mutedPeerIds, []);
  assert.equal(await notifications.isDmMuted({ userId: alice.id, peerUserId: bob.id }), false);
});

test('notification store mutes and unmutes visible saved rooms only', async (t) => {
  const { users, rooms, notifications } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');
  const created = await rooms.createRoomWithQuota({
    creatorIp: '127.0.0.1',
    isStatic: true,
    ownerId: alice.id,
    roomId: 'saved-room'
  });
  assert.equal(created.status, 'created');

  assert.equal((await notifications.setRoomMute({ userId: bob.id, roomId: 'saved-room', muted: true })).status, 'not_found');
  assert.equal((await notifications.setRoomMute({ userId: alice.id, roomId: 'missing-room', muted: true })).status, 'not_found');

  const muted = await notifications.setRoomMute({ userId: alice.id, roomId: 'saved-room', muted: true });
  assert.equal(muted.status, 'muted');
  assert.deepEqual(muted.preferences.mutedRoomIds, ['saved-room']);
  assert.equal(await notifications.isRoomMuted({ userId: alice.id, roomId: 'saved-room' }), true);

  const unmuted = await notifications.setRoomMute({ userId: alice.id, roomId: 'saved-room', muted: false });
  assert.equal(unmuted.status, 'unmuted');
  assert.deepEqual(unmuted.preferences.mutedRoomIds, []);
  assert.equal(await notifications.isRoomMuted({ userId: alice.id, roomId: 'saved-room' }), false);
});
