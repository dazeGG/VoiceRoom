import type * as WebLog from '@/shared/log';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startScreenSustainedDiagnostics } from '@voiceroom/call/engine/media/screen-sustained-diagnostics';
import type { LogContext } from '@/shared/log';
import { installWebCallPortsForTest } from '../../../../apps/web/test/helpers/call-ports';

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

function records(message: string) {
  return info.mock.calls.filter(([logged]) => logged === message).map(([, context]) => context);
}

function summaries() {
  return records('screen sustained summary');
}

function totals() {
  return records('screen sustained total');
}

const MINUTE = 60_000;

function expectIntake(): void {
  expect(info.mock.calls.length).toBeGreaterThan(0);
  for (const [message, context] of info.mock.calls) {
    expect(message === 'screen sustained summary' || message === 'screen sustained total').toBe(true);
    expect(Object.keys(context).length).toBeLessThanOrEqual(18);
    expect(
      Object.values(context).every((value) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
    ).toBe(true);
  }
}

function sender(fpsAt: (tick: number) => number, options?: { gapUs?: number; backpressure?: boolean }) {
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
      framesDroppedBackpressure: options?.backpressure ? tick : 0,
      ...(options?.gapUs === undefined ? {} : { backend: 'wgc', maxGapUs: options.gapUs * tick })
    })
  };
}

test('a quiet publication logs only the total and reports once on stop', async () => {
  const stop = startScreenSustainedDiagnostics(sender(() => 30));
  await vi.advanceTimersByTimeAsync(MINUTE * 2);
  expect(summaries()).toHaveLength(0);
  expect(totals()).toHaveLength(0);
  expect(report).not.toHaveBeenCalled();
  stop();
  expect(summaries()).toHaveLength(0);
  expect(totals()).toHaveLength(1);
  expect(totals()[0]).toMatchObject({
    trackId: 'TR_screen',
    direction: 'send',
    minutes: 2,
    degradedMinutes: 0,
    errors: 0,
    minFps: 30,
    lowSamples: 0,
    minHeight: 540,
    maxGapMs: null,
    backpressure: 0
  });
  expectIntake();
  expect(report).toHaveBeenCalledExactlyOnceWith('screen sustained diagnostics', 'info');
  expect(vi.getTimerCount()).toBe(0);
});

test('a degraded minute is logged and reported before stop, then the total covers the whole publication', async () => {
  const stop = startScreenSustainedDiagnostics(sender((tick) => (tick > 3 ? 5 : 30)));
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(summaries()).toHaveLength(1);
  expect(totals()).toHaveLength(0);
  expect(report).toHaveBeenCalledExactlyOnceWith('screen sustained diagnostics', 'info');
  expect(summaries()[0]).toMatchObject({ minFps: 5 });
  expect(summaries()[0]?.lowSamples).toBeGreaterThan(0);
  stop();
  expect(summaries()).toHaveLength(1);
  expect(totals()[0]).toMatchObject({ minutes: 1, degradedMinutes: 1, minFps: 5 });
  expect(totals()[0]?.lowSamples).toBeGreaterThan(0);
  expect(report).toHaveBeenCalledTimes(2);
  expectIntake();
});

test('missing numbers stay null, and twenty fps without backpressure is not a degraded minute', async () => {
  const stop = startScreenSustainedDiagnostics({
    direction: 'send',
    trackId: 'TR_screen',
    profileId: 'balanced-30',
    read: async () => stats()
  });
  await vi.advanceTimersByTimeAsync(10_000);
  stop();
  expect(summaries()).toHaveLength(0);
  expect(totals()[0]).toMatchObject({
    minFps: null,
    medianFps: null,
    avgBitrate: null,
    minHeight: null,
    maxGapMs: null,
    backpressure: null,
    lowSamples: null,
    errors: 0
  });
  expect(totals()[0]?.samples).toBeGreaterThan(0);

  info.mockClear();
  report.mockClear();
  const steady = startScreenSustainedDiagnostics(sender(() => 20));
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(summaries()).toHaveLength(0);
  steady();
  expect(summaries()).toHaveLength(0);
  expect(totals()[0]).toMatchObject({ degradedMinutes: 0, minFps: 20, lowSamples: 0 });
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
  expect(summaries()).toHaveLength(0);
  expect(totals()[0]).toMatchObject({ direction: 'receive', samples: 0, errors: 4, minutes: 1 });
  expect(JSON.stringify(info.mock.calls)).not.toContain('private');
  expectIntake();
});

test('the sender total keeps the longest pipeline gap and backpressure, and the viewer sums freezes and loss', async () => {
  const stop = startScreenSustainedDiagnostics(sender(() => 30, { gapUs: 1500, backpressure: true }));
  await vi.advanceTimersByTimeAsync(8000);
  stop();
  expect(summaries()[0]).toMatchObject({ maxGapMs: 7.5, backpressure: 4, minHeight: 540 });
  expect(totals()[0]).toMatchObject({ maxGapMs: 7.5, backpressure: 4, degradedMinutes: 1, minHeight: 540 });
  expect(Object.keys(summaries()[0] ?? {})).toHaveLength(15);
  expect(Object.keys(totals()[0] ?? {})).toHaveLength(16);

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
  expect(summaries()[0]).toMatchObject({ freezes: 3, lost: 6, minFps: 30, fpsSource: 'rendered' });
  expect(totals()[0]).toMatchObject({ freezes: 3, lost: 6, degradedMinutes: 1, fpsSource: 'rendered', final: true });
  expect(Object.keys(totals()[0] ?? {})).toHaveLength(17);
  expect(totals()[0]).not.toHaveProperty('minRenderedFps');
});

test('a viewer whose browser counts no playback frames is judged by decoded fps', async () => {
  let tick = 0;
  const stop = startScreenSustainedDiagnostics({
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
        framesPerSecond: 30,
        freezeCount: 0,
        frameHeight: 720
      });
    },
    playback: () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 })
  });
  await vi.advanceTimersByTimeAsync(8_000);
  stop();
  expect(summaries()).toHaveLength(0);
  expect(totals()[0]).toMatchObject({ degradedMinutes: 0, medianFps: 30, lowSamples: 0, fpsSource: 'decoded' });
});

test('a viewer stage that decodes but stops painting is a degraded minute', async () => {
  let tick = 0;
  const stop = startScreenSustainedDiagnostics({
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
        framesPerSecond: 30,
        freezeCount: 0,
        frameHeight: 720
      });
    },
    playback: () => ({ totalVideoFrames: 40, droppedVideoFrames: 0 })
  });
  await vi.advanceTimersByTimeAsync(8_000);
  stop();
  expect(summaries()[0]).toMatchObject({ minFps: 0, fpsSource: 'rendered' });
  expect(totals()[0]).toMatchObject({ degradedMinutes: 1, fpsSource: 'rendered' });
});

test('packet loss alone does not make a viewer minute degraded', async () => {
  let tick = 0;
  const stop = startScreenSustainedDiagnostics({
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
        freezeCount: 0,
        packetsLost: tick * 3,
        frameHeight: 720
      });
    },
    playback: () => ({ totalVideoFrames: tick * 60, droppedVideoFrames: 0 })
  });
  await vi.advanceTimersByTimeAsync(8_000);
  stop();
  expect(summaries()).toHaveLength(0);
  expect(totals()[0]).toMatchObject({ degradedMinutes: 0, freezes: 0 });
  expect(totals()[0]?.lost).toBeGreaterThan(0);
});

test('at most ten degraded minutes are logged, and later ones still count on the total', async () => {
  const stop = startScreenSustainedDiagnostics(sender(() => 5));
  await vi.advanceTimersByTimeAsync(MINUTE * 10);
  expect(summaries()).toHaveLength(10);
  expect(report).toHaveBeenCalledTimes(10);
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(summaries()).toHaveLength(10);
  expect(report).toHaveBeenCalledTimes(10);
  stop();
  expect(summaries()).toHaveLength(10);
  expect(totals()[0]).toMatchObject({ minutes: 11, degradedMinutes: 11, minFps: 5 });
  expect(report).toHaveBeenCalledTimes(11);
  expectIntake();
  expect(vi.getTimerCount()).toBe(0);
});

test('stops sampling after 120 minutes', async () => {
  const read = vi.fn(async () => stats());
  startScreenSustainedDiagnostics({ direction: 'send', trackId: 'TR_screen', profileId: 'balanced-30', read });
  await vi.advanceTimersByTimeAsync(MINUTE * 15);
  expect(totals()).toEqual([expect.objectContaining({ minutes: 15, final: false })]);
  expect(report).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(MINUTE * 106);
  expect(summaries()).toHaveLength(0);
  // A running total every 15 minutes before the cap, then the final one.
  expect(totals().map((total) => total.minutes)).toEqual([15, 30, 45, 60, 75, 90, 105, 120]);
  expect(totals().at(-1)).toMatchObject({ minutes: 120, degradedMinutes: 0, final: true });
  const reads = read.mock.calls.length;
  await vi.advanceTimersByTimeAsync(MINUTE * 5);
  expect(read.mock.calls.length).toBe(reads);
  expect(report).toHaveBeenCalledTimes(8);
  expect(vi.getTimerCount()).toBe(0);
});
