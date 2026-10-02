// A room preview subscription is only trusted once the server answers it: a
// lost subscribe frame would leave that room's chat deaf until a reload.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';

async function load() {
  vi.resetModules();
  installFakeWebSocket();
  vi.doMock('../../src/lib/entities/room/room-presence.svelte', () => ({ applyRoomSummary: () => {} }));
  return import('../../src/lib/entities/room/room-realtime.ts');
}

const subscribes = (socket: FakeWebSocket) =>
  socket.sent.filter((frame) => frame.type === 'room.preview.subscribe').length;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('a subscription the server never answers is sent again until it is', async () => {
  const realtime = await load();
  const unsubscribe = realtime.subscribeRoomPreview('room-a', () => {});
  const socket = FakeWebSocket.latest();
  socket.open();
  expect(subscribes(socket)).toBe(1);

  await vi.advanceTimersByTimeAsync(4_500);
  expect(subscribes(socket)).toBe(2);

  socket.receive({ type: 'room.snapshot', payload: { roomId: 'room-a', peers: [], recentMessages: [] } });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(subscribes(socket)).toBe(2);
  unsubscribe();
});

test('a room that is gone or closed to the client counts as an answer', async () => {
  const realtime = await load();
  const offA = realtime.subscribeRoomPreview('room-a', () => {});
  const offB = realtime.subscribeRoomPreview('room-b', () => {});
  const socket = FakeWebSocket.latest();
  socket.open();
  socket.receive({ type: 'room.not_found', payload: { roomId: 'room-a' } });
  socket.receive({ type: 'room.banned', payload: { roomId: 'room-b' } });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(subscribes(socket)).toBe(2);
  offA();
  offB();
});

test('retries stop after a few attempts and once the subscription is dropped', async () => {
  const realtime = await load();
  const unsubscribe = realtime.subscribeRoomPreview('room-a', () => {});
  const socket = FakeWebSocket.latest();
  socket.open();
  // Short of the heartbeat timeout, so the same socket stays in use.
  await vi.advanceTimersByTimeAsync(20_000);
  expect(subscribes(socket)).toBe(4);

  const other = realtime.subscribeRoomPreview('room-b', () => {});
  other();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(socket.sent.filter((frame) => frame.type === 'room.preview.subscribe').at(-1)?.payload).toEqual({
    roomId: 'room-b'
  });
  expect(subscribes(socket)).toBe(5);
  unsubscribe();
});

test('a reconnect restores the subscription and waits for its answer again', async () => {
  const realtime = await load();
  const unsubscribe = realtime.subscribeRoomPreview('room-a', () => {});
  FakeWebSocket.latest().open();
  FakeWebSocket.latest().receive({
    type: 'room.snapshot',
    payload: { roomId: 'room-a', peers: [], recentMessages: [] }
  });

  FakeWebSocket.latest().serverClose(1006);
  await vi.advanceTimersByTimeAsync(1_000);
  const second = FakeWebSocket.latest();
  second.open();
  expect(subscribes(second)).toBe(1);
  await vi.advanceTimersByTimeAsync(4_500);
  expect(subscribes(second)).toBe(2);
  unsubscribe();
});
