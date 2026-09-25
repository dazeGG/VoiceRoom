import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiApp } from '../src/server.ts';
import { storedDirectMessage, userSession } from './fakes/index.ts';
import { injectWs, waitForWsType } from './ws-harness.ts';

const SENDER_ID = '11111111-1111-4111-8111-111111111111';
const RECIPIENT_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = 'dm-message-1';

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
        if (token === 'sender-session') return userSession({ id: SENDER_ID });
        if (token === 'recipient-session') return userSession({ id: RECIPIENT_ID });
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
        return storedDirectMessage(MESSAGE_ID, { senderId: SENDER_ID, recipientId: RECIPIENT_ID, body: 'delete me' });
      },
      async softDeleteMessage(messageId) {
        assert.equal(messageId, MESSAGE_ID);
        deleteCount += 1;
        return true;
      }
    }
  });

  let sender: Awaited<ReturnType<typeof injectWs>> | undefined;
  let recipient: Awaited<ReturnType<typeof injectWs>> | undefined;
  t.after(async () => {
    sender?.ws.terminate();
    recipient?.ws.terminate();
    await app.close();
  });
  await app.ready();

  sender = await injectWs(app, { cookie: 'vr_session=sender-session', remoteAddress: '127.0.0.1' });
  recipient = await injectWs(app, { cookie: 'vr_session=recipient-session', remoteAddress: '127.0.0.2' });

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

  const senderEvent = await waitForWsType(sender.frames, 'dm.message.deleted', () => true, 1000);
  const recipientEvent = await waitForWsType(recipient.frames, 'dm.message.deleted', () => true, 1000);
  assert.equal(senderEvent.payload.messageId, MESSAGE_ID);
  assert.equal(recipientEvent.payload.messageId, MESSAGE_ID);
  assert.equal(senderEvent.payload.peerUserId, RECIPIENT_ID);
  assert.equal(recipientEvent.payload.peerUserId, SENDER_ID);
});
