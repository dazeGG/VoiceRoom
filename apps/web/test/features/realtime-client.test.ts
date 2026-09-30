// The shared realtime (WebSocket) client: one socket for all subscribers,
// queued sends, reconnects, and the end-of-session close.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { freshImport } from '../helpers/fresh-module.ts';
import type * as RealtimeModule from '../../src/lib/api/realtime.ts';

async function load() {
  installFakeWebSocket();
  return freshImport<typeof RealtimeModule>('/src/lib/api/realtime.ts');
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('subscribers share one socket that opens with hello and flushes what was sent before it opened', async () => {
  const realtime = await load();
  const first = realtime.connectRealtime(() => {});
  const second = realtime.connectRealtime(() => {});
  first.send('room.preview.subscribe', { roomId: 'room-a' });
  expect(FakeWebSocket.instances).toHaveLength(1);

  FakeWebSocket.latest().open();
  expect(FakeWebSocket.latest().sent.map((frame) => frame.type)).toEqual(['hello', 'room.preview.subscribe']);
  first.close();
  second.close();
});

test('events reach every subscriber; server errors arrive as error events', async () => {
  const realtime = await load();
  const events: unknown[] = [];
  const handle = realtime.connectRealtime((event) => events.push(event));
  const socket = FakeWebSocket.latest();
  socket.open();
  socket.receive({ type: 'friend.presence', payload: { userId: 'anna', online: true } });
  socket.receive({ type: 'error', id: 'req-1', error: { code: 'forbidden', message: 'Нет доступа' } });
  expect(events).toEqual([
    { type: 'friend.presence', payload: { userId: 'anna', online: true } },
    { type: 'error', payload: { code: 'forbidden', message: 'Нет доступа', id: 'req-1' } }
  ]);
  handle.close();
});

test('a dropped connection reconnects and restores subscriptions on the new socket', async () => {
  const realtime = await load();
  const handle = realtime.connectRealtime(() => {});
  const restored = vi.fn();
  realtime.getAppRealtime().onRestore(restored);
  FakeWebSocket.latest().open();

  FakeWebSocket.latest().serverClose(1006);
  expect(realtime.getAppRealtime().isConnected()).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeWebSocket.instances).toHaveLength(2);

  FakeWebSocket.latest().open();
  expect(restored).toHaveBeenCalledTimes(1);
  handle.close();
});

test('when the server ends the account session, the client stops reconnecting and reports it', async () => {
  const realtime = await load();
  const handle = realtime.connectRealtime(() => {});
  const ended = vi.fn();
  realtime.getAppRealtime().onSessionEnded(ended);
  FakeWebSocket.latest().open();

  FakeWebSocket.latest().serverClose(4401);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(ended).toHaveBeenCalledTimes(1);
  expect(FakeWebSocket.instances).toHaveLength(1);
  handle.close();
});

test('the last unsubscribe closes the socket and nothing reconnects', async () => {
  const realtime = await load();
  const handle = realtime.connectRealtime(() => {});
  FakeWebSocket.latest().open();
  handle.close();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(FakeWebSocket.latest().readyState).toBe(FakeWebSocket.CLOSED);
  expect(FakeWebSocket.instances).toHaveLength(1);
});

test('a socket that stops answering pings is closed and replaced', async () => {
  const realtime = await load();
  const handle = realtime.connectRealtime(() => {});
  FakeWebSocket.latest().open();
  // No pong ever comes back.
  await vi.advanceTimersByTimeAsync(120_000);
  expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  expect(FakeWebSocket.instances[0]?.readyState).toBe(FakeWebSocket.CLOSED);
  handle.close();
});

test('connecting eagerly cancels a scheduled reconnect, so one socket and one heartbeat remain', async () => {
  const realtime = await load();
  const connection = realtime.getAppRealtime();
  const unsubscribe = connection.subscribe(() => {});
  FakeWebSocket.latest().serverClose(1006);
  expect(vi.getTimerCount()).toBe(1);

  connection.ensureConnected();
  expect(FakeWebSocket.instances).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeWebSocket.instances).toHaveLength(2);

  FakeWebSocket.latest().open();
  connection.ensureConnected();
  expect(FakeWebSocket.instances).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(1);
  unsubscribe();
});
