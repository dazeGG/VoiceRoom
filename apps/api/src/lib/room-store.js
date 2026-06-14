'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_FILE_NAME = 'voice-room-state.json';
const DEFAULT_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createRoomId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function createRoomStore({
  dataDir = path.resolve(__dirname, '..', '..', 'data'),
  fileName = DEFAULT_FILE_NAME,
  maxMessagesPerRoom = 500,
  messageTtlMs = DEFAULT_MESSAGE_TTL_MS,
  roomIdleTtlMs = 15 * 60 * 1000
} = {}) {
  const filePath = path.join(dataDir, fileName);
  const rooms = new Map();
  const retainedMessageLimit = normalizePositiveInt(maxMessagesPerRoom, 500);

  function ensureDir() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function normalizePositiveInt(value, fallback) {
    const next = Number(value);
    return Number.isFinite(next) && next >= 0 ? next : fallback;
  }

  function normalizeMessage(message, now) {
    if (!message || typeof message !== 'object') return null;
    const createdAt = normalizePositiveInt(message.createdAt, now);
    const expiresAt = normalizePositiveInt(message.expiresAt, createdAt + messageTtlMs);
    if (!expiresAt || expiresAt <= now) return null;

    return {
      createdAt,
      expiresAt,
      id: typeof message.id === 'string' && message.id ? message.id : crypto.randomUUID?.() || createRoomId(),
      name: typeof message.name === 'string' ? message.name : '',
      peerId: typeof message.peerId === 'string' ? message.peerId : '',
      roomId: typeof message.roomId === 'string' ? message.roomId : '',
      text: typeof message.text === 'string' ? message.text : ''
    };
  }

  function normalizeEmptySince(room, now) {
    const peerCount = normalizePositiveInt(room.peerCount, 0);
    const emptySince = normalizePositiveInt(room.emptySince, 0);
    if (peerCount > 0) return now;
    if (emptySince > 0) return emptySince;
    const createdAt = normalizePositiveInt(room.createdAt, now);
    return createdAt > 0 ? createdAt : now;
  }

  function hydrateRoom(room, now) {
    const id = typeof room.id === 'string' ? room.id : '';
    if (!id) return null;

    const createdAt = normalizePositiveInt(room.createdAt, now);
    const updatedAt = normalizePositiveInt(room.updatedAt, createdAt);
    const messages = Array.isArray(room.messages)
      ? room.messages
          .map((message) => normalizeMessage(message, now))
          .filter(Boolean)
          .slice(retainedMessageLimit > 0 ? -retainedMessageLimit : undefined)
      : [];

    return {
      createdAt,
      creatorIp: typeof room.creatorIp === 'string' ? room.creatorIp : '',
      emptySince: normalizeEmptySince(room, now),
      id,
      isStatic: Boolean(room.isStatic),
      messages,
      peers: new Map(),
      updatedAt
    };
  }

  function serializeRoom(room) {
    return {
      createdAt: room.createdAt,
      creatorIp: room.creatorIp,
      emptySince: room.emptySince,
      id: room.id,
      isStatic: room.isStatic,
      messages: room.messages.map((message) => ({
        createdAt: message.createdAt,
        expiresAt: message.expiresAt,
        id: message.id,
        name: message.name,
        peerId: message.peerId,
        roomId: message.roomId,
        text: message.text
      })),
      peerCount: room.peers.size,
      updatedAt: room.updatedAt
    };
  }

  function save() {
    ensureDir();
    const snapshot = {
      roomIdleTtlMs,
      savedAt: Date.now(),
      version: 1,
      rooms: Array.from(rooms.values()).map(serializeRoom)
    };
    const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmpFile, filePath);
  }

  function load() {
    rooms.clear();

    let payload = null;
    let hadFile = false;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      payload = JSON.parse(raw);
      hadFile = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Failed to read durable room store at ${filePath}:`, error.message);
      }
    }

    const now = Date.now();
    if (payload && Array.isArray(payload.rooms)) {
      for (const entry of payload.rooms) {
        const room = hydrateRoom(entry, now);
        if (room) {
          rooms.set(room.id, room);
        }
      }
    }

    const changed = pruneRooms(now, { persist: false });
    if (hadFile || changed) {
      save();
    }
  }

  function createRoom({ roomId = createRoomId(), creatorIp, isStatic = false, now = Date.now() }) {
    const id = String(roomId || '').trim();
    if (!id) {
      throw new Error('Room id is required');
    }
    if (rooms.has(id)) {
      throw new Error(`Room already exists: ${id}`);
    }

    const room = {
      createdAt: now,
      creatorIp: typeof creatorIp === 'string' ? creatorIp : '',
      emptySince: now,
      id,
      isStatic: Boolean(isStatic),
      messages: [],
      peers: new Map(),
      updatedAt: now
    };
    rooms.set(room.id, room);
    save();
    return room;
  }

  function deleteRoom(roomId) {
    const deleted = rooms.delete(roomId);
    if (deleted) save();
    return deleted;
  }

  function getRoom(roomId) {
    return rooms.get(roomId) || null;
  }

  function markRoomActive(room, now = Date.now()) {
    if (!room) return;
    if (room.emptySince !== null) {
      room.emptySince = null;
      room.updatedAt = now;
      save();
      return;
    }
    room.updatedAt = now;
  }

  function markRoomEmpty(room, now = Date.now()) {
    if (!room) return;
    if (room.emptySince !== now) {
      room.emptySince = now;
      room.updatedAt = now;
      save();
      return;
    }
    room.updatedAt = now;
  }

  function pruneMessages(room, now = Date.now()) {
    if (!room || !Array.isArray(room.messages) || room.messages.length === 0) return false;
    const before = room.messages.length;
    room.messages = room.messages.filter((message) => normalizePositiveInt(message?.expiresAt, 0) > now);
    return room.messages.length !== before;
  }

  function pruneRooms(now = Date.now(), { persist = true } = {}) {
    let changed = false;
    for (const room of rooms.values()) {
      const messagesChanged = pruneMessages(room, now);
      const roomExpired =
        !room.isStatic &&
        room.peers.size === 0 &&
        room.emptySince !== null &&
        now - room.emptySince > roomIdleTtlMs;

      if (messagesChanged) changed = true;
      if (roomExpired) {
        rooms.delete(room.id);
        changed = true;
      }
    }

    if (changed && persist) {
      save();
    }
    return changed;
  }

  function appendMessage(roomId, message) {
    const room = rooms.get(roomId);
    if (!room) return null;

    const now = Date.now();
    const entry = normalizeMessage({ ...message, roomId }, now);
    if (!entry) return null;

    room.messages.push(entry);
    if (retainedMessageLimit > 0 && room.messages.length > retainedMessageLimit) {
      room.messages = room.messages.slice(-retainedMessageLimit);
    }
    room.updatedAt = now;
    save();
    return entry;
  }

  load();

  return {
    appendMessage,
    createRoom,
    deleteRoom,
    getRoom,
    markRoomActive,
    markRoomEmpty,
    pruneRooms,
    rooms,
    save
  };
}

module.exports = { createRoomStore };
