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

const CONSOLE_BY_LEVEL: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
};

export function createLogger(namespace: string, onRecord?: (record: ClientLogRecord) => void): Logger {
  const ns = namespace || 'ui';
  function record(level: LogLevel, msg: string, ctx?: LogContext): void {
    onRecord?.({ at: Date.now(), level, ns, msg, ctx });

    // Development shows everything. Production only prints warnings and errors.
    if (isDev || level === 'warn' || level === 'error') {
      CONSOLE_BY_LEVEL[level](`[${ns}] ${msg}`, ctx ?? '');
    }
  }

  return {
    debug: (msg, ctx) => record('debug', msg, ctx),
    info: (msg, ctx) => record('info', msg, ctx),
    warn: (msg, ctx) => record('warn', msg, ctx),
    error: (msg, ctx) => record('error', msg, ctx),
    child: (suffix) => createLogger(`${ns}:${suffix}`, onRecord)
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
