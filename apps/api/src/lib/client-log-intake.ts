// Browser-sourced log records are untrusted input on a public route: they set
// the size of the log stream, and whatever they carry ends up in the same
// storage as server records. Everything here is therefore a hard cap applied
// before a record is emitted, never a best effort applied after.
const CLIENT_LOG_LIMITS = Object.freeze({
  maxEvents: 100,
  maxMessageChars: 200,
  maxNamespaceChars: 64,
  maxContextKeys: 12,
  maxContextKeyChars: 32,
  maxContextValueChars: 200,
  maxSessionIdChars: 64,
  // Records older than this are a stale buffer replayed after the fact; they
  // are kept but stamped, so they are not mistaken for a live incident.
  maxAgeMs: 30 * 60 * 1000
});

const CLIENT_LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error'] as const);

export type ClientLogLevel = (typeof CLIENT_LOG_LEVELS)[number];
export type ClientLogContext = Record<string, string | number | boolean | null>;
export type ClientLogEvent = { level: ClientLogLevel; ns: string; msg: string; at: number; stale: boolean; ctx: ClientLogContext | undefined };
type RawClientLogEvent = { msg?: unknown; message?: unknown; ns?: unknown; namespace?: unknown; at?: unknown; level?: unknown; ctx?: unknown; context?: unknown };
const NAMESPACE_PATTERN = /^[A-Za-z0-9:._-]+$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

// Browser errors quote URLs, and URLs here carry secrets in their query: the
// LiveKit connect URL holds both the JWT and the gate credential. Queries and
// fragments are dropped, and anything shaped like a JWT or gate credential is
// masked wherever it appears.
const URL_QUERY_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi;
const SECRET_PATTERN = /\b(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*|vrg1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;

function redactSecrets(text: string): string {
  return text.replace(URL_QUERY_PATTERN, '$1?…').replace(SECRET_PATTERN, '[redacted]');
}

function cleanText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  // Control characters would let a caller forge extra lines in a line-delimited
  // log stream, so they are stripped rather than escaped.
  return redactSecrets(value.replace(/[\u0000-\u001f\u007f]/g, ' ')).trim().slice(0, maxChars);
}

function cleanSessionId(value: unknown): string {
  const text = cleanText(value, CLIENT_LOG_LIMITS.maxSessionIdChars);
  return SESSION_ID_PATTERN.test(text) ? text : '';
}

function cleanNamespace(value: unknown): string {
  const text = cleanText(value, CLIENT_LOG_LIMITS.maxNamespaceChars);
  return NAMESPACE_PATTERN.test(text) ? text : '';
}

function cleanLevel(value: unknown): ClientLogLevel {
  const text = String(value || '').toLowerCase();
  return (CLIENT_LOG_LEVELS as readonly string[]).includes(text) ? text as ClientLogLevel : 'info';
}

// Only primitives survive. An object or array would let a caller nest an
// arbitrarily large structure into one record, and a function or symbol has no
// meaning once serialized.
function cleanContext(value: unknown): ClientLogContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const context: ClientLogContext = {};
  let keys = 0;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (keys >= CLIENT_LOG_LIMITS.maxContextKeys) break;
    const key = cleanText(rawKey, CLIENT_LOG_LIMITS.maxContextKeyChars);
    if (!key || !NAMESPACE_PATTERN.test(key)) continue;
    if (typeof rawValue === 'string') context[key] = cleanText(rawValue, CLIENT_LOG_LIMITS.maxContextValueChars);
    else if (typeof rawValue === 'number') context[key] = Number.isFinite(rawValue) ? rawValue : 0;
    else if (typeof rawValue === 'boolean' || rawValue === null) context[key] = rawValue;
    else continue;
    keys += 1;
  }
  return keys > 0 ? context : undefined;
}

function cleanTimestamp(value: unknown, now: number): { at: number; stale: boolean } {
  const at = Number(value);
  if (!Number.isFinite(at) || at <= 0) return { at: now, stale: false };
  // A clock ahead of the server is common enough that a future stamp is pulled
  // back rather than dropped; the record is still worth having.
  if (at > now) return { at: now, stale: false };
  return { at, stale: now - at > CLIENT_LOG_LIMITS.maxAgeMs };
}

function normalizeClientLogEvent(input: unknown, now: number): ClientLogEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as RawClientLogEvent;
  const message = cleanText(raw.msg ?? raw.message, CLIENT_LOG_LIMITS.maxMessageChars);
  const namespace = cleanNamespace(raw.ns ?? raw.namespace);
  // A record with neither a message nor a namespace names nothing and would
  // only add volume.
  if (!message && !namespace) return null;
  const { at, stale } = cleanTimestamp(raw.at, now);
  return {
    level: cleanLevel(raw.level),
    ns: namespace || 'web',
    msg: message || namespace,
    at,
    stale,
    ctx: cleanContext(raw.ctx ?? raw.context)
  };
}

// Returns the records worth emitting plus how many were discarded, so the
// intake can report a caller sending malformed batches instead of silently
// dropping them.
function normalizeClientLogBatch(body: unknown, { now = Date.now() }: { now?: number } = {}): { sessionId: string; events: ClientLogEvent[]; dropped: number } {
  const source = (body && typeof body === 'object' ? body : {}) as { events?: unknown; sessionId?: unknown };
  const rawEvents: unknown[] = Array.isArray(source.events) ? source.events : [];
  const considered = rawEvents.slice(0, CLIENT_LOG_LIMITS.maxEvents);
  const events: ClientLogEvent[] = [];
  for (const raw of considered) {
    const event = normalizeClientLogEvent(raw, now);
    if (event) events.push(event);
  }
  return {
    sessionId: cleanSessionId(source.sessionId),
    events,
    // Both the records that failed validation and the ones past the batch cap.
    dropped: rawEvents.length - events.length
  };
}

export { CLIENT_LOG_LEVELS, CLIENT_LOG_LIMITS, normalizeClientLogBatch, normalizeClientLogEvent };
