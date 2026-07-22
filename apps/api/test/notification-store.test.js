'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const { createNotificationStore } = require('../src/lib/notification-store');
const { createRoomStore } = require('../src/lib/room-store');
const { createUserStore } = require('../src/lib/user-store');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

async function createStores(t, notificationOptions = {}) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const users = createUserStore({ databaseUrl, logger: SILENT });
  const rooms = createRoomStore({ databaseUrl, logger: SILENT });
  const notifications = createNotificationStore({ databaseUrl, logger: SILENT, ...notificationOptions });
  t.after(async () => {
    await notifications.close();
    await rooms.close();
    await users.close();
    await cleanup();
  });
  return { users, rooms, notifications };
}

async function makeUser(users, login) {
  const created = await users.createUser({ login, displayName: login, password: 'password123' });
  assert.equal(created.status, 'created', `created ${login}`);
  return created.user;
}

test('notification preferences default private notifications off and update explicitly', async (t) => {
  const automaticPresenceLeaseMs = 25;
  const { users, notifications } = await createStores(t, { automaticPresenceLeaseMs });
  const alice = await makeUser(users, 'alice');

  assert.deepEqual(await notifications.getPreferences(alice.id), {
    doNotDisturb: false,
    mutedPeerIds: [],
    mutedRoomIds: [],
    roomLevels: {},
    presenceStatus: 'online',
    presenceStatusAutomatic: false,
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

  const dndEnabled = await notifications.setDoNotDisturb({ userId: alice.id, doNotDisturb: true });
  assert.equal(dndEnabled.status, 'updated');
  assert.equal(dndEnabled.preferences.doNotDisturb, true);
  assert.equal(dndEnabled.preferences.presenceStatus, 'dnd');
  assert.equal((await users.getUserById(alice.id)).doNotDisturb, true);

  const dndDisabled = await notifications.setDoNotDisturb({ userId: alice.id, doNotDisturb: false });
  assert.equal(dndDisabled.status, 'updated');
  assert.equal(dndDisabled.preferences.doNotDisturb, false);
  assert.equal(dndDisabled.preferences.presenceStatus, 'online');

  const away = await notifications.setPresenceStatus({ userId: alice.id, presenceStatus: 'away' });
  assert.equal(away.status, 'updated');
  assert.equal(away.preferences.presenceStatus, 'away');
  assert.equal(away.preferences.presenceStatusAutomatic, false);
  assert.equal(away.preferences.doNotDisturb, false);

  const manualAwayIgnoresAutomaticResume = await notifications.setPresenceStatus({
    userId: alice.id,
    presenceStatus: 'online',
    automatic: true
  });
  assert.equal(manualAwayIgnoresAutomaticResume.status, 'unchanged');
  assert.equal(manualAwayIgnoresAutomaticResume.preferences.presenceStatus, 'away');
  assert.equal(manualAwayIgnoresAutomaticResume.preferences.presenceStatusAutomatic, false);

  await notifications.setPresenceStatus({ userId: alice.id, presenceStatus: 'online' });
  const activeHeartbeat = await notifications.setPresenceStatus({
    userId: alice.id,
    presenceStatus: 'online',
    automatic: true
  });
  assert.equal(activeHeartbeat.status, 'unchanged');
  const blockedByActiveSession = await notifications.setPresenceStatus({
    userId: alice.id,
    presenceStatus: 'away',
    automatic: true
  });
  assert.equal(blockedByActiveSession.status, 'unchanged');
  assert.equal(blockedByActiveSession.preferences.presenceStatus, 'online');

  await delay(automaticPresenceLeaseMs * 3);
  const automaticAway = await notifications.setPresenceStatus({
    userId: alice.id,
    presenceStatus: 'away',
    automatic: true
  });
  assert.equal(automaticAway.status, 'updated');
  assert.equal(automaticAway.preferences.presenceStatus, 'away');
  assert.equal(automaticAway.preferences.presenceStatusAutomatic, true);

  const automaticOnline = await notifications.setPresenceStatus({
    userId: alice.id,
    presenceStatus: 'online',
    automatic: true
  });
  assert.equal(automaticOnline.status, 'updated');
  assert.equal(automaticOnline.preferences.presenceStatus, 'online');
  assert.equal(automaticOnline.preferences.presenceStatusAutomatic, false);

  await delay(automaticPresenceLeaseMs * 3);
  await notifications.setPresenceStatus({
    userId: alice.id,
    presenceStatus: 'away',
    automatic: true
  });
  const pinnedAway = await notifications.setPresenceStatus({ userId: alice.id, presenceStatus: 'away' });
  assert.equal(pinnedAway.status, 'updated');
  assert.equal(pinnedAway.preferences.presenceStatus, 'away');
  assert.equal(pinnedAway.preferences.presenceStatusAutomatic, false);

  const dndStatus = await notifications.setPresenceStatus({ userId: alice.id, presenceStatus: 'dnd' });
  assert.equal(dndStatus.preferences.presenceStatus, 'dnd');
  assert.equal(dndStatus.preferences.doNotDisturb, true);
  assert.equal((await users.getUserById(alice.id)).presenceStatus, 'dnd');
});

test('notification store mutes and unmutes any existing non-self user', async (t) => {
  const { users, notifications } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');

  assert.equal((await notifications.setDmMute({ userId: alice.id, peerUserId: alice.id, muted: true })).status, 'self');
  assert.equal((await notifications.setDmMute({ userId: alice.id, peerUserId: crypto.randomUUID(), muted: true })).status, 'not_found');

  const muted = await notifications.setDmMute({ userId: alice.id, peerUserId: bob.id, muted: true });
  assert.equal(muted.status, 'muted');
  assert.deepEqual(muted.preferences.mutedPeerIds, [bob.id]);
  assert.equal(await notifications.isDmMuted({ userId: alice.id, peerUserId: bob.id }), true);

  const unmuted = await notifications.setDmMute({ userId: alice.id, peerUserId: bob.id, muted: false });
  assert.equal(unmuted.status, 'unmuted');
  assert.deepEqual(unmuted.preferences.mutedPeerIds, []);
  assert.equal(await notifications.isDmMuted({ userId: alice.id, peerUserId: bob.id }), false);
});

test('notification store persists mutes for saved rooms only', async (t) => {
  const { users, rooms, notifications } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');
  await rooms.createRoomWithQuota({ roomId: 'saved-room', creatorIp: '127.0.0.1', isStatic: true, ownerId: alice.id });
  await rooms.createRoomWithQuota({ roomId: 'other-room', creatorIp: '127.0.0.1', isStatic: true, ownerId: bob.id });
  await rooms.createRoom({ roomId: 'temp-room', creatorIp: '127.0.0.1', isStatic: false });

  assert.equal((await notifications.setRoomMute({ userId: alice.id, roomId: 'missing-room', muted: true })).status, 'not_found');
  assert.equal((await notifications.setRoomMute({ userId: alice.id, roomId: 'temp-room', muted: true })).status, 'temporary_room');
  assert.equal((await notifications.setRoomMute({ userId: alice.id, roomId: 'other-room', muted: true })).status, 'not_saved_room');

  const muted = await notifications.setRoomMute({ userId: alice.id, roomId: 'saved-room', muted: true });
  assert.equal(muted.status, 'muted');
  assert.deepEqual(muted.preferences.mutedRoomIds, ['saved-room']);
  assert.equal(await notifications.isRoomMuted({ userId: alice.id, roomId: 'saved-room' }), true);

  const unmuted = await notifications.setRoomMute({ userId: alice.id, roomId: 'saved-room', muted: false });
  assert.equal(unmuted.status, 'unmuted');
  assert.deepEqual(unmuted.preferences.mutedRoomIds, []);
  assert.equal(await notifications.isRoomMuted({ userId: alice.id, roomId: 'saved-room' }), false);
});
