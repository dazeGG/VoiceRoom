'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApiApp } = require('../src/server');

const SENDER_ID = '11111111-1111-4111-8111-111111111111';
const RECIPIENT_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = 'dm-message-1';

function waitForFrame(frames, type, timeoutMs = 1000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const frame = frames.find((candidate) => candidate.type === type);
      if (frame) {
        resolve(frame);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for WebSocket frame: ${type}`));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

async function openAccountWs(app, sessionToken, remoteAddress) {
  const frames = [];
  const ws = await app.injectWS(
    '/api/ws',
    {
      headers: { cookie: `vr_session=${sessionToken}` },
      socket: { remoteAddress }
    },
    {
      onInit(socket) {
        socket.on('message', (raw) => frames.push(JSON.parse(String(raw))));
      }
    }
  );
  await waitForFrame(frames, 'ready');
  return { frames, ws };
}

test('DM delete realtime identifies the counterpart separately for sender and recipient', async (t) => {
  let deleteCount = 0;
  const app = createApiApp({
    store: {
      async listVisibleRoomsForUser() {
        return [];
      }
    },
    users: {
      async getSessionUser(token) {
        if (token === 'sender-session') return { user: { id: SENDER_ID } };
        if (token === 'recipient-session') return { user: { id: RECIPIENT_ID } };
        return null;
      }
    },
    friends: {
      async getFriendIds() {
        return [];
      },
      async getMessage(userId, peerId, messageId) {
        assert.equal(userId, SENDER_ID);
        assert.equal(peerId, RECIPIENT_ID);
        assert.equal(messageId, MESSAGE_ID);
        return {
          id: MESSAGE_ID,
          senderId: SENDER_ID,
          recipientId: RECIPIENT_ID,
          body: 'delete me'
        };
      },
      async softDeleteMessage(messageId) {
        assert.equal(messageId, MESSAGE_ID);
        deleteCount += 1;
        return true;
      }
    }
  });

  let sender;
  let recipient;
  t.after(async () => {
    sender?.ws.terminate();
    recipient?.ws.terminate();
    await app.close();
  });
  await app.ready();

  sender = await openAccountWs(app, 'sender-session', '127.0.0.1');
  recipient = await openAccountWs(app, 'recipient-session', '127.0.0.2');

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/dm/${RECIPIENT_ID}/messages/${MESSAGE_ID}`,
    headers: {
      cookie: 'vr_session=sender-session',
      host: 'voice.local',
      origin: 'http://voice.local'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(deleteCount, 1);

  const senderEvent = await waitForFrame(sender.frames, 'dm.message.deleted');
  const recipientEvent = await waitForFrame(recipient.frames, 'dm.message.deleted');
  assert.equal(senderEvent.payload.messageId, MESSAGE_ID);
  assert.equal(recipientEvent.payload.messageId, MESSAGE_ID);
  assert.equal(senderEvent.payload.peerUserId, RECIPIENT_ID);
  assert.equal(recipientEvent.payload.peerUserId, SENDER_ID);
});
