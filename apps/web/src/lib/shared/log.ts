export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, string | number | boolean | null>;

export interface ClientLogRecord {
  at: number;
  level: LogLevel;
  ns: string;
  msg: string;
  ctx?: LogContext;
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
    return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
})();

// The buffer is what makes a failure report useful: by the time a call drops,
// the interesting records (device enumeration, track state, reconnect attempts)
// are already minutes old. It is a ring so a long session cannot grow it.
const BUFFER_LIMIT = 100;
const buffer: ClientLogRecord[] = [];

// Matches CLIENT_LOG_RATE_LIMIT on the API with room to spare: a failing room
// must not turn one user's bad network into a flood of reports.
const FLUSH_INTERVAL_MS = 30_000;
let lastFlushAt = 0;
let flushInFlight: Promise<void> | null = null;
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
    return { ...extra, errorName: error.name, errorMessage: error.message };
  }
  return { ...extra, errorMessage: String(error) };
}

export function readLogBuffer(): readonly ClientLogRecord[] {
  return buffer.slice();
}

export function clearLogBuffer(): void {
  buffer.length = 0;
}

// Sends what the page has seen so far. Called when something actually failed —
// not on a timer — so the log stream carries reports, not telemetry.
export async function reportClientLogs(reason: string): Promise<boolean> {
  if (!browser || !intakeAvailable || buffer.length === 0) return false;
  const at = Date.now();
  if (at - lastFlushAt < FLUSH_INTERVAL_MS) return false;
  if (flushInFlight) return false;

  lastFlushAt = at;
  const events = buffer.slice();
  events.push({ at, level: 'error', ns: 'report', msg: reason });

  flushInFlight = (async () => {
    try {
      const response = await fetch('/api/client-logs', {
        body: JSON.stringify({ sessionId, events }),
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        method: 'POST'
      });
      if (response.status === 404) intakeAvailable = false;
      // Delivered records are dropped so a later report carries what happened
      // since, not a second copy of what the log stream already holds. Only
      // the records this report sent are removed: anything logged while the
      // request was in flight belongs to the next one.
      if (response.ok) buffer.splice(0, events.length - 1);
      // A report that fails must never surface to the user or break the flow
      // that was already going wrong.
    } catch {
      // Offline or blocked: the buffer stays for the next attempt.
    } finally {
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
      errorMessage: String(event.message || ''),
      source: String(event.filename || ''),
      line: Number(event.lineno) || 0
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    log.error('unhandled rejection', errorContext(event.reason));
  });
}
