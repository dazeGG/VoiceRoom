import test from 'node:test';
import assert from 'node:assert/strict';
import type { ServerFrame } from '@voice-room/shared/contracts/realtime';
import { createRoomRealtimeRuntime, type RoomRuntimeDeps } from '../src/realtime/room-runtime.ts';
import type { WsConnection } from '../src/realtime/registry.ts';
import { fake } from './fakes/index.ts';
import { runtimeDeps } from './fakes/room-runtime.ts';

type TestRoom = NonNullable<Awaited<ReturnType<RoomRuntimeDeps['getRoom']>>>;

function connection() {
  return fake<WsConnection>({ activeVoice: null, closed: false, pendingVoiceJoin: null, previewRoomIds: new Set() });
}

function join(roomId: string, n: number) {
  return { roomId, peerId: `peer-${roomId}-${n}`, sessionToken: `${roomId}${n}`.padEnd(32, 't'), name: `Peer ${n}` };
}

// Two rooms and a voice cap of three people for the whole server.
function capacityRuntime(maxVoicePeers: number) {
  const rooms = new Map<string, TestRoom>([
    ['room-a', { id: 'room-a', peers: new Map() }],
    ['room-b', { id: 'room-b', peers: new Map() }]
  ]);
  const sent: ServerFrame[] = [];
  const runtime = createRoomRealtimeRuntime(
    runtimeDeps({
      presenceRooms: rooms,
      getRoom: async (roomId) => rooms.get(roomId) ?? null,
      MAX_VOICE_PEERS: maxVoicePeers,
      queueRoomOccupancyTransition: async () => {},
      findRoomBan: async () => null,
      store: {
        async getOrCreatePeerIdentity({ roomId, peerId }) {
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
          return { status: 'created' as const, identity };
        },
        async isRoomServerMuted() {
          return false;
        },
        normalizeGatePrincipal() {
          return { principalId: 'guest', principalType: 'guest' };
        }
      },
      wsRegistry: {
        sendToConnection(_connection, frame) {
          sent.push(frame);
          return true;
        }
      }
    })
  );
  return { rooms, sent, runtime };
}

test('voice joins past MAX_VOICE_PEERS across all rooms are refused with server.full', async () => {
  const { rooms, sent, runtime } = capacityRuntime(3);

  for (const payload of [join('room-a', 1), join('room-a', 2), join('room-b', 1)]) {
    assert.equal((await runtime.joinVoiceRoom(connection(), payload, null)).ok, true);
  }
  const refused = await runtime.joinVoiceRoom(connection(), join('room-b', 2), null);

  assert.deepEqual(refused, { ok: false, code: 'server_full' });
  assert.equal(rooms.get('room-b')?.peers.has('peer-room-b-2'), false);
  assert.deepEqual(
    sent.find((frame) => frame.type === 'server.full'),
    { type: 'server.full', payload: { roomId: 'room-b', maxVoicePeers: 3 } }
  );
});

test('someone already in voice keeps their seat on reconnect when the server is at its cap', async () => {
  const { runtime } = capacityRuntime(2);
  const seated = join('room-a', 1);

  assert.equal((await runtime.joinVoiceRoom(connection(), seated, null)).ok, true);
  assert.equal((await runtime.joinVoiceRoom(connection(), join('room-b', 1), null)).ok, true);

  assert.equal((await runtime.joinVoiceRoom(connection(), seated, null)).ok, true);
});

test('MAX_VOICE_PEERS of 0 leaves the server uncapped', async () => {
  const { runtime } = capacityRuntime(0);

  for (let n = 1; n <= 5; n += 1) {
    assert.equal((await runtime.joinVoiceRoom(connection(), join('room-a', n), null)).ok, true);
  }
});
