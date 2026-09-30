process.env.ROOM_CHAT_RATE_LIMIT = '1';
process.env.ROOM_CHAT_RATE_WINDOW_MS = '60000';
process.env.DM_RATE_LIMIT = '1';
process.env.DM_RATE_WINDOW_MS = '60000';

import test from 'node:test';
import assert from 'node:assert/strict';

const { createApiApp } = await import('../src/server.ts');
import type { Failure } from '@voice-room/shared/contracts/http';
import type { FastifyInstance } from 'fastify';
import { dbRoom, storedDirectMessage, userSession, type Fakes } from './fakes/index.ts';
import { injectWs, sendWs, waitForWsType } from './ws-harness.ts';

const AUTHOR_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const PEER_ID = '33333333-3333-4333-8333-333333333333';
const ROOM_ID = 'edit-rate-room';

function flushRealtime() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

function patch(app: FastifyInstance, url: string, sessionToken: string, text: string) {
  return app.inject({
    method: 'PATCH',
    url,
    headers: {
      cookie: `vr_session=${sessionToken}`,
      host: 'voice.local',
      origin: 'http://voice.local'
    },
    payload: { text }
  });
}

test('message edit rate limits run after ownership and before storage or realtime fan-out', async (t) => {
  let roomEditCount = 0;
  let dmEditCount = 0;
  let roomMessage: {
    authorUserId: string;
    avatarColorKey: string;
    createdAt: number;
    editedAt: number | null;
    expiresAt: number;
    id: string;
    name: string;
    peerId: string;
    roomId: string;
    text: string;
  } = {
    authorUserId: AUTHOR_ID,
    avatarColorKey: 'blurple',
    createdAt: 100,
    editedAt: null,
    expiresAt: 10_000,
    id: 'room-message-1',
    name: 'Author',
    peerId: `auth-${AUTHOR_ID}`,
    roomId: ROOM_ID,
    text: 'room before'
  };
  let dmMessage = storedDirectMessage('dm-message-1', {
    senderId: AUTHOR_ID,
    recipientId: PEER_ID,
    body: 'dm before',
    createdAt: 100
  });

  const roomStore = {
    async editMessage(roomId: string, messageId: string, text: string) {
      roomEditCount += 1;
      roomMessage = { ...roomMessage, roomId, id: messageId, text, editedAt: 200 };
      return roomMessage;
    },
    async findActiveRoomBan() {
      return null;
    },
    async getMessage(roomId: string, messageId: string) {
      return roomId === ROOM_ID && messageId === roomMessage.id ? roomMessage : null;
    },
    async getRoom(roomId: string) {
      if (roomId !== ROOM_ID) return null;
      return dbRoom(ROOM_ID, { createdAt: 100, name: 'Rate limit room', ownerId: OWNER_ID });
    },
    async listMessages(roomId: string) {
      return roomId === ROOM_ID ? [roomMessage] : [];
    },
    async listVisibleRoomsForUser() {
      return [];
    }
  } satisfies Fakes['store'];

  const friendStore = {
    async editMessage({
      messageId,
      senderId,
      recipientId,
      body
    }: {
      messageId: string;
      senderId: string;
      recipientId: string;
      body: string;
    }) {
      dmEditCount += 1;
      dmMessage = { ...dmMessage, id: messageId, senderId, recipientId, body, editedAt: 300 };
      return dmMessage;
    },
    async getFriendIds() {
      return [];
    },
    async getMessage(_userId: string, _peerId: string, messageId: string) {
      if (messageId === 'foreign-message-1') {
        return { ...dmMessage, id: messageId, senderId: PEER_ID, recipientId: AUTHOR_ID };
      }
      return messageId === dmMessage.id ? dmMessage : null;
    }
  } satisfies Fakes['friends'];

  const userStore: Fakes['users'] = {
    async getSessionUser(token) {
      if (token === 'author-session') return userSession({ id: AUTHOR_ID });
      if (token === 'owner-session') return userSession({ id: OWNER_ID });
      return null;
    }
  };

  const app = createApiApp({ store: roomStore, friends: friendStore, users: userStore });
  let realtime: Awaited<ReturnType<typeof injectWs>> | undefined;
  t.after(async () => {
    realtime?.ws.terminate();
    await app.close();
  });
  await app.ready();

  realtime = await injectWs(app, { cookie: 'vr_session=author-session' });
  sendWs(realtime.ws, 'room.preview.subscribe', { roomId: ROOM_ID });
  await waitForWsType(realtime.frames, 'room.snapshot', (frame) => frame.payload.roomId === ROOM_ID, 1000);

  const roomUrl = `/api/rooms/${ROOM_ID}/chat/${roomMessage.id}`;
  const forbiddenRoomEdit = await patch(app, roomUrl, 'owner-session', 'room forbidden');
  assert.equal(forbiddenRoomEdit.statusCode, 403);
  assert.equal(roomEditCount, 0);

  const allowedRoomEdit = await patch(app, roomUrl, 'author-session', 'room allowed');
  assert.equal(allowedRoomEdit.statusCode, 200);
  assert.equal(roomEditCount, 1);
  await waitForWsType(
    realtime.frames,
    'room.chat.edited',
    (frame) => frame.payload.message.text === 'room allowed',
    1000
  );

  const blockedRoomEdit = await patch(app, roomUrl, 'author-session', 'room blocked');
  assert.equal(blockedRoomEdit.statusCode, 429);
  const blockedRoomEditBody = blockedRoomEdit.json<Failure>();
  assert.equal(blockedRoomEditBody.error, 'Too many chat messages');
  assert.ok((blockedRoomEditBody.retryAfterSeconds ?? 0) > 0);
  assert.equal(blockedRoomEdit.headers['retry-after'], String(blockedRoomEditBody.retryAfterSeconds));
  assert.equal(roomEditCount, 1);
  assert.equal(roomMessage.text, 'room allowed');
  await flushRealtime();
  assert.equal(realtime.frames.filter((frame) => frame.type === 'room.chat.edited').length, 1);

  const foreignDmUrl = `/api/dm/${PEER_ID}/messages/foreign-message-1`;
  const forbiddenDmEdit = await patch(app, foreignDmUrl, 'author-session', 'dm forbidden');
  assert.equal(forbiddenDmEdit.statusCode, 403);
  assert.equal(dmEditCount, 0);

  const dmUrl = `/api/dm/${PEER_ID}/messages/${dmMessage.id}`;
  const allowedDmEdit = await patch(app, dmUrl, 'author-session', 'dm allowed');
  assert.equal(allowedDmEdit.statusCode, 200);
  assert.equal(dmEditCount, 1);
  await waitForWsType(
    realtime.frames,
    'dm.message.edited',
    (frame) => frame.payload.message.body === 'dm allowed',
    1000
  );

  const blockedDmEdit = await patch(app, dmUrl, 'author-session', 'dm blocked');
  assert.equal(blockedDmEdit.statusCode, 429);
  const blockedDmEditBody = blockedDmEdit.json<Failure>();
  assert.equal(blockedDmEditBody.error, 'Слишком много сообщений, попробуйте позже');
  assert.ok((blockedDmEditBody.retryAfterSeconds ?? 0) > 0);
  assert.equal(blockedDmEdit.headers['retry-after'], String(blockedDmEditBody.retryAfterSeconds));
  assert.equal(dmEditCount, 1);
  assert.equal(dmMessage.body, 'dm allowed');
  await flushRealtime();
  assert.equal(realtime.frames.filter((frame) => frame.type === 'dm.message.edited').length, 1);
});
