import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionRegistry } from '../src/realtime/registry.ts';

const settle = () => new Promise((resolve) => setImmediate(resolve));

function socket() {
  return { readyState: 1, send() {}, close() {} };
}

test('manual offline masks open sockets and stale tabs cannot overwrite active account status', async () => {
  const presenceEvents: Array<{ friendId: string; userId: string; online: boolean }> = [];
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
  assert.deepEqual(
    presenceEvents.map((event) => event.online),
    [true]
  );

  registry.setUserPresenceStatus('user-1', 'offline');
  await settle();
  assert.equal(registry.isUserOnline('user-1'), false);
  assert.deepEqual(
    presenceEvents.map((event) => event.online),
    [true, false]
  );

  const staleSecondTab = registry.addConnection('user-1', socket(), '127.0.0.2', 'online');
  await settle();
  assert.equal(first.presenceStatus, 'offline');
  assert.equal(staleSecondTab.presenceStatus, 'offline');
  assert.deepEqual(
    presenceEvents.map((event) => event.online),
    [true, false]
  );

  registry.setUserPresenceStatus('user-1', 'away');
  await settle();
  registry.setUserPresenceStatus('user-1', 'dnd');
  await settle();
  assert.equal(registry.isUserOnline('user-1'), true);
  assert.deepEqual(
    presenceEvents.map((event) => event.online),
    [true, false, true]
  );

  registry.setUserPresenceStatus('user-1', 'offline');
  await settle();
  registry.removeConnection(first);
  registry.removeConnection(staleSecondTab);
  await settle();
  assert.deepEqual(
    presenceEvents.map((event) => event.online),
    [true, false, true, false]
  );
  // The manual status went with the last socket: a new one starts from its own.
  assert.equal(registry.addConnection('user-1', socket(), '127.0.0.3', 'away').presenceStatus, 'away');
});

test('presence revision advances when account availability changes', () => {
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 8,
    keepaliveMs: 15_000,
    getFriendIds: async () => []
  });

  const revision = () => registry.presenceSnapshot('room-1', undefined).revision;

  assert.equal(revision(), 0);
  const connection = registry.addConnection('user-1', socket());
  const connectedRevision = revision();
  assert.ok(connectedRevision > 0);

  registry.setUserPresenceStatus('user-1', 'away');
  const awayRevision = revision();
  assert.ok(awayRevision > connectedRevision);

  registry.setUserPresenceStatus('user-1', 'away');
  assert.equal(revision(), awayRevision);

  registry.removeConnection(connection);
  assert.ok(revision() > awayRevision);
});

test('membership presence includes signed-in users before they join voice', () => {
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 8,
    keepaliveMs: 15_000,
    getFriendIds: async () => []
  });
  registry.addConnection('owner-1', socket(), '127.0.0.1', 'online');

  const snapshot = registry.presenceSnapshot('room-1', { updatedAt: 10, peers: new Map() });

  assert.deepEqual(snapshot.byUserId.get('owner-1'), [
    {
      inVoice: false,
      roomId: null,
      presenceStatus: 'online'
    }
  ]);
  assert.ok(snapshot.revision > 0);
});

test('the registry counts its sockets and takes a finished voice seat off every socket that held it', () => {
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 8,
    keepaliveMs: 15_000,
    getFriendIds: async () => []
  });
  const tab = registry.addConnection('user-1', socket());
  const otherTab = registry.addConnection('user-1', socket());
  const guest = registry.addGuestConnection(socket(), '10.0.0.1');
  assert.deepEqual(registry.stats(), { sockets: 3, guests: 1, accountIds: ['user-1', 'user-1'] });
  assert.deepEqual([...registry.allConnections()], [tab, otherTab, guest]);

  tab.activeVoice = { roomId: 'room-1', peerId: 'peer-1', sessionToken: 's', transportId: 't' };
  tab.previewRoomIds.add('room-1');
  registry.registerConnectionForRoom(tab, 'room-1');
  guest.activeVoice = { roomId: 'room-1', peerId: 'peer-2', sessionToken: 's', transportId: 'u' };
  registry.registerConnectionForRoom(guest, 'room-1');

  registry.detachVoicePeer('room-1', 'peer-1');
  assert.equal(tab.activeVoice, null);
  assert.equal(tab.previewRoomIds.has('room-1'), false);
  assert.deepEqual([...registry.roomDetailSubscribers('room-1')], [guest]);
  assert.equal(guest.activeVoice?.peerId, 'peer-2');
});
