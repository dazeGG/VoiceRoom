import { afterEach, expect, test, vi } from 'vitest';
import { normalizeClientLogBatch } from '../../../api/src/lib/client-log-intake.ts';
import { freshImport } from '../helpers/fresh-module';

const records: Array<{ msg: string; ctx?: Record<string, string | number | boolean | null> }> = [];
const report = vi.fn(async () => true);

async function load() {
  records.length = 0;
  report.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T08:00:00Z'));
  vi.doMock('@/shared/log', () => ({
    createLogger: () => ({
      info: (msg: string, ctx: Record<string, string | number | boolean | null>) => records.push({ msg, ctx }),
      error: (msg: string, ctx: Record<string, string | number | boolean | null>) => records.push({ msg, ctx })
    }),
    reportClientLogs: report
  }));
  return freshImport(() => import('@/features/room/client/room/capture-diagnostics'));
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('@/shared/log');
  vi.unstubAllGlobals();
});

test('metadata uses only a bounded existing desktop version and leaves absent versions unknown', async () => {
  const diagnostics = await load();
  vi.stubGlobal('window', { voiceRoomRuntime: { isDesktop: true, version: '1.4.13' } });
  diagnostics.startCaptureDiagnostics();
  expect(records[0]?.ctx?.desktopVersion).toBe('1.4.13');
  diagnostics.stopCaptureDiagnostics();
  vi.stubGlobal('window', { voiceRoomRuntime: { isDesktop: true } });
  diagnostics.startCaptureDiagnostics();
  expect(records.at(-1)?.ctx?.desktopVersion).toBe('unknown');
  diagnostics.stopCaptureDiagnostics();
  vi.stubGlobal('window', { voiceRoomRuntime: { isDesktop: true, version: 'a/b?token=secret' } });
  diagnostics.startCaptureDiagnostics();
  expect(records.at(-1)?.ctx?.desktopVersion).toBe('unknown');
});

test('diagnostic producer uses exact scalar allowlists accepted by the real intake', async () => {
  const diagnostics = await load();
  diagnostics.startCaptureDiagnostics();
  diagnostics.noteCaptureHealth({
    generation: 1,
    expectedMs: 3000,
    deliveredMs: 1000,
    contextMs: 2900,
    contextState: 'running',
    desiredMode: 'rnnoise',
    actualMode: 'rnnoise',
    intent: 'active',
    rawState: 'live',
    rawMuted: false,
    rawEnabled: true,
    outputState: 'live',
    upstreamPaused: false,
    sourceAvailable: true,
    statsReadMs: 4,
    ageMs: 0
  });
  diagnostics.noteCaptureRecovery({
    generation: 1,
    attempt: 1,
    reason: 'watchdog',
    action: 'reopen',
    outcome: 'applied',
    durationMs: 800,
    actualMode: 'rnnoise',
    progress: 'capture_progress_restored',
    evidence: 'encoder_feed'
  });
  diagnostics.noteProcessingRelief({
    generation: 1,
    kind: 'noise',
    outcome: 'applied',
    requestedMode: 'browser',
    actualMode: 'browser',
    durationMs: 40
  });
  diagnostics.noteCaptureTransition({
    generation: 1,
    reason: 'external-state',
    beforeState: 'running',
    afterState: 'suspended',
    desiredMode: 'rnnoise',
    actualMode: 'rnnoise',
    intent: 'active',
    pollAgeMs: 12
  });
  const byMessage = Object.fromEntries(records.map((record) => [record.msg, record.ctx]));
  expect(Object.keys(byMessage.capture_health ?? {})).toEqual([
    'schemaVersion',
    'generation',
    'expectedMs',
    'deliveredMs',
    'contextMs',
    'contextState',
    'desiredMode',
    'actualMode',
    'intent',
    'rawState',
    'rawMuted',
    'rawEnabled',
    'outputState',
    'upstreamPaused',
    'sourceAvailable',
    'statsReadMs',
    'ageMs'
  ]);
  expect(Object.keys(byMessage.capture_recovery ?? {})).toEqual([
    'schemaVersion',
    'generation',
    'attempt',
    'reason',
    'action',
    'outcome',
    'durationMs',
    'actualMode',
    'progress',
    'evidence',
    'expectedMs',
    'deliveredMs',
    'contextMs'
  ]);
  expect(Object.keys(byMessage.processing_relief ?? {})).toEqual([
    'schemaVersion',
    'generation',
    'kind',
    'outcome',
    'requestedMode',
    'actualMode',
    'durationMs'
  ]);
  expect(Object.keys(byMessage.capture_transition ?? {})).toEqual([
    'schemaVersion',
    'generation',
    'reason',
    'beforeState',
    'afterState',
    'desiredMode',
    'actualMode',
    'intent',
    'pollAgeMs'
  ]);
  expect(Object.keys(byMessage.session_metadata ?? {})).toEqual([
    'schemaVersion',
    'webBuild',
    'desktopVersion',
    'runtimeFamily',
    'runtimeVersion'
  ]);
  const intake = normalizeClientLogBatch(
    {
      sessionId: 'test',
      events: records.map(({ msg, ctx }) => ({
        at: Date.now(),
        level: 'info',
        ns: 'room:capture',
        msg,
        ctx
      }))
    },
    { now: Date.now() }
  );
  expect(intake.dropped).toBe(0);
  expect(intake.events).toHaveLength(records.length);
  expect(intake.events.every((event) => Object.keys(event.ctx ?? {}).length <= 18)).toBe(true);
  expect(report).toHaveBeenCalledTimes(records.length);
});

test('114 nonterminal events cannot borrow six terminal slots; duplicate terminal is ignored', async () => {
  const diagnostics = await load();
  diagnostics.startCaptureDiagnostics();
  let attempts = 0;
  for (let minute = 0; minute < 20; minute += 1) {
    for (let n = 0; n < 6; n += 1) {
      diagnostics.noteProcessingRelief({
        generation: 1,
        kind: 'video',
        outcome: 'applied',
        requestedMode: null,
        actualMode: null,
        durationMs: n
      });
    }
    vi.advanceTimersByTime(60_000);
  }
  expect(records).toHaveLength(114);
  for (let n = 0; n < 1000; n += 1)
    diagnostics.noteCaptureTransition({
      generation: n,
      reason: 'devicechange',
      beforeState: 'running',
      afterState: 'suspended',
      desiredMode: 'browser',
      actualMode: 'browser',
      intent: 'active',
      pollAgeMs: 0
    });
  expect(records).toHaveLength(114);
  for (let n = 1; n <= 6; n += 1) {
    attempts = n;
    diagnostics.noteCaptureRecovery({
      generation: 1,
      attempt: n,
      reason: 'watchdog',
      action: 'reopen',
      outcome: 'applied',
      durationMs: 10,
      actualMode: 'browser',
      progress: 'unverified',
      evidence: 'none'
    });
  }
  expect(records.filter((record) => record.msg === 'capture_recovery')).toHaveLength(6);
  expect(records.find((record) => record.msg === 'capture_recovery')?.ctx?.dropped).toBe(1006);
  diagnostics.noteCaptureRecovery({
    generation: 1,
    attempt: attempts,
    reason: 'watchdog',
    action: 'reopen',
    outcome: 'applied',
    durationMs: 10,
    actualMode: 'browser',
    progress: 'unverified',
    evidence: 'none'
  });
  expect(records).toHaveLength(120);
  expect(report).toHaveBeenCalledTimes(120);
});

test('rolling minute admits at most six nonterminal and six terminal reports', async () => {
  const diagnostics = await load();
  diagnostics.startCaptureDiagnostics();
  for (let n = 0; n < 10; n += 1)
    diagnostics.noteProcessingRelief({
      generation: 1,
      kind: 'video',
      outcome: 'applied',
      requestedMode: null,
      actualMode: null,
      durationMs: n
    });
  for (let n = 1; n <= 8; n += 1)
    diagnostics.noteCaptureRecovery({
      generation: 1,
      attempt: n,
      reason: 'watchdog',
      action: 'reopen',
      outcome: 'failed',
      durationMs: n,
      actualMode: null,
      progress: 'not_applied',
      evidence: 'none'
    });
  expect(records).toHaveLength(12);
  expect(report).toHaveBeenCalledTimes(12);
  expect(records.find((record) => record.msg === 'capture_recovery')?.ctx?.dropped).toBe(5);
});

test('existing wake reasons are call-gated, coalesced, and use the bounded nonterminal flush', async () => {
  const diagnostics = await load();
  diagnostics.noteWakeUnlock('resume');
  expect(records).toHaveLength(0);
  diagnostics.startCaptureDiagnostics();
  diagnostics.noteWakeUnlock('resume');
  diagnostics.noteWakeUnlock('resume');
  diagnostics.noteWakeUnlock('unlock-screen');
  expect(records.filter((record) => record.msg === 'capture_transition')).toHaveLength(2);
  expect(records.at(-1)?.ctx).toMatchObject({
    reason: 'wake-unlock',
    beforeState: null,
    afterState: null,
    intent: 'unknown'
  });
  vi.advanceTimersByTime(3000);
  diagnostics.noteWakeUnlock('unlock-screen');
  expect(records.filter((record) => record.msg === 'capture_transition')).toHaveLength(3);
  expect(report).toHaveBeenCalledTimes(4); // metadata and three transitions
  diagnostics.stopCaptureDiagnostics();
  diagnostics.noteWakeUnlock('resume');
  expect(report).toHaveBeenCalledTimes(4);
});

test('wall-clock jumps cannot reopen a rolling cap or defeat transition coalescing', async () => {
  const diagnostics = await load();
  diagnostics.startCaptureDiagnostics();
  diagnostics.noteWakeUnlock('resume');
  vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  diagnostics.noteWakeUnlock('resume');
  expect(records.filter((record) => record.msg === 'capture_transition')).toHaveLength(1);
  for (let n = 0; n < 10; n += 1)
    diagnostics.noteProcessingRelief({
      generation: n,
      kind: 'video',
      outcome: 'applied',
      requestedMode: null,
      actualMode: null,
      durationMs: n
    });
  expect(records).toHaveLength(6);
  vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
  diagnostics.noteProcessingRelief({
    generation: 99,
    kind: 'video',
    outcome: 'applied',
    requestedMode: null,
    actualMode: null,
    durationMs: 1
  });
  expect(records).toHaveLength(6);
  vi.advanceTimersByTime(60_000);
  diagnostics.noteWakeUnlock('resume');
  expect(records).toHaveLength(7);
  expect(records.at(-1)?.ctx?.dropped).toBe(7);
});

test('owned suspend and resume do not masquerade as external transitions or spend the stall budget', async () => {
  const diagnostics = await load();
  diagnostics.startCaptureDiagnostics();
  const snapshot = (contextState: string, intent: 'active' | 'owned-mute') => ({
    generation: 1,
    expectedMs: 0,
    deliveredMs: 0,
    contextMs: 0,
    contextState,
    desiredMode: 'browser' as const,
    actualMode: 'browser' as const,
    intent,
    rawState: 'live',
    rawMuted: false,
    rawEnabled: true,
    outputState: 'live',
    upstreamPaused: false,
    sourceAvailable: true,
    statsReadMs: 1,
    ageMs: 0
  });
  diagnostics.noteCaptureHealth(snapshot('running', 'active'));
  for (let cycle = 0; cycle < 10; cycle += 1) {
    diagnostics.noteOwnedProcessingTransition('suspended');
    diagnostics.noteCaptureHealth(snapshot('suspended', 'owned-mute'));
    diagnostics.noteOwnedProcessingTransition('running');
    diagnostics.noteCaptureHealth(snapshot('running', 'active'));
    vi.advanceTimersByTime(3000);
  }
  expect(records.filter((record) => record.msg === 'capture_transition')).toHaveLength(0);
  diagnostics.noteCaptureHealth(snapshot('suspended', 'active'));
  expect(records.at(-1)?.ctx?.reason).toBe('external-state');
  expect(records.at(-1)?.ctx?.dropped).toBeUndefined();
});

test('an old capture owned transition cannot hide a new capture external suspension', async () => {
  const diagnostics = await load();
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  diagnostics.startCaptureDiagnostics();
  const snapshot = (contextState: string) => ({
    generation: 1,
    expectedMs: 0,
    deliveredMs: 0,
    contextMs: 0,
    contextState,
    desiredMode: 'browser' as const,
    actualMode: 'browser' as const,
    intent: 'active' as const,
    rawState: 'live',
    rawMuted: false,
    rawEnabled: true,
    outputState: 'live',
    upstreamPaused: false,
    sourceAvailable: true,
    statsReadMs: 1,
    ageMs: 0
  });
  state.micProcessor = [];
  diagnostics.noteCaptureHealth(snapshot('running'));
  diagnostics.noteOwnedProcessingTransition('suspended');
  state.micProcessor = [];
  diagnostics.noteCaptureHealth(snapshot('suspended'));
  expect(records.at(-1)?.ctx?.reason).toBe('external-state');
  state.micProcessor = null;
});
