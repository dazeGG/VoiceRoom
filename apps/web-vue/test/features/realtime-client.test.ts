// The shared realtime (WebSocket) client: one socket for all subscribers,
// queued sends, reconnects, and the end-of-session close.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { freshImport, muteWarnings } from '../helpers/fresh-module.ts';

async function load() {
  installFakeWebSocket();
  return freshImport(() => import('../../src/api/realtime.ts'));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('subscribers share one socket that opens with hello and flushes what was sent before it opened', async () => {
  const realtime = await load();
  const unsubscribeFirst = realtime.getAppRealtime().subscribe(() => {});
  const unsubscribeSecond = realtime.getAppRealtime().subscribe(() => {});
  realtime.getAppRealtime().send('room.preview.subscribe', { roomId: 'room-a' });
  expect(FakeWebSocket.instances).toHaveLength(1);

  FakeWebSocket.latest().open();
  expect(FakeWebSocket.latest().sent.map((frame) => frame.type)).toEqual(['hello', 'room.preview.subscribe']);
  unsubscribeFirst();
  unsubscribeSecond();
});

test('events reach every subscriber; server errors arrive as error events', async () => {
  const realtime = await load();
  const events: unknown[] = [];
  const unsubscribe = realtime.getAppRealtime().subscribe((event) => events.push(event));
  const socket = FakeWebSocket.latest();
  socket.open();
  socket.receive({ type: 'friend.presence', payload: { userId: 'anna', online: true } });
  socket.receive({ type: 'error', id: 'req-1', error: { code: 'forbidden', message: 'Нет доступа' } });
  expect(events).toEqual([
    { type: 'friend.presence', payload: { userId: 'anna', online: true } },
    { type: 'error', payload: { code: 'forbidden', message: 'Нет доступа', id: 'req-1' } }
  ]);
  unsubscribe();
});

test('a frame outside the realtime contract is dropped and the next good one still arrives', async () => {
  const realtime = await load();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const events: unknown[] = [];
  const unsubscribe = realtime.getAppRealtime().subscribe((event) => events.push(event));
  const socket = FakeWebSocket.latest();
  socket.open();
  socket.receive({ type: 'friend.presence', payload: { userId: 'anna', online: 'yes' } });
  socket.receive({ type: 'friend.presence' });
  socket.receive({ type: 'room.teleported', payload: {} });
  socket.receive({ type: 'error', error: { code: 'no_such_code', message: 'Новое' } });
  socket.receive({ payload: {} });
  socket.receive({ type: 'friend.presence', payload: { userId: 'anna', online: false } });
  // A refusal with a code newer than this build still arrives, without a code.
  expect(events).toEqual([
    { type: 'error', payload: { code: '', message: 'Новое' } },
    { type: 'friend.presence', payload: { userId: 'anna', online: false } }
  ]);
  unsubscribe();
  warn.mockRestore();
});

test('frames outside the contract ask for a version check at most once a minute', async () => {
  const realtime = await load();
  const { onContractViolation } = await import('../../src/api/contract-violations.ts');
  muteWarnings();
  const violated = vi.fn();
  onContractViolation(violated);
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  const socket = FakeWebSocket.latest();
  socket.open();

  socket.receive({ type: 'friend.presence', payload: { userId: 'anna', online: false } });
  expect(violated).not.toHaveBeenCalled();
  socket.receive({ type: 'room.teleported', payload: {} });
  socket.receive({ type: 'friend.presence', payload: { userId: 'anna', online: 'yes' } });
  expect(violated).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 60_000);
  socket.receive({ type: 'room.teleported', payload: {} });
  expect(violated).toHaveBeenCalledTimes(2);
  unsubscribe();
});

test('a dropped connection reconnects and restores subscriptions on the new socket', async () => {
  const realtime = await load();
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  const restored = vi.fn();
  realtime.getAppRealtime().onRestore(restored);
  FakeWebSocket.latest().open();

  FakeWebSocket.latest().serverClose(1006);
  expect(realtime.getAppRealtime().isConnected()).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeWebSocket.instances).toHaveLength(2);

  FakeWebSocket.latest().open();
  expect(restored).toHaveBeenCalledTimes(1);
  unsubscribe();
});

test('when the server ends the account session, the client stops reconnecting and reports it', async () => {
  const realtime = await load();
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  const ended = vi.fn();
  realtime.getAppRealtime().onSessionEnded(ended);
  FakeWebSocket.latest().open();

  FakeWebSocket.latest().serverClose(4401);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(ended).toHaveBeenCalledTimes(1);
  expect(FakeWebSocket.instances).toHaveLength(1);
  unsubscribe();
});

test('the last unsubscribe closes the socket and nothing reconnects', async () => {
  const realtime = await load();
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  FakeWebSocket.latest().open();
  unsubscribe();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(FakeWebSocket.latest().readyState).toBe(FakeWebSocket.CLOSED);
  expect(FakeWebSocket.instances).toHaveLength(1);
});

test('a socket that stops answering pings is closed and replaced', async () => {
  const realtime = await load();
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  FakeWebSocket.latest().open();
  // No pong ever comes back.
  await vi.advanceTimersByTimeAsync(120_000);
  expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  expect(FakeWebSocket.instances[0]?.readyState).toBe(FakeWebSocket.CLOSED);
  unsubscribe();
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

test('a dead socket is replaced even when closing it never completes', async () => {
  const realtime = await load();
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  const first = FakeWebSocket.latest();
  first.open();
  first.dead = true;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeWebSocket.instances).toHaveLength(2);
  expect(realtime.getAppRealtime().isConnected()).toBe(false);
  unsubscribe();
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

test('coming back to the tab drops a socket that no longer answers, and keeps one that does', async () => {
  const realtime = await load();
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  const first = FakeWebSocket.latest();
  first.open();

  setVisibility('visible');
  expect(first.sent.at(-1)?.type).toBe('ping');
  first.receive({ type: 'pong', payload: { at: 1 } });
  await vi.advanceTimersByTimeAsync(6_000);
  expect(FakeWebSocket.instances).toHaveLength(1);

  first.dead = true;
  setVisibility('visible');
  await vi.advanceTimersByTimeAsync(6_000);
  expect(FakeWebSocket.instances).toHaveLength(2);
  unsubscribe();
});

test('the network coming back reconnects at once instead of waiting out the backoff', async () => {
  const realtime = await load();
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  for (let attempt = 0; attempt < 5; attempt += 1) {
    FakeWebSocket.latest().serverClose(1006);
    await vi.advanceTimersByTimeAsync(10_000);
  }
  FakeWebSocket.latest().serverClose(1006);
  const before = FakeWebSocket.instances.length;

  window.dispatchEvent(new Event('online'));
  expect(FakeWebSocket.instances).toHaveLength(before + 1);
  unsubscribe();
});

test('a desktop wake-up probes the socket even while the page reads as hidden', async () => {
  const realtime = await load();
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  const first = FakeWebSocket.latest();
  first.open();
  setVisibility('hidden');

  first.dead = true;
  realtime.getAppRealtime().probeLiveness();
  expect(first.sent.at(-1)?.type).toBe('ping');
  await vi.advanceTimersByTimeAsync(6_000);
  expect(FakeWebSocket.instances).toHaveLength(2);

  // A hidden tab alone still does not probe: only an explicit wake-up does.
  const second = FakeWebSocket.latest();
  second.open();
  const sentBefore = second.sent.length;
  setVisibility('hidden');
  expect(second.sent).toHaveLength(sentBefore);
  setVisibility('visible');
  unsubscribe();
});

test('after the last unsubscribe, tab and network events open nothing', async () => {
  const realtime = await load();
  const unsubscribe = realtime.getAppRealtime().subscribe(() => {});
  FakeWebSocket.latest().open();
  unsubscribe();
  window.dispatchEvent(new Event('online'));
  setVisibility('visible');
  expect(FakeWebSocket.instances).toHaveLength(1);
});

test('the first command opens the socket when nothing else has', async () => {
  const realtime = await load();
  realtime.getAppRealtime().send('room.preview.subscribe', { roomId: 'room-a' });
  expect(FakeWebSocket.instances).toHaveLength(1);
  FakeWebSocket.latest().open();
  expect(FakeWebSocket.latest().sent.map((frame) => frame.type)).toEqual(['hello', 'room.preview.subscribe']);
});

test('a command sent during the reconnect backoff waits for the scheduled reconnect', async () => {
  const realtime = await load();
  const connection = realtime.getAppRealtime();
  const unsubscribe = connection.subscribe(() => {});
  FakeWebSocket.latest().open();
  FakeWebSocket.latest().serverClose(1006);
  expect(vi.getTimerCount()).toBe(1);

  connection.send('room.preview.subscribe', { roomId: 'room-a' });
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(1);

  await vi.advanceTimersByTimeAsync(10_000);
  expect(FakeWebSocket.instances).toHaveLength(2);
  FakeWebSocket.latest().open();
  expect(FakeWebSocket.latest().sent.map((frame) => frame.type)).toEqual(['hello', 'room.preview.subscribe']);
  unsubscribe();
});

test('typing and ping frames sent while disconnected are dropped, not sent late', async () => {
  const realtime = await load();
  const connection = realtime.getAppRealtime();
  const unsubscribe = connection.subscribe(() => {});
  FakeWebSocket.latest().open();
  FakeWebSocket.latest().serverClose(1006);

  connection.send('dm.typing', { userId: 'anna', activity: 'typing' });
  connection.send('room.chat.typing', { roomId: 'room-a', activity: 'typing' });
  connection.send('ping', { at: 1 });
  await vi.advanceTimersByTimeAsync(10_000);
  FakeWebSocket.latest().open();
  expect(FakeWebSocket.latest().sent.map((frame) => frame.type)).toEqual(['hello']);
  unsubscribe();
});

test('after the server ends the account session, a command does not reconnect', async () => {
  const realtime = await load();
  const connection = realtime.getAppRealtime();
  const unsubscribe = connection.subscribe(() => {});
  FakeWebSocket.latest().open();
  FakeWebSocket.latest().serverClose(4401);

  connection.send('room.preview.subscribe', { roomId: 'room-a' });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(FakeWebSocket.instances).toHaveLength(1);
  unsubscribe();
});

test('a command sent after the last unsubscribe is dropped, not sent on the next socket', async () => {
  const realtime = await load();
  const connection = realtime.getAppRealtime();
  const unsubscribe = connection.subscribe(() => {});
  FakeWebSocket.latest().open();
  unsubscribe();

  connection.send('room.preview.unsubscribe', { roomId: 'room-a' });
  const resubscribe = connection.subscribe(() => {});
  FakeWebSocket.latest().open();
  expect(FakeWebSocket.latest().sent.map((frame) => frame.type)).toEqual(['hello']);
  resubscribe();
});
