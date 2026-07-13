'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConnectionRegistry } = require('../src/realtime/registry');

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
