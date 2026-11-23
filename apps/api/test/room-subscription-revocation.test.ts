import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionRegistry } from '../src/realtime/registry.ts';
import type { RosterPeer } from '../src/realtime/room-presence.ts';
import { createRoomRealtimeRuntime } from '../src/realtime/room-runtime.ts';
import { createFullTestRuntime, runtimeDeps } from './fakes/room-runtime.ts';
import { dbRoom } from './fakes/index.ts';
import { buildServerEnvelope } from '@voiceroom/shared/realtime';

function harness() {
  const frames: string[] = [];
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 4,
    keepaliveMs: 15000,
    getFriendIds: async () => []
  });
  const connection = registry.addConnection('A', { readyState: 1, send: (data) => frames.push(data), close() {} });
  const deps = runtimeDeps({ wsRegistry: registry, store: { getRoom: async () => dbRoom('room') } });
  return { frames, registry, connection, deps };
}

test('preview boundary denial clears its intent without subscribing or reading messages', async () => {
  for (const scenario of ['missing-room', 'widget-room', 'widget-connection'] as const) {
    const h = harness();
    let messageReads = 0;
    const store = h.deps.getRoomStore();
    h.deps.getRoomStore = () => ({
      ...store,
      getRoom: async () =>
        scenario === 'missing-room' ? null : dbRoom('room', { kind: scenario === 'widget-room' ? 'widget' : 'main' }),
      listMessages: async () => {
        messageReads++;
        return [];
      }
    });
    if (scenario === 'widget-connection') h.connection.roomSurface = 'widget';
    const runtime = createRoomRealtimeRuntime(h.deps);
    try {
      await runtime.subscribePreview(h.connection, 'room');
      assert.equal(h.frames.length, 0, scenario);
      assert.equal(h.registry.roomDetailSubscribers('room').size, 0, scenario);
      assert.equal(h.connection.pendingPreviews?.size, 0, scenario);
      assert.equal(messageReads, 0, scenario);
    } finally {
      h.registry.removeConnection(h.connection);
    }
  }
});

for (const phase of ['lookup', 'snapshot'] as const) {
  test(
    `account detachment cancels pending preview ${phase}; fresh unbanned attempt succeeds`,
    { timeout: 5000 },
    async () => {
      const h = harness();
      const reached = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const pause = async () => {
        reached.resolve();
        await resume.promise;
      };
      if (phase === 'lookup')
        h.deps.findRoomBan = async () => {
          await pause();
          return null;
        };
      else {
        const store = h.deps.getRoomStore();
        h.deps.getRoomStore = () => ({
          ...store,
          getRoom: async () => {
            await pause();
            return dbRoom('room');
          }
        });
      }
      const runtime = createRoomRealtimeRuntime(h.deps);
      const pending = runtime.subscribePreview(h.connection, 'room');
      try {
        await reached.promise;
        h.registry.detachAccountRoom('room', 'A');
        resume.resolve();
        await pending;
        assert.equal(h.frames.length, 0);
        assert.equal(h.registry.roomDetailSubscribers('room').size, 0);
        assert.equal(h.connection.pendingPreviews?.size, 0);
        await runtime.subscribePreview(h.connection, 'room');
        assert.equal(h.frames.length, 1);
        assert.equal(h.registry.roomDetailSubscribers('room').has(h.connection), true);
      } finally {
        resume.resolve();
        h.registry.removeConnection(h.connection);
      }
    }
  );
}

for (const outcome of ['missing', 'throw', 'success'] as const) {
  test(`superseded snapshot ${outcome} cannot remove the newer subscription`, { timeout: 5000 }, async () => {
    const h = harness();
    const reached = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let reads = 0;
    const store = h.deps.getRoomStore();
    h.deps.getRoomStore = () => ({
      ...store,
      getRoom: async () => {
        if (++reads === 1) {
          reached.resolve();
          await resume.promise;
          if (outcome === 'throw') throw new Error('old failure');
          if (outcome === 'missing') return null;
        }
        return dbRoom('room');
      }
    });
    const runtime = createRoomRealtimeRuntime(h.deps);
    const pending = runtime.subscribePreview(h.connection, 'room');
    const settled = pending.catch((error: unknown) => error);
    try {
      await reached.promise;
      await runtime.subscribePreview(h.connection, 'room');
      resume.resolve();
      await settled;
      assert.equal(h.frames.length, 1);
      assert.equal(h.registry.roomDetailSubscribers('room').has(h.connection), true);
      assert.equal(h.connection.previewRoomIds.has('room'), true);
      assert.equal(h.connection.pendingPreviews?.size, 0);
    } finally {
      resume.resolve();
      h.registry.removeConnection(h.connection);
    }
  });
}

test('account detach covers voice and two previews while preserving other rooms and accounts', async () => {
  const h = harness();
  const received = new Map<string, string[]>();
  const add = (userId: string, name: string) => {
    const frames: string[] = [];
    received.set(name, frames);
    return h.registry.addConnection(userId, { readyState: 1, send: (data) => frames.push(data), close() {} });
  };
  const preview1 = add('A', 'preview1');
  const preview2 = add('A', 'preview2');
  const other = add('B', 'other');
  const connections = [h.connection, preview1, preview2, other];
  const runtime = createFullTestRuntime(h.deps);
  try {
    for (const connection of connections) await runtime.subscribePreview(connection, 'room');
    await runtime.subscribePreview(preview1, 'other-room');
    h.connection.activeVoice = { roomId: 'room', peerId: 'peer', sessionToken: 'token', transportId: 'transport' };
    h.registry.detachAccountRoom('room', 'A');
    const before = connections.map((connection) =>
      connection === h.connection
        ? h.frames.length
        : received.get(connection === preview1 ? 'preview1' : connection === preview2 ? 'preview2' : 'other')?.length
    );
    runtime.broadcastRoomDetail('room', buildServerEnvelope('room.not_found', { roomId: 'room' }));
    assert.equal(h.frames.length, before[0]);
    assert.equal(received.get('preview1')?.length, before[1]);
    assert.equal(received.get('preview2')?.length, before[2]);
    assert.equal(received.get('other')?.length, (before[3] || 0) + 1);
    assert.deepEqual([...h.registry.roomDetailSubscribers('room')], [other]);
    assert.equal(h.registry.roomDetailSubscribers('other-room').has(preview1), true);
    for (const connection of connections.slice(0, 3)) assert.equal(connection.previewRoomIds.has('room'), false);
  } finally {
    for (const connection of connections) h.registry.removeConnection(connection);
  }
});

test('account detach invalidates voice completion paused in its snapshot', { timeout: 5000 }, async () => {
  const h = harness();
  const room = { id: 'room', peers: new Map<string, RosterPeer>() };
  const reached = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const store = h.deps.getRoomStore();
  h.deps.presenceRooms.set('room', room);
  h.deps.getRoom = async () => room;
  h.deps.queueRoomOccupancyTransition = async () => {};
  h.deps.closePeer = (_roomId, peerId, transportId) => {
    const peer = h.deps.presenceRooms.get('room')?.peers.get(peerId);
    if (peer?.transport?.id === transportId) room.peers.delete(peerId);
  };
  h.deps.getRoomStore = () => ({
    ...store,
    getRoom: async () => {
      reached.resolve();
      await resume.promise;
      return dbRoom('room');
    },
    getOrCreatePeerIdentity: async () => ({
      status: 'created',
      identity: {
        id: 'guest',
        peerId: 'peer',
        roomId: 'room',
        avatarColorKey: 'blue',
        createdAt: 0,
        lastSeenAt: 0,
        displayName: 'A',
        sessionTokenHash: ''
      }
    }),
    normalizeGatePrincipal: () => ({ principalType: 'account', principalId: 'A' }),
    isRoomServerMuted: async () => false
  });
  const runtime = createRoomRealtimeRuntime(h.deps);
  const pending = runtime.joinVoiceRoom(
    h.connection,
    { roomId: 'room', peerId: 'peer', sessionToken: 's'.repeat(32), name: 'A' },
    { id: 'A' }
  );
  try {
    await reached.promise;
    h.registry.detachAccountRoom('room', 'A');
    resume.resolve();
    assert.deepEqual(await pending, {
      ok: false,
      code: 'superseded_join',
      message: 'Join replaced by a newer connection'
    });
    assert.equal(h.frames.length, 0);
    assert.equal(h.registry.roomDetailSubscribers('room').size, 0);
    assert.equal(h.connection.activeVoice, null);
  } finally {
    resume.resolve();
    h.registry.removeConnection(h.connection);
  }
});
