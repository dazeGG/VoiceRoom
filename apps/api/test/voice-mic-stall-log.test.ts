// A client that rebuilt its stalled microphone leaves one searchable line in the
// log, so the operator can find it without reading every stay's minutes. An
// ordinary poll, with or without the microphone's numbers, leaves none.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LOG_EVENTS } from '../src/lib/log-events.ts';
import { createRoomRealtimeRuntime, type RoomRuntimeDeps } from '../src/realtime/room-runtime.ts';
import type { WsConnection } from '../src/realtime/registry.ts';
import { fake } from './fakes/index.ts';
import { runtimeDeps } from './fakes/room-runtime.ts';

type TestRoom = NonNullable<Awaited<ReturnType<RoomRuntimeDeps['getRoom']>>>;

async function seated() {
  const warnings: unknown[] = [];
  const rooms = new Map<string, TestRoom>([['kitchen', { id: 'kitchen', peers: new Map() }]]);
  const runtime = createRoomRealtimeRuntime(
    runtimeDeps({
      presenceRooms: rooms,
      getRoom: async (roomId) => rooms.get(roomId) ?? null,
      queueRoomOccupancyTransition: async () => {},
      logger: {
        info() {},
        error() {},
        warn(record: unknown) {
          warnings.push(record);
        }
      },
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
      }
    })
  );
  const connection = fake<WsConnection>({
    id: 'conn-1',
    activeVoice: null,
    closed: false,
    pendingVoiceJoin: null,
    previewRoomIds: new Set()
  });
  const target = { roomId: 'kitchen', peerId: 'peer-1', sessionToken: 'token'.padEnd(32, 't') };
  assert.equal((await runtime.joinVoiceRoom(connection, { ...target, name: 'Петя' }, null)).ok, true);
  const poll = {
    ...target,
    rttMs: 40,
    jitterBufferMs: 30,
    uplink: { packets: 150, lost: 0 },
    transport: 'udp' as const,
    heard: []
  };
  return { runtime, connection, poll, warnings };
}

const mic = { expectedMs: 3000, deliveredMs: 0, contextMs: 3000, reopens: 0, replacements: 0 };

test('a poll that reports a recovered microphone logs it with its numbers', async () => {
  const { runtime, connection, poll, warnings } = await seated();
  assert.equal(runtime.reportVoice(connection, { ...poll, mic: { ...mic, reopens: 1 } }).ok, true);
  assert.deepEqual(warnings, [
    {
      evt: LOG_EVENTS.ROOM_MIC_STALL_RECOVERY,
      connId: 'conn-1',
      userId: undefined,
      roomId: 'kitchen',
      mic: { ...mic, reopens: 1 }
    }
  ]);
});

test('a poll without a recovery logs nothing', async () => {
  const { runtime, connection, poll, warnings } = await seated();
  runtime.reportVoice(connection, poll);
  runtime.reportVoice(connection, { ...poll, mic });
  assert.deepEqual(warnings, []);
});
