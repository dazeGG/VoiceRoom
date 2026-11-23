import type * as WebLog from '@/shared/log';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startScreenStartupDiagnostics } from '@voiceroom/call/engine/media/screen-startup-diagnostics';
import type { LogContext } from '@/shared/log';
import { installWebCallPortsForTest } from '../helpers/call-ports';

const { info, report } = vi.hoisted(() => ({
  info: vi.fn<(message: string, context: LogContext) => void>(),
  report: vi.fn(async () => true)
}));
vi.mock('@/shared/log', async (importOriginal) => ({
  ...(await importOriginal<typeof WebLog>()),
  createLogger: () => ({ info }),
  reportClientLogs: report
}));

beforeEach(installWebCallPortsForTest);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

function stats(...entries: object[]) {
  return { forEach: (visit: (entry: unknown) => void) => entries.forEach(visit) };
}

function summaries() {
  return info.mock.calls.filter(([message]) => message === 'screen startup summary').map(([, context]) => context);
}

function expectOneSummary(): LogContext {
  expect(info.mock.calls.map(([message]) => message)).toEqual(['screen startup summary']);
  const summary = summaries()[0];
  expect(summary).toBeDefined();
  expect(Object.keys(summary ?? {}).length).toBeLessThanOrEqual(18);
  expect(
    Object.values(summary ?? {}).every(
      (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value)
    )
  ).toBe(true);
  return summary ?? {};
}

test('a share that becomes stable records first frame, stable time and the worst fps after that', async () => {
  const plan = [
    { add: 0, height: 720, limitation: 'none', gapUs: 40_000 },
    { add: 10, height: 540, limitation: 'none', gapUs: 40_000 },
    { add: 30, height: 720, limitation: 'bandwidth', gapUs: 40_000 },
    { add: 30, height: 720, limitation: 'none', gapUs: 40_000 },
    { add: 30, height: 720, limitation: 'bandwidth', gapUs: 80_000 },
    { add: 20, height: 720, limitation: 'cpu', gapUs: 40_000 }
  ];
  let tick = 0;
  let sent = 0;
  const stop = startScreenStartupDiagnostics({
    direction: 'send',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () => {
      const step = plan[tick] ?? plan[plan.length - 1] ?? { add: 30, height: 720, limitation: 'none', gapUs: 0 };
      tick += 1;
      sent += step.add;
      return stats(
        {
          id: 'video',
          type: 'outbound-rtp',
          kind: 'video',
          timestamp: tick * 1000,
          framesSent: sent,
          frameWidth: 1280,
          frameHeight: step.height,
          qualityLimitationReason: step.limitation,
          encoderImplementation: 'OpenH264',
          codecId: 'codec'
        },
        { id: 'codec', type: 'codec', mimeType: 'video/VP8' }
      );
    },
    capture: () => ({ backend: 'wgc', maxGapUs: plan[tick - 1]?.gapUs ?? 0 })
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(info).not.toHaveBeenCalled();
  stop();
  const summary = expectOneSummary();
  expect(summary).toMatchObject({
    trackId: 'TR_screen',
    direction: 'send',
    profileId: 'balanced-30',
    reason: 'stopped',
    elapsedMs: 5_000,
    samples: 6,
    errors: 0,
    firstFrameMs: 1_000,
    stableMs: 2_000,
    minFpsAfterStable: 20,
    medianFps: 30,
    maxHeight: 720,
    limitation: 'bandwidth',
    codec: 'video/VP8',
    encoder: 'OpenH264',
    backend: 'wgc',
    maxGapMs: 80
  });
  expect(Object.keys(summary)).toHaveLength(18);
  expect(report).toHaveBeenCalledExactlyOnceWith('screen startup diagnostics', 'info');
});

test('a window that never holds three samples at its tallest height leaves stableMs null', async () => {
  const heights = [720, 720, 720, 720, 1080];
  let tick = 0;
  let sent = 0;
  const stop = startScreenStartupDiagnostics({
    direction: 'send',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () => {
      tick += 1;
      sent += tick === 1 ? 0 : 30;
      return stats({
        id: 'video',
        type: 'outbound-rtp',
        kind: 'video',
        timestamp: tick * 1000,
        framesSent: sent,
        frameWidth: 1280,
        frameHeight: heights[tick - 1] ?? 720,
        qualityLimitationReason: 'none'
      });
    }
  });
  await vi.advanceTimersByTimeAsync(4_000);
  stop();
  expect(expectOneSummary()).toMatchObject({
    reason: 'stopped',
    firstFrameMs: 1_000,
    stableMs: null,
    minFpsAfterStable: null,
    maxHeight: 1080,
    medianFps: 30,
    limitation: 'none',
    backend: null,
    maxGapMs: null
  });
});

test('measured zero stays zero and does not count as the first frame', async () => {
  let tick = 0;
  const stop = startScreenStartupDiagnostics({
    direction: 'send',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () => {
      tick += 1;
      return stats({
        id: 'video',
        type: 'outbound-rtp',
        kind: 'video',
        timestamp: tick * 1000,
        framesSent: 0,
        frameHeight: 720,
        qualityLimitationReason: 'none'
      });
    }
  });
  await vi.advanceTimersByTimeAsync(3_000);
  stop();
  expect(expectOneSummary()).toMatchObject({
    firstFrameMs: null,
    stableMs: null,
    minFpsAfterStable: null,
    medianFps: 0,
    maxHeight: 720,
    samples: 4
  });
});

test('a viewer is measured by rendered fps once its playback counter counts, and sums freezes and loss', async () => {
  let tick = 0;
  const stop = startScreenStartupDiagnostics({
    direction: 'receive',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () => {
      tick += 1;
      return stats(
        {
          id: 'remote',
          type: 'inbound-rtp',
          kind: 'video',
          timestamp: tick * 1000,
          framesPerSecond: 10,
          packetsLost: tick,
          freezeCount: tick === 1 ? 0 : 1,
          frameWidth: 1280,
          frameHeight: 720,
          codecId: 'codec'
        },
        { id: 'codec', type: 'codec', mimeType: 'video/VP9' }
      );
    },
    playback: () => ({ totalVideoFrames: tick * 30, droppedVideoFrames: 0 })
  });
  await vi.advanceTimersByTimeAsync(3_000);
  stop();
  const summary = expectOneSummary();
  expect(summary).toMatchObject({
    direction: 'receive',
    reason: 'stopped',
    samples: 4,
    fpsSource: 'rendered',
    firstFrameMs: 1_000,
    stableMs: 1_000,
    minFpsAfterStable: 30,
    medianFps: 30,
    maxHeight: 720,
    codec: 'video/VP9',
    freezes: 1,
    lost: 3
  });
  expect(Object.keys(summary)).toHaveLength(17);
  expect(summary).not.toHaveProperty('limitation');
  expect(summary).not.toHaveProperty('encoder');
  expect(summary).not.toHaveProperty('backend');
  expect(summary).not.toHaveProperty('maxGapMs');
});

test('a viewer whose browser counts no playback frames is measured by decoded fps, not as a frozen stage', async () => {
  let tick = 0;
  const stop = startScreenStartupDiagnostics({
    direction: 'receive',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () => {
      tick += 1;
      return stats({
        id: 'remote',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: tick * 1000,
        framesPerSecond: 30,
        frameHeight: 720
      });
    },
    playback: () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 })
  });
  await vi.advanceTimersByTimeAsync(3_000);
  stop();
  expect(expectOneSummary()).toMatchObject({
    fpsSource: 'decoded',
    firstFrameMs: 0,
    stableMs: 0,
    minFpsAfterStable: 30,
    medianFps: 30
  });
});

function viewer(
  read: () => Promise<ReturnType<typeof stats>>,
  playback: () => { totalVideoFrames: number; droppedVideoFrames: number }
) {
  return startScreenStartupDiagnostics({
    direction: 'receive',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read,
    playback
  });
}

function decoding(fps: number, tick: number) {
  return stats({
    id: 'remote',
    type: 'inbound-rtp',
    kind: 'video',
    timestamp: tick * 1000,
    framesPerSecond: fps,
    frameHeight: 720
  });
}

test('a stage that decodes but stops painting reads as zero, not as the decoded rate', async () => {
  let tick = 0;
  const stop = viewer(
    async () => decoding(30, ++tick),
    () => ({ totalVideoFrames: 12, droppedVideoFrames: 0 })
  );
  await vi.advanceTimersByTimeAsync(4_000);
  stop();
  expect(expectOneSummary()).toMatchObject({ fpsSource: 'rendered', firstFrameMs: null, stableMs: null, medianFps: 0 });
});

test('a stage that paints late counts its black seconds once the counter starts', async () => {
  let tick = 0;
  const stop = viewer(
    async () => decoding(30, ++tick),
    () => ({ totalVideoFrames: tick <= 3 ? 0 : (tick - 3) * 30, droppedVideoFrames: 0 })
  );
  await vi.advanceTimersByTimeAsync(7_000);
  stop();
  expect(expectOneSummary()).toMatchObject({ fpsSource: 'rendered', firstFrameMs: 3_000, stableMs: 3_000 });
});

test('two good samples and a dip just under 27 fps are not stable; the next three are', async () => {
  const plan = [30, 30, 26.9, 27, 30, 30];
  let tick = 0;
  const stop = viewer(
    async () => decoding(plan[tick++] ?? 30, tick),
    () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 })
  );
  await vi.advanceTimersByTimeAsync(5_000);
  stop();
  expect(expectOneSummary()).toMatchObject({ stableMs: 3_000, minFpsAfterStable: 27, samples: 6 });
});

test('a failed read between good samples breaks the stable run', async () => {
  let tick = 0;
  const stop = viewer(
    async () => {
      tick += 1;
      if (tick === 2) throw new Error('stats unavailable');
      return decoding(30, tick);
    },
    () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 })
  );
  await vi.advanceTimersByTimeAsync(4_000);
  stop();
  expect(expectOneSummary()).toMatchObject({ stableMs: 2_000, errors: 1, samples: 4 });
});

test('the full window logs one complete summary and then stops sampling', async () => {
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
  const summary = expectOneSummary();
  expect(summary).toMatchObject({ reason: 'complete', elapsedMs: 30_000, samples: 30, errors: 0 });
  expect(Object.keys(summary)).toHaveLength(18);
  expect(report).toHaveBeenCalledExactlyOnceWith('screen startup diagnostics', 'info');
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(30);
  expect(report).toHaveBeenCalledTimes(1);
  expect(summaries()).toHaveLength(1);
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
  expect(expectOneSummary()).toMatchObject({ reason: 'stopped', elapsedMs: 5_000, samples: 0, direction: 'receive' });
  expect(report).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('a stuck read cannot keep the window alive, and a failed read counts without leaking the error', async () => {
  const read = vi.fn(async () => {
    if (read.mock.calls.length === 1) throw new Error('private URL/token must not be logged');
    if (read.mock.calls.length === 3) return new Promise<undefined>(() => {});
    return undefined;
  });
  startScreenStartupDiagnostics({ direction: 'send', trackId: 'TR_screen', profileId: 'balanced-30', read });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(read).toHaveBeenCalledTimes(3);
  expect(expectOneSummary()).toMatchObject({ errors: 1, samples: 1, reason: 'complete' });
  expect(JSON.stringify(info.mock.calls)).not.toContain('private');
  expect(vi.getTimerCount()).toBe(0);
});
