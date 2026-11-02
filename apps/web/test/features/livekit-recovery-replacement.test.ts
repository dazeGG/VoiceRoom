// Recovering a lost LiveKit connection by replacing the room: a fresh
// connection is built on the side and only committed once complete.

import { expect, test, vi } from 'vitest';
import { RealtimeRecoveryController } from '@/features/room/client/recovery/realtime-recovery';
import { loadLiveKitHarness } from '../helpers/livekit-harness.ts';

const micTrack = {
  id: 'mic',
  kind: 'audio',
  readyState: 'live',
  stop() {
    micTrack.readyState = 'ended';
  }
};
const micStream = { id: 'mic-stream', getAudioTracks: () => [micTrack], getTracks: () => [micTrack] };

async function inCall(options: Parameters<typeof loadLiveKitHarness>[0] = {}) {
  const lk = await loadLiveKitHarness({ autoResolveClient: true, ...options });
  const oldRoom = {
    closed: false,
    disconnect: async () => {
      oldRoom.closed = true;
    },
    removeAllListeners: () => {},
    remoteParticipants: new Map<string, unknown>()
  };
  Object.assign(lk.state, {
    joined: true,
    roomId: 'room-a',
    peerId: 'peer-1',
    sessionToken: 'session-1',
    localStream: micStream,
    localScreenStream: null,
    localScreenPublications: new Map<string, unknown>(),
    livekitRoom: oldRoom,
    self: { name: 'Анна' }
  });
  return { lk, oldRoom };
}

test('a replacement connects, publishes the kept microphone and only then takes over from the old room', async () => {
  const { lk, oldRoom } = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }) });
  const outcome = await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });

  expect(outcome).toEqual({ ok: true });
  const [candidate] = lk.rooms;
  expect(lk.state.livekitRoom).toBe(candidate);
  expect(candidate?.published.map((entry) => entry.track)).toEqual([micTrack]);
  expect(oldRoom.closed).toBe(true);
});

test('a room the server drops leaves the microphone its replacement publishes running', async () => {
  let duringReplacement = () => {};
  const { lk } = await inCall({
    requestToken: async () => {
      duringReplacement();
      return { token: 't', url: 'wss://lk.example' };
    }
  });
  micTrack.readyState = 'live';
  await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  duringReplacement = () => lk.rooms[0]?.dropByServer();

  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 2 })).resolves.toEqual({ ok: true });

  expect(micTrack.readyState).toBe('live');
  expect(lk.state.livekitRoom).toBe(lk.rooms[1]);
});

test('when the first LiveKit address fails, the next one is tried', async () => {
  const { lk } = await inCall({
    requestToken: async () => ({ token: 't', urls: ['wss://a.example', 'wss://b.example'] }),
    failingUrls: ['wss://a.example']
  });
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toEqual({ ok: true });
  expect(lk.rooms.map((room) => [room.connectedUrl, room.disconnected])).toEqual([
    ['', true],
    ['wss://b.example', false]
  ]);
});

test('a failure everywhere keeps the old room and is worth retrying', async () => {
  const { lk, oldRoom } = await inCall({
    requestToken: async () => ({ token: 't', url: 'wss://a.example' }),
    failingUrls: ['wss://a.example']
  });
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toMatchObject({
    retryable: true,
    code: 'transport_error'
  });
  expect(lk.state.livekitRoom).toBe(oldRoom);
});

test('a ban or a full room stops recovery; a server error does not', async () => {
  let error: Error = new Error('');
  const { lk } = await inCall({
    requestToken: async () => {
      throw error;
    }
  });
  error = lk.refusal('banned', 'room_banned', 403);
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toMatchObject({
    retryable: false,
    code: 'room_banned'
  });
  error = lk.refusal('full', 'room_full', 409);
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 2 })).resolves.toMatchObject({
    retryable: false
  });
  error = lk.refusal('down', 'internal', 503);
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 3 })).resolves.toMatchObject({
    retryable: true,
    status: 503
  });
});

test('a replacement abandoned mid-way (the recovery epoch moved on) never replaces the room', async () => {
  let current = true;
  const { lk, oldRoom } = await inCall({
    requestToken: async () => {
      current = false;
      return { token: 't', url: 'wss://lk.example' };
    },
    recoveryEpochCurrent: () => current
  });
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toMatchObject({
    retryable: true
  });
  expect(lk.state.livekitRoom).toBe(oldRoom);
  expect(lk.rooms).toHaveLength(0);
});

test('recovery logs name candidates by index only, never by URL or raw error', async () => {
  const logged: unknown[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
  const info = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
  const { lk } = await inCall({
    requestToken: async () => ({ token: 't', urls: ['wss://secret-a.example', 'wss://secret-b.example'] }),
    failingUrls: ['wss://secret-a.example']
  });
  await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  const text = JSON.stringify(logged);
  expect(text).toContain('candidateIndex');
  expect(text).not.toContain('secret-');
  expect(text).not.toContain('cannot reach');
  warn.mockRestore();
  info.mockRestore();
});

test('?forceRelay=1 sends all media through the TURN relay; otherwise ICE picks freely', async () => {
  const { lk } = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }) });
  await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  expect(lk.rooms[0]?.connectOptions).toEqual({ autoSubscribe: false });

  window.history.replaceState({}, '', '/r/room-a?forceRelay=1');
  const relayed = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }) });
  await relayed.lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  expect(relayed.lk.rooms[0]?.connectOptions).toEqual({
    autoSubscribe: false,
    rtcConfig: { iceTransportPolicy: 'relay' }
  });
  window.history.replaceState({}, '', '/');
});

/** Whether the current room still acts on its events; all of them share the one guard. */
function hearsEvents(lk: Awaited<ReturnType<typeof loadLiveKitHarness>>, room: (typeof lk.rooms)[number] | undefined) {
  const marker = { source: 'microphone', trackSid: 'marker' };
  room?.emit('LocalTrackPublished', marker);
  return lk.state.localMicPublication === marker;
}

test('a replacement room keeps hearing its events whatever a call changes after it took over', async () => {
  const otherStream = { id: 'other', getAudioTracks: () => [micTrack], getTracks: () => [micTrack] };
  const screen = { id: 'screen', getAudioTracks: () => [], getTracks: () => [] };
  const changes: Array<(lk: Awaited<ReturnType<typeof loadLiveKitHarness>>) => void> = [
    () => {},
    (lk) => Object.assign(lk.state, { localStream: otherStream }),
    (lk) => Object.assign(lk.state, { localScreenStream: screen })
  ];
  for (const change of changes) {
    const { lk } = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }) });
    await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
    change(lk);
    expect(hearsEvents(lk, lk.rooms[0])).toBe(true);
  }
});

test('a replacement room outlives its own recovery epoch, and goes deaf only when the call ends', async () => {
  let currentEpoch = 1;
  const { lk } = await inCall({
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' }),
    recoveryEpochCurrent: (epoch) => epoch === currentEpoch
  });
  await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  currentEpoch = 2;
  expect(hearsEvents(lk, lk.rooms[0])).toBe(true);
  Object.assign(lk.state, { joined: false });
  expect(hearsEvents(lk, lk.rooms[0])).toBe(false);
});

test('with the real recovery controller, an asked replacement takes over; a refused one leaves that room in charge', async () => {
  let refused: Error | null = null;
  let controller: RealtimeRecoveryController | null = null;
  const { lk, oldRoom } = await inCall({
    requestToken: async () => {
      if (refused) throw refused;
      return { token: 't', url: 'wss://lk.example' };
    },
    recoveryEpochCurrent: (epoch) => controller?.isCurrent(epoch) ?? false
  });
  const recovery = new RealtimeRecoveryController({
    attemptReplacement: (context) => lk.service.attemptFreshLiveKitReplacement(context),
    requestAppSnapshot: () => true
  });
  controller = recovery;
  const snapshot = () => recovery.appSnapshotApplied({ appEpoch: 1, active: true, hasLocalPeer: true });
  recovery.activate({ appEpoch: 1, appConnected: true });
  snapshot();
  recovery.livekitReconciled();

  recovery.requestLiveKitReplacement();
  snapshot();
  await vi.waitFor(() => expect(recovery.getSnapshot().phase).toBe('healthy'));
  expect(lk.state.livekitRoom).toBe(lk.rooms[0]);
  expect(oldRoom.closed).toBe(true);

  refused = lk.refusal('banned', 'room_banned', 403);
  recovery.requestLiveKitReplacement();
  snapshot();
  await vi.waitFor(() => expect(recovery.getSnapshot().phase).toBe('healthy'));
  expect(lk.state.livekitRoom).toBe(lk.rooms[0]);
  expect(hearsEvents(lk, lk.rooms[0]), 'the earlier epoch is long gone').toBe(true);
  recovery.cancel();
});
