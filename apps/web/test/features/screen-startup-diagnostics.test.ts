import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startScreenStartupDiagnostics } from '@/features/room/client/media/screen-startup-diagnostics';
import type { LogContext } from '@/shared/log';

const { info, report } = vi.hoisted(() => ({
  info: vi.fn<(message: string, context: LogContext) => void>(),
  report: vi.fn(async () => true)
}));
vi.mock('@/shared/log', () => ({ createLogger: () => ({ info }), reportClientLogs: report }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

function stats(...entries: object[]) {
  return { forEach: (visit: (entry: unknown) => void) => entries.forEach(visit) };
}

function samples() {
  return info.mock.calls.filter(([message]) => message === 'screen startup sample').map(([, context]) => context);
}

test('buffers at most 30 samples, stops at 30 seconds and reports once within intake limits', async () => {
  const read = vi.fn(async () => stats());
  const stop = startScreenStartupDiagnostics({
    direction: 'send',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read
  });
  await vi.advanceTimersByTimeAsync(29_999);
  expect(info).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(samples()).toHaveLength(30);
  expect(info.mock.calls[0]).toEqual([
    'screen startup started',
    expect.objectContaining({ direction: 'send', trackId: 'TR_screen', profileId: 'balanced-30' })
  ]);
  expect(info.mock.calls.at(-1)).toEqual([
    'screen startup ended',
    expect.objectContaining({ reason: 'complete', elapsedMs: 30_000, samples: 30 })
  ]);
  for (const [, context] of info.mock.calls) expect(Object.keys(context).length).toBeLessThanOrEqual(18);
  expect(report).toHaveBeenCalledExactlyOnceWith('screen startup diagnostics', 'info');
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(30);
  expect(report).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('early stop is idempotent and ignores a late asynchronous report', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof stats>>();
  const read = vi.fn(() => pending.promise);
  const stop = startScreenStartupDiagnostics({
    direction: 'receive',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(read).toHaveBeenCalledTimes(1);
  stop();
  stop();
  pending.resolve(stats({ id: 'video', type: 'inbound-rtp', kind: 'video', framesPerSecond: 30 }));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(samples()).toEqual([]);
  expect(info.mock.calls.at(-1)?.[1]).toMatchObject({ reason: 'stopped', elapsedMs: 5_000 });
  expect(report).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('a stuck read cannot keep the window alive; a failed read does not leak errors or stop later samples', async () => {
  const read = vi.fn(async () => {
    if (read.mock.calls.length === 1) throw new Error('private URL/token must not be logged');
    if (read.mock.calls.length === 3) return new Promise<undefined>(() => {});
    return undefined;
  });
  startScreenStartupDiagnostics({ direction: 'send', trackId: 'TR_screen', profileId: 'balanced-30', read });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(read).toHaveBeenCalledTimes(3);
  expect(samples()).toHaveLength(1);
  expect(info.mock.calls.at(-1)?.[1]).toMatchObject({ errors: 1, reason: 'complete' });
  expect(JSON.stringify(info.mock.calls)).not.toContain('private');
  expect(vi.getTimerCount()).toBe(0);
});

test('sender keeps measured zero distinct from missing values and measures native capture deltas', async () => {
  let frames = 0;
  const read = async () =>
    stats(
      {
        id: 'video',
        type: 'outbound-rtp',
        kind: 'video',
        timestamp: frames * 1000,
        framesPerSecond: 0,
        framesEncoded: 0,
        framesSent: 0,
        bytesSent: 0,
        frameWidth: 1280,
        frameHeight: 720,
        qualityLimitationReason: 'cpu',
        totalEncodeTime: 0
      },
      { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, availableOutgoingBitrate: 0 }
    );
  const stop = startScreenStartupDiagnostics({
    direction: 'send',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read,
    capture: () => ({ framesReceived: frames * 30, framesWritten: frames * 5, framesDroppedBackpressure: frames * 25 })
  });
  await vi.advanceTimersByTimeAsync(0);
  frames = 1;
  await vi.advanceTimersByTimeAsync(1000);
  stop();
  expect(samples()[0]).toMatchObject({ encodedFps: 0, sentFps: null, captureFps: null, bitrate: null });
  expect(samples()[1]).toMatchObject({
    encodedFps: 0,
    sentFps: 0,
    captureFps: 30,
    writtenFps: 5,
    backpressure: 25,
    bitrate: 0,
    availableBitrate: 0,
    limitation: 'cpu',
    encodeMs: null
  });
});

test('sender selects the largest video layer, never sums FPS, and resets deltas on SSRC/counter changes', async () => {
  let tick = 0;
  const read = async () =>
    stats(
      {
        id: 'low',
        type: 'outbound-rtp',
        kind: 'video',
        timestamp: tick * 1000,
        frameWidth: 960,
        frameHeight: 540,
        framesEncoded: 1000 + tick * 30,
        bytesSent: 9_000_000 + tick * 1000
      },
      {
        id: tick > 1 ? 'replacement' : 'high',
        type: 'outbound-rtp',
        kind: 'video',
        timestamp: tick * 1000,
        frameWidth: 1280,
        frameHeight: 720,
        framesEncoded: tick === 3 ? 2 : tick * 20,
        bytesSent: tick === 3 ? 5 : tick * 2000,
        totalEncodeTime: tick * 0.04,
        mediaSourceId: 'source'
      },
      { id: 'source', type: 'media-source', kind: 'video', timestamp: tick * 1000, frames: tick * 30 }
    );
  const stop = startScreenStartupDiagnostics({
    direction: 'send',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read
  });
  await vi.advanceTimersByTimeAsync(0);
  for (tick = 1; tick <= 3; tick++) await vi.advanceTimersByTimeAsync(1000);
  stop();
  expect(samples()[1]).toMatchObject({ layerId: 'high', encodedFps: 20, captureFps: 30, bitrate: 16_000, encodeMs: 2 });
  expect(samples()[2]).toMatchObject({ layerId: 'replacement', encodedFps: null, bitrate: null });
  expect(samples()[3]).toMatchObject({ encodedFps: null, bitrate: null });
});

test('receiver separates received, decoded and displayed frames, losses and drops', async () => {
  let tick = 0;
  const stop = startScreenStartupDiagnostics({
    direction: 'receive',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () =>
      stats({
        id: 'remote',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: tick * 1000,
        bytesReceived: tick * 125_000,
        framesReceived: tick * 30,
        framesDecoded: tick * 25,
        framesDropped: tick * 5,
        packetsLost: tick * 2,
        freezeCount: tick,
        frameWidth: 1280,
        frameHeight: 720,
        jitter: 0.01
      }),
    playback: () => ({ totalVideoFrames: tick * 25, droppedVideoFrames: tick * 5 })
  });
  await vi.advanceTimersByTimeAsync(0);
  tick = 1;
  await vi.advanceTimersByTimeAsync(1000);
  stop();
  expect(samples()[1]).toMatchObject({
    receivedFps: 30,
    decodedFps: 25,
    renderedFps: 20,
    bitrate: 1_000_000,
    dropped: 5,
    lost: 2,
    freezes: 1,
    jitterMs: 10,
    width: 1280,
    height: 720
  });
});

test('invalid numeric stats stay missing, rather than becoming misleading zero or infinity', async () => {
  const stop = startScreenStartupDiagnostics({
    direction: 'receive',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () =>
      stats({
        id: 'remote',
        type: 'inbound-rtp',
        kind: 'video',
        framesPerSecond: Number.NaN,
        frameWidth: Number.POSITIVE_INFINITY,
        frameHeight: '720',
        jitter: Number.NaN
      })
  });
  await vi.advanceTimersByTimeAsync(0);
  stop();
  expect(samples()[0]).toMatchObject({
    decodedFps: null,
    receivedFps: null,
    width: null,
    height: null,
    jitterMs: null
  });
});
