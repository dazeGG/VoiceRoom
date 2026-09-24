// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOG_EVENTS, LOG_EVENT_CODES } from '../src/lib/log-events.ts';
import {
  createFastifyLoggerOptions,
  createLogger,
  getLogLevel,
  hashIp,
  normalizeRequestId
} from '../src/lib/logger.ts';
import { CLIENT_LOG_LIMITS, normalizeClientLogBatch } from '../src/lib/client-log-intake.ts';

// Captures what a logger actually serializes, which is the only way to assert
// on redaction: the fields are removed by pino at write time, not before.
function captureLogger(options = {}) {
  const records = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      records.push(JSON.parse(String(chunk)));
      done();
    }
  });
  const logger = createLogger({ env: { LOG_LEVEL: 'trace' }, destination, ...options });
  return { logger, records };
}

test('every declared log event code is unique', () => {
  assert.equal(new Set(LOG_EVENT_CODES).size, LOG_EVENT_CODES.length);
});

test('log event codes follow the domain.event naming convention', () => {
  for (const code of LOG_EVENT_CODES) {
    assert.match(code, /^[a-z]+\.[a-z0-9_]+$/, `${code} is not <domain>.<event>`);
  }
});

test('the logger redacts credentials and personal identifiers at any depth', () => {
  const { logger, records } = captureLogger();
  logger.info({
    evt: LOG_EVENTS.HTTP_REQUEST,
    password: 'hunter2',
    sessionToken: 'abc',
    email: 'someone@example.com',
    nested: { token: 'xyz', email: 'other@example.com', roomId: 'r-1' }
  }, 'probe');

  const [record] = records;
  assert.equal(records.length, 1);
  assert.equal(record.password, undefined);
  assert.equal(record.sessionToken, undefined);
  assert.equal(record.email, undefined);
  assert.equal(record.nested.token, undefined);
  assert.equal(record.nested.email, undefined);
  // Redaction must not swallow the fields that make the record useful.
  assert.equal(record.nested.roomId, 'r-1');
  assert.equal(record.evt, LOG_EVENTS.HTTP_REQUEST);
});

test('the logger stamps the service, version and environment on every record', () => {
  const { logger, records } = captureLogger({ name: 'worker.media-processing' });
  logger.warn({ evt: LOG_EVENTS.MEDIA_JOB_FAILED }, 'probe');

  assert.equal(records[0].service, 'worker.media-processing');
  assert.equal(typeof records[0].version, 'string');
  assert.ok(records[0].version.length > 0);
});

test('an error passed as err is serialized with its type and stack', () => {
  const { logger, records } = captureLogger();
  const error = new TypeError('boom');
  logger.error({ evt: LOG_EVENTS.WS_MESSAGE_FAILED, err: error }, 'probe');

  assert.equal(records[0].err.type, 'TypeError');
  assert.equal(records[0].err.message, 'boom');
  assert.ok(records[0].err.stack.includes('boom'));
});

test('getLogLevel defaults to info in production and silent elsewhere', () => {
  assert.equal(getLogLevel({ NODE_ENV: 'production' }), 'info');
  assert.equal(getLogLevel({ NODE_ENV: 'development' }), 'silent');
  assert.equal(getLogLevel({ LOG_LEVEL: 'debug', NODE_ENV: 'production' }), 'debug');
});

test('createFastifyLoggerOptions turns logging off for the disabled levels', () => {
  assert.equal(createFastifyLoggerOptions({ LOG_LEVEL: 'silent' }), false);
  assert.equal(createFastifyLoggerOptions({ LOG_LEVEL: 'off' }), false);
  assert.equal(createFastifyLoggerOptions({ LOG_LEVEL: 'info' }).level, 'info');
});

test('an inbound request id is reused only when it is safe to log', () => {
  assert.equal(normalizeRequestId('req-abc.123_X'), 'req-abc.123_X');
  assert.equal(normalizeRequestId(['first', 'second']), 'first');
  // Anything that could forge a log line or inflate a record is discarded.
  assert.equal(normalizeRequestId('bad\nid'), '');
  assert.equal(normalizeRequestId('a'.repeat(65)), '');
  assert.equal(normalizeRequestId(''), '');
  assert.equal(normalizeRequestId(undefined), '');
});

test('hashed client addresses are stable within a process and never reversible', () => {
  const hash = hashIp('203.0.113.7');
  assert.equal(hash, hashIp('203.0.113.7'));
  assert.notEqual(hash, hashIp('203.0.113.8'));
  assert.ok(!hash.includes('203'));
  assert.equal(hashIp(''), 'unknown');
});

// Fastify binds reqId to the per-request child logger, so passing it again at
// the call site emits the key twice in one JSON record. The values match, but
// it lands in every request record and strict ingesters reject duplicate keys.
test('a bound request id is not repeated at the call site', () => {
  const { logger, records } = captureLogger();
  const child = logger.child({ reqId: 'abc' });
  child.info({ evt: LOG_EVENTS.HTTP_REQUEST, route: '/probe' }, 'probe');

  assert.equal(records[0].reqId, 'abc');
  const line = JSON.stringify(records[0]);
  assert.equal(line.match(/"reqId"/g).length, 1);
});

test('no handler adds reqId to a record the request logger already binds', () => {
  const source = readFileSync(join(import.meta.dirname, '../src/server.ts'), 'utf8');
  const offenders = source
    .split(String.fromCharCode(10))
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => /^\s*reqId:\s*(req\?\.id|request\.id)\s*,?\s*$/.test(line))
    .map(([number]) => number);

  assert.deepEqual(offenders, [], `server.ts repeats a bound reqId on lines: ${offenders.join(', ')}`);
});

test('client log intake keeps well-formed records and reports the rest as dropped', () => {
  const now = Date.now();
  const batch = normalizeClientLogBatch({
    sessionId: 'web-abc123',
    events: [
      { at: now, level: 'error', ns: 'room:mic', msg: 'getUserMedia failed', ctx: { code: 'NotAllowedError' } },
      { level: 'warn', ns: 'room:screen-share' },
      null,
      'not an object',
      {}
    ]
  }, { now });

  assert.equal(batch.sessionId, 'web-abc123');
  assert.equal(batch.events.length, 2);
  assert.equal(batch.dropped, 3);
  assert.equal(batch.events[0].level, 'error');
  assert.equal(batch.events[0].ctx.code, 'NotAllowedError');
  // A record with only a namespace still names something, so it survives.
  assert.equal(batch.events[1].msg, 'room:screen-share');
});

test('client log intake caps the batch, the message and the context', () => {
  const events = Array.from({ length: CLIENT_LOG_LIMITS.maxEvents + 25 }, () => ({ ns: 'room', msg: 'x' }));
  const overflow = normalizeClientLogBatch({ events });
  assert.equal(overflow.events.length, CLIENT_LOG_LIMITS.maxEvents);
  assert.equal(overflow.dropped, 25);

  const context = Object.fromEntries(
    Array.from({ length: CLIENT_LOG_LIMITS.maxContextKeys + 5 }, (_value, index) => [`k${index}`, index])
  );
  const [event] = normalizeClientLogBatch({
    events: [{ ns: 'room', msg: 'y'.repeat(500), ctx: context }]
  }).events;
  assert.equal(event.msg.length, CLIENT_LOG_LIMITS.maxMessageChars);
  assert.equal(Object.keys(event.ctx).length, CLIENT_LOG_LIMITS.maxContextKeys);
});

test('client log intake refuses values that could forge or inflate a record', () => {
  const [event] = normalizeClientLogBatch({
    events: [{
      ns: 'room',
      level: 'fatal',
      msg: 'line one\nlevel=30 forged',
      ctx: { nested: { deep: true }, list: [1, 2], ok: 'kept' }
    }]
  }).events;

  // An unknown level must not become a level the alerting treats as louder.
  assert.equal(event.level, 'info');
  assert.ok(!event.msg.includes('\n'));
  assert.deepEqual(Object.keys(event.ctx), ['ok']);
});

test('client log intake rejects a namespace or session id with unexpected characters', () => {
  const batch = normalizeClientLogBatch({
    sessionId: 'web abc!',
    events: [{ ns: 'room mic', msg: 'still kept' }]
  });
  assert.equal(batch.sessionId, '');
  assert.equal(batch.events[0].ns, 'web');
});

test('client log intake marks a replayed buffer as stale and pulls back a future clock', () => {
  const now = Date.now();
  const batch = normalizeClientLogBatch({
    events: [
      { ns: 'room', msg: 'old', at: now - CLIENT_LOG_LIMITS.maxAgeMs - 1000 },
      { ns: 'room', msg: 'ahead', at: now + 60_000 }
    ]
  }, { now });

  assert.equal(batch.events[0].stale, true);
  assert.equal(batch.events[1].at, now);
  assert.equal(batch.events[1].stale, false);
});

test('client log intake strips URL queries and masks tokens before they reach the log', () => {
  const now = Date.now();
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwZWVyLWEifQ.c2lnbmF0dXJl';
  const batch = normalizeClientLogBatch({
    events: [{
      at: now,
      level: 'error',
      ns: 'room:livekit',
      msg: `could not connect to wss://livekit.example/rtc?access_token=${jwt}&vr_gate_credential=vrg1.abc.def`,
      ctx: { errorMessage: `token ${jwt} rejected`, credential: 'vrg1.payload.signature', page: 'https://app.example/room/abc#frag' }
    }]
  }, { now });

  const [event] = batch.events;
  assert.equal(event.msg, 'could not connect to wss://livekit.example/rtc?…');
  assert.equal(event.ctx.errorMessage, 'token [redacted] rejected');
  assert.equal(event.ctx.credential, '[redacted]');
  assert.equal(event.ctx.page, 'https://app.example/room/abc?…');
});
