'use strict';

const crypto = require('node:crypto');

const CURSOR_CODEC_VERSION = 1;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONTEXT_BYTES = 512;
const MAX_PURPOSE_BYTES = 80;
const MIN_SECRET_BYTES = 32;

class CursorCodecError extends Error {
  constructor(message = 'Invalid cursor') {
    super(message);
    this.name = 'CursorCodecError';
    this.code = 'invalid_cursor';
    this.statusCode = 400;
  }
}

function base64urlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64urlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeString(value, name, maxBytes) {
  if (typeof value !== 'string') throw new CursorCodecError();
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw new CursorCodecError(`${name} is invalid`);
  }
  return normalized;
}

function normalizeMicrosecond(value) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^[0-9]{1,20}$/.test(value)) return value;
  throw new CursorCodecError();
}

function normalizeTuple(tuple) {
  if (!tuple || typeof tuple !== 'object' || Array.isArray(tuple)) throw new CursorCodecError();
  const createdAtMicros = normalizeMicrosecond(tuple.createdAtMicros ?? tuple.micros ?? tuple.ts);
  const id = normalizeString(tuple.id ?? tuple.messageId, 'id', 160);
  return { createdAtMicros, id };
}

function normalizeKeys(keys) {
  const rawKeys = Array.isArray(keys)
    ? keys
    : typeof keys === 'string'
      ? keys.split(',')
      : [];

  const normalized = rawKeys
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

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

function readCursorKeysFromEnv(env = process.env) {
  return env.VOICE_ROOM_CURSOR_HMAC_KEYS || env.CURSOR_HMAC_KEYS || env.CURSOR_HMAC_KEY || '';
}

function makePayload({ purpose, context, tuple, ttlMs, nowMs }) {
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

function createCursorCodec(options = {}) {
  const keys = normalizeKeys(options.keys ?? readCursorKeysFromEnv(options.env));
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0
    ? Math.trunc(options.ttlMs)
    : DEFAULT_TTL_MS;
  const now = typeof options.now === 'function' ? options.now : Date.now;

  function encode(input = {}) {
    const purpose = normalizeString(input.purpose, 'purpose', MAX_PURPOSE_BYTES);
    const context = normalizeString(input.context, 'context', MAX_CONTEXT_BYTES);
    const tuple = normalizeTuple(input.tuple ?? input);
    const payload = makePayload({ purpose, context, tuple, ttlMs, nowMs: now() });
    const body = base64urlEncode(JSON.stringify(payload));
    const key = keys[0];
    const signature = hmac(key.secret, body);
    return `${body}.${signature}`;
  }

  function decode(cursor, expected = {}) {
    try {
      const purpose = normalizeString(expected.purpose, 'purpose', MAX_PURPOSE_BYTES);
      const context = normalizeString(expected.context, 'context', MAX_CONTEXT_BYTES);
      if (typeof cursor !== 'string' || cursor.length > 4096) throw new CursorCodecError();

      const [body, signature, extra] = cursor.split('.');
      if (!body || !signature || extra !== undefined) throw new CursorCodecError();

      const verified = keys.some((key) => timingSafeEqualString(hmac(key.secret, body), signature));
      if (!verified) throw new CursorCodecError();

      const payload = JSON.parse(base64urlDecode(body));
      if (!payload || payload.v !== CURSOR_CODEC_VERSION) throw new CursorCodecError();
      if (payload.p !== purpose || payload.c !== sha256(context)) throw new CursorCodecError();
      if (!Number.isFinite(payload.exp) || Math.trunc(now()) > payload.exp) throw new CursorCodecError();

      return normalizeTuple(payload.t);
    } catch (error) {
      if (error instanceof CursorCodecError) throw error;
      throw new CursorCodecError();
    }
  }

  return { encode, decode };
}

module.exports = {
  CURSOR_CODEC_VERSION,
  CursorCodecError,
  createCursorCodec
};
