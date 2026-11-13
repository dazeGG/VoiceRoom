/** Bounded, call-scoped diagnostic producer. The existing logger owns FIFO delivery. */
import { createLogger, reportClientLogs, type LogContext } from '@/shared/log';
import { state as roomState } from '../core/room-runtime.store';

const log = createLogger('room:capture');
const NONTERMINAL_CALL_MAX = 114;
const TERMINAL_CALL_MAX = 6;
const WINDOW_MS = 60_000;
const MAX_DROPPED = 100_000;

type Mode = 'rnnoise' | 'browser' | 'off' | null;
type Intent = 'active' | 'owned-mute' | 'ptt-idle' | 'unknown';

export interface CaptureHealthSnapshot {
  generation: number;
  expectedMs: number;
  deliveredMs: number;
  contextMs: number;
  contextState: string | null;
  desiredMode: Mode;
  actualMode: Mode;
  intent: Intent;
  rawState: string | null;
  rawMuted: boolean | null;
  rawEnabled: boolean | null;
  outputState: string | null;
  upstreamPaused: boolean | null;
  sourceAvailable: boolean;
  statsReadMs: number;
  ageMs: number | null;
}

export interface CaptureRecoveryEvent {
  generation: number;
  attempt: number;
  reason: 'watchdog' | 'raw_ended' | 'owned_resume_failure' | 'processorerror';
  action: 'reopen' | 'replace' | 'browser_fallback';
  outcome: 'applied' | 'failed' | 'stale' | 'timed_out';
  durationMs: number;
  actualMode: Mode;
  progress: 'capture_progress_restored' | 'unverified' | 'not_applied';
  evidence: 'encoder_feed' | 'none';
}

export interface CaptureTransitionEvent {
  generation: number;
  reason:
    'owned-unmute' | 'external-state' | 'wake-resume' | 'wake-unlock' | 'devicechange' | 'processorerror' | 'watchdog';
  beforeState: string | null;
  afterState: string | null;
  desiredMode: Mode;
  actualMode: Mode;
  intent: Intent;
  pollAgeMs: number | null;
}

export interface ProcessingReliefEvent {
  generation: number;
  kind: 'noise' | 'video';
  outcome: 'applied' | 'failed' | 'not_applied';
  requestedMode: Mode;
  actualMode: Mode;
  durationMs: number;
}

let active = false;
let nonterminalCount = 0;
let terminalCount = 0;
let dropped = 0;
let nonterminalTimes: number[] = [];
let terminalTimes: number[] = [];
let snapshots: Array<{ snapshot: CaptureHealthSnapshot; observedAt: number }> = [];
let terminalAttempts = new Set<string>();
let transitions = new Map<string, number>();
let ownedTransition: {
  target: string;
  generation: number | null;
  processor: typeof roomState.micProcessor;
  at: number;
} | null = null;

const bounded = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(100_000_000, value)) : 0);
const mode = (value: Mode): Mode => (value === 'rnnoise' || value === 'browser' || value === 'off' ? value : null);
const state = (value: string | null): string | null =>
  value === 'running' || value === 'suspended' || value === 'closed' || value === 'live' || value === 'ended'
    ? value
    : null;

function admit(terminal: boolean, now: number): boolean {
  if (!active) return false;
  const times = terminal ? terminalTimes : nonterminalTimes;
  while (times.length && now - (times[0] ?? now) >= WINDOW_MS) times.shift();
  if (times.length >= 6 || (terminal ? terminalCount >= TERMINAL_CALL_MAX : nonterminalCount >= NONTERMINAL_CALL_MAX)) {
    dropped = Math.min(MAX_DROPPED, dropped + 1);
    return false;
  }
  times.push(now);
  if (terminal) terminalCount += 1;
  else nonterminalCount += 1;
  return true;
}

function emit(family: string, context: LogContext, terminal = false, failure = false): boolean {
  const now = performance.now();
  if (!admit(terminal, now)) return false;
  const ctx = { ...context, ...(dropped ? { dropped } : {}) };
  dropped = 0;
  if (failure) log.error(family, ctx);
  else log.info(family, ctx);
  // Producer priority is admission only. The logger's 100-record FIFO may still
  // evict this record, and a completed upload attempt is not server acceptance.
  void reportClientLogs(family, failure ? 'error' : 'info');
  return true;
}

export function startCaptureDiagnostics(): void {
  if (active) return;
  active = true;
  nonterminalCount = 0;
  terminalCount = 0;
  dropped = 0;
  nonterminalTimes = [];
  terminalTimes = [];
  snapshots = [];
  terminalAttempts = new Set();
  transitions = new Map();
  ownedTransition = null;
  const webBuild = String(import.meta.env.VITE_APP_VERSION || 'unknown').slice(0, 40);
  const suppliedVersion = window.voiceRoomRuntime?.isDesktop ? window.voiceRoomRuntime.version : undefined;
  const desktopVersion =
    typeof suppliedVersion === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(suppliedVersion)
      ? suppliedVersion
      : 'unknown';
  const runtimeFamily = /Firefox\//.test(navigator.userAgent)
    ? 'firefox'
    : /Chrome\//.test(navigator.userAgent)
      ? 'chromium'
      : /Safari\//.test(navigator.userAgent)
        ? 'safari'
        : 'unknown';
  emit('session_metadata', {
    schemaVersion: 1,
    webBuild,
    desktopVersion,
    runtimeFamily,
    runtimeVersion: 'unknown'
  });
}

export function stopCaptureDiagnostics(): void {
  active = false;
  snapshots = [];
  terminalAttempts.clear();
  transitions.clear();
  ownedTransition = null;
}

/** An owned suspend/resume is not evidence of an external capture state change. */
export function noteOwnedProcessingTransition(target: 'running' | 'suspended'): void {
  if (!active) return;
  ownedTransition = {
    target,
    generation: snapshots.at(-1)?.snapshot.generation ?? null,
    processor: roomState.micProcessor,
    at: performance.now()
  };
}

export function noteCaptureHealth(snapshot: CaptureHealthSnapshot): void {
  if (!active) return;
  const before = snapshots.at(-1)?.snapshot;
  snapshots.push({ snapshot, observedAt: performance.now() });
  if (snapshots.length > 5) snapshots.shift();
  if (before && before.contextState !== snapshot.contextState) {
    const owned =
      ownedTransition?.target === snapshot.contextState &&
      (ownedTransition.generation === null || ownedTransition.generation === snapshot.generation) &&
      ownedTransition.processor === roomState.micProcessor &&
      performance.now() - ownedTransition.at <= 5000;
    ownedTransition = null;
    if (!owned)
      noteCaptureTransition({
        generation: snapshot.generation,
        reason: 'external-state',
        beforeState: before.contextState,
        afterState: snapshot.contextState,
        desiredMode: snapshot.desiredMode,
        actualMode: snapshot.actualMode,
        intent: snapshot.intent,
        pollAgeMs: snapshot.ageMs
      });
  }
  if (snapshot.expectedMs <= 0 || snapshot.deliveredMs * 5 >= snapshot.expectedMs * 4) return;
  emit('capture_health', {
    schemaVersion: 1,
    generation: bounded(snapshot.generation),
    expectedMs: bounded(snapshot.expectedMs),
    deliveredMs: bounded(snapshot.deliveredMs),
    contextMs: bounded(snapshot.contextMs),
    contextState: state(snapshot.contextState),
    desiredMode: mode(snapshot.desiredMode),
    actualMode: mode(snapshot.actualMode),
    intent: snapshot.intent,
    rawState: state(snapshot.rawState),
    rawMuted: snapshot.rawMuted,
    rawEnabled: snapshot.rawEnabled,
    outputState: state(snapshot.outputState),
    upstreamPaused: snapshot.upstreamPaused,
    sourceAvailable: snapshot.sourceAvailable,
    statsReadMs: bounded(snapshot.statsReadMs),
    ageMs: snapshot.ageMs === null ? null : bounded(snapshot.ageMs)
  });
}

/** The existing desktop wake hook reports occurrence, not a proven capture state change. */
export function noteWakeUnlock(reason: 'resume' | 'unlock-screen'): void {
  if (!active || (reason !== 'resume' && reason !== 'unlock-screen')) return;
  const latest = snapshots.at(-1);
  const snapshot = latest?.snapshot;
  noteCaptureTransition({
    generation: snapshot?.generation ?? 0,
    reason: reason === 'resume' ? 'wake-resume' : 'wake-unlock',
    beforeState: snapshot?.contextState ?? null,
    afterState: null,
    desiredMode: snapshot?.desiredMode ?? null,
    actualMode: snapshot?.actualMode ?? null,
    intent: snapshot?.intent ?? 'unknown',
    pollAgeMs: latest ? Math.max(0, performance.now() - latest.observedAt) : null
  });
}

export function noteCaptureTransition(event: CaptureTransitionEvent): void {
  const now = performance.now();
  const key = `${bounded(event.generation)}:${event.reason}:${state(event.beforeState)}:${state(event.afterState)}`;
  if (now - (transitions.get(key) ?? -Infinity) < 3000) return;
  if (
    emit('capture_transition', {
      schemaVersion: 1,
      generation: bounded(event.generation),
      reason: event.reason,
      beforeState: state(event.beforeState),
      afterState: state(event.afterState),
      desiredMode: mode(event.desiredMode),
      actualMode: mode(event.actualMode),
      intent: event.intent,
      pollAgeMs: event.pollAgeMs === null ? null : bounded(event.pollAgeMs)
    })
  )
    transitions.set(key, now);
}

export function noteCaptureRecovery(event: CaptureRecoveryEvent): void {
  const key = `${bounded(event.generation)}:${bounded(event.attempt)}`;
  if (terminalAttempts.has(key)) return;
  const latest = snapshots.at(-1)?.snapshot;
  if (
    emit(
      'capture_recovery',
      {
        schemaVersion: 1,
        generation: bounded(event.generation),
        attempt: bounded(event.attempt),
        reason: event.reason,
        action: event.action,
        outcome: event.outcome,
        durationMs: bounded(event.durationMs),
        actualMode: mode(event.actualMode),
        progress: event.progress,
        evidence: event.evidence,
        expectedMs: bounded(latest?.expectedMs ?? 0),
        deliveredMs: bounded(latest?.deliveredMs ?? 0),
        contextMs: bounded(latest?.contextMs ?? 0)
      },
      true,
      event.outcome === 'failed' || event.outcome === 'timed_out'
    )
  )
    terminalAttempts.add(key);
}

export function noteProcessingRelief(event: ProcessingReliefEvent): void {
  emit('processing_relief', {
    schemaVersion: 1,
    generation: bounded(event.generation),
    kind: event.kind,
    outcome: event.outcome,
    requestedMode: mode(event.requestedMode),
    actualMode: mode(event.actualMode),
    durationMs: bounded(event.durationMs)
  });
}
