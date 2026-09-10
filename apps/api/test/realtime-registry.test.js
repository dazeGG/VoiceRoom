'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoomMembershipPresenceSnapshot, createConnectionRegistry } = require('../src/realtime/registry');

const settle = () => new Promise((resolve) => setImmediate(resolve));

function socket() {
  return { readyState: 1, send() {}, close() {} };
}

test('manual offline masks open sockets and stale tabs cannot overwrite active account status', async () => {
  const presenceEvents = [];
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 8,
    keepaliveMs: 15_000,
    getFriendIds: async () => ['friend-1'],
    onPresenceChange(friendId, userId, online) {
      presenceEvents.push({ friendId, userId, online });
    }
  });

  const first = registry.addConnection('user-1', socket(), '127.0.0.1', 'online');
  await settle();
  assert.equal(registry.isUserOnline('user-1'), true);
  assert.deepEqual(presenceEvents.map((event) => event.online), [true]);

  registry.setUserPresenceStatus('user-1', 'offline');
  await settle();
  assert.equal(registry.isUserOnline('user-1'), false);
  assert.deepEqual(presenceEvents.map((event) => event.online), [true, false]);

  const staleSecondTab = registry.addConnection('user-1', socket(), '127.0.0.2', 'online');
  await settle();
  assert.equal(registry.userPresenceStatuses.get('user-1'), 'offline');
  assert.equal(first.presenceStatus, 'offline');
  assert.equal(staleSecondTab.presenceStatus, 'offline');
  assert.deepEqual(presenceEvents.map((event) => event.online), [true, false]);

  registry.setUserPresenceStatus('user-1', 'away');
  await settle();
  registry.setUserPresenceStatus('user-1', 'dnd');
  await settle();
  assert.equal(registry.isUserOnline('user-1'), true);
  assert.deepEqual(presenceEvents.map((event) => event.online), [true, false, true]);

  registry.setUserPresenceStatus('user-1', 'offline');
  await settle();
  registry.removeConnection(first);
  registry.removeConnection(staleSecondTab);
  await settle();
  assert.equal(registry.userPresenceStatuses.has('user-1'), false);
  assert.deepEqual(presenceEvents.map((event) => event.online), [true, false, true, false]);
});

test('presence revision advances when account availability changes', () => {
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 8,
    keepaliveMs: 15_000,
    getFriendIds: async () => []
  });

  assert.equal(registry.getPresenceRevision(), 0);
  const connection = registry.addConnection('user-1', socket());
  const connectedRevision = registry.getPresenceRevision();
  assert.ok(connectedRevision > 0);

  registry.setUserPresenceStatus('user-1', 'away');
  const awayRevision = registry.getPresenceRevision();
  assert.ok(awayRevision > connectedRevision);

  registry.setUserPresenceStatus('user-1', 'away');
  assert.equal(registry.getPresenceRevision(), awayRevision);

  registry.removeConnection(connection);
  assert.ok(registry.getPresenceRevision() > awayRevision);
});

test('membership presence includes signed-in users before they join voice', () => {
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 8,
    keepaliveMs: 15_000,
    getFriendIds: async () => []
  });
  registry.addConnection('owner-1', socket(), '127.0.0.1', 'online');

  const snapshot = buildRoomMembershipPresenceSnapshot(
    'room-1',
    { updatedAt: 10, peers: new Map() },
    registry
  );

  assert.deepEqual(snapshot.byUserId.get('owner-1'), [{
    inVoice: false,
    roomId: null,
    presenceStatus: 'online'
  }]);
  assert.equal(snapshot.revision, registry.getPresenceRevision());
});
