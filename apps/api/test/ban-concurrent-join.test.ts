import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionRegistry } from '../src/realtime/registry.ts';
import { createRoomPresence } from '../src/realtime/room-presence.ts';
import { createRoomRealtimeRuntime } from '../src/realtime/room-runtime.ts';
import { createPeerEviction } from '../src/domains/rooms/peer-eviction.ts';
import type { ActiveBanRecord } from '../src/domains/moderation/active-ban.repository.ts';
import type { LiveKitConfig } from '../src/domains/admission/livekit-config.ts';
import { createPeerModerationService, type PeerModerationStore } from '../src/domains/rooms/peer-moderation.service.ts';
import { runtimeDeps } from './fakes/room-runtime.ts';
import { fake, dbRoom, recordingLogger } from './fakes/index.ts';
import { buildServerEnvelope } from '@voiceroom/shared/realtime';

for (const cleanupFails of [false, true]) {
  test(
    `ban sweeps a completed second voice join after persistence, cleanupFails=${cleanupFails}`,
    { timeout: 5000 },
    async () => {
      const frames: string[] = [];
      const registry = createConnectionRegistry({
        maxConnectionsPerUser: 4,
        keepaliveMs: 15000,
        getFriendIds: async () => []
      });
      const connect = () =>
        registry.addConnection('A', { readyState: 1, send: (data) => frames.push(data), close() {} });
      const first = connect();
      const second = connect();
      const presence = createRoomPresence({
        sockets: registry,
        logger: () => recordingLogger(),
        roster: { waitMs: 10, pollMs: 1 },
        occupancyRetry: { baseMs: 1, maxMs: 2 },
        store: () => ({
          markRoomActive: async () => {},
          markRoomEmpty: async () => {},
          pruneRooms: async () => {},
          getRoom: async () => dbRoom('room')
        })
      });
      const room = { ...dbRoom('room'), ownerId: 'owner', peers: presence.room('room').peers };
      let committed = false;
      const deps = runtimeDeps({
        wsRegistry: registry,
        presenceRooms: presence.rooms,
        getRoom: async () => room,
        closePeer: presence.closePeer,
        publishRoomEvent: presence.publish,
        queueRoomOccupancyTransition: async () => {},
        findRoomBan: async () => (committed ? fake<ActiveBanRecord>({ id: 'ban' }) : null),
        store: {
          getRoom: async () => dbRoom('room'),
          normalizeGatePrincipal: () => ({ principalType: 'account', principalId: 'A' }),
          isRoomServerMuted: async () => false,
          getOrCreatePeerIdentity: async ({ peerId }) => ({
            status: 'created',
            identity: {
              id: 'guest-' + peerId,
              roomId: 'room',
              peerId,
              avatarColorKey: 'blue',
              displayName: 'A',
              createdAt: 0,
              lastSeenAt: 0,
              sessionTokenHash: ''
            }
          })
        }
      });
      const runtime = createRoomRealtimeRuntime(deps);
      const eviction = createPeerEviction({
        runtime: () => runtime,
        store: () => ({ revokeLiveKitGatePeer: async () => {}, invalidatePeerIdentity: async () => {} }),
        notifyPeer: presence.sendToPeer,
        notifyUser: () => {},
        detachVoiceConnections: registry.detachVoicePeer,
        closePeer: presence.closePeer,
        removeParticipant: async (_roomId, peerId) => {
          if (cleanupFails && peerId === 'P1') throw new Error('sfu down');
        }
      });
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const moderation = createPeerModerationService({
        eviction,
        detachAccountRoom: registry.detachAccountRoom,
        store: () =>
          fake<PeerModerationStore>({
            createRoomBan: async () => {
              entered.resolve();
              await release.promise;
              committed = true;
              return {
                status: 'created',
                ban: { id: 'ban', roomId: 'room', userId: 'A', ip: '', createdAt: 0, expiresAt: null, metadata: {} }
              };
            }
          }),
        livekitConfig: () => fake<LiveKitConfig>({ enabled: false }),
        gatePrincipalForPeer: () => ({ principalType: 'account', principalId: 'A' }),
        revokeForServerMute: async () => {},
        setParticipantMuted: async () => ({ status: 'applied' }),
        announcePeerUpdated: () => {},
        maxBans: 10,
        logger: () => recordingLogger()
      });
      const join = (connection: typeof first, peerId: string) =>
        runtime.joinVoiceRoom(
          connection,
          { roomId: 'room', peerId, sessionToken: 's'.repeat(32), name: 'A' },
          { id: 'A' }
        );
      try {
        assert.equal((await join(first, 'P1')).ok, true);
        const banning = moderation.ban(room, 'P1');
        await entered.promise;
        assert.equal((await join(second, 'P2')).ok, true);
        assert.equal(second.pendingVoiceJoin, null);
        release.resolve();
        assert.deepEqual(await banning, { status: 'banned', banId: 'ban', cleanupFailed: cleanupFails });
        assert.equal(room.peers.size, 0);
        assert.equal(first.activeVoice, null);
        assert.equal(second.activeVoice, null);
        assert.equal(registry.roomDetailSubscribers('room').size, 0);
        const before = frames.length;
        presence.publish('room', buildServerEnvelope('room.not_found', { roomId: 'room' }));
        assert.equal(frames.length, before);
      } finally {
        release.resolve();
        registry.removeConnection(first);
        registry.removeConnection(second);
        presence.reset();
      }
    }
  );
}
