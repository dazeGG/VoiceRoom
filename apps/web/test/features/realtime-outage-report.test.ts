// The server cannot log connections that never reached it, so the page reports
// how long it could not get through, once it gets through again.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Type } from 'typebox';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { stubFetch } from '../fixtures/fetch.ts';
import { parse } from '../helpers/assert.ts';
import { freshImport, muteWarnings } from '../helpers/fresh-module.ts';

const ReportBody = Type.Object({
  events: Type.Array(
    Type.Object({
      msg: Type.String(),
      ns: Type.String(),
      level: Type.String(),
      ctx: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
    })
  )
});

const cleanups: Array<() => void> = [];

async function start() {
  installFakeWebSocket();
  muteWarnings();
  const { calls } = stubFetch({ '/api/client-logs': { status: 202, body: { ok: true } } });
  const realtime = await freshImport(() => import('../../src/api/realtime.ts'));
  cleanups.push(realtime.getAppRealtime().subscribe(() => {}));
  return () =>
    calls
      .filter((call) => call.url === '/api/client-logs')
      .flatMap((call) => parse(ReportBody, call.body).events)
      .filter((event) => event.ns === 'realtime');
}

// Each reconnect fires within the backoff's cap of 8 seconds.
const nextAttempt = () => vi.advanceTimersByTimeAsync(8_000);

async function failAttempts(count: number) {
  for (let attempt = 0; attempt < count; attempt += 1) {
    await nextAttempt();
    FakeWebSocket.latest().serverClose(1006);
  }
}

async function reconnect() {
  await nextAttempt();
  FakeWebSocket.latest().open();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('a long loss of the server is reported once the connection is back', async () => {
  const reports = await start();
  FakeWebSocket.latest().open();

  FakeWebSocket.latest().serverClose(1006);
  await failAttempts(6);
  expect(reports()).toEqual([]);

  await reconnect();
  expect(reports()).toMatchObject([
    {
      msg: 'server was unreachable',
      level: 'warn',
      ctx: { attempts: 6, durationMs: 56_000, offline: false }
    }
  ]);
});

test('a server restart of a few seconds is not reported', async () => {
  const reports = await start();
  FakeWebSocket.latest().open();

  FakeWebSocket.latest().serverClose(1001);
  await failAttempts(1);
  await reconnect();
  expect(reports()).toEqual([]);
});

test('a page that could not connect from the start reports too', async () => {
  const reports = await start();
  FakeWebSocket.latest().serverClose(1006);
  await failAttempts(5);
  await reconnect();
  expect(reports()).toMatchObject([{ ctx: { attempts: 6, durationMs: 48_000 } }]);
});

test('a computer that slept and failed once on waking has no outage to report', async () => {
  const reports = await start();
  FakeWebSocket.latest().open();
  FakeWebSocket.latest().serverClose(1006);

  // No timer runs while the computer sleeps, only the clock moves.
  vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000);
  await failAttempts(1);
  await reconnect();
  expect(reports()).toEqual([]);
});

test('a browser with no network says so in the report', async () => {
  const reports = await start();
  FakeWebSocket.latest().open();
  FakeWebSocket.latest().serverClose(1006);

  const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
  await failAttempts(6);
  online.mockReturnValue(true);
  await reconnect();
  expect(reports()).toMatchObject([{ ctx: { offline: true } }]);
});

test('each outage is counted on its own', async () => {
  const reports = await start();
  FakeWebSocket.latest().open();

  FakeWebSocket.latest().serverClose(1006);
  await failAttempts(2);
  await reconnect();
  expect(reports()).toEqual([]);

  // Twenty-four seconds each: together they would have reached the threshold.
  FakeWebSocket.latest().serverClose(1006);
  await failAttempts(2);
  await reconnect();
  expect(reports()).toEqual([]);
});
