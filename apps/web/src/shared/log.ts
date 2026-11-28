import {
  createLogger as createUiLogger,
  errorContext,
  redactForLog,
  type ClientLogRecord,
  type Logger,
  type LogLevel
} from '@voiceroom/ui/log';
import {
  DIAGNOSTICS_JOIN_EVENT,
  DIAGNOSTICS_LOG_LIMIT,
  type DiagnosticsJoinOutcome,
  type DiagnosticsJoinStage
} from '@voiceroom/shared/contracts/diagnostics';

export { errorContext, redactForLog };
export type { ClientLogRecord, LogContext, Logger, LogLevel } from '@voiceroom/ui/log';

const browser = typeof window !== 'undefined' && typeof document !== 'undefined';

// The buffer is what makes a failure report useful: by the time a call drops,
// the interesting records (device enumeration, track state, reconnect attempts)
// are already minutes old. It is a ring so a long session cannot grow it.
const REPORT_LIMIT = 100;
const buffer: ClientLogRecord[] = [];
const pending: ClientLogRecord[] = [];
// The intake keeps join outcomes in its own delivery queue, with a cap to
// bound memory offline and an overflow count for the next batch.
const joinOutcomes: ClientLogRecord[] = [];
let droppedJoinOutcomes = 0;

export function reportVoiceJoinOutcome(ctx: {
  outcome: DiagnosticsJoinOutcome;
  elapsedMs: number;
  stage: DiagnosticsJoinStage;
  roomId?: string;
  /** Client-reported correlation only, never an authenticated identity. */
  reportedGuestId?: string;
}): void {
  if (joinOutcomes.length === REPORT_LIMIT) {
    joinOutcomes.shift();
    droppedJoinOutcomes += 1;
  }
  const record: ClientLogRecord = { at: Date.now(), level: 'info', ns: 'room', msg: DIAGNOSTICS_JOIN_EVENT, ctx };
  joinOutcomes.push(record);
  const { outcome, stage, elapsedMs } = ctx;
  appendToBuffer({ ...record, ctx: { outcome, stage, elapsedMs } });
  void reportClientLogs('voice join outcomes flush', 'info');
}

// Matches CLIENT_LOG_RATE_LIMIT on the API with room to spare: a failing room
// must not turn one user's bad network into a flood of reports.
const FLUSH_INTERVAL_MS = 30_000;
// A server that accepts the request and never answers must not hold back every later report.
const REPORT_TIMEOUT_MS = 15_000;
let lastFlushAt = 0;
let flushInFlight: Promise<void> | null = null;
// A report the throttle held back goes out when the window ends, since nothing
// else may ever send one.
let heldReport: ReturnType<typeof setTimeout> | null = null;
// The intake route answers 404 when an operator has not enabled it. Rather than
// plumb a capability flag to the client, the first 404 stops further attempts
// for the life of the page.
let intakeAvailable = true;

// One id per page load ties the records of a single session together across
// several reports without identifying the person.
const sessionId = browser ? `web-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}` : '';

function appendToBuffer(record: ClientLogRecord): void {
  buffer.push(record);
  while (buffer.length > DIAGNOSTICS_LOG_LIMIT) buffer.shift();
}

function appendRecord(record: ClientLogRecord): void {
  appendToBuffer(record);
  pending.push(record);
  while (pending.length > REPORT_LIMIT) pending.shift();
}

export function createLogger(namespace: string): Logger {
  return createUiLogger(namespace || 'web', appendRecord);
}

export function readLogBuffer(): readonly ClientLogRecord[] {
  return buffer.slice();
}

export function clearLogBuffer(): void {
  buffer.length = 0;
  pending.length = 0;
}

// Sends diagnostics and pending join outcomes through the bounded intake.
export async function reportClientLogs(reason: string, level: LogLevel = 'error'): Promise<boolean> {
  if (!browser || !intakeAvailable || (pending.length === 0 && joinOutcomes.length === 0)) return false;
  const at = Date.now();
  const sinceLast = at - lastFlushAt;
  if (flushInFlight || sinceLast < FLUSH_INTERVAL_MS) {
    heldReport ??= setTimeout(
      () => {
        heldReport = null;
        void reportClientLogs(reason, level);
      },
      flushInFlight ? FLUSH_INTERVAL_MS : FLUSH_INTERVAL_MS - sinceLast
    );
    return false;
  }

  const outcomes = joinOutcomes.slice(0, REPORT_LIMIT - 1);
  const diagnostics = pending.slice(Math.max(0, pending.length - (REPORT_LIMIT - 1 - outcomes.length)));
  const dropped = droppedJoinOutcomes;
  const events = [...outcomes, ...diagnostics];
  events.push({ at, level, ns: 'report', msg: reason, ...(dropped ? { ctx: { droppedJoinOutcomes: dropped } } : {}) });

  flushInFlight = (async () => {
    const controller = new AbortController();
    const giveUp = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
    try {
      const response = await fetch('/api/client-logs', {
        body: JSON.stringify({ sessionId, events }),
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal
      });
      // Only an answer uses up the window: a report that never got out says
      // nothing about the server's limit, and the next one should not wait.
      lastFlushAt = at;
      if (response.status === 404) intakeAvailable = false;
      // Delivered records are dropped so a later report carries what happened
      // since, not a second copy of what the log stream already holds. Only
      // the records this report sent are removed: anything logged while the
      // request was in flight belongs to the next one.
      if (response.ok) {
        for (const event of diagnostics) {
          const index = pending.indexOf(event);
          if (index !== -1) pending.splice(index, 1);
        }
        for (const event of outcomes) {
          const index = joinOutcomes.indexOf(event);
          if (index !== -1) joinOutcomes.splice(index, 1);
        }
        droppedJoinOutcomes -= dropped;
        if (joinOutcomes.length) void reportClientLogs('voice join outcomes flush', 'info');
      }
      // A report that fails must never surface to the user or break the flow
      // that was already going wrong.
    } catch {
      // Offline or blocked: the buffer stays for the next attempt.
    } finally {
      clearTimeout(giveUp);
      flushInFlight = null;
    }
  })();

  await flushInFlight;
  return true;
}

let globalCaptureInstalled = false;

// Uncaught errors and rejected promises are the failures nobody wrote a log
// line for, which is exactly why they are worth capturing.
export function installGlobalErrorCapture(): void {
  if (!browser || globalCaptureInstalled) return;
  globalCaptureInstalled = true;
  const log = createLogger('window');

  window.addEventListener('error', (event) => {
    log.error('uncaught error', {
      errorMessage: redactForLog(String(event.message || '')),
      source: redactForLog(String(event.filename || '')),
      line: Number(event.lineno) || 0
    });
  });

  // The DOM types the reason as any; it is whatever the promise rejected with.
  window.addEventListener('unhandledrejection', (event: { reason: unknown }) => {
    log.error('unhandled rejection', errorContext(event.reason));
  });
}
