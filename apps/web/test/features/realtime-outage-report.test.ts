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

async function startConnection() {
  installFakeWebSocket();
  muteWarnings();
  const { calls } = stubFetch({ '/api/client-logs': { status: 202, body: { ok: true } } });
  const realtime = await freshImport(() => import('../../src/api/realtime.ts'));
  const connection = realtime.getAppRealtime();
  cleanups.push(connection.subscribe(() => {}));
  const reports = () =>
    calls
      .filter((call) => call.url === '/api/client-logs')
      .flatMap((call) => parse(ReportBody, call.body).events)
      .filter((event) => event.ns === 'realtime');
  return { connection, reports };
}

const start = async () => (await startConnection()).reports;

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

test('a server that accepts the connection and never answers is reported for the whole time', async () => {
  const reports = await start();
  FakeWebSocket.latest().open();
  FakeWebSocket.latest().serverClose(1006);

  // No socket opens or closes by itself: each one waits for the connect timeout.
  await vi.advanceTimersByTimeAsync(180_000);
  expect(FakeWebSocket.instances.length).toBeGreaterThan(6);
  FakeWebSocket.latest().open();
  await vi.advanceTimersByTimeAsync(0);

  const [report] = reports();
  expect(report?.ctx).toMatchObject({ durationMs: 180_000, offline: false });
  expect(report?.ctx?.attempts).toBeGreaterThanOrEqual(5);
});

test('a connection that opens in time is not cut off by the connect timeout', async () => {
  await start();
  const socket = FakeWebSocket.latest();
  await vi.advanceTimersByTimeAsync(19_000);
  socket.open();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(FakeWebSocket.latest()).toBe(socket);
  expect(socket.readyState).toBe(FakeWebSocket.OPEN);
});

test('a socket that fell silent counts from its silence, even when the next one opens at once', async () => {
  const reports = await start();
  FakeWebSocket.latest().open();

  // No pong ever comes, so the heartbeat gives up on the socket after 45 seconds.
  await vi.advanceTimersByTimeAsync(46_000);
  expect(FakeWebSocket.instances).toHaveLength(2);
  FakeWebSocket.latest().open();
  await vi.advanceTimersByTimeAsync(0);

  expect(reports()).toMatchObject([{ ctx: { attempts: 0, offline: false } }]);
  expect(reports()[0]?.ctx?.durationMs).toBeGreaterThanOrEqual(45_000);
});

test('an abnormal close after silence counts from the silence', async () => {
  const reports = await start();
  FakeWebSocket.latest().open();

  await vi.advanceTimersByTimeAsync(36_000);
  FakeWebSocket.latest().serverClose(1006);
  await vi.advanceTimersByTimeAsync(4_000);
  FakeWebSocket.latest().open();
  await vi.advanceTimersByTimeAsync(0);

  expect(reports()).toMatchObject([{ ctx: { attempts: 0, durationMs: 40_000 } }]);
});

test('a clean close after a quiet stretch is not an outage', async () => {
  const reports = await start();
  FakeWebSocket.latest().open();

  await vi.advanceTimersByTimeAsync(36_000);
  FakeWebSocket.latest().serverClose(1001);
  await vi.advanceTimersByTimeAsync(4_000);
  FakeWebSocket.latest().open();
  await vi.advanceTimersByTimeAsync(0);

  expect(reports()).toEqual([]);
});

test('a session the server ended is not an outage when the page connects again', async () => {
  const { connection, reports } = await startConnection();
  FakeWebSocket.latest().open();
  FakeWebSocket.latest().serverClose(4401);

  await vi.advanceTimersByTimeAsync(60_000);
  connection.ensureConnected();
  FakeWebSocket.latest().open();
  await vi.advanceTimersByTimeAsync(0);

  expect(reports()).toEqual([]);
});

test('a socket that goes on answering is never an outage, however long it stays open', async () => {
  const reports = await start();
  const socket = FakeWebSocket.latest();
  socket.open();
  for (let beat = 0; beat < 20; beat += 1) {
    await vi.advanceTimersByTimeAsync(15_000);
    socket.receive({ type: 'pong', payload: { at: Date.now() } });
  }
  socket.serverClose(1001);
  await failAttempts(1);
  await reconnect();
  expect(reports()).toEqual([]);
});

test('a computer that slept with no socket open does not count the waking moments as an outage', async () => {
  const reports = await start();
  FakeWebSocket.latest().open();
  FakeWebSocket.latest().serverClose(1006);
  await failAttempts(1);

  vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000);
  await failAttempts(2);
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
