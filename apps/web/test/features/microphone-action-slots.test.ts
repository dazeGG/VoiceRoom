import { afterEach, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  acquireMicrophoneForJoin,
  attachMicrophoneOutcome,
  canAdmitAutomaticMicrophoneAction,
  isOwnedMicrophonePublishPending,
  publishMicrophoneForReplacementRoom,
  discardPublishedJoinMicrophone,
  publishMicrophoneForJoin,
  ensureCurrentMicrophonePublication,
  fallbackRnnoiseAfterProcessorError,
  invalidateMicrophoneActions,
  reopenMicrophone,
  requestAutomaticMicrophoneConnectionReplacement,
  setMicrophoneRecoveryObserver,
  startMicrophoneCall,
  type MicrophoneRecoveryEvent
} from '@/features/room/client/ui/devices';
import { Room } from 'livekit-client';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media';
import type { MicrophoneCapture } from '@/features/room/client/core/types';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import { clearLogBuffer, readLogBuffer } from '@/shared/log';
import { noteMicSend } from '@/features/room/client/room/mic-send';
import {
  setLocalMicrophoneCapture,
  setMicrophoneCaptureEnabled
} from '@/features/room/client/services/microphone-service';
import { ensureLocalMicrophonePublished } from '@/features/room/client/services/livekit/local-publications';
import { defined } from '../helpers/assert';

vi.mock('@/features/room/client/media/livekit-runtime', () => ({
  TRACK_SOURCE: { Microphone: 'microphone' },
  loadLiveKitClient: async () => ({ Track: { Source: { Microphone: 'microphone' } } })
}));

const captureWork = vi.hoisted(() => ({
  open: vi.fn<() => Promise<MicrophoneCapture>>(),
  stop: vi.fn()
}));
vi.mock('@/features/room/client/services/microphone-service', async (original) => ({
  ...(await original<object>()),
  openLocalMicrophone: captureWork.open,
  stopMicrophoneCapture: captureWork.stop
}));

afterEach(() => {
  invalidateMicrophoneActions();
  captureWork.open.mockReset();
  captureWork.stop.mockReset();
  vi.useRealTimers();
});

test('SDK re-enabling the output during replace cannot release a candidate after PTT key-up', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldRaw = new FakeMediaStreamTrack('old-raw', 'audio');
  const oldOutput = new FakeMediaStreamTrack('old-output', 'audio');
  const raw = new FakeMediaStreamTrack('new-raw', 'audio');
  const output = new FakeMediaStreamTrack('new-output', 'audio');
  raw.enabled = false;
  output.enabled = false;
  const capture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  captureWork.open.mockResolvedValueOnce(capture);
  let finishReplace: () => void = () => {};
  const replaceTrack = vi.fn(async (track: MediaStreamTrack) => {
    track.enabled = true; // Installed LiveKit can do this before its promise settles.
    await new Promise<void>((resolve) => (finishReplace = resolve));
  });
  const mute = vi.fn();
  const publication = { track: { replaceTrack }, mute, unmute: vi.fn() };
  const publishTrack = vi.fn(async () => publication);
  const room = Object.assign(new Room(), {
    localParticipant: {
      publishTrack,
      trackPublications: new Map<string, unknown>(),
      unpublishTrack: vi.fn(async () => {})
    }
  });
  Object.assign(state, {
    joined: true,
    livekitRoom: room,
    localMicPublication: publication,
    localStream: new FakeMediaStream([oldOutput]),
    localRawStream: new FakeMediaStream([oldRaw]),
    muted: false,
    outputMuted: false
  });
  startMicrophoneCall();
  const terminal = vi.fn<(event: MicrophoneRecoveryEvent) => void>();
  setMicrophoneRecoveryObserver(terminal);
  const action = reopenMicrophone();
  await vi.waitFor(() => expect(replaceTrack).toHaveBeenCalledOnce());
  expect(raw.enabled).toBe(false);
  expect(output.enabled).toBe(true);
  await ensureLocalMicrophonePublished(room);
  expect(publishTrack, 'in-place reconnect cannot publish across a pending replace').not.toHaveBeenCalled();
  state.muted = true; // PTT key-up while the SDK operation is pending.
  finishReplace();
  expect(await action).toBe(true);
  expect(raw.enabled).toBe(false);
  expect(output.enabled).toBe(false);
  expect(mute).not.toHaveBeenCalled();
  const manualRaw = new FakeMediaStreamTrack('manual-raw', 'audio');
  const manualOutput = new FakeMediaStreamTrack('manual-output', 'audio');
  state.muted = false;
  setLocalMicrophoneCapture({
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([manualRaw]),
    stream: new FakeMediaStream([manualOutput])
  });
  for (let index = 0; index < 6; index += 1)
    noteMicSend({ atMs: 1_000_000 + index * 3000, deliveredSeconds: 100 + index * 3, contextSeconds: 100 + index * 3 });
  expect(terminal).toHaveBeenCalledOnce();
  expect(terminal.mock.calls[0]?.[0].progress).toBe('unverified');
  setMicrophoneRecoveryObserver(null);
});

test('a timed-out GUM releases the join but retains its page-wide slot through late cleanup', async () => {
  vi.useFakeTimers();
  const track = new FakeMediaStreamTrack('raw', 'audio');
  const stream = new FakeMediaStream([track]);
  const capture: MicrophoneCapture = { barrier: true, mode: 'browser', processor: null, rawStream: stream, stream };
  let resolveFirst: (capture: MicrophoneCapture) => void = () => {};
  captureWork.open.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
  const first = acquireMicrophoneForJoin(() => true);
  expect(captureWork.open).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await first).toBeNull();
  expect(await acquireMicrophoneForJoin(() => true)).toBeNull();
  expect(captureWork.open).toHaveBeenCalledTimes(1);

  resolveFirst(capture);
  await vi.waitFor(() => expect(captureWork.stop).toHaveBeenCalledWith(capture));
  captureWork.open.mockResolvedValueOnce(capture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
  expect(captureWork.open).toHaveBeenCalledTimes(2);
});

test('15s permission prompt returns listen-only with an explicit timeout explanation', async () => {
  vi.useFakeTimers();
  let resolveOpen: (capture: MicrophoneCapture) => void = () => {};
  captureWork.open.mockImplementationOnce(() => new Promise((resolve) => (resolveOpen = resolve)));
  const explain = vi.fn();
  const joining = acquireMicrophoneForJoin(() => true, explain);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await joining).toBeNull();
  expect(explain).toHaveBeenCalledOnce();
  const track = new FakeMediaStreamTrack('late-permission', 'audio');
  const stream = new FakeMediaStream([track]);
  const capture: MicrophoneCapture = { barrier: true, mode: 'browser', processor: null, rawStream: stream, stream };
  resolveOpen(capture);
  await vi.waitFor(() => expect(captureWork.stop).toHaveBeenCalledWith(capture));
});

test('in-place reconnect adopts an existing publication despite a busy capture slot', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  let resolveOpen: (capture: MicrophoneCapture) => void = () => {};
  captureWork.open.mockImplementationOnce(() => new Promise((resolve) => (resolveOpen = resolve)));
  const pending = acquireMicrophoneForJoin(() => true);
  const track = new FakeMediaStreamTrack('existing-mic', 'audio');
  const publication = { source: 'microphone', track: { mediaStreamTrack: track }, mute: vi.fn(), unmute: vi.fn() };
  Object.assign(state, {
    joined: true,
    livekitRoom: { localParticipant: { trackPublications: new Map([['mic', publication]]) } },
    localStream: new FakeMediaStream([track]),
    localMicPublication: null
  });
  expect(await ensureCurrentMicrophonePublication()).toBe('applied');
  expect(state.localMicPublication).toEqual(publication);
  const stream = new FakeMediaStream([track]);
  resolveOpen({ barrier: true, mode: 'browser', processor: null, rawStream: stream, stream });
  await pending;
  invalidateMicrophoneActions();
});

test('obsolete room reconciliation cannot adopt a publication from a newer room', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const track = new FakeMediaStreamTrack('new-room-mic', 'audio');
  const publication = { source: 'microphone', track: { mediaStreamTrack: track }, mute: vi.fn(), unmute: vi.fn() };
  const obsoleteRoom = Object.assign(new Room(), {
    localParticipant: { trackPublications: new Map<string, unknown>() }
  });
  const newerRoom = Object.assign(new Room(), {
    localParticipant: { trackPublications: new Map([['mic', publication]]) }
  });
  Object.assign(state, { joined: true, livekitRoom: newerRoom, localMicPublication: null });
  expect(await ensureCurrentMicrophonePublication(obsoleteRoom)).toBe('stale');
  expect(state.localMicPublication).toBeNull();
  expect(publication.mute).not.toHaveBeenCalled();
  expect(publication.unmute).not.toHaveBeenCalled();
});

test('a prepared join capture survives a 12s network connect, then publishes with a fresh deadline and stops on leave', async () => {
  vi.useFakeTimers();
  const raw = new FakeMediaStreamTrack('prepared-raw', 'audio');
  const output = new FakeMediaStreamTrack('prepared-output', 'audio');
  const capture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  captureWork.open.mockResolvedValue(capture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
  invalidateMicrophoneActions();
  expect(captureWork.stop).toHaveBeenCalledWith(capture);
  captureWork.stop.mockClear();
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(captureWork.stop).not.toHaveBeenCalled();
  const publication = { track: { mediaStreamTrack: output }, mute: vi.fn(), unmute: vi.fn() };
  const room = Object.assign(new Room(), {
    localParticipant: { publishTrack: vi.fn(async () => publication), unpublishTrack: vi.fn(async () => {}) }
  });
  expect((await publishMicrophoneForJoin(room, capture, () => true)).publication).toBe(publication);
  expect(captureWork.stop).not.toHaveBeenCalled();
  invalidateMicrophoneActions();
  expect(captureWork.stop).not.toHaveBeenCalled();
});

test('prepared join capture with ended raw input is never submitted to SDK publication', async () => {
  const raw = new FakeMediaStreamTrack('ended-prepared-raw', 'audio');
  const output = new FakeMediaStreamTrack('live-prepared-output', 'audio');
  const capture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  captureWork.open.mockResolvedValueOnce(capture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
  raw.stop();
  const publishTrack = vi.fn(async () => ({ track: { mediaStreamTrack: output } }));
  const room = Object.assign(new Room(), {
    localParticipant: {
      publishTrack,
      unpublishTrack: vi.fn(async () => {}),
      trackPublications: new Map<string, unknown>()
    }
  });
  expect((await publishMicrophoneForJoin(room, capture, () => true)).publication).toBeNull();
  expect(publishTrack).not.toHaveBeenCalled();
  expect(captureWork.stop).toHaveBeenCalledWith(capture);
});

test('raw input ending during SDK publish quarantines the late join publication', async () => {
  const raw = new FakeMediaStreamTrack('publishing-raw', 'audio');
  const output = new FakeMediaStreamTrack('publishing-output', 'audio');
  const capture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  captureWork.open.mockResolvedValueOnce(capture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
  let finishPublish = () => {};
  const publication = {
    track: { mediaStreamTrack: output },
    mute: vi.fn(async () => {}),
    unmute: vi.fn(async () => {})
  };
  const publishTrack = vi.fn(
    () => new Promise<typeof publication>((resolve) => (finishPublish = () => resolve(publication)))
  );
  const unpublishTrack = vi.fn(async () => {});
  const room = Object.assign(new Room(), {
    localParticipant: { publishTrack, unpublishTrack, trackPublications: new Map<string, unknown>() }
  });
  const publishing = publishMicrophoneForJoin(room, capture, () => true);
  await vi.waitFor(() => expect(publishTrack).toHaveBeenCalledOnce());
  raw.stop();
  finishPublish();
  expect((await publishing).publication).toBeNull();
  expect(unpublishTrack).toHaveBeenCalledOnce();
  expect(captureWork.stop).toHaveBeenCalledWith(capture);
});

test('late join cleanup keeps the page-wide SDK slot until exact unpublish settles', async () => {
  const raw = new FakeMediaStreamTrack('late-raw', 'audio');
  const output = new FakeMediaStreamTrack('late-output', 'audio');
  const capture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  captureWork.open.mockResolvedValueOnce(capture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
  const publication = {
    track: { mediaStreamTrack: output },
    mute: vi.fn(async () => {}),
    unmute: vi.fn(async () => {})
  };
  let finishUnpublish = () => {};
  const unpublishTrack = vi.fn(() => new Promise<void>((resolve) => (finishUnpublish = resolve)));
  const room = Object.assign(new Room(), {
    localParticipant: {
      publishTrack: vi.fn(async () => publication),
      unpublishTrack,
      trackPublications: new Map<string, unknown>()
    }
  });
  const { publication: published } = await publishMicrophoneForJoin(room, capture, () => true);
  expect(published).not.toBeNull();
  if (!published) return;
  raw.stop();
  const cleanup = discardPublishedJoinMicrophone(room, published, capture);
  await vi.waitFor(() => expect(unpublishTrack).toHaveBeenCalledOnce());
  expect(await acquireMicrophoneForJoin(() => true)).toBeNull();
  expect(captureWork.open).toHaveBeenCalledOnce();
  finishUnpublish();
  await cleanup;
  const nextTrack = new FakeMediaStreamTrack('next-raw', 'audio');
  const nextStream = new FakeMediaStream([nextTrack]);
  const nextCapture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: nextStream,
    stream: nextStream
  };
  captureWork.open.mockResolvedValueOnce(nextCapture);
  await vi.waitFor(async () => expect(await acquireMicrophoneForJoin(() => true)).toBe(nextCapture));
});

test('late join cleanup times out to the caller but retains the unresolved SDK slot', async () => {
  vi.useFakeTimers();
  const raw = new FakeMediaStreamTrack('timeout-raw', 'audio');
  const output = new FakeMediaStreamTrack('timeout-output', 'audio');
  const capture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  captureWork.open.mockResolvedValueOnce(capture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
  const publication = {
    track: { mediaStreamTrack: output },
    mute: vi.fn(async () => {}),
    unmute: vi.fn(async () => {})
  };
  let finishUnpublish = () => {};
  const unpublishTrack = vi.fn(() => new Promise<void>((resolve) => (finishUnpublish = resolve)));
  const room = Object.assign(new Room(), {
    localParticipant: {
      publishTrack: vi.fn(async () => publication),
      unpublishTrack,
      trackPublications: new Map<string, unknown>()
    }
  });
  const { publication: published } = await publishMicrophoneForJoin(room, capture, () => true);
  expect(published).not.toBeNull();
  if (!published) return;
  raw.stop();
  const cleanup = discardPublishedJoinMicrophone(room, published, capture);
  const failure = expect(cleanup).rejects.toThrow('cleanup timed out');
  await vi.waitFor(() => expect(unpublishTrack).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(10_000);
  await failure;
  expect(await acquireMicrophoneForJoin(() => true)).toBeNull();
  finishUnpublish();
  await vi.advanceTimersByTimeAsync(0);
  const nextTrack = new FakeMediaStreamTrack('timeout-next', 'audio');
  const nextStream = new FakeMediaStream([nextTrack]);
  const nextCapture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: nextStream,
    stream: nextStream
  };
  captureWork.open.mockResolvedValueOnce(nextCapture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(nextCapture);
});

test('a prepared join capture is stopped on leave even after a slow network wait', async () => {
  vi.useFakeTimers();
  const track = new FakeMediaStreamTrack('join-leave', 'audio');
  const stream = new FakeMediaStream([track]);
  const capture: MicrophoneCapture = { barrier: true, mode: 'browser', processor: null, rawStream: stream, stream };
  captureWork.open.mockResolvedValue(capture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(captureWork.stop).not.toHaveBeenCalled();
  invalidateMicrophoneActions();
  expect(captureWork.stop).toHaveBeenCalledWith(capture);
});

test('processorerror admits one temporary browser fallback without changing RNNoise intent', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldRaw = new FakeMediaStreamTrack('old-raw-noise', 'audio');
  const oldOutput = new FakeMediaStreamTrack('old-output-noise', 'audio');
  const newRaw = new FakeMediaStreamTrack('new-raw-browser', 'audio');
  const newOutput = new FakeMediaStreamTrack('new-output-browser', 'audio');
  newRaw.enabled = false;
  newOutput.enabled = false;
  const oldCapture: MicrophoneCapture = {
    mode: 'rnnoise',
    processor: null,
    rawStream: new FakeMediaStream([oldRaw]),
    stream: new FakeMediaStream([oldOutput])
  };
  const browserCapture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([newRaw]),
    stream: new FakeMediaStream([newOutput])
  };
  captureWork.open.mockResolvedValueOnce(browserCapture);
  const replaceTrack = vi.fn(async () => {});
  const publication = { track: { replaceTrack } };
  Object.assign(state, {
    joined: true,
    livekitRoom: { localParticipant: { unpublishTrack: vi.fn(async () => {}) } },
    localMicPublication: publication,
    localStream: oldCapture.stream,
    localRawStream: oldCapture.rawStream,
    noiseMode: 'rnnoise',
    muted: false
  });
  startMicrophoneCall();
  fallbackRnnoiseAfterProcessorError(oldCapture);
  fallbackRnnoiseAfterProcessorError(oldCapture);
  await vi.waitFor(() => expect(state.localStream).toBe(browserCapture.stream));
  expect(captureWork.open).toHaveBeenCalledTimes(1);
  expect(replaceTrack).toHaveBeenCalledTimes(1);
  expect(state.noiseMode).toBe('rnnoise');
  const incidental = {
    ...browserCapture,
    stream: new FakeMediaStream([new FakeMediaStreamTrack('incidental', 'audio')])
  };
  captureWork.open.mockResolvedValueOnce(incidental);
  expect(await reopenMicrophone()).toBe(true);
  expect(captureWork.open).toHaveBeenLastCalledWith(expect.any(Function), 'browser');
  expect(state.noiseMode).toBe('rnnoise');
  invalidateMicrophoneActions();
});

test('same-call reattachment retains effective browser fallback after losing the microphone', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldTrack = new FakeMediaStreamTrack('reattach-rnnoise', 'audio');
  const fallbackTrack = new FakeMediaStreamTrack('reattach-browser', 'audio');
  const attachedTrack = new FakeMediaStreamTrack('reattached-browser', 'audio');
  const failedCapture: MicrophoneCapture = {
    mode: 'rnnoise',
    processor: null,
    rawStream: new FakeMediaStream([oldTrack]),
    stream: new FakeMediaStream([oldTrack])
  };
  const browserCapture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([fallbackTrack]),
    stream: new FakeMediaStream([fallbackTrack])
  };
  const reattachedCapture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([attachedTrack]),
    stream: new FakeMediaStream([attachedTrack])
  };
  captureWork.open.mockResolvedValueOnce(browserCapture).mockResolvedValueOnce(reattachedCapture);
  const publication = { track: { replaceTrack: vi.fn(async () => {}) }, mute: vi.fn(), unmute: vi.fn() };
  const room = {
    localParticipant: {
      unpublishTrack: vi.fn(async () => {}),
      publishTrack: vi.fn(async () => publication)
    }
  };
  Object.assign(state, {
    joined: true,
    muted: false,
    noiseMode: 'rnnoise',
    livekitRoom: room,
    localMicPublication: publication
  });
  setLocalMicrophoneCapture(failedCapture);
  startMicrophoneCall();
  fallbackRnnoiseAfterProcessorError(failedCapture);
  await vi.waitFor(() => expect(state.localStream).toBe(browserCapture.stream));
  Object.assign(state, { localStream: null, localRawStream: null, localMicPublication: null, microphoneMissing: true });
  expect(await attachMicrophoneOutcome()).toBe('applied');
  expect(state.localStream).toBe(reattachedCapture.stream);
  expect(captureWork.open).toHaveBeenLastCalledWith(expect.any(Function), 'browser');
  expect(state.noiseMode).toBe('rnnoise');
});

test('failed RNNoise stays latched while PTT-idle, then uses one fallback on eligible key-down', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldRaw = new FakeMediaStreamTrack('idle-old-raw', 'audio');
  const oldOutput = new FakeMediaStreamTrack('idle-old-output', 'audio');
  const nextRaw = new FakeMediaStreamTrack('idle-new-raw', 'audio');
  const nextOutput = new FakeMediaStreamTrack('idle-new-output', 'audio');
  const oldCapture: MicrophoneCapture = {
    mode: 'rnnoise',
    processor: null,
    rawStream: new FakeMediaStream([oldRaw]),
    stream: new FakeMediaStream([oldOutput])
  };
  const nextCapture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([nextRaw]),
    stream: new FakeMediaStream([nextOutput])
  };
  captureWork.open.mockResolvedValueOnce(nextCapture);
  const replaceTrack = vi.fn(async () => {});
  Object.assign(state, {
    joined: true,
    livekitRoom: { localParticipant: { unpublishTrack: vi.fn(async () => {}) } },
    localMicPublication: { track: { replaceTrack } },
    microphoneMode: 'push-to-talk',
    muted: true,
    noiseMode: 'rnnoise'
  });
  setLocalMicrophoneCapture(oldCapture);
  startMicrophoneCall();
  oldCapture.processorFailed = true; // Equivalent to the current-node processorerror health latch.
  setMicrophoneCaptureEnabled(oldCapture, false);
  expect(captureWork.open).not.toHaveBeenCalled();
  state.pushToTalkActive = true;
  state.muted = false;
  setMicrophoneCaptureEnabled(oldCapture, true);
  await vi.waitFor(() => expect(state.localStream).toBe(nextCapture.stream));
  fallbackRnnoiseAfterProcessorError(oldCapture); // Stale node cannot spend another admission.
  expect(captureWork.open).toHaveBeenCalledTimes(1);
  expect(state.noiseMode).toBe('rnnoise');
});

test('latched RNNoise failure retries once after an unrelated deferred acquisition rejects', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldTrack = new FakeMediaStreamTrack('failed-old', 'audio');
  const nextTrack = new FakeMediaStreamTrack('failed-browser', 'audio');
  const oldCapture: MicrophoneCapture = {
    mode: 'rnnoise',
    processor: null,
    rawStream: new FakeMediaStream([oldTrack]),
    stream: new FakeMediaStream([oldTrack])
  };
  const browserCapture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([nextTrack]),
    stream: new FakeMediaStream([nextTrack])
  };
  let rejectAcquisition: () => void = () => {};
  captureWork.open
    .mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectAcquisition = () => reject(new Error('device B failed'))))
    )
    .mockResolvedValueOnce(browserCapture);
  const publication = { track: { replaceTrack: vi.fn(async () => {}) } };
  Object.assign(state, {
    joined: true,
    muted: false,
    livekitRoom: { localParticipant: { unpublishTrack: vi.fn(async () => {}) } },
    localMicPublication: publication
  });
  setLocalMicrophoneCapture(oldCapture);
  startMicrophoneCall();
  const switching = reopenMicrophone();
  await vi.waitFor(() => expect(captureWork.open).toHaveBeenCalledOnce());
  oldCapture.processorFailed = true;
  fallbackRnnoiseAfterProcessorError(oldCapture);
  expect(captureWork.open).toHaveBeenCalledOnce();
  rejectAcquisition();
  expect(await switching).toBe(false);
  await vi.waitFor(() => expect(state.localStream).toBe(browserCapture.stream));
  expect(captureWork.open).toHaveBeenCalledTimes(2);
  expect(captureWork.open).toHaveBeenLastCalledWith(expect.any(Function), 'browser');
});

test('initial committed failed RNNoise is reconsidered when join activates the call', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldTrack = new FakeMediaStreamTrack('join-failed', 'audio');
  const nextTrack = new FakeMediaStreamTrack('join-browser', 'audio');
  const failedCapture: MicrophoneCapture = {
    mode: 'rnnoise',
    processor: null,
    processorFailed: true,
    rawStream: new FakeMediaStream([oldTrack]),
    stream: new FakeMediaStream([oldTrack])
  };
  const browserCapture: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([nextTrack]),
    stream: new FakeMediaStream([nextTrack])
  };
  captureWork.open.mockResolvedValueOnce(browserCapture);
  Object.assign(state, {
    joined: false,
    muted: false,
    livekitRoom: { localParticipant: { unpublishTrack: vi.fn(async () => {}) } },
    localMicPublication: { track: { replaceTrack: vi.fn(async () => {}) } }
  });
  setLocalMicrophoneCapture(failedCapture);
  fallbackRnnoiseAfterProcessorError(failedCapture);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(captureWork.open).not.toHaveBeenCalled();
  state.joined = true;
  startMicrophoneCall();
  await vi.waitFor(() => expect(state.localStream).toBe(browserCapture.stream));
  expect(captureWork.open).toHaveBeenCalledTimes(1);
});

test('timed-out SDK mutation quarantines publication until late detach finishes', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldRaw = new FakeMediaStreamTrack('timeout-old-raw', 'audio');
  const oldOutput = new FakeMediaStreamTrack('timeout-old-output', 'audio');
  const raw = new FakeMediaStreamTrack('timeout-new-raw', 'audio');
  const output = new FakeMediaStreamTrack('timeout-new-output', 'audio');
  raw.enabled = false;
  output.enabled = false;
  const candidate: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  captureWork.open.mockResolvedValueOnce(candidate);
  let settleSdk: () => void = () => {};
  const replaceTrack = vi.fn(async (track: MediaStreamTrack) => {
    track.enabled = true;
    await new Promise<void>((resolve) => (settleSdk = resolve));
  });
  const publication = { track: { replaceTrack } };
  const unpublishTrack = vi.fn(async () => {});
  const room = { localParticipant: { unpublishTrack } };
  Object.assign(state, {
    joined: true,
    livekitRoom: room,
    localMicPublication: publication,
    localStream: new FakeMediaStream([oldOutput]),
    localRawStream: new FakeMediaStream([oldRaw]),
    muted: false
  });
  startMicrophoneCall();
  const action = reopenMicrophone();
  await vi.waitFor(() => expect(replaceTrack).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await action).toBe(false);
  expect(raw.enabled).toBe(false);
  expect(state.localStream).toBeNull();
  expect(await acquireMicrophoneForJoin(() => true)).toBeNull();
  expect(captureWork.open).toHaveBeenCalledTimes(1);
  settleSdk();
  await vi.waitFor(() => expect(unpublishTrack).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(0);
  captureWork.open.mockResolvedValueOnce(candidate);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(candidate);
  invalidateMicrophoneActions();
});

test('SDK swap then rejection silences both captures and retains the mutation lease until detach', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldRaw = new FakeMediaStreamTrack('reject-old-raw', 'audio');
  const oldOutput = new FakeMediaStreamTrack('reject-old-output', 'audio');
  const raw = new FakeMediaStreamTrack('reject-new-raw', 'audio');
  const output = new FakeMediaStreamTrack('reject-new-output', 'audio');
  const previous: MicrophoneCapture = {
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([oldRaw]),
    stream: new FakeMediaStream([oldOutput])
  };
  const candidate: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([raw]),
    stream: new FakeMediaStream([output])
  };
  captureWork.open.mockResolvedValueOnce(candidate);
  let finishDetach: () => void = () => {};
  let rejectReplace: () => void = () => {};
  const initiallyAttached: MediaStreamTrack = oldOutput;
  const publication = {
    track: {
      mediaStreamTrack: initiallyAttached,
      replaceTrack: vi.fn(async (track: MediaStreamTrack) => {
        publication.track.mediaStreamTrack = track;
        track.enabled = true; // LiveKit can mutate before the sender rejects.
        await new Promise<void>((resolve) => (rejectReplace = resolve));
        throw new Error('sender.replaceTrack rejected');
      })
    }
  };
  const unpublishTrack = vi.fn(() => new Promise<void>((resolve) => (finishDetach = resolve)));
  const room = { localParticipant: { unpublishTrack } };
  Object.assign(state, { joined: true, livekitRoom: room, muted: false });
  setLocalMicrophoneCapture(previous);
  Object.assign(state, { localMicPublication: publication });
  startMicrophoneCall();
  const terminal = vi.fn<(event: MicrophoneRecoveryEvent) => void>();
  setMicrophoneRecoveryObserver(terminal);

  const reopening = reopenMicrophone();
  await vi.waitFor(() => expect(publication.track.replaceTrack).toHaveBeenCalledOnce());
  rejectReplace();
  expect(await reopening).toBe(false);
  expect(terminal).toHaveBeenCalledOnce();
  expect(terminal.mock.calls[0]?.[0].outcome).toBe('failed');
  expect(state.localStream).toBeNull();
  expect(state.localMicPublication).toBeNull();
  expect(state.microphoneMissing).toBe(true);
  expect(oldRaw.enabled).toBe(false);
  expect(oldOutput.enabled).toBe(false);
  expect(raw.enabled).toBe(false);
  expect(output.enabled).toBe(false);
  expect(unpublishTrack).toHaveBeenCalledOnce();
  expect(await acquireMicrophoneForJoin(() => true)).toBeNull();
  finishDetach();
  await vi.waitFor(() => expect(unpublishTrack).toHaveBeenCalledOnce());
  captureWork.open.mockResolvedValueOnce(candidate);
  await vi.waitFor(async () => expect(await acquireMicrophoneForJoin(() => true)).toBe(candidate));
});

test('SDK rejection that proves the old track stayed attached retains the old capture', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldRaw = new FakeMediaStreamTrack('intact-old-raw', 'audio');
  const oldOutput = new FakeMediaStreamTrack('intact-old-output', 'audio');
  const nextOutput = new FakeMediaStreamTrack('intact-next-output', 'audio');
  nextOutput.enabled = false;
  const previous: MicrophoneCapture = {
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([oldRaw]),
    stream: new FakeMediaStream([oldOutput])
  };
  const candidate: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([nextOutput]),
    stream: new FakeMediaStream([nextOutput])
  };
  captureWork.open.mockResolvedValueOnce(candidate);
  const publication = {
    track: {
      mediaStreamTrack: oldOutput,
      replaceTrack: vi.fn(async () => {
        throw new Error('rejected before attachment');
      })
    }
  };
  const unpublishTrack = vi.fn(async () => {});
  Object.assign(state, { joined: true, livekitRoom: { localParticipant: { unpublishTrack } }, muted: false });
  setLocalMicrophoneCapture(previous);
  Object.assign(state, { localMicPublication: publication });
  startMicrophoneCall();

  expect(await reopenMicrophone()).toBe(false);
  expect(state.localStream).toBe(previous.stream);
  expect(state.localMicPublication).toEqual(publication);
  expect(oldRaw.enabled).toBe(true);
  expect(oldOutput.enabled).toBe(true);
  expect(nextOutput.enabled).toBe(false);
  expect(unpublishTrack).not.toHaveBeenCalled();
});

test('stale successful replace restores the exact old live publication rather than unpublishing it', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldOutput = new FakeMediaStreamTrack('stale-old', 'audio');
  const nextOutput = new FakeMediaStreamTrack('stale-next', 'audio');
  const previous: MicrophoneCapture = {
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([oldOutput]),
    stream: new FakeMediaStream([oldOutput])
  };
  const candidate: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([nextOutput]),
    stream: new FakeMediaStream([nextOutput])
  };
  captureWork.open.mockResolvedValueOnce(candidate);
  let finishReplace: () => void = () => {};
  const attachedTrack: MediaStreamTrack = oldOutput;
  const publication = {
    track: {
      mediaStreamTrack: attachedTrack,
      replaceTrack: vi.fn(async (track: MediaStreamTrack) => {
        publication.track.mediaStreamTrack = track;
        if (track === nextOutput) await new Promise<void>((resolve) => (finishReplace = resolve));
      })
    }
  };
  const unpublishTrack = vi.fn(async () => {});
  Object.assign(state, {
    joined: true,
    livekitRoom: { localParticipant: { unpublishTrack } },
    localMicPublication: publication
  });
  setLocalMicrophoneCapture(previous);
  const reopening = reopenMicrophone();
  await vi.waitFor(() => expect(publication.track.replaceTrack).toHaveBeenCalledOnce());
  invalidateMicrophoneActions();
  finishReplace();
  expect(await reopening).toBe(false);
  await vi.waitFor(() => expect(publication.track.mediaStreamTrack).toBe(oldOutput));
  expect(state.localStream).toBe(previous.stream);
  expect(state.localMicPublication).toEqual(publication);
  expect(unpublishTrack).not.toHaveBeenCalled();
});

test('late SDK rejection cleans its old publication without clearing a genuinely new owner', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const oldOutput = new FakeMediaStreamTrack('owner-old-output', 'audio');
  const candidateOutput = new FakeMediaStreamTrack('owner-candidate-output', 'audio');
  const newestOutput = new FakeMediaStreamTrack('owner-newest-output', 'audio');
  const previous: MicrophoneCapture = {
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([oldOutput]),
    stream: new FakeMediaStream([oldOutput])
  };
  const candidate: MicrophoneCapture = {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([candidateOutput]),
    stream: new FakeMediaStream([candidateOutput])
  };
  const newest: MicrophoneCapture = {
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([newestOutput]),
    stream: new FakeMediaStream([newestOutput])
  };
  captureWork.open.mockResolvedValueOnce(candidate);
  let rejectReplace: () => void = () => {};
  const initiallyAttached: MediaStreamTrack = oldOutput;
  const oldPublication = {
    track: {
      mediaStreamTrack: initiallyAttached,
      replaceTrack: vi.fn(async (track: MediaStreamTrack) => {
        oldPublication.track.mediaStreamTrack = track;
        await new Promise<void>((resolve) => (rejectReplace = resolve));
        throw new Error('late sender failure');
      })
    }
  };
  const unpublishTrack = vi.fn(async () => {});
  const oldRoom = { localParticipant: { unpublishTrack } };
  Object.assign(state, { joined: true, livekitRoom: oldRoom, localMicPublication: oldPublication, muted: false });
  setLocalMicrophoneCapture(previous);
  startMicrophoneCall();
  const reopening = reopenMicrophone();
  await vi.waitFor(() => expect(oldPublication.track.replaceTrack).toHaveBeenCalledOnce());

  const newRoom = { localParticipant: { unpublishTrack: vi.fn(async () => {}) } };
  const newPublication = { track: { mediaStreamTrack: newestOutput } };
  Object.assign(state, { livekitRoom: newRoom, localMicPublication: newPublication });
  setLocalMicrophoneCapture(newest);
  rejectReplace();
  expect(await reopening).toBe(false);
  expect(state.livekitRoom).toEqual(newRoom);
  expect(state.localStream).toBe(newest.stream);
  expect(state.localMicPublication).toEqual(newPublication);
  expect(newestOutput.enabled).toBe(true);
  expect(unpublishTrack).toHaveBeenCalledOnce();
  expect(newRoom.localParticipant.unpublishTrack).not.toHaveBeenCalled();
});

test('one call admits at most six automatic replacements and reports one terminal per admission', async () => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState(), { joined: true, muted: false, outputMuted: false });
  startMicrophoneCall();
  const terminal = vi.fn<(event: MicrophoneRecoveryEvent) => void>();
  setMicrophoneRecoveryObserver(terminal);
  const replace = vi.fn(async () => false);
  for (let index = 0; index < 100; index += 1) {
    await requestAutomaticMicrophoneConnectionReplacement(replace);
  }
  expect(replace).toHaveBeenCalledTimes(6);
  expect(terminal).toHaveBeenCalledTimes(6);
  expect(terminal.mock.calls.map(([event]) => event.outcome)).toEqual(Array(6).fill('failed'));
  setMicrophoneRecoveryObserver(null);
});

test('leaving during an SDK publish frees the next join while the late publication is still detached', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const track = new FakeMediaStreamTrack('stale-hung', 'audio');
  const stream = new FakeMediaStream([track]);
  let finishUnpublish: () => void = () => {};
  const publication = { track, mute: vi.fn(), unmute: vi.fn() };
  const room = {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: vi.fn(async () => {
        invalidateMicrophoneActions();
        return publication;
      }),
      unpublishTrack: vi.fn(() => new Promise<void>((resolve) => (finishUnpublish = resolve)))
    }
  };
  Object.assign(state, { joined: true, livekitRoom: room, localStream: stream, localRawStream: stream });
  const ensuring = ensureCurrentMicrophonePublication();
  await vi.waitFor(() => expect(room.localParticipant.unpublishTrack).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await ensuring).toBe('timed_out');
  const next = new FakeMediaStream([new FakeMediaStreamTrack('stale-hung-next', 'audio')]);
  const capture: MicrophoneCapture = { barrier: true, mode: 'browser', processor: null, rawStream: next, stream: next };
  captureWork.open.mockResolvedValueOnce(capture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
  finishUnpublish();
  await vi.advanceTimersByTimeAsync(0);
  expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(track, false);
});

test('rejected stale unpublish leaves the page mutation slot quarantined', async () => {
  vi.useFakeTimers();
  clearLogBuffer();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const track = new FakeMediaStreamTrack('stale-reject', 'audio');
  const stream = new FakeMediaStream([track]);
  const publication = { track, mute: vi.fn(), unmute: vi.fn() };
  let finishPublish: (value: typeof publication) => void = () => {};
  const room = {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: vi.fn(() => new Promise<typeof publication>((resolve) => (finishPublish = resolve))),
      unpublishTrack: vi.fn(async () => {
        throw new Error('detach rejected');
      })
    }
  };
  Object.assign(state, { joined: true, livekitRoom: room, localStream: stream, localRawStream: stream });
  const ensuring = ensureCurrentMicrophonePublication();
  await vi.waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await ensuring).toBe('timed_out');
  state.livekitRoom = null; // The room went away while the SDK publish was pending.
  finishPublish(publication);
  await vi.advanceTimersByTimeAsync(0);
  expect(room.localParticipant.unpublishTrack).toHaveBeenCalledOnce();
  expect(
    readLogBuffer().filter((entry) => entry.ns === 'room:devices' && entry.msg === 'late microphone cleanup failed')
  ).toHaveLength(1);
  expect(await acquireMicrophoneForJoin(() => true)).toBeNull();
});

test('leaving the room releases a slot quarantined by a rejected unpublish, so the next join gets a microphone', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const track = new FakeMediaStreamTrack('leave-reject', 'audio');
  const stream = new FakeMediaStream([track]);
  const publication = { track, mute: vi.fn(), unmute: vi.fn() };
  let finishPublish: (value: typeof publication) => void = () => {};
  const room = {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: vi.fn(() => new Promise<typeof publication>((resolve) => (finishPublish = resolve))),
      unpublishTrack: vi.fn(async () => {
        throw new Error('detach rejected');
      })
    }
  };
  Object.assign(state, { joined: true, livekitRoom: room, localStream: stream, localRawStream: stream });
  const ensuring = ensureCurrentMicrophonePublication();
  await vi.waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await ensuring).toBe('timed_out');
  state.livekitRoom = null; // The room went away while the SDK publish was pending.
  finishPublish(publication);
  await vi.advanceTimersByTimeAsync(0);
  expect(room.localParticipant.unpublishTrack).toHaveBeenCalledOnce();

  invalidateMicrophoneActions();
  Object.assign(state, createInitialRoomState());
  const next = new FakeMediaStream([new FakeMediaStreamTrack('leave-reject-next', 'audio')]);
  const capture: MicrophoneCapture = { barrier: true, mode: 'browser', processor: null, rawStream: next, stream: next };
  captureWork.open.mockResolvedValueOnce(capture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
});

test('leaving the room releases a slot held by an SDK publish that never settles', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const track = new FakeMediaStreamTrack('leave-hung', 'audio');
  const stream = new FakeMediaStream([track]);
  const room = {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: vi.fn(() => new Promise<never>(() => {})),
      unpublishTrack: vi.fn(async () => {})
    }
  };
  Object.assign(state, { joined: true, livekitRoom: room, localStream: stream, localRawStream: stream });
  const ensuring = ensureCurrentMicrophonePublication();
  await vi.waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await ensuring).toBe('timed_out');

  invalidateMicrophoneActions();
  Object.assign(state, createInitialRoomState());
  const next = new FakeMediaStream([new FakeMediaStreamTrack('leave-hung-next', 'audio')]);
  const capture: MicrophoneCapture = { barrier: true, mode: 'browser', processor: null, rawStream: next, stream: next };
  captureWork.open.mockResolvedValueOnce(capture);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(capture);
});

test('a join that finds the microphone busy says why it continues without one', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  captureWork.open.mockImplementationOnce(() => new Promise(() => {}));
  const first = acquireMicrophoneForJoin(() => true);
  const onTimeout = vi.fn();
  const onBusy = vi.fn();
  expect(await acquireMicrophoneForJoin(() => true, onTimeout, onBusy)).toBeNull();
  expect(onBusy).toHaveBeenCalledOnce();
  expect(onTimeout).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await first).toBeNull();
});

test('the microphone button says so when an earlier microphone operation still holds the microphone', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  // The join's permission prompt never answered: the call goes on listen-only.
  captureWork.open.mockImplementationOnce(() => new Promise(() => {}));
  const joining = acquireMicrophoneForJoin(() => true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await joining).toBeNull();
  Object.assign(state, { joined: true, livekitRoom: { localParticipant: {} }, localStream: null });

  const { useToastUiStore } = await import('@/features/room/toast-ui.store');
  expect(await attachMicrophoneOutcome()).toBe('busy');
  expect(useToastUiStore().items.map((item) => item.message)).toContain(
    'Микрофон ещё занят прошлой операцией: попробуйте через несколько секунд'
  );
  invalidateMicrophoneActions();
});

test('a slow in-place republish keeps the live microphone and adopts the late publication', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const track = new FakeMediaStreamTrack('slow-reconnect', 'audio');
  track.enabled = true;
  const stream = new FakeMediaStream([track]);
  const publication = { track, mute: vi.fn(async () => {}), unmute: vi.fn(async () => {}) };
  let finishPublish: (value: typeof publication) => void = () => {};
  const room = {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: vi.fn(() => new Promise<typeof publication>((resolve) => (finishPublish = resolve))),
      unpublishTrack: vi.fn(async () => {})
    }
  };
  Object.assign(state, { joined: true, livekitRoom: room, localStream: stream, localRawStream: stream, muted: false });
  const ensuring = ensureCurrentMicrophonePublication();
  await vi.waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await ensuring).toBe('timed_out');
  expect(state.localStream, 'the live capture survives a slow reconnect').toBe(stream);
  expect(state.microphoneMissing).toBe(false);
  expect(captureWork.stop).not.toHaveBeenCalled();
  expect(track.enabled).toBe(true);

  finishPublish(publication);
  await vi.advanceTimersByTimeAsync(0);
  expect(state.localMicPublication).toEqual(publication);
  expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
});

function preparedCapture(id: string): MicrophoneCapture {
  return {
    barrier: true,
    mode: 'browser',
    processor: null,
    rawStream: new FakeMediaStream([new FakeMediaStreamTrack(`${id}-raw`, 'audio')]),
    stream: new FakeMediaStream([new FakeMediaStreamTrack(`${id}-output`, 'audio')])
  };
}

test("an old join's publish timing out after leave and rejoin leaves the new call's microphone alone", async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const first = preparedCapture('old-join');
  captureWork.open.mockResolvedValueOnce(first);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(first);
  const oldRoom = Object.assign(new Room(), {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: vi.fn(() => new Promise<never>(() => {})),
      unpublishTrack: vi.fn(async () => {})
    }
  });
  let oldJoinCurrent = true;
  const oldPublish = publishMicrophoneForJoin(oldRoom, first, () => oldJoinCurrent);
  await vi.advanceTimersByTimeAsync(100);
  oldJoinCurrent = false;
  invalidateMicrophoneActions(); // leave
  Object.assign(state, createInitialRoomState());

  // Rejoin: the new microphone is prepared while the old publish is still pending.
  const second = preparedCapture('new-join');
  captureWork.open.mockResolvedValueOnce(second);
  expect(await acquireMicrophoneForJoin(() => true)).toBe(second);
  captureWork.stop.mockClear();
  await vi.advanceTimersByTimeAsync(10_000);
  expect((await oldPublish).publication).toBeNull();
  expect(captureWork.stop, 'the prepared microphone of the new join survives').not.toHaveBeenCalledWith(second);

  const outputTrack = defined(second.stream?.getAudioTracks()[0], 'new output track');
  const publication = {
    track: { mediaStreamTrack: outputTrack },
    mute: vi.fn(async () => {}),
    unmute: vi.fn(async () => {})
  };
  const newRoom = Object.assign(new Room(), {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: vi.fn(async () => publication),
      unpublishTrack: vi.fn(async () => {})
    }
  });
  state.livekitRoom = newRoom;
  expect((await publishMicrophoneForJoin(newRoom, second, () => true)).publication).toBe(publication);
  setLocalMicrophoneCapture(second);
  Object.assign(state, { joined: true, microphoneMissing: false });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(state.localStream).toBe(second.stream);
  expect(state.microphoneMissing).toBe(false);
  expect(captureWork.stop).not.toHaveBeenCalledWith(second);
});

test('a slow publish into a replacement room keeps the live microphone of the current room', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const committed = preparedCapture('replacement-committed');
  const standingPublication = { track: {}, mute: vi.fn(), unmute: vi.fn() };
  const standing = Object.assign(new Room(), {
    localParticipant: { trackPublications: new Map<string, unknown>(), publishTrack: vi.fn(), unpublishTrack: vi.fn() }
  });
  setLocalMicrophoneCapture(committed);
  Object.assign(state, {
    joined: true,
    livekitRoom: standing,
    localMicPublication: standingPublication,
    muted: false,
    microphoneMissing: false
  });
  const candidate = Object.assign(new Room(), {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: vi.fn(() => new Promise<never>(() => {})),
      unpublishTrack: vi.fn(async () => {})
    }
  });
  const publishing = publishMicrophoneForReplacementRoom(candidate, defined(committed.stream, 'stream'), () => true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect((await publishing).outcome).toBe('timed_out');
  expect(state.localStream).toBe(committed.stream);
  expect(state.microphoneMissing).toBe(false);
  expect(state.localMicPublication).not.toBeNull();
  expect(captureWork.stop).not.toHaveBeenCalledWith(committed);
});

test('a replacement refused as stale keeps the standing room publish owned', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const committed = preparedCapture('stale-supersede');
  setLocalMicrophoneCapture(committed);
  const standing = Object.assign(new Room(), {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: vi.fn(() => new Promise<never>(() => {})),
      unpublishTrack: vi.fn(async () => {})
    }
  });
  Object.assign(state, {
    joined: true,
    livekitRoom: standing,
    localMicPublication: null,
    muted: false,
    outputMuted: false
  });
  startMicrophoneCall();
  const ensuring = ensureCurrentMicrophonePublication();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await ensuring).toBe('timed_out');
  const candidate = Object.assign(new Room(), {
    localParticipant: { trackPublications: new Map<string, unknown>(), publishTrack: vi.fn(), unpublishTrack: vi.fn() }
  });
  const other = preparedCapture('stale-supersede-other');
  const refused = await publishMicrophoneForReplacementRoom(candidate, defined(other.stream, 'stream'), () => true);
  expect(refused.outcome).toBe('stale');
  expect(isOwnedMicrophonePublishPending(standing), 'the standing publish keeps its owner').toBe(true);
  expect(canAdmitAutomaticMicrophoneAction(), 'no second microphone mutation may start').toBe(false);
});
