import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startScreenSustainedDiagnostics } from '@/features/room/client/media/screen-sustained-diagnostics';
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

function summaries() {
  return info.mock.calls.filter(([message]) => message === 'screen sustained summary').map(([, context]) => context);
}

const MINUTE = 60_000;

function sender(fpsAt: (tick: number) => number, gapUs?: number) {
  let tick = 0;
  let sent = 0;
  return {
    direction: 'send' as const,
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () => {
      tick += 1;
      sent += fpsAt(tick) * 2;
      return stats({
        id: 'video',
        type: 'outbound-rtp',
        kind: 'video',
        timestamp: tick * 2000,
        framesSent: sent,
        framesEncoded: sent,
        bytesSent: tick * 25_000,
        frameWidth: 1280,
        frameHeight: tick === 5 ? 540 : 720
      });
    },
    capture: () => ({
      framesDroppedBackpressure: tick,
      ...(gapUs === undefined
        ? {}
        : {
            pipeline: {
              seq: 1,
              backend: 'wgc',
              acquired: 0,
              pacingSkips: 0,
              pausedSkips: 0,
              written: 0,
              sumMapUs: 0,
              sumWriteUs: 0,
              maxGapUs: gapUs * tick,
              maxMapUs: 0,
              maxWriteUs: 0
            }
          })
    })
  };
}

test('aggregates one summary per minute and reports every 5 summaries and on stop', async () => {
  const stop = startScreenSustainedDiagnostics(sender(() => 30, 1000));
  await vi.advanceTimersByTimeAsync(MINUTE * 4 + 1000);
  expect(summaries()).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(summaries()).toHaveLength(5);
  expect(report).toHaveBeenCalledExactlyOnceWith('screen sustained diagnostics', 'info');
  await vi.advanceTimersByTimeAsync(MINUTE * 2);
  stop();
  expect(summaries()).toHaveLength(7);
  expect(report).toHaveBeenCalledTimes(2);
  expect(summaries()[0]).toMatchObject({
    trackId: 'TR_screen',
    direction: 'send',
    errors: 0,
    minHeight: 540,
    lowSamples: 0
  });
  for (const summary of summaries()) expect(Object.keys(summary).length).toBeLessThanOrEqual(18);
  expect(vi.getTimerCount()).toBe(0);
});

test('missing data stays null and low-FPS samples are counted', async () => {
  const stop = startScreenSustainedDiagnostics({
    direction: 'send',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () => stats()
  });
  await vi.advanceTimersByTimeAsync(10_000);
  stop();
  expect(summaries()[0]).toMatchObject({
    minFps: null,
    medianFps: null,
    avgBitrate: null,
    minHeight: null,
    minCaptureFps: null,
    maxGapMs: null,
    backpressure: null,
    lowSamples: null
  });

  info.mockClear();
  const slow = startScreenSustainedDiagnostics(sender((tick) => (tick > 3 ? 5 : 30)));
  await vi.advanceTimersByTimeAsync(20_000);
  slow();
  expect(summaries()[0]?.lowSamples).toBeGreaterThan(0);
  expect(summaries()[0]?.minFps).toBe(5);
});

test('failed reads count as errors without serializing the exception', async () => {
  const stop = startScreenSustainedDiagnostics({
    direction: 'receive',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () => {
      throw new Error('private URL/token');
    }
  });
  await vi.advanceTimersByTimeAsync(6000);
  stop();
  expect(summaries()[0]).toMatchObject({ direction: 'receive', samples: 0, errors: 4 });
  expect(JSON.stringify(info.mock.calls)).not.toContain('private');
});

test('the sender reports the longest pipeline gap and the receiver freezes and losses', async () => {
  const stop = startScreenSustainedDiagnostics(sender(() => 30, 1500));
  await vi.advanceTimersByTimeAsync(8000);
  stop();
  expect(summaries()[0]).toMatchObject({ maxGapMs: 7.5, backpressure: 4 });

  info.mockClear();
  let tick = 0;
  const viewer = startScreenSustainedDiagnostics({
    direction: 'receive',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () => {
      tick += 1;
      return stats({
        id: 'in',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: tick * 2000,
        freezeCount: tick,
        packetsLost: tick * 2
      });
    },
    playback: () => ({ totalVideoFrames: tick * 60, droppedVideoFrames: 0 })
  });
  await vi.advanceTimersByTimeAsync(6000);
  viewer();
  expect(summaries()[0]).toMatchObject({ freezes: 3, lost: 6, minRenderedFps: 30 });
});

test('stops sampling after 120 summaries', async () => {
  const read = vi.fn(async () => stats());
  startScreenSustainedDiagnostics({ direction: 'send', trackId: 'TR_screen', profileId: 'balanced-30', read });
  await vi.advanceTimersByTimeAsync(MINUTE * 121);
  expect(summaries()).toHaveLength(120);
  const reads = read.mock.calls.length;
  await vi.advanceTimersByTimeAsync(MINUTE * 5);
  expect(read.mock.calls.length).toBe(reads);
  expect(vi.getTimerCount()).toBe(0);
});
