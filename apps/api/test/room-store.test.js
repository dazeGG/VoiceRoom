'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createRoomStore } = require('../src/lib/room-store');

test('durable room store persists registry and message shape to disk', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-store-'));

  try {
    const store = createRoomStore({ dataDir, messageTtlMs: 7 * 24 * 60 * 60 * 1000, roomIdleTtlMs: 60000 });
    const dynamic = store.createRoom({ creatorIp: '1.2.3.4', roomId: 'dyn-room' });
    const statik = store.createRoom({ creatorIp: '5.6.7.8', isStatic: true, roomId: 'static-room' });
    store.appendMessage(dynamic.id, {
      createdAt: dynamic.createdAt,
      expiresAt: dynamic.createdAt + 60000,
      id: 'msg-1',
      name: 'Alice',
      peerId: 'peer-a',
      text: 'hello'
    });

    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'voice-room-state.json'), 'utf8'));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.rooms.length, 2);
    assert.deepEqual(
      persisted.rooms.map((room) => ({ id: room.id, isStatic: room.isStatic, peerCount: room.peerCount })).sort((a, b) =>
        a.id.localeCompare(b.id)
      ),
      [
        { id: 'dyn-room', isStatic: false, peerCount: 0 },
        { id: 'static-room', isStatic: true, peerCount: 0 }
      ]
    );

    const reloaded = createRoomStore({ dataDir, messageTtlMs: 7 * 24 * 60 * 60 * 1000, roomIdleTtlMs: 60000 });
    const reloadedDynamic = reloaded.getRoom(dynamic.id);
    const reloadedStatic = reloaded.getRoom(statik.id);
    assert.equal(reloadedDynamic?.createdAt, dynamic.createdAt);
    assert.equal(reloadedDynamic?.isStatic, false);
    assert.equal(reloadedDynamic?.messages.length, 1);
    assert.equal(reloadedDynamic?.messages[0].text, 'hello');
    assert.equal(reloadedStatic?.isStatic, true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('durable room store prunes expired chat messages on reload', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-store-'));

  try {
    const store = createRoomStore({ dataDir, messageTtlMs: 1, roomIdleTtlMs: 60000 });
    const room = store.createRoom({ creatorIp: '1.2.3.4', roomId: 'ttl-room' });
    store.appendMessage(room.id, {
      createdAt: room.createdAt,
      id: 'expired-msg',
      name: 'Alice',
      peerId: 'peer-a',
      text: 'short-lived',
      expiresAt: room.createdAt + 1
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const reloaded = createRoomStore({ dataDir, messageTtlMs: 1, roomIdleTtlMs: 60000 });
    const reloadedRoom = reloaded.getRoom(room.id);
    assert.equal(reloadedRoom?.messages.length, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('durable room store prunes expired chat messages during active cleanup', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-store-'));

  try {
    const store = createRoomStore({ dataDir, messageTtlMs: 60000, roomIdleTtlMs: 60000 });
    const room = store.createRoom({ creatorIp: '1.2.3.4', roomId: 'cleanup-room', isStatic: true });
    store.appendMessage(room.id, {
      createdAt: room.createdAt,
      id: 'cleanup-msg',
      name: 'Alice',
      peerId: 'peer-a',
      text: 'cleanup-me',
      expiresAt: Number.MAX_SAFE_INTEGER - 1
    });

    const changed = store.pruneRooms(Number.MAX_SAFE_INTEGER);
    assert.equal(changed, true);
    assert.equal(store.getRoom(room.id)?.messages.length, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});


test('durable room store caps retained chat messages per room', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-store-'));
  try {
    const store = createRoomStore({ dataDir, maxMessagesPerRoom: 2, messageTtlMs: 60000, roomIdleTtlMs: 60000 });
    const room = store.createRoom({ creatorIp: '127.0.0.1', roomId: 'caproom1' });
    for (let index = 1; index <= 3; index += 1) {
      store.appendMessage(room.id, {
        createdAt: index,
        expiresAt: Date.now() + 60000,
        id: `m${index}`,
        name: 'Guest',
        peerId: `peer-${index}`,
        text: `message ${index}`
      });
    }

    assert.deepEqual(store.getRoom(room.id).messages.map((message) => message.id), ['m2', 'm3']);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
