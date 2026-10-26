import test from 'node:test';
import assert from 'node:assert/strict';
import type { MediaGrant } from '@voice-room/shared/contracts/realtime';
import { createRoomRealtimeRuntime, type RoomRuntimeDeps } from '../src/realtime/room-runtime.ts';
import type { WsConnection } from '../src/realtime/registry.ts';
import { fake } from './fakes/index.ts';
import { defined } from './helpers/assert-defined.ts';
import { runtimeDeps } from './fakes/room-runtime.ts';

type TestRoom = NonNullable<Awaited<ReturnType<RoomRuntimeDeps['getRoom']>>>;
type Runtime = ReturnType<typeof createRoomRealtimeRuntime>;

function connection() {
  return fake<WsConnection>({ activeVoice: null, closed: false, pendingVoiceJoin: null, previewRoomIds: new Set() });
}

// Two rooms on one server, a clock the test moves, and the media limits under test.
function budgetRuntime(limits: {
  MEDIA_BUDGET_MBPS?: number;
  MEDIA_BUDGET_VOICE_PEERS?: number;
  MAX_ROOM_SCREENS?: number;
}) {
  const rooms = new Map<string, TestRoom>([
    ['room-a', { id: 'room-a', peers: new Map() }],
    ['room-b', { id: 'room-b', peers: new Map() }]
  ]);
  const clock = { now: 1_000_000 };
  const runtime = createRoomRealtimeRuntime(
    runtimeDeps({
      ...limits,
      presenceRooms: rooms,
      getRoom: async (roomId) => rooms.get(roomId) ?? null,
      now: () => clock.now,
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
      }
    })
  );
  return { clock, runtime };
}

type Seat = { conn: WsConnection; target: { roomId: string; peerId: string; sessionToken: string } };

async function seat(runtime: Runtime, roomId: string, n: number): Promise<Seat> {
  const conn = connection();
  const target = { roomId, peerId: `peer-${roomId}-${n}`, sessionToken: `${roomId}${n}`.padEnd(32, 't') };
  assert.equal((await runtime.joinVoiceRoom(conn, { ...target, name: `Peer ${n}` }, null)).ok, true);
  return { conn, target };
}

// At least two people, so a test can name the first two.
async function seats(runtime: Runtime, roomId: string, count: number): Promise<[Seat, Seat, ...Seat[]]> {
  assert.ok(count >= 2, 'seats() seats at least two people');
  const first = await seat(runtime, roomId, 1);
  const second = await seat(runtime, roomId, 2);
  const rest: Seat[] = [];
  for (let n = 3; n <= count; n += 1) rest.push(await seat(runtime, roomId, n));
  return [first, second, ...rest];
}

function ask(runtime: Runtime, { conn, target }: Seat, kind: 'screen' | 'camera', profileId?: string) {
  const result = runtime.requestMedia(conn, { ...target, kind, ...(profileId ? { profileId } : {}) });
  assert.equal(result.ok, true);
  return result.ok ? result.grant : null;
}

function profileOf(grant: MediaGrant | null) {
  return grant?.granted ? grant.profileId : undefined;
}

// A screen share costs its bitrate times the others in the room: in a room of
// nine, 1080p 60 FPS (10 Mbit/s) to eight viewers is 80 Mbit/s.

test('a screen share fits the budget at the quality asked for', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 80 });
  const [first] = await seats(runtime, 'room-a', 9);

  assert.deepEqual(ask(runtime, first, 'screen', 'high-60'), {
    roomId: 'room-a',
    kind: 'screen',
    granted: true,
    profileId: 'high-60'
  });
});

test('a busy server offers the best 720p profile that still fits', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 120 });
  const [first, second] = await seats(runtime, 'room-a', 9);

  ask(runtime, first, 'screen', 'high-60');
  // 40 Mbit/s left: 720p 60 FPS needs 60, 720p 30 FPS needs exactly 40.
  assert.equal(profileOf(ask(runtime, second, 'screen', 'high-60')), 'balanced-30');
});

test('a full budget refuses the screen share outright', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 80 });
  const [first, second] = await seats(runtime, 'room-a', 9);

  ask(runtime, first, 'screen', 'high-60');
  assert.deepEqual(ask(runtime, second, 'screen', 'balanced-5'), {
    roomId: 'room-a',
    kind: 'screen',
    granted: false,
    reason: 'server_busy'
  });
});

test('the budget is shared by every room on the server', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 80 });
  const [streamer] = await seats(runtime, 'room-a', 9);
  const [other] = await seats(runtime, 'room-b', 2);

  ask(runtime, streamer, 'screen', 'high-60');
  assert.equal(ask(runtime, other, 'screen', 'balanced-30')?.granted, false);
});

test('a stream started without asking, by an older client, still counts', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 80 });
  const [legacy, second] = await seats(runtime, 'room-a', 9);

  await runtime.updatePeerState(legacy.conn, {
    ...legacy.target,
    patch: { screen: true, screenProfileId: 'high-60' }
  });
  assert.equal(ask(runtime, second, 'screen', 'balanced-5')?.granted, false);
});

test('a stopped stream gives its share back', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 80 });
  const [first, second] = await seats(runtime, 'room-a', 9);

  ask(runtime, first, 'screen', 'high-60');
  await runtime.updatePeerState(first.conn, { ...first.target, patch: { screen: true, screenProfileId: 'high-60' } });
  await runtime.updatePeerState(first.conn, { ...first.target, patch: { screen: false, screenProfileId: '' } });

  assert.equal(profileOf(ask(runtime, second, 'screen', 'high-60')), 'high-60');
});

test('a grant holds its share until the stream is published, even through other presence updates', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 80 });
  const [first, second] = await seats(runtime, 'room-a', 9);

  ask(runtime, first, 'screen', 'high-60');
  await runtime.updatePeerState(first.conn, { ...first.target, patch: { muted: true, screen: false } });

  assert.equal(ask(runtime, second, 'screen', 'balanced-5')?.granted, false);
});

test('a grant that never turned into a stream lapses after a minute', async () => {
  const { clock, runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 80 });
  const [first, second] = await seats(runtime, 'room-a', 9);

  ask(runtime, first, 'screen', 'high-60');
  clock.now += 60_001;

  assert.equal(profileOf(ask(runtime, second, 'screen', 'high-60')), 'high-60');
});

test('asking again replaces your own share instead of adding to it', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 80 });
  const [first] = await seats(runtime, 'room-a', 9);

  ask(runtime, first, 'screen', 'high-60');
  assert.equal(profileOf(ask(runtime, first, 'screen', 'high-60')), 'high-60');
});

test('a new stream in a small room is charged as if the room had nine people, since rooms grow', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 50 });
  const [first] = await seats(runtime, 'room-a', 2);

  // Eight viewers counted: 1080p 60 FPS would be 80, 720p 60 FPS 60, 720p 30 FPS 40.
  assert.equal(profileOf(ask(runtime, first, 'screen', 'high-60')), 'balanced-30');
});

test('people in voice take their share of the budget before any stream', async () => {
  // Nine of twenty: 45% of 100 Mbit/s goes to voice, 55 is left. 1080p 60 FPS
  // (80) and 720p 60 FPS (60) no longer fit, 720p 30 FPS (40) does.
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 100, MEDIA_BUDGET_VOICE_PEERS: 20 });
  const [first] = await seats(runtime, 'room-a', 9);

  assert.equal(profileOf(ask(runtime, first, 'screen', 'high-60')), 'balanced-30');
});

test('no video is left once the server holds MEDIA_BUDGET_VOICE_PEERS people in voice, in any rooms', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 1000, MEDIA_BUDGET_VOICE_PEERS: 18 });
  const [first] = await seats(runtime, 'room-a', 9);
  await seats(runtime, 'room-b', 9);

  assert.deepEqual(ask(runtime, first, 'camera'), {
    roomId: 'room-a',
    kind: 'camera',
    granted: false,
    reason: 'server_busy'
  });
});

test('a camera claim ends when the camera goes on and off, and survives repeats of "camera off"', async () => {
  // Nine people: one camera costs 0.45 Mbit/s × 8 = 3.6 Mbit/s.
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 4 });
  const [first, second] = await seats(runtime, 'room-a', 9);

  ask(runtime, first, 'camera');
  await runtime.updatePeerState(first.conn, { ...first.target, patch: { camera: false, muted: true } });
  assert.equal(ask(runtime, second, 'camera')?.granted, false);

  await runtime.updatePeerState(first.conn, { ...first.target, patch: { camera: true } });
  assert.equal(ask(runtime, second, 'camera')?.granted, false);
  await runtime.updatePeerState(first.conn, { ...first.target, patch: { camera: false } });
  assert.equal(ask(runtime, second, 'camera')?.granted, true);
});

test('a camera that is on stays counted when its owner reconnects', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 4 });
  const [first, second] = await seats(runtime, 'room-a', 9);

  ask(runtime, first, 'camera');
  await runtime.updatePeerState(first.conn, { ...first.target, patch: { camera: true } });
  const again = connection();
  assert.equal((await runtime.joinVoiceRoom(again, { ...first.target, name: 'Peer 1' }, null)).ok, true);

  assert.equal(ask(runtime, second, 'camera')?.granted, false);
});

test('a camera costs its 360p layer for each viewer', async () => {
  // Ten people: a camera sends 0.45 Mbit/s to nine viewers, 4.05 Mbit/s.
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 9 });
  const people = await seats(runtime, 'room-a', 10);

  assert.deepEqual(ask(runtime, people[0], 'camera'), { roomId: 'room-a', kind: 'camera', granted: true });
  assert.equal(ask(runtime, people[1], 'camera')?.granted, true);
  assert.deepEqual(ask(runtime, defined(people[2], 'the third person'), 'camera'), {
    roomId: 'room-a',
    kind: 'camera',
    granted: false,
    reason: 'server_busy'
  });
});

test('a room runs at most MAX_ROOM_SCREENS screen shares, other rooms are not affected', async () => {
  const { runtime } = budgetRuntime({ MAX_ROOM_SCREENS: 1 });
  const [first, second] = await seats(runtime, 'room-a', 2);
  const elsewhere = await seat(runtime, 'room-b', 1);

  ask(runtime, first, 'screen', 'balanced-30');
  assert.deepEqual(ask(runtime, second, 'screen', 'balanced-30'), {
    roomId: 'room-a',
    kind: 'screen',
    granted: false,
    reason: 'room_screens_full',
    maxRoomScreens: 1
  });
  assert.equal(ask(runtime, elsewhere, 'screen', 'balanced-30')?.granted, true);
});

test('with no limits set every request is granted as asked', async () => {
  const { runtime } = budgetRuntime({});
  const people = await seats(runtime, 'room-a', 5);

  for (const person of people) assert.equal(profileOf(ask(runtime, person, 'screen', 'high-60')), 'high-60');
});

test('only the connection that holds the voice session may ask', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 80 });
  const [first] = await seats(runtime, 'room-a', 2);

  assert.deepEqual(runtime.requestMedia(connection(), { ...first.target, kind: 'screen' }), {
    ok: false,
    code: 'not_active_peer'
  });
  assert.deepEqual(
    runtime.requestMedia(first.conn, { ...first.target, sessionToken: 'x'.repeat(32), kind: 'screen' }),
    { ok: false, code: 'invalid_session' }
  );
});

// The server page's video minute (media-minute.ts): counts only, peaks over
// the minute, and the starts the budget lowered or refused.

test('the minute keeps its video peaks and counts the starts it lowered or refused', async () => {
  const { runtime } = budgetRuntime({ MEDIA_BUDGET_MBPS: 120 });
  const [first, second, third] = await seats(runtime, 'room-a', 9);
  const share = async (who: Seat, patch: { screen: boolean; screenProfileId?: string }) =>
    assert.equal((await runtime.updatePeerState(who.conn, { ...who.target, patch })).ok, true);

  // 80 Mbit/s granted as asked, then 40 at a lower profile, then nothing left.
  assert.equal(profileOf(ask(runtime, first, 'screen', 'high-60')), 'high-60');
  assert.equal(profileOf(ask(runtime, second, 'screen', 'high-60')), 'balanced-30');
  assert.equal(ask(runtime, defined(third, 'the third seat'), 'camera')?.granted, false);
  await share(first, { screen: true, screenProfileId: 'high-60' });
  await share(second, { screen: true, screenProfileId: 'balanced-30' });

  assert.deepEqual(runtime.takeMediaMinute(), {
    screensMax: 2,
    camerasMax: 0,
    videoMbpsMax: 120,
    videoBudgetMbps: 120,
    lowered: 1,
    refused: 1
  });

  // One share stops: the minute it stopped in still saw both, the next one does not.
  await share(first, { screen: false });
  assert.deepEqual(runtime.takeMediaMinute(), {
    screensMax: 2,
    camerasMax: 0,
    videoMbpsMax: 120,
    videoBudgetMbps: 120,
    lowered: 0,
    refused: 0
  });
  const quiet = runtime.takeMediaMinute();
  assert.equal(quiet.screensMax, 1);
  assert.equal(quiet.videoMbpsMax, 40);
});

test('a server without a video budget reports no budget, and a camera counts once it shows', async () => {
  const { runtime } = budgetRuntime({});
  const [first] = await seats(runtime, 'room-b', 2);
  assert.equal(ask(runtime, first, 'camera')?.granted, true);
  assert.equal((await runtime.updatePeerState(first.conn, { ...first.target, patch: { camera: true } })).ok, true);
  const minute = runtime.takeMediaMinute();
  assert.equal(minute.camerasMax, 1);
  assert.equal(minute.videoBudgetMbps, null);
  assert.equal(minute.lowered + minute.refused, 0);
});
