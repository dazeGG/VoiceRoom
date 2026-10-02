// What a client sends the moment its socket opens, while the server is still
// resolving the session behind it: nothing may be lost, and a socket that
// closes in that window must not stay registered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { createWsHandler, type WsRoomRuntime } from '../src/realtime/ws-handler.ts';
import { createConnectionRegistry } from '../src/realtime/registry.ts';
import { fake } from './fakes/index.ts';

type Sent = { type: string; payload?: Record<string, unknown> };

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Sent[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data) as Sent);
  }
  close() {
    this.readyState = 3;
  }
}

function setup() {
  const registry = createConnectionRegistry({
    maxConnectionsPerUser: 10,
    keepaliveMs: 15_000,
    getFriendIds: async () => []
  });
  const subscribed: string[] = [];
  let releaseSession!: (value: { user: { id: string }; session: object }) => void;
  const handler = createWsHandler({
    registry,
    roomRuntime: fake<WsRoomRuntime>({
      async sendAccountSummaries() {},
      async subscribePreview(_connection, roomId) {
        subscribed.push(roomId);
      }
    }),
    resolveSessionUser: () =>
      new Promise((resolve) => {
        releaseSession = resolve;
      }),
    getFriendIds: async () => [],
    isUserOnline: () => false
  });
  return { registry, handler, subscribed, release: () => releaseSession({ user: { id: 'u1' }, session: {} }) };
}

const frame = (type: string, payload: Record<string, unknown>) => JSON.stringify({ type, payload });

test('frames sent while the session resolves are handled once the socket is ready', async () => {
  const { handler, subscribed, release } = setup();
  const socket = new FakeSocket();
  const opened = handler.handleConnection(socket, fake<IncomingMessage>());
  socket.emit('message', frame('ping', { at: 1 }));
  socket.emit('message', frame('room.preview.subscribe', { roomId: 'room1' }));
  release();
  await opened;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    socket.sent.map((sent) => sent.type),
    ['ready', 'pong']
  );
  assert.deepEqual(subscribed, ['room1']);
});

test('a socket that closes while the session resolves is never registered', async () => {
  const { handler, registry, release } = setup();
  const socket = new FakeSocket();
  const opened = handler.handleConnection(socket, fake<IncomingMessage>());
  socket.emit('close', 1006, '');
  release();
  await opened;

  assert.equal(registry.connectionCount('u1'), 0);
  assert.equal(registry.isUserOnline('u1'), false);
  assert.deepEqual(socket.sent, []);
});
