import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomRealtimeRuntime, type RoomRuntimeDeps } from '../src/realtime/room-runtime.ts';
import type { WsConnection } from '../src/realtime/registry.ts';
import type { ActiveBanRecord } from '../src/domains/moderation/active-ban.repository.ts';
import { fake } from './fakes/index.ts';
import { runtimeDeps } from './fakes/room-runtime.ts';

type TestRoom = NonNullable<Awaited<ReturnType<RoomRuntimeDeps['getRoom']>>>;

const BANNED_USER = { id: 'user-banned', displayName: 'Banned' };
const JOIN = { roomId: 'room-a', peerId: 'peer-banned', sessionToken: 's'.repeat(32), name: 'Banned' };

// An owner's ban commits while the join is between its ban check and taking
// the seat (here: while the peer identity is loaded). The ban's eviction
// (afterBanCommitted) reads the roster once, right after the commit, so it
// cannot see a peer that takes its seat later.
function joinRacingABan(findRoomBan: (banCommitted: boolean) => Promise<ActiveBanRecord | null>) {
  const room: TestRoom = { id: JOIN.roomId, peers: new Map() };
  const rooms = new Map([[room.id, room]]);
  let banCommitted = false;
  const evicted: string[] = [];
  const left: string[] = [];

  const runtime = createRoomRealtimeRuntime(
    runtimeDeps({
      presenceRooms: rooms,
      getRoom: async (roomId) => rooms.get(roomId) ?? null,
      queueRoomOccupancyTransition: async () => {},
      findRoomBan: async (_roomId, userId) => (userId === BANNED_USER.id ? findRoomBan(banCommitted) : null),
      // Only the transport that owns the seat can close it, as in room-presence.
      closePeer(roomId, peerId, transportId, reason) {
        const current = rooms.get(roomId)?.peers.get(peerId);
        if (!current || !transportId || current.transport?.id !== transportId) return;
        rooms.get(roomId)?.peers.delete(peerId);
        left.push(`${peerId}:${reason}`);
      },
      store: {
        async getOrCreatePeerIdentity({ roomId, peerId }) {
          banCommitted = true;
          for (const peer of room.peers.values()) {
            if (peer.accountUserId !== BANNED_USER.id) continue;
            evicted.push(peer.id);
            room.peers.delete(peer.id);
          }
          const identity = {
            avatarColorKey: 'blue',
            createdAt: 0,
            displayName: '',
            id: `identity-${peerId}`,
            lastSeenAt: 0,
            peerId,
            roomId,
            sessionTokenHash: ''
          };
          return { status: 'created', identity };
        },
        async isRoomServerMuted() {
          return false;
        },
        normalizeGatePrincipal() {
          return { principalId: BANNED_USER.id, principalType: 'account' };
        }
      }
    })
  );
  const connection = fake<WsConnection>({
    activeVoice: null,
    closed: false,
    pendingVoiceJoin: null,
    previewRoomIds: new Set()
  });
  return { connection, evicted, left, room, join: () => runtime.joinVoiceRoom(connection, JOIN, BANNED_USER) };
}

test('a ban committed while a voice join is in flight does not leave the peer in the room', async () => {
  const { connection, evicted, left, room, join } = joinRacingABan(async (banCommitted) =>
    banCommitted ? fake<ActiveBanRecord>({ id: 'ban-1' }) : null
  );

  const result = await join();

  assert.deepEqual(evicted, [], 'the eviction ran before the peer took its seat');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'room_banned');
  assert.equal(room.peers.has(JOIN.peerId), false);
  assert.deepEqual(left, [`${JOIN.peerId}:banned`]);
  assert.equal(connection.activeVoice, null);
});

test('a voice join whose second ban check fails gives the seat back', async () => {
  const { connection, left, room, join } = joinRacingABan(async (banCommitted) => {
    if (banCommitted) throw new Error('database unavailable');
    return null;
  });

  await assert.rejects(join(), /database unavailable/);

  assert.equal(room.peers.has(JOIN.peerId), false);
  assert.deepEqual(left, [`${JOIN.peerId}:lost`]);
  assert.equal(connection.activeVoice, null);
});
