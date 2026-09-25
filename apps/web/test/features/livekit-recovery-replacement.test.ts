// Recovering a lost LiveKit connection by replacing the room: a fresh
// connection is built on the side and only committed once complete.

import { expect, test, vi } from 'vitest';
import { loadLiveKitHarness } from '../helpers/livekit-harness.ts';

const micTrack = { id: 'mic', kind: 'audio', readyState: 'live' };
const micStream = { id: 'mic-stream', getAudioTracks: () => [micTrack], getTracks: () => [micTrack] };

async function inCall(options: Parameters<typeof loadLiveKitHarness>[0] = {}) {
  const lk = await loadLiveKitHarness({ autoResolveClient: true, ...options });
  const oldRoom = { disconnect: async () => { (oldRoom as { closed?: boolean }).closed = true; }, removeAllListeners: () => {}, remoteParticipants: new Map() };
  Object.assign(lk.state, {
    joined: true,
    roomId: 'room-a',
    peerId: 'peer-1',
    sessionToken: 'session-1',
    localStream: micStream,
    localScreenStream: null,
    localScreenPublications: new Map(),
    livekitRoom: oldRoom,
    self: { name: 'Анна' }
  });
  return { lk, oldRoom };
}

test('a replacement connects, publishes the kept microphone and only then takes over from the old room', async () => {
  const { lk, oldRoom } = await inCall({ postJson: async () => ({ token: 't', url: 'wss://lk.example' }) });
  const outcome = await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });

  expect(outcome).toEqual({ ok: true });
  const [candidate] = lk.rooms;
  expect(lk.state.livekitRoom).toBe(candidate);
  expect(candidate?.published.map((entry) => entry.track)).toEqual([micTrack]);
  expect((oldRoom as { closed?: boolean }).closed).toBe(true);
});

test('when the first LiveKit address fails, the next one is tried', async () => {
  const { lk } = await inCall({
    postJson: async () => ({ token: 't', urls: ['wss://a.example', 'wss://b.example'] }),
    failingUrls: ['wss://a.example']
  });
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toEqual({ ok: true });
  expect(lk.rooms.map((room) => [room.connectedUrl, room.disconnected])).toEqual([['', true], ['wss://b.example', false]]);
});

test('a failure everywhere keeps the old room and is worth retrying', async () => {
  const { lk, oldRoom } = await inCall({
    postJson: async () => ({ token: 't', url: 'wss://a.example' }),
    failingUrls: ['wss://a.example']
  });
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toMatchObject({ retryable: true, code: 'transport_error' });
  expect(lk.state.livekitRoom).toBe(oldRoom);
});

test('a ban or a full room stops recovery; a server error does not', async () => {
  let error: Error = new Error('');
  const { lk } = await inCall({ postJson: async () => { throw error; } });
  error = new lk.ApiRequestError('banned', 'room_banned', 403);
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toMatchObject({ retryable: false, code: 'room_banned' });
  error = new lk.ApiRequestError('full', 'room_full', 409);
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 2 })).resolves.toMatchObject({ retryable: false });
  error = new lk.ApiRequestError('down', 'internal', 503);
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 3 })).resolves.toMatchObject({ retryable: true, status: 503 });
});

test('a replacement abandoned mid-way (the recovery epoch moved on) never replaces the room', async () => {
  let current = true;
  const { lk, oldRoom } = await inCall({
    postJson: async () => { current = false; return { token: 't', url: 'wss://lk.example' }; },
    recoveryEpochCurrent: () => current
  });
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toMatchObject({ retryable: true });
  expect(lk.state.livekitRoom).toBe(oldRoom);
  expect(lk.rooms).toHaveLength(0);
});

test('recovery logs name candidates by index only, never by URL or raw error', async () => {
  const logged: unknown[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => { logged.push(args); });
  const info = vi.spyOn(console, 'info').mockImplementation((...args) => { logged.push(args); });
  const { lk } = await inCall({
    postJson: async () => ({ token: 't', urls: ['wss://secret-a.example', 'wss://secret-b.example'] }),
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
  const { lk } = await inCall({ postJson: async () => ({ token: 't', url: 'wss://lk.example' }) });
  await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  expect(lk.rooms[0]?.connectOptions).toEqual({ autoSubscribe: false });

  window.history.replaceState({}, '', '/r/room-a?forceRelay=1');
  const relayed = await inCall({ postJson: async () => ({ token: 't', url: 'wss://lk.example' }) });
  await relayed.lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  expect(relayed.lk.rooms[0]?.connectOptions).toEqual({ autoSubscribe: false, rtcConfig: { iceTransportPolicy: 'relay' } });
  window.history.replaceState({}, '', '/');
});
