// Recovering a lost LiveKit connection by replacing the room: a fresh
// connection is built on the side and only committed once complete.

import { afterEach, expect, test, vi } from 'vitest';
import { RealtimeRecoveryController } from '@/features/room/client/recovery/realtime-recovery';
import { fakeParticipant, fakePublication, loadLiveKitHarness } from '../helpers/livekit-harness.ts';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media.ts';

const micTrack = {
  id: 'mic',
  kind: 'audio',
  readyState: 'live',
  stop() {
    micTrack.readyState = 'ended';
  }
};
const micStream = { id: 'mic-stream', getAudioTracks: () => [micTrack], getTracks: () => [micTrack] };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function inCall(options: Parameters<typeof loadLiveKitHarness>[0] = {}) {
  micTrack.readyState = 'live';
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
    localRawStream: micStream,
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

test('unexpected local microphone publication loss still marks the voice connection reconnecting', async () => {
  const { lk } = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }) });
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toEqual({ ok: true });
  const room = lk.rooms[0];
  if (!room) throw new Error('replacement room missing');
  const publication = lk.state.localMicPublication;
  room.emit('LocalTrackUnpublished', publication);
  expect(lk.voiceStatuses.at(-1)).toBe('reconnecting');
});

test('a newer manual microphone intent prevents a stale full-room handover commit', async () => {
  const screenGate = Promise.withResolvers<void>();
  const screenStarted = Promise.withResolvers<void>();
  const screenTrack = new FakeMediaStreamTrack('screen-handover', 'audio');
  const { lk, oldRoom } = await inCall({
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' }),
    onPublish: (track) => {
      if (track !== screenTrack) return Promise.resolve();
      screenStarted.resolve();
      return screenGate.promise;
    }
  });
  lk.state.localScreenStream = new FakeMediaStream([screenTrack]);
  let publishedTrack: unknown = micTrack;
  const publicationTrack = {
    get mediaStreamTrack() {
      return publishedTrack;
    },
    replaceTrack: vi.fn(async (next: MediaStreamTrack) => {
      publishedTrack = next;
    })
  };
  lk.state.localMicPublication = { track: publicationTrack, source: 'microphone' };
  const replacement = lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  await screenStarted.promise;

  const nextCaptureGate = Promise.withResolvers<{
    processor: null;
    rawStream: FakeMediaStream;
    stream: FakeMediaStream;
  }>();
  const microphone = await import('@/features/room/client/services/microphone-service');
  vi.spyOn(microphone, 'openLocalMicrophone').mockImplementationOnce(() => nextCaptureGate.promise);
  const devices = await import('@/features/room/client/ui/devices');
  const switching = devices.switchMicrophone({ refreshDeviceList: false });
  expect(devices.getMicrophoneIntentRevision()).toBeGreaterThan(0);
  screenGate.resolve();
  await expect(replacement).resolves.toMatchObject({ retryable: true });
  const nextRaw = new FakeMediaStreamTrack('raw-b', 'audio');
  const nextOutput = new FakeMediaStreamTrack('output-b', 'audio');
  const nextCapture = {
    processor: null,
    rawStream: new FakeMediaStream([nextRaw]),
    stream: new FakeMediaStream([nextOutput])
  };
  nextCaptureGate.resolve(nextCapture);
  await expect(switching).resolves.toBe(true);
  expect(lk.state.livekitRoom).toBe(oldRoom);
  expect(lk.rooms[0]?.disconnected).toBe(true);
  expect(lk.state.localStream).toBe(nextCapture.stream);
});

test('a raw source ending during deferred screen handover leaves the old room to finish microphone cleanup', async () => {
  const screenGate = Promise.withResolvers<void>();
  const screenStarted = Promise.withResolvers<void>();
  const cleanupGate = Promise.withResolvers<void>();
  const cleanupStarted = Promise.withResolvers<void>();
  const raw = new FakeMediaStreamTrack('handover-raw', 'audio');
  const output = new FakeMediaStreamTrack('handover-output', 'audio');
  const rawStream = new FakeMediaStream([raw]);
  const outputStream = new FakeMediaStream([output]);
  const screenTrack = new FakeMediaStreamTrack('handover-screen', 'audio');
  let oldUnpublish = true;
  let emitOldUnpublish = () => {};
  const { lk } = await inCall({
    stubPresence: true,
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' }),
    onPublish: (track) => {
      if (track !== screenTrack) return Promise.resolve();
      screenStarted.resolve();
      return screenGate.promise;
    },
    onUnpublish: async (track) => {
      if (track !== output || !oldUnpublish) return;
      oldUnpublish = false;
      emitOldUnpublish();
      cleanupStarted.resolve();
      await cleanupGate.promise;
    }
  });
  Object.assign(lk.state, { localRawStream: rawStream, localStream: outputStream, muted: true });
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toEqual({ ok: true });
  const standing = lk.rooms[0];
  if (!standing) throw new Error('standing room missing');
  const oldPublication = lk.state.localMicPublication;
  emitOldUnpublish = () => standing.emit('LocalTrackUnpublished', oldPublication);
  lk.state.localScreenStream = new FakeMediaStream([screenTrack]);
  const devices = await import('@/features/room/client/ui/devices');
  devices.watchLocalMicrophone();
  const boundary = await import('@/platform/desktop-boundary');
  const realtimeBlocked = vi.spyOn(boundary, 'isRealtimeBlocked').mockReturnValue(false);
  const presence = await import('@/features/room/client/room/presence');
  const postState = vi.spyOn(presence, 'postState');
  const realtimeSockets = vi.fn();
  vi.stubGlobal('WebSocket', function UnexpectedRealtimeSocket() {
    realtimeSockets();
    throw new Error('LiveKit harness opened an application realtime socket');
  });

  const handover = lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 2 });
  await screenStarted.promise;
  raw.stop();
  raw.dispatchEvent(new Event('ended'));
  await cleanupStarted.promise;
  expect(lk.state.microphoneMissing).toBe(true);
  expect(lk.state.localStream).toBe(outputStream);
  expect(lk.voiceStatuses).not.toContain('reconnecting');
  screenGate.resolve();
  await expect(handover).resolves.toMatchObject({ retryable: true });
  expect(lk.state.livekitRoom).toBe(standing);
  cleanupGate.resolve();
  await vi.waitFor(() => expect(lk.state.localStream).toBeNull());
  expect(lk.state.localMicPublication).toBeNull();
  const microphone = await import('@/features/room/client/services/microphone-service');
  const nextRaw = new FakeMediaStreamTrack('attach-raw', 'audio');
  const nextOutput = new FakeMediaStreamTrack('attach-output', 'audio');
  const nextCapture = {
    barrier: true,
    processor: null,
    rawStream: new FakeMediaStream([nextRaw]),
    stream: new FakeMediaStream([nextOutput])
  };
  vi.spyOn(microphone, 'openLocalMicrophone').mockResolvedValueOnce(nextCapture);
  await expect(devices.attachMicrophoneOutcome()).resolves.toBe('applied');
  expect(lk.state.localStream).toBe(nextCapture.stream);
  await vi.waitFor(() => expect(postState).toHaveBeenCalled());
  expect(lk.state.joined).toBe(true);
  expect(realtimeBlocked).not.toHaveBeenCalled();
  expect(realtimeSockets).not.toHaveBeenCalled();
});

test('a current join reports listen-only when its prepared microphone cannot publish', async () => {
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' })
  });
  const capture = {
    processor: null,
    rawStream: null,
    stream: new FakeMediaStream([new FakeMediaStreamTrack('join-mic', 'audio')])
  };

  await expect(lk.service.connectLiveKitRoom('Анна', () => true, capture)).resolves.toBe(true);
  expect(lk.state.microphoneMissing).toBe(true);
  expect(lk.toasts).toEqual(['Не удалось подключить микрофон: вы в комнате без микрофона']);
});

test('a prepared raw microphone ending during the token wait joins listen-only without publishing', async () => {
  const tokenGate = Promise.withResolvers<{ token: string; url: string }>();
  const lk = await loadLiveKitHarness({ autoResolveClient: true, requestToken: () => tokenGate.promise });
  const raw = new FakeMediaStreamTrack('raw-token', 'audio');
  const output = new FakeMediaStreamTrack('output-token', 'audio');
  const capture = {
    barrier: true,
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  const microphone = await import('@/features/room/client/services/microphone-service');
  vi.spyOn(microphone, 'openLocalMicrophone').mockResolvedValueOnce(capture);
  const devices = await import('@/features/room/client/ui/devices');
  expect(await devices.acquireMicrophoneForJoin(() => true)).toBe(capture);
  const joining = lk.service.connectLiveKitRoom('Анна', () => true, capture);
  raw.stop();
  tokenGate.resolve({ token: 't', url: 'wss://lk.example' });

  await expect(joining).resolves.toBe(true);
  expect(lk.rooms[0]?.published).toHaveLength(0);
  expect(lk.state.localStream).toBeFalsy();
  expect(lk.state.microphoneMissing).toBe(true);
  expect(output.readyState).toBe('ended');
});

test('a prepared raw microphone ending during deferred publish is unpublished and never committed', async () => {
  const publishGate = Promise.withResolvers<void>();
  const publishStarted = Promise.withResolvers<void>();
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' }),
    onConnect: (room) => {
      Object.assign(room, {
        publishGate: {
          then: (resolve: (value: void) => void, reject: (error: unknown) => void) => {
            publishStarted.resolve();
            return publishGate.promise.then(resolve, reject);
          }
        }
      });
    }
  });
  const raw = new FakeMediaStreamTrack('raw-publish', 'audio');
  const output = new FakeMediaStreamTrack('output-publish', 'audio');
  const capture = {
    barrier: true,
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  const microphone = await import('@/features/room/client/services/microphone-service');
  vi.spyOn(microphone, 'openLocalMicrophone').mockResolvedValueOnce(capture);
  const devices = await import('@/features/room/client/ui/devices');
  expect(await devices.acquireMicrophoneForJoin(() => true)).toBe(capture);
  const joining = lk.service.connectLiveKitRoom('Анна', () => true, capture);
  await publishStarted.promise;
  raw.stop();
  publishGate.resolve();

  await expect(joining).resolves.toBe(true);
  expect(lk.rooms[0]?.published).toHaveLength(1);
  expect(lk.rooms[0]?.unpublished).toContain(output);
  expect(lk.state.localStream).toBeFalsy();
  expect(lk.state.localMicPublication).toBeFalsy();
  expect(lk.state.microphoneMissing).toBe(true);
  expect(output.readyState).toBe('ended');
});

test.each([
  { label: 'resolves', cleanupRejects: false },
  { label: 'rejects', cleanupRejects: true }
])('late join cleanup that $label cannot mark a newer call missing', async ({ cleanupRejects }) => {
  const cleanupGate = Promise.withResolvers<void>();
  const cleanupStarted = Promise.withResolvers<void>();
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' }),
    onUnpublish: async () => {
      cleanupStarted.resolve();
      await cleanupGate.promise;
    }
  });
  const raw = new FakeMediaStreamTrack('raw-late-cleanup', 'audio');
  const output = new FakeMediaStreamTrack('output-late-cleanup', 'audio');
  const capture = {
    barrier: true,
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  const microphone = await import('@/features/room/client/services/microphone-service');
  vi.spyOn(microphone, 'openLocalMicrophone').mockResolvedValueOnce(capture);
  const devices = await import('@/features/room/client/ui/devices');
  expect(await devices.acquireMicrophoneForJoin(() => true)).toBe(capture);
  const publish = devices.publishMicrophoneForJoin;
  vi.spyOn(devices, 'publishMicrophoneForJoin').mockImplementationOnce(async (...args) => {
    const publication = await publish(...args);
    raw.stop();
    return publication;
  });
  let current = true;
  const joining = lk.service.connectLiveKitRoom('Анна', () => current, capture);
  await cleanupStarted.promise;
  const nextRoom = { marker: 'next-call' };
  const nextPublication = { marker: 'next-publication' };
  current = false;
  lk.state.livekitRoom = nextRoom;
  lk.state.localMicPublication = nextPublication;
  lk.state.microphoneMissing = false;
  lk.state.joined = true;
  lk.state.muted = false;
  expect(devices.canAdmitAutomaticMicrophoneAction()).toBe(false);
  if (cleanupRejects) cleanupGate.reject(new Error('cleanup refused'));
  else cleanupGate.resolve();

  await expect(joining).resolves.toBe(false);
  if (!cleanupRejects) expect(lk.rooms[0]?.unpublished).toContain(output);
  else expect(devices.canAdmitAutomaticMicrophoneAction()).toBe(false);
  expect(lk.state.livekitRoom).toBe(nextRoom);
  expect(lk.state.localMicPublication).toBe(nextPublication);
  expect(lk.state.microphoneMissing).toBe(false);
  expect(lk.toasts).toEqual([]);
});

test('a stale join null publish cannot mark a subsequent room as missing its microphone', async () => {
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' })
  });
  const capture = {
    processor: null,
    rawStream: null,
    stream: new FakeMediaStream([new FakeMediaStreamTrack('stale-join-mic', 'audio')])
  };
  lk.state.microphoneMissing = false;
  lk.state.localScreenPublications = new Map<string, unknown>();
  let checksAfterBinding = 0;
  const isCurrent = () => {
    if (lk.rooms[0]?.listeners.size) checksAfterBinding += 1;
    return checksAfterBinding < 2;
  };

  await expect(lk.service.connectLiveKitRoom('Анна', isCurrent, capture)).resolves.toBe(false);
  expect(checksAfterBinding).toBe(2);
  expect(lk.state.microphoneMissing).toBe(false);
  expect(lk.toasts).toEqual([]);
  expect(lk.rooms[0]?.disconnected).toBe(true);
});

test('a fresh replacement takes the live microphone over from a timed-out in-place publish, which is then detached', async () => {
  vi.useFakeTimers();
  const { lk } = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }) });
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toEqual({ ok: true });
  const standing = lk.rooms[0];
  if (!standing) throw new Error('standing room missing');
  let finishPublish: () => void = () => {};
  const gate = new Promise<void>((resolve) => (finishPublish = resolve));
  const started = vi.fn<() => void>();
  Object.assign(standing, {
    publishGate: {
      then: (resolve: (value: void) => void, reject: (error: unknown) => void) => {
        started();
        return gate.then(resolve, reject);
      }
    }
  });
  standing.emit('Reconnected');
  for (let index = 0; index < 20 && !started.mock.calls.length; index += 1) await Promise.resolve();
  expect(started).toHaveBeenCalledOnce();

  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 2 })).resolves.toMatchObject({
    retryable: true
  });
  expect(lk.rooms[1]?.published).toHaveLength(0);
  expect(lk.state.livekitRoom).toBe(standing);
  await vi.advanceTimersByTimeAsync(10_000);
  const { acquireMicrophoneForJoin } = await import('@/features/room/client/ui/devices');
  expect(await acquireMicrophoneForJoin(() => true)).toBeNull();
  // The slow publish timed out without dropping the microphone.
  expect(lk.state.localStream).not.toBeNull();
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 3 })).resolves.toEqual({ ok: true });
  expect(lk.rooms[2]?.published).toHaveLength(1);
  finishPublish();
  for (let index = 0; index < 20 && !standing.unpublished.length; index += 1) await Promise.resolve();
  expect(standing.unpublished).toContain(micTrack);
  expect(lk.state.localStream).not.toBeNull();
  expect(lk.state.livekitRoom).toBe(lk.rooms[2]);
});

test('in-place reconnect reconciles the screen despite coalesced and timed-out microphone publish', async () => {
  vi.useFakeTimers();
  const { lk } = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }) });
  await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  const standing = lk.rooms[0];
  if (!standing) throw new Error('standing room missing');
  let finishPublish: () => void = () => {};
  const gate = new Promise<void>((resolve) => (finishPublish = resolve));
  const started = vi.fn<() => void>();
  Object.assign(standing, {
    publishGate: {
      then: (resolve: (value: void) => void, reject: (error: unknown) => void) => {
        started();
        return gate.then(resolve, reject);
      }
    }
  });
  const screenTrack = { id: 'screen-1', kind: 'audio', readyState: 'live' };
  lk.state.localScreenStream = { id: 'screen-stream', getTracks: () => [screenTrack] };
  lk.state.localMicPublication = null;

  standing.emit('Reconnected');
  for (let index = 0; index < 20 && !started.mock.calls.length; index += 1) await Promise.resolve();
  expect(started).toHaveBeenCalledOnce();
  Object.assign(standing, { publishGate: Promise.resolve() });
  standing.emit('Reconnected');
  await vi.waitFor(() => expect(standing.published.some((entry) => entry.track === screenTrack)).toBe(true));
  const nextScreenTrack = { id: 'screen-2', kind: 'audio', readyState: 'live' };
  lk.state.localScreenStream = { id: 'screen-stream-next', getTracks: () => [screenTrack, nextScreenTrack] };
  standing.emit('Reconnected');
  await vi.waitFor(() => expect(standing.published.some((entry) => entry.track === nextScreenTrack)).toBe(true));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(standing.published.filter((entry) => entry.track === screenTrack)).toHaveLength(1);
  finishPublish();
});

test('in-place reconnect keeps reconciling when microphone mute sync rejects', async () => {
  const { lk } = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }) });
  await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  const standing = lk.rooms[0];
  if (!standing) throw new Error('standing room missing');
  const screenTrack = { id: 'screen-2', kind: 'audio', readyState: 'live' };
  lk.state.localScreenStream = { id: 'screen-stream-2', getTracks: () => [screenTrack] };
  const devices = await import('@/features/room/client/ui/devices');
  const failure = vi
    .spyOn(devices, 'ensureCurrentMicrophonePublication')
    .mockRejectedValueOnce(new Error('mute failed'));

  standing.emit('Reconnected');
  await vi.waitFor(() => expect(standing.published.some((entry) => entry.track === screenTrack)).toBe(true));
  expect(failure).toHaveBeenCalledOnce();
  failure.mockRestore();
});

test('a hung existing-publication mute is coalesced and cannot strand room reconciliation', async () => {
  const { lk } = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }) });
  await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  const standing = lk.rooms[0];
  if (!standing) throw new Error('standing room missing');
  const muteGate = Promise.withResolvers<void>();
  const mute = vi.fn(() => muteGate.promise);
  const existing = { source: 'microphone', track: micTrack, trackSid: 'mic-owned', mute, unmute: async () => {} };
  standing.localParticipant.trackPublications.set('mic-owned', existing);
  lk.state.localMicPublication = existing;
  lk.state.muted = true;
  const screenTrack = { id: 'recovered-screen', kind: 'audio', readyState: 'live' };
  lk.state.localScreenStream = { id: 'screen', getTracks: () => [screenTrack] };
  const cameraTrack = { id: 'recovered-camera', kind: 'video', readyState: 'live' };
  lk.state.localCameraStream = { getVideoTracks: () => [cameraTrack] };
  const remoteMic = fakePublication('microphone');
  const remote = fakeParticipant('remote', [remoteMic.publication]);
  standing.remoteParticipants.set('remote', remote);
  lk.state.peers.set('remote', { id: 'remote' });

  standing.emit('Reconnected');
  standing.emit('Reconnected');
  await vi.waitFor(() => expect(lk.recovery.reconciled).toBe(2));
  expect(mute).toHaveBeenCalledOnce();
  expect(standing.published.some((entry) => entry.track === screenTrack)).toBe(true);
  expect(standing.published.some((entry) => entry.track === cameraTrack)).toBe(true);
  expect(remoteMic.calls.subscribed).toContain(true);
  expect(lk.audio.playbackSyncs).toBeGreaterThanOrEqual(2);

  lk.state.livekitRoom = null;
  standing.emit('Reconnected');
  muteGate.resolve();
  await Promise.resolve();
  expect(lk.recovery.reconciled).toBe(2);
  expect(mute).toHaveBeenCalledOnce();
});

test('pre-resolution LocalTrackPublished cannot steal the reconnect owner commit', async () => {
  const { lk } = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }) });
  await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });
  const standing = lk.rooms[0];
  if (!standing) throw new Error('standing room missing');
  let finishPublish: () => void = () => {};
  const gate = new Promise<void>((resolve) => (finishPublish = resolve));
  const started = vi.fn<() => void>();
  Object.assign(standing, {
    publishGate: {
      then: (resolve: (value: void) => void, reject: (error: unknown) => void) => {
        started();
        return gate.then(resolve, reject);
      }
    }
  });
  lk.state.localMicPublication = null;
  standing.emit('Reconnected');
  for (let index = 0; index < 20 && !started.mock.calls.length; index += 1) await Promise.resolve();
  expect(started).toHaveBeenCalledOnce();
  const early = { source: 'microphone', track: micTrack, trackSid: 'early' };
  standing.emit('LocalTrackPublished', early);
  expect(lk.state.localMicPublication).toBeNull();
  finishPublish();
  for (let index = 0; index < 20 && !lk.state.localMicPublication; index += 1) await Promise.resolve();
  expect(lk.state.localMicPublication).toMatchObject({ track: micTrack });
  standing.emit('LocalTrackUnpublished', early);
  expect(lk.state.localMicPublication).toMatchObject({ track: micTrack });
  expect(standing.unpublished).not.toContain(micTrack);
});

test('controller abandonment does not release a pending replacement SDK publish lease', async () => {
  let controller: RealtimeRecoveryController | null = null;
  let finishPublish: () => void = () => {};
  const gate = new Promise<void>((resolve) => (finishPublish = resolve));
  const connected = vi.fn();
  const { lk, oldRoom } = await inCall({
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' }),
    recoveryEpochCurrent: (epoch) => controller?.isCurrent(epoch) ?? false,
    onConnect: (room) => {
      room.publishGate = gate;
      connected();
    }
  });
  controller = new RealtimeRecoveryController({
    attemptReplacement: (context) => lk.service.attemptFreshLiveKitReplacement(context),
    requestAppSnapshot: () => true
  });
  const snapshot = () => controller?.appSnapshotApplied({ appEpoch: 1, active: true, hasLocalPeer: true });
  controller.activate({ appEpoch: 1, appConnected: true });
  snapshot();
  controller.livekitReconciled();
  expect(controller.requestLiveKitReplacement()).toBe(true);
  snapshot();
  await vi.waitFor(() => expect(connected).toHaveBeenCalledOnce());
  const devices = await import('@/features/room/client/ui/devices');
  expect(devices.canAdmitAutomaticMicrophoneAction()).toBe(false);
  controller.livekitReconciled(); // The optional controller answer is now abandoned.
  expect(controller.getSnapshot().phase).toBe('healthy');
  expect(await devices.acquireMicrophoneForJoin(() => true)).toBeNull();
  finishPublish();
  await vi.waitFor(() => expect(lk.rooms[0]?.unpublished).toContain(micTrack));
  expect(lk.state.livekitRoom).toBe(oldRoom);
  expect(lk.rooms[0]?.disconnected).toBe(true);
  expect(devices.canAdmitAutomaticMicrophoneAction()).toBe(true);
  controller.cancel();
});

test('an expired optional epoch cannot publish or commit after its token arrives late', async () => {
  vi.useFakeTimers();
  let controller: RealtimeRecoveryController | null = null;
  let finishToken: (value: { token: string; url: string }) => void = () => {};
  const tokenRequested = vi.fn<() => void>();
  const { lk, oldRoom } = await inCall({
    requestToken: () => {
      tokenRequested();
      return new Promise((resolve) => (finishToken = resolve));
    },
    recoveryEpochCurrent: (epoch) => controller?.isCurrent(epoch) ?? false
  });
  controller = new RealtimeRecoveryController({
    attemptReplacement: (context) => lk.service.attemptFreshLiveKitReplacement(context),
    requestAppSnapshot: () => true
  });
  const snapshot = () => controller?.appSnapshotApplied({ appEpoch: 1, active: true, hasLocalPeer: true });
  controller.activate({ appEpoch: 1, appConnected: true });
  snapshot();
  controller.livekitReconciled();
  expect(controller.requestLiveKitReplacement()).toBe(true);
  const optionalEpoch = controller.getSnapshot().epoch;
  snapshot();
  for (let index = 0; index < 20 && !tokenRequested.mock.calls.length; index += 1) await Promise.resolve();
  expect(tokenRequested).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(10_000);
  expect(controller.abandonOptionalReplacement(optionalEpoch)).toBe(true);
  expect(controller.getSnapshot().phase).toBe('healthy');
  finishToken({ token: 'late', url: 'wss://lk.example' });
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
  expect(lk.rooms).toHaveLength(0);
  expect(lk.state.livekitRoom).toBe(oldRoom);
  expect(oldRoom.closed).toBe(false);
  controller.cancel();
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

type Harness = Awaited<ReturnType<typeof loadLiveKitHarness>>;

async function reconnectWithRejectedMicrophone(replaceWith?: (lk: Harness) => Promise<boolean>) {
  let harness: Harness | null = null;
  const { lk } = await inCall({
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' }),
    requestReplacement: () => (harness && replaceWith ? replaceWith(harness) : null)
  });
  harness = lk;
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toEqual({ ok: true });
  const standing = lk.rooms[0];
  if (!standing) throw new Error('standing room missing');
  // The SDK lost the microphone publication in the reconnect, and publishing it again fails.
  standing.localParticipant.trackPublications.clear();
  lk.state.localMicPublication = null;
  const rejected = Promise.reject(new Error('negotiation timed out'));
  rejected.catch(() => {});
  Object.assign(standing, { publishGate: rejected });
  standing.emit('Reconnected');
  await vi.waitFor(() => expect(lk.recovery.reconciled).toBe(1));
  return lk;
}

test('a reconnect whose microphone cannot be published again says so instead of showing a live microphone', async () => {
  const lk = await reconnectWithRejectedMicrophone();
  await vi.waitFor(() => expect(lk.state.microphoneMissing).toBe(true));
  expect(lk.recovery.replacementRequests).toBe(1);
  expect(lk.state.localStream).toBeNull();
  expect(lk.toasts).toContain('Микрофон не переподключился: вы в комнате без микрофона');
  expect(micTrack.readyState).toBe('ended');
});

test('a reconnect whose microphone cannot be published again asks for a new connection that carries it', async () => {
  const lk = await reconnectWithRejectedMicrophone(
    async (harness) => 'ok' in (await harness.service.attemptFreshLiveKitReplacement({ epoch: 2, attempt: 1 }))
  );
  await vi.waitFor(() => expect(lk.state.livekitRoom).toBe(lk.rooms[1]));
  expect(lk.recovery.replacementRequests).toBe(1);
  expect(lk.rooms[1]?.published.map((entry) => entry.track)).toContain(micTrack);
  expect(lk.state.localStream).toBe(micStream);
  expect(lk.state.microphoneMissing).not.toBe(true);
  expect(lk.toasts).toEqual([]);
});

test('a join whose microphone publication LiveKit refuses names the refusal, not a timeout', async () => {
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' }),
    onPublish: () => Promise.reject(new Error('insufficient permissions'))
  });
  lk.state.localScreenPublications = new Map<string, unknown>();
  const capture = {
    barrier: true,
    processor: null,
    rawStream: new FakeMediaStream([new FakeMediaStreamTrack('raw-refused', 'audio')]),
    stream: new FakeMediaStream([new FakeMediaStreamTrack('output-refused', 'audio')])
  };
  const microphone = await import('@/features/room/client/services/microphone-service');
  vi.spyOn(microphone, 'openLocalMicrophone').mockResolvedValueOnce(capture);
  const devices = await import('@/features/room/client/ui/devices');
  expect(await devices.acquireMicrophoneForJoin(() => true)).toBe(capture);
  await expect(lk.service.connectLiveKitRoom('Анна', () => true, capture)).resolves.toBe(true);
  expect(lk.state.microphoneMissing).toBe(true);
  expect(lk.toasts).toEqual(['Не удалось подключить микрофон: вы в комнате без микрофона']);
});

async function reconnectWithHeldMicrophone(options: Parameters<typeof loadLiveKitHarness>[0]) {
  const { lk } = await inCall({ requestToken: async () => ({ token: 't', url: 'wss://lk.example' }), ...options });
  await expect(lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 })).resolves.toEqual({ ok: true });
  const standing = lk.rooms[0];
  if (!standing) throw new Error('standing room missing');
  standing.localParticipant.trackPublications.clear();
  lk.state.localMicPublication = null;
  const republish = Promise.withResolvers<void>();
  republish.promise.catch(() => {});
  Object.assign(standing, { publishGate: republish.promise });
  standing.emit('Reconnected');
  await vi.waitFor(() => expect(lk.recovery.reconciled).toBe(1));
  return { lk, standing, rejectRepublish: () => republish.reject(new Error('negotiation timed out')) };
}

test('a second reconnect during a failing republish leaves the microphone to the replacement the first one asked for', async () => {
  const replacement = Promise.withResolvers<boolean>();
  let requests = 0;
  const { lk, standing, rejectRepublish } = await reconnectWithHeldMicrophone({
    // While the first replacement runs the controller is not healthy and refuses another.
    requestReplacement: () => (++requests === 1 ? replacement.promise : null)
  });
  standing.emit('Reconnecting');
  standing.emit('Reconnected');
  await vi.waitFor(() => expect(lk.recovery.reconciled).toBe(2));
  rejectRepublish();
  await vi.waitFor(() => expect(lk.recovery.replacementRequests).toBe(1));
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  expect(lk.recovery.replacementRequests).toBe(1);
  expect(lk.state.localStream).toBe(micStream);
  expect(lk.toasts).toEqual([]);
  replacement.resolve(false);
  await vi.waitFor(() => expect(lk.state.microphoneMissing).toBe(true));
  expect(lk.toasts).toEqual(['Микрофон не переподключился: вы в комнате без микрофона']);
});

test('a failing republish during a recovery already under way waits for it instead of dropping the microphone', async () => {
  const recovery = Promise.withResolvers<void>();
  const { lk, rejectRepublish } = await reconnectWithHeldMicrophone({ recoverySettled: () => recovery.promise });
  rejectRepublish();
  await vi.waitFor(() => expect(lk.recovery.replacementRequests).toBe(1));
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  expect(lk.state.localStream).toBe(micStream);
  // The running recovery replaced the room and carried the microphone over.
  Object.assign(lk.state, { livekitRoom: { marker: 'recovered-room' }, localMicPublication: { marker: 'carried' } });
  recovery.resolve();
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  expect(lk.state.localStream).toBe(micStream);
  expect(lk.state.microphoneMissing).not.toBe(true);
  expect(lk.toasts).toEqual([]);
});
