// The web logger: a ring buffer for failure reports, a quiet production
// console, throttled reports, and redaction of secrets.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { freshImport } from '../helpers/fresh-module.ts';
import { Type } from 'typebox';
import { parse } from '../helpers/assert.ts';

const load = () => freshImport(() => import('../../src/shared/log.ts'));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('every level is kept for reports, and only the last hundred records are', async () => {
  const log = await load();
  const logger = log.createLogger('room');
  logger.debug('joining');
  logger.info('joined', { peers: 2 });
  expect(log.readLogBuffer().map((record) => [record.level, record.ns, record.msg])).toEqual([
    ['debug', 'room', 'joining'],
    ['info', 'room', 'joined']
  ]);

  for (let index = 0; index < 150; index += 1) logger.warn(`w${index}`);
  expect(log.readLogBuffer()).toHaveLength(100);
  expect(log.readLogBuffer().at(-1)?.msg).toBe('w149');
  logger.child('media').info('track added');
  expect(log.readLogBuffer().at(-1)).toMatchObject({ ns: 'room:media', msg: 'track added' });
});

test('secrets and URL queries are redacted from errors before they are kept', async () => {
  const log = await load();
  const context = log.errorContext(
    new Error(
      'connect failed wss://lk.example/rtc?access_token=abc&gate=vrg1.aaa.bbb token eyJhbGciOiJI.eyJzdWIiOiJ4In0.sig'
    )
  );
  expect(context.errorName).toBe('Error');
  expect(context.errorMessage).toBe('connect failed wss://lk.example/rtc?… token [redacted]');
});

test('a report sends the buffer with a page session id and no account id, then drops what was sent', async () => {
  const { calls } = stubFetch({ 'POST /api/client-logs': { body: { ok: true } } });
  const log = await load();
  log.createLogger('room').error('voice failed');

  await expect(log.reportClientLogs('join failed')).resolves.toBe(true);
  const body = parse(
    Type.Object({ sessionId: Type.String(), events: Type.Array(Type.Object({ msg: Type.String() })) }),
    calls[0]?.body
  );
  expect(body.sessionId).toMatch(/^web-/);
  expect(JSON.stringify(body)).not.toMatch(/userId/);
  expect(body.events.map((event) => event.msg)).toEqual(['voice failed', 'join failed']);
  expect(log.readLogBuffer()).toEqual([]);
});

test('reports are throttled and stop for good once the intake is switched off', async () => {
  const { calls } = stubFetch({ 'POST /api/client-logs': { status: 404 } });
  const log = await load();
  const logger = log.createLogger('room');
  logger.error('a');
  await log.reportClientLogs('first');
  logger.error('b');
  await expect(log.reportClientLogs('too soon')).resolves.toBe(false);
  await vi.advanceTimersByTimeAsync(31_000);
  await expect(log.reportClientLogs('after the intake said 404')).resolves.toBe(false);
  expect(calls).toHaveLength(1);
});

test('a report that cannot be delivered never throws and keeps the buffer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('offline');
    })
  );
  const log = await load();
  log.createLogger('room').error('a');
  await expect(log.reportClientLogs('x')).resolves.toBe(true);
  expect(log.readLogBuffer()).toHaveLength(1);
});

test('a report that never got out does not hold back the next one', async () => {
  const fetchMock = vi.fn(async () => {
    throw new TypeError('offline');
  });
  vi.stubGlobal('fetch', fetchMock);
  const log = await load();
  log.createLogger('room').error('a');
  await log.reportClientLogs('during the outage');

  const { calls } = stubFetch({ 'POST /api/client-logs': { body: { ok: true } } });
  await expect(log.reportClientLogs('connection back')).resolves.toBe(true);
  expect(calls).toHaveLength(1);
});

test('a report the server never answers gives up, and the one held behind it still goes out', async () => {
  const bodies: unknown[] = [];
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(init?.body);
    if (bodies.length > 1) return new Response('{}', { status: 202 });
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const log = await load();
  const logger = log.createLogger('room');
  logger.error('a');
  const hung = log.reportClientLogs('hangs');

  logger.error('b');
  await expect(log.reportClientLogs('held behind it')).resolves.toBe(false);
  await vi.advanceTimersByTimeAsync(15_000);
  await expect(hung).resolves.toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(15_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(log.readLogBuffer()).toEqual([]);
});

test('a report the throttle held back goes out once when the window ends', async () => {
  const { calls } = stubFetch({ 'POST /api/client-logs': { body: { ok: true } } });
  const log = await load();
  const logger = log.createLogger('room');
  logger.error('a');
  await log.reportClientLogs('first');

  logger.error('b');
  await expect(log.reportClientLogs('held')).resolves.toBe(false);
  logger.error('c');
  await expect(log.reportClientLogs('held too')).resolves.toBe(false);
  expect(calls).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(29_000);
  expect(calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1_500);
  expect(calls).toHaveLength(2);
  const body = parse(Type.Object({ events: Type.Array(Type.Object({ msg: Type.String() })) }), calls[1]?.body);
  expect(body.events.map((event) => event.msg)).toEqual(['b', 'c', 'held']);

  await vi.advanceTimersByTimeAsync(120_000);
  expect(calls).toHaveLength(2);
});

test('a successful recovery requests its own held upload after session metadata already flushed', async () => {
  const { calls } = stubFetch({ 'POST /api/client-logs': { body: { ok: true } } });
  const [log, diagnostics] = await freshImport(() =>
    Promise.all([import('../../src/shared/log.ts'), import('@/features/room/client/room/capture-diagnostics')])
  );
  diagnostics.startCaptureDiagnostics();
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(1);
  diagnostics.noteCaptureRecovery({
    generation: 1,
    attempt: 1,
    reason: 'watchdog',
    action: 'reopen',
    outcome: 'applied',
    durationMs: 500,
    actualMode: 'rnnoise',
    progress: 'capture_progress_restored',
    evidence: 'encoder_feed'
  });
  expect(log.readLogBuffer().some((record) => record.msg === 'capture_recovery')).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(calls).toHaveLength(2);
  diagnostics.stopCaptureDiagnostics();
});

test('uncaught errors and rejected promises are captured', async () => {
  const log = await load();
  log.installGlobalErrorCapture();
  window.dispatchEvent(
    new ErrorEvent('error', { message: 'boom', filename: 'https://voiceroom.ru/app.js?v=secret', lineno: 7 })
  );
  const rejection = Object.assign(new Event('unhandledrejection'), { reason: new Error('nope') });
  window.dispatchEvent(rejection);
  const records = log.readLogBuffer();
  expect(records.map((record) => record.msg)).toEqual(['uncaught error', 'unhandled rejection']);
  expect(records[0]?.ctx).toMatchObject({ errorMessage: 'boom', source: 'https://voiceroom.ru/app.js?…', line: 7 });
});

test('a failed API response is logged with the request id the server gave it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Нет доступа' }), { status: 403, headers: { 'x-request-id': 'req-42' } })
    )
  );
  const log = await load();
  log.clearLogBuffer();
  const { api } = await import('../../src/api/client.ts');
  const { Done } = await import('@voice-room/shared/contracts/http');
  await expect(api.get('/api/friends', Done)).rejects.toThrow('Нет доступа');
  const records = (await import('../../src/shared/log.ts')).readLogBuffer();
  expect(records.at(-1)).toMatchObject({
    level: 'warn',
    msg: 'api request failed',
    ctx: { url: '/api/friends', status: 403, requestId: 'req-42' }
  });
});

test('join outcomes survive throttling and diagnostic ring churn without error markers', async () => {
  const { calls } = stubFetch({ 'POST /api/client-logs': { body: { ok: true } } });
  const log = await load();
  log.reportVoiceJoinOutcome({ outcome: 'success', stage: 'connect', elapsedMs: 123 });
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  log.reportVoiceJoinOutcome({
    outcome: 'failure',
    stage: 'microphone',
    elapsedMs: 456,
    roomId: 'abc123',
    reportedGuestId: '11111111-1111-4111-8111-111111111111'
  });
  log.reportVoiceJoinOutcome({ outcome: 'cancel', stage: 'started', elapsedMs: 10 });
  for (let i = 0; i < 150; i += 1) log.createLogger('room').info('noise');
  await vi.advanceTimersByTimeAsync(31_000);
  expect(calls).toHaveLength(2);
  const body = parse(
    Type.Object({
      events: Type.Array(Type.Object({ level: Type.String(), msg: Type.String(), ctx: Type.Optional(Type.Unknown()) }))
    }),
    calls[1]?.body
  );
  expect(body.events.filter((event) => event.msg === 'voice join outcome').map((event) => event.ctx)).toEqual([
    {
      outcome: 'failure',
      stage: 'microphone',
      elapsedMs: 456,
      roomId: 'abc123',
      reportedGuestId: '11111111-1111-4111-8111-111111111111'
    },
    { outcome: 'cancel', stage: 'started', elapsedMs: 10 }
  ]);
  expect(body.events.at(-1)?.level).toBe('info');
});

test('pending outcome overflow is counted and newest outcomes drain in bounded batches', async () => {
  const bodies: string[] = [];
  let finishFirst: (response: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string') bodies.push(init.body);
      if (bodies.length === 1)
        return new Promise<Response>((resolve) => {
          finishFirst = resolve;
        });
      return Promise.resolve(new Response('{}', { status: 202 }));
    })
  );
  const log = await load();
  const logger = log.createLogger('room');
  logger.info('old diagnostic');
  const first = log.reportClientLogs('first');
  for (let i = 0; i < 150; i += 1) logger.info(`new diagnostic ${i}`);
  for (let i = 0; i < 101; i += 1) {
    log.reportVoiceJoinOutcome({ outcome: 'cancel', stage: 'started', elapsedMs: i });
  }
  finishFirst(new Response('{}', { status: 202 }));
  await first;
  expect(log.readLogBuffer()).toHaveLength(100);
  expect(log.readLogBuffer()[0]?.msg).toBe('new diagnostic 50');
  await vi.advanceTimersByTimeAsync(61_000);
  const schema = Type.Object({
    events: Type.Array(
      Type.Object({ msg: Type.String(), ctx: Type.Optional(Type.Record(Type.String(), Type.Unknown())) })
    )
  });
  const batches = bodies.map((body) => parse(schema, JSON.parse(body)));
  expect(batches).toHaveLength(3);
  expect(batches.every((batch) => batch.events.length <= 100)).toBe(true);
  expect(batches[1]?.events.at(-1)?.ctx).toEqual({ droppedJoinOutcomes: 1 });
  const outcomes = batches.flatMap((batch) => batch.events.filter((event) => event.msg === 'voice join outcome'));
  expect(outcomes.map((event) => event.ctx?.elapsedMs)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
});
