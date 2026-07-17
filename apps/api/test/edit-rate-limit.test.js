'use strict';

process.env.ROOM_CHAT_RATE_LIMIT = '1';
process.env.ROOM_CHAT_RATE_WINDOW_MS = '60000';
process.env.DM_RATE_LIMIT = '1';
process.env.DM_RATE_WINDOW_MS = '60000';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApiApp } = require('../src/server');

const AUTHOR_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const PEER_ID = '33333333-3333-4333-8333-333333333333';
const ROOM_ID = 'edit-rate-room';

function waitForFrame(frames, type, predicate = () => true, timeoutMs = 1000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const frame = frames.find((candidate) => candidate.type === type && predicate(candidate));
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

async function openWs(app, cookie) {
  const frames = [];
  const ws = await app.injectWS(
    '/api/ws',
    { headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } },
    {
      onInit(socket) {
        socket.on('message', (raw) => frames.push(JSON.parse(String(raw))));
      }
    }
  );
  await waitForFrame(frames, 'ready');
  return { frames, ws };
}

function flushRealtime() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

function patch(app, url, sessionToken, text) {
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
  let roomMessage = {
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
  let dmMessage = {
    id: 'dm-message-1',
    senderId: AUTHOR_ID,
    recipientId: PEER_ID,
    body: 'dm before',
    createdAt: 100,
    editedAt: null,
    readAt: null
  };

  const roomStore = {
    async editMessage(roomId, messageId, text) {
      roomEditCount += 1;
      roomMessage = { ...roomMessage, roomId, id: messageId, text, editedAt: 200 };
      return roomMessage;
    },
    async findActiveRoomBan() {
      return null;
    },
    async getMessage(roomId, messageId) {
      return roomId === ROOM_ID && messageId === roomMessage.id ? roomMessage : null;
    },
    async getRoom(roomId) {
      if (roomId !== ROOM_ID) return null;
      return {
        createdAt: 100,
        emptySince: null,
        id: ROOM_ID,
        isStatic: true,
        name: 'Rate limit room',
        ownerId: OWNER_ID,
        peers: new Map()
      };
    },
    async listMessages(roomId) {
      return roomId === ROOM_ID ? [roomMessage] : [];
    },
    async listVisibleRoomsForUser() {
      return [];
    }
  };

  const friendStore = {
    async editMessage({ messageId, senderId, recipientId, body }) {
      dmEditCount += 1;
      dmMessage = { ...dmMessage, id: messageId, senderId, recipientId, body, editedAt: 300 };
      return dmMessage;
    },
    async getFriendIds() {
      return [];
    },
    async getMessage(_userId, _peerId, messageId) {
      if (messageId === 'foreign-message-1') {
        return { ...dmMessage, id: messageId, senderId: PEER_ID, recipientId: AUTHOR_ID };
      }
      return messageId === dmMessage.id ? dmMessage : null;
    }
  };

  const userStore = {
    async getSessionUser(token) {
      if (token === 'author-session') return { user: { id: AUTHOR_ID } };
      if (token === 'owner-session') return { user: { id: OWNER_ID } };
      return null;
    }
  };

  const app = createApiApp({ store: roomStore, friends: friendStore, users: userStore });
  let realtime;
  t.after(async () => {
    realtime?.ws.terminate();
    await app.close();
  });
  await app.ready();

  realtime = await openWs(app, 'vr_session=author-session');
  realtime.ws.send(JSON.stringify({ type: 'room.preview.subscribe', payload: { roomId: ROOM_ID } }));
  await waitForFrame(realtime.frames, 'room.snapshot', (frame) => frame.payload?.roomId === ROOM_ID);

  const roomUrl = `/api/rooms/${ROOM_ID}/chat/${roomMessage.id}`;
  const forbiddenRoomEdit = await patch(app, roomUrl, 'owner-session', 'room forbidden');
  assert.equal(forbiddenRoomEdit.statusCode, 403);
  assert.equal(roomEditCount, 0);

  const allowedRoomEdit = await patch(app, roomUrl, 'author-session', 'room allowed');
  assert.equal(allowedRoomEdit.statusCode, 200);
  assert.equal(roomEditCount, 1);
  await waitForFrame(
    realtime.frames,
    'room.chat.edited',
    (frame) => frame.payload?.message?.text === 'room allowed'
  );

  const blockedRoomEdit = await patch(app, roomUrl, 'author-session', 'room blocked');
  assert.equal(blockedRoomEdit.statusCode, 429);
  assert.equal(blockedRoomEdit.json().error, 'Too many chat messages');
  assert.ok(blockedRoomEdit.json().retryAfterSeconds > 0);
  assert.equal(blockedRoomEdit.headers['retry-after'], String(blockedRoomEdit.json().retryAfterSeconds));
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
  await waitForFrame(
    realtime.frames,
    'dm.message.edited',
    (frame) => frame.payload?.message?.body === 'dm allowed'
  );

  const blockedDmEdit = await patch(app, dmUrl, 'author-session', 'dm blocked');
  assert.equal(blockedDmEdit.statusCode, 429);
  assert.equal(blockedDmEdit.json().error, 'Слишком много сообщений, попробуйте позже');
  assert.ok(blockedDmEdit.json().retryAfterSeconds > 0);
  assert.equal(blockedDmEdit.headers['retry-after'], String(blockedDmEdit.json().retryAfterSeconds));
  assert.equal(dmEditCount, 1);
  assert.equal(dmMessage.body, 'dm allowed');
  await flushRealtime();
  assert.equal(realtime.frames.filter((frame) => frame.type === 'dm.message.edited').length, 1);
});
