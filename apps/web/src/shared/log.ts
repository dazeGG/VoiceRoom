export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, string | number | boolean | null>;

export interface ClientLogRecord {
  at: number;
  level: LogLevel;
  ns: string;
  msg: string;
  ctx?: LogContext | undefined;
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(suffix: string): Logger;
}

// A logging primitive must be importable from anywhere, including the platform
// modules that unit tests load directly under Node, so the environment is read
// from the runtime rather than from SvelteKit's `$app/environment`.
const browser = typeof window !== 'undefined' && typeof document !== 'undefined';

// `import.meta.env` is injected by Vite and absent under a plain Node import.
const isDev = ((): boolean => {
  try {
    // Narrowed by hand: the scripts project imports this file without Vite's types.
    const meta: object = import.meta;
    const env = 'env' in meta ? meta.env : undefined;
    return typeof env === 'object' && env !== null && 'DEV' in env && env.DEV === true;
  } catch {
    return false;
  }
})();

// The buffer is what makes a failure report useful: by the time a call drops,
// the interesting records (device enumeration, track state, reconnect attempts)
// are already minutes old. It is a ring so a long session cannot grow it.
const BUFFER_LIMIT = 100;
const buffer: ClientLogRecord[] = [];
// Join outcomes are kept apart from the diagnostic ring until sent. The cap
// bounds memory offline; overflow is made visible in a later report.
const joinOutcomes: ClientLogRecord[] = [];
let droppedJoinOutcomes = 0;

export function reportVoiceJoinOutcome(ctx: {
  outcome: 'success' | 'failure' | 'cancel';
  elapsedMs: number;
  stage: 'started' | 'microphone' | 'token' | 'connect' | 'publish';
}): void {
  if (joinOutcomes.length === BUFFER_LIMIT) {
    joinOutcomes.shift();
    droppedJoinOutcomes += 1;
  }
  joinOutcomes.push({ at: Date.now(), level: 'info', ns: 'room', msg: 'voice join outcome', ctx });
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

const CONSOLE_BY_LEVEL: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
};

function record(level: LogLevel, ns: string, msg: string, ctx?: LogContext): void {
  buffer.push({ at: Date.now(), level, ns, msg, ctx });
  while (buffer.length > BUFFER_LIMIT) buffer.shift();

  // Development shows everything; a production console keeps only what a user
  // or a support session would actually be asked to read back.
  if (isDev || level === 'warn' || level === 'error') {
    CONSOLE_BY_LEVEL[level](`[${ns}] ${msg}`, ctx ?? '');
  }
}

export function createLogger(namespace: string): Logger {
  const ns = namespace || 'web';
  return {
    debug: (msg, ctx) => record('debug', ns, msg, ctx),
    info: (msg, ctx) => record('info', ns, msg, ctx),
    warn: (msg, ctx) => record('warn', ns, msg, ctx),
    error: (msg, ctx) => record('error', ns, msg, ctx),
    child: (suffix) => createLogger(`${ns}:${suffix}`)
  };
}

// Turns an unknown thrown value into fields a log record can carry. DOM media
// errors are the ones that matter here, and their `name` is the whole
// diagnosis (NotAllowedError vs NotReadableError vs OverconstrainedError).
export function errorContext(error: unknown, extra: LogContext = {}): LogContext {
  if (error instanceof Error) {
    return { ...extra, errorName: error.name, errorMessage: redactForLog(error.message) };
  }
  return { ...extra, errorMessage: redactForLog(String(error)) };
}

// Error text quotes URLs, and the LiveKit connect URL carries the JWT and the
// gate credential in its query. The intake strips these too; doing it here
// keeps them out of the in-page buffer and anything that copies it.
const URL_QUERY_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi;
const SECRET_PATTERN =
  /\b(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*|vrg1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;

export function redactForLog(text: string): string {
  return text.replace(URL_QUERY_PATTERN, '$1?…').replace(SECRET_PATTERN, '[redacted]');
}

export function readLogBuffer(): readonly ClientLogRecord[] {
  return buffer.slice();
}

export function clearLogBuffer(): void {
  buffer.length = 0;
}

// Sends diagnostics and pending join outcomes through the bounded intake.
export async function reportClientLogs(reason: string, level: LogLevel = 'error'): Promise<boolean> {
  if (!browser || !intakeAvailable || (buffer.length === 0 && joinOutcomes.length === 0)) return false;
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

  const outcomes = joinOutcomes.slice(0, BUFFER_LIMIT - 1);
  const diagnostics = buffer.slice(-(BUFFER_LIMIT - 1 - outcomes.length));
  // slice(-0) returns the whole array.
  if (outcomes.length === BUFFER_LIMIT - 1) diagnostics.length = 0;
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
          const index = buffer.indexOf(event);
          if (index !== -1) buffer.splice(index, 1);
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
