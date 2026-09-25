import type { ErrorCode } from '@voice-room/shared/contracts/errors';
import crypto from 'node:crypto';

const CURSOR_CODEC_VERSION = 1;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONTEXT_BYTES = 512;
const MAX_PURPOSE_BYTES = 80;
const MIN_SECRET_BYTES = 32;

export type CursorTuple = { createdAtMicros: string; id: string };
type CursorKey = { id: string; current: boolean; secret: string };
type CursorPayload = { v: number; p: string; c: string; t: CursorTuple; iat: number; exp: number };

export type CursorCodec = {
  encode(input?: { purpose?: unknown; context?: unknown; tuple?: unknown; [key: string]: unknown }): string;
  decode(cursor: unknown, expected?: { purpose?: unknown; context?: unknown }): CursorTuple;
};

class CursorCodecError extends Error {
  declare code: ErrorCode;
  declare statusCode: number;

  constructor(message = 'Invalid cursor') {
    super(message);
    this.name = 'CursorCodecError';
    this.code = 'invalid_cursor';
    this.statusCode = 400;
  }
}

function base64urlEncode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function hmac(secret: string, value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function timingSafeEqualString(left: unknown, right: unknown): boolean {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeString(value: unknown, name: string, maxBytes: number): string {
  if (typeof value !== 'string') throw new CursorCodecError();
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw new CursorCodecError(`${name} is invalid`);
  }
  return normalized;
}

function normalizeMicrosecond(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^[0-9]{1,20}$/.test(value)) return value;
  throw new CursorCodecError();
}

function normalizeTuple(input: unknown): CursorTuple {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CursorCodecError();
  const tuple = input as Record<string, unknown>;
  const createdAtMicros = normalizeMicrosecond(tuple.createdAtMicros ?? tuple.micros ?? tuple.ts);
  const id = normalizeString(tuple.id ?? tuple.messageId, 'id', 160);
  return { createdAtMicros, id };
}

function normalizeKeys(keys: unknown): CursorKey[] {
  const rawKeys: unknown[] = Array.isArray(keys) ? keys : typeof keys === 'string' ? keys.split(',') : [];

  const normalized = rawKeys.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean);

  if (normalized.length === 0) throw new Error('At least one cursor HMAC key is required');

  return normalized.map((secret, index) => {
    const bytes = Buffer.byteLength(secret, 'utf8');
    if (bytes < MIN_SECRET_BYTES) throw new Error('Cursor HMAC keys must be at least 32 bytes');
    return {
      id: `k${index}`,
      current: index === 0,
      secret
    };
  });
}

function readCursorKeysFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.VOICE_ROOM_CURSOR_HMAC_KEYS || env.CURSOR_HMAC_KEYS || env.CURSOR_HMAC_KEY || '';
}

function makePayload({
  purpose,
  context,
  tuple,
  ttlMs,
  nowMs
}: {
  purpose: string;
  context: string;
  tuple: CursorTuple;
  ttlMs: number;
  nowMs: number;
}): CursorPayload {
  const issuedAtMs = Number.isFinite(nowMs) ? Math.trunc(nowMs) : Date.now();
  const expiresAtMs = issuedAtMs + ttlMs;
  return {
    v: CURSOR_CODEC_VERSION,
    p: purpose,
    c: sha256(context),
    t: tuple,
    iat: issuedAtMs,
    exp: expiresAtMs
  };
}

function createCursorCodec(
  options: { keys?: unknown; env?: NodeJS.ProcessEnv; ttlMs?: unknown; now?: unknown } = {}
): CursorCodec {
  const keys = normalizeKeys(options.keys ?? readCursorKeysFromEnv(options.env));
  const ttlMs =
    Number.isFinite(options.ttlMs) && (options.ttlMs as number) > 0
      ? Math.trunc(options.ttlMs as number)
      : DEFAULT_TTL_MS;
  const now: () => number = typeof options.now === 'function' ? (options.now as () => number) : Date.now;

  function encode(
    input: { purpose?: unknown; context?: unknown; tuple?: unknown; [key: string]: unknown } = {}
  ): string {
    const purpose = normalizeString(input.purpose, 'purpose', MAX_PURPOSE_BYTES);
    const context = normalizeString(input.context, 'context', MAX_CONTEXT_BYTES);
    const tuple = normalizeTuple(input.tuple ?? input);
    const payload = makePayload({ purpose, context, tuple, ttlMs, nowMs: now() });
    const body = base64urlEncode(JSON.stringify(payload));
    const key = keys[0]!;
    const signature = hmac(key.secret, body);
    return `${body}.${signature}`;
  }

  function decode(cursor: unknown, expected: { purpose?: unknown; context?: unknown } = {}): CursorTuple {
    try {
      const purpose = normalizeString(expected.purpose, 'purpose', MAX_PURPOSE_BYTES);
      const context = normalizeString(expected.context, 'context', MAX_CONTEXT_BYTES);
      if (typeof cursor !== 'string' || cursor.length > 4096) throw new CursorCodecError();

      const [body, signature, extra] = cursor.split('.');
      if (!body || !signature || extra !== undefined) throw new CursorCodecError();

      const verified = keys.some((key) => timingSafeEqualString(hmac(key.secret, body), signature));
      if (!verified) throw new CursorCodecError();

      const payload = JSON.parse(base64urlDecode(body)) as Partial<CursorPayload> | null;
      if (!payload || payload.v !== CURSOR_CODEC_VERSION) throw new CursorCodecError();
      if (payload.p !== purpose || payload.c !== sha256(context)) throw new CursorCodecError();
      if (!Number.isFinite(payload.exp) || Math.trunc(now()) > (payload.exp as number)) throw new CursorCodecError();

      return normalizeTuple(payload.t);
    } catch (error) {
      if (error instanceof CursorCodecError) throw error;
      throw new CursorCodecError();
    }
  }

  return { encode, decode };
}

export { CURSOR_CODEC_VERSION, CursorCodecError, createCursorCodec };
