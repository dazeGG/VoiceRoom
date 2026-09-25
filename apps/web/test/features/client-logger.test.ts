// The web logger: a ring buffer for failure reports, a quiet production
// console, throttled reports, and redaction of secrets.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { freshImport } from '../helpers/fresh-module.ts';
import type * as LogModule from '../../src/lib/shared/log.ts';

const load = () => freshImport<typeof LogModule>('/src/lib/shared/log.ts');

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
  const body = calls[0]?.body as { sessionId: string; events: Array<{ msg: string }> };
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

test('uncaught errors and rejected promises are captured', async () => {
  const log = await load();
  log.installGlobalErrorCapture();
  window.dispatchEvent(
    new ErrorEvent('error', { message: 'boom', filename: 'https://voiceroom.ru/app.js?v=secret', lineno: 7 })
  );
  const rejection = new Event('unhandledrejection') as Event & { reason: unknown };
  rejection.reason = new Error('nope');
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
  const http = await import('../../src/lib/api/http.ts');
  await expect(http.getJsonAuth('/api/friends')).rejects.toThrow('Нет доступа');
  const records = (await import('../../src/lib/shared/log.ts')).readLogBuffer();
  expect(records.at(-1)).toMatchObject({
    level: 'warn',
    msg: 'api request failed',
    ctx: { url: '/api/friends', status: 403, requestId: 'req-42' }
  });
});
