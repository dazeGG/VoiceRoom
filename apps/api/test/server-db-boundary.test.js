
'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.ROOM_CHAT_RATE_LIMIT = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApiServer } = require('../src/server');

function createFakeStore() {
  const rooms = new Map();
  const messages = new Map();
  return {
    rooms: new Map(),
    async appendMessage(roomId, message) {
      if (!rooms.has(roomId)) return null;
      const entry = { ...message, roomId };
      const list = messages.get(roomId) || [];
      list.push(entry);
      messages.set(roomId, list);
      return entry;
    },
    async countQuotaRoomsForIp() {
      return 0;
    },
    async countRooms() {
      return rooms.size;
    },
    async createRoom({ creatorIp, isStatic, roomId, name = '', emoji = '', roomColorKey = 'blue', roomIconKey = 'headphones', roomPresetKey = 'voice-blue', now = Date.now() }) {
      const room = {
        createdAt: now,
        creatorIp,
        emptySince: now,
        id: roomId,
        isStatic,
        emoji,
        name,
        roomColorKey,
        roomIconKey,
        roomPresetKey,
        messages: [],
        peers: new Map(),
        updatedAt: now
      };
      rooms.set(roomId, room);
      return { ...room, peers: new Map() };
    },
    async createRoomWithQuota(options) {
      const room = await this.createRoom(options);
      return { room, status: 'created' };
    },
    async getRoom(roomId) {
      const room = rooms.get(roomId);
      return room ? { ...room, peers: new Map() } : null;
    },
    async getOrCreatePeerIdentity({ peerId, sessionToken }) {
      if (sessionToken && sessionToken.startsWith('bad')) {
        return { identity: null, status: 'token_mismatch' };
      }
      return { identity: { avatarColorKey: 'blurple', peerId }, status: 'created' };
    },
    async listMessages(roomId) {
      return messages.get(roomId) || [];
    },
    async markRoomActive() {},
    async markRoomEmpty() {},
    async pruneRooms() {}
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function request(port, path, { method = 'GET', body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, json: await response.json() };
}

test('server create/chat handlers use async store and allow link-only chat', async () => {
  const store = createFakeStore();
  const server = createApiServer({ store });
  const port = await listen(server);
  try {
    const created = await request(port, '/api/rooms', { method: 'POST', body: { isStatic: false } });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.isStatic, false);

    const posted = await request(port, `/api/rooms/${created.json.roomId}/chat`, {
      method: 'POST',
      body: { name: 'Link user', text: 'hello from link' }
    });
    assert.equal(posted.response.status, 201);
    assert.match(posted.json.message.peerId, /^chat-/);
    assert.equal(posted.json.message.text, 'hello from link');

    const listed = await request(port, `/api/rooms/${created.json.roomId}/chat`);
    assert.equal(listed.response.status, 200);
    assert.equal(listed.json.messages.length, 1);
  } finally {
    await close(server);
  }
});

test('server preserves active voice peer spoof protection while chat without voice remains open', async () => {
  const store = createFakeStore();
  const room = await store.createRoom({ creatorIp: 'test', isStatic: true, roomId: 'room1', now: Date.now() });
  assert.equal(room.id, 'room1');
  const server = createApiServer({ store });
  const port = await listen(server);
  const events = http.get(`http://127.0.0.1:${port}/api/events?room=room1&peer=peer0001&token=goodtoken12345678901234567890123&name=Ada`);

  try {
    await new Promise((resolve) => events.once('response', resolve));
    await new Promise((resolve) => setTimeout(resolve, 25));

    const activePost = await request(port, '/api/rooms/room1/chat', {
      method: 'POST',
      body: { peerId: 'peer0001', sessionToken: 'goodtoken12345678901234567890123', name: 'Ada', text: 'from voice' }
    });
    assert.equal(activePost.response.status, 201);
    assert.equal(activePost.json.message.avatarColorKey, 'blurple');

    const spoof = await request(port, '/api/rooms/room1/chat', {
      method: 'POST',
      body: { peerId: 'peer0001', sessionToken: 'badtoken123456789012345678901234', name: 'Mallory', text: 'spoof' }
    });
    assert.equal(spoof.response.status, 403);

    const linkOnly = await request(port, '/api/rooms/room1/chat', {
      method: 'POST',
      body: { name: 'Link user', text: 'allowed' }
    });
    assert.equal(linkOnly.response.status, 201);
    assert.ok(linkOnly.json.message.avatarColorKey);
  } finally {
    events.destroy();
    await close(server);
  }
});


test('server logs mark-empty failures instead of creating unhandled rejections', async () => {
  const store = createFakeStore();
  const room = await store.createRoom({ creatorIp: 'test', isStatic: false, roomId: 'room-empty-fail', now: Date.now() });
  assert.equal(room.id, 'room-empty-fail');
  store.markRoomEmpty = async () => {
    throw new Error('db offline');
  };

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  const server = createApiServer({ store });
  const port = await listen(server);
  const events = http.get(`http://127.0.0.1:${port}/api/events?room=room-empty-fail&peer=peer0002&token=goodtoken12345678901234567890123&name=Ada`);

  try {
    await new Promise((resolve) => events.once('response', resolve));
    events.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(errors.some((entry) => String(entry[0]).includes('Failed to mark room empty')), true);
  } finally {
    console.error = originalError;
    events.destroy();
    await close(server);
  }
});
