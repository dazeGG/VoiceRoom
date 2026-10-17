import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { MediaGrant, ServerFrame } from '@voice-room/shared/contracts/realtime';
import { createWsHandler, type WsRoomRuntime } from '../src/realtime/ws-handler.ts';
import type { ConnectionRegistry, WsConnection } from '../src/realtime/registry.ts';
import { fake } from './fakes/index.ts';

const TARGET = { roomId: 'room1', peerId: 'peer-alice1', sessionToken: 'a'.repeat(32) };

class FakeSocket extends EventEmitter {
  readyState = 1;
  send() {}
  close() {}
}

// A handler whose runtime answers every media request with `answer`.
async function open(answer: ReturnType<WsRoomRuntime['requestMedia']>) {
  const sent: ServerFrame[] = [];
  const asked: unknown[] = [];
  const registry = fake<ConnectionRegistry>({
    addGuestConnection(socket) {
      return fake<WsConnection>({
        activeVoice: null,
        closed: false,
        inboundMessageQueue: Promise.resolve(),
        previewRoomIds: new Set(),
        socket
      });
    },
    rejectGuestOverLimit: () => false,
    rejectOverLimit: () => false,
    removeConnection() {},
    sendReady: () => true,
    sendToConnection(_connection, frame) {
      sent.push(frame);
      return true;
    },
    touch() {}
  });
  const roomRuntime = fake<WsRoomRuntime>({
    requestMedia(_connection, payload) {
      asked.push(payload);
      return answer;
    },
    async sendAccountSummaries() {}
  });
  const handler = createWsHandler({
    registry,
    roomRuntime,
    resolveSessionUser: async () => null,
    getFriendIds: async () => [],
    isUserOnline: () => false
  });
  const socket = new FakeSocket();
  await handler.handleConnection(socket, fake<IncomingMessage>());
  return { asked, sent, socket };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for the handler');
}

test('a media request is answered with room.media.grant under the request id', async () => {
  const grant: MediaGrant = { roomId: 'room1', kind: 'screen', granted: true, profileId: 'balanced-30' };
  const { asked, sent, socket } = await open({ ok: true, grant });

  socket.emit(
    'message',
    JSON.stringify({
      id: 'media-1',
      type: 'room.media.request',
      payload: { ...TARGET, kind: 'screen', profileId: 'high-60' }
    })
  );
  await waitFor(() => sent.some((frame) => frame.type === 'room.media.grant'));

  assert.deepEqual(asked, [{ ...TARGET, kind: 'screen', profileId: 'high-60' }]);
  assert.deepEqual(
    sent.find((frame) => frame.type === 'room.media.grant'),
    { id: 'media-1', type: 'room.media.grant', payload: grant }
  );
});

test('a media request for a session this connection does not hold is refused with an error', async () => {
  const { sent, socket } = await open({ ok: false, code: 'not_active_peer' });

  socket.emit(
    'message',
    JSON.stringify({ id: 'media-2', type: 'room.media.request', payload: { ...TARGET, kind: 'camera' } })
  );
  await waitFor(() => sent.some((frame) => frame.type === 'error'));

  assert.deepEqual(
    sent.find((frame) => frame.type === 'error'),
    { id: 'media-2', type: 'error', error: { code: 'not_active_peer', message: 'Media request rejected' } }
  );
});
