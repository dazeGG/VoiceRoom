'use strict';

const crypto = require('node:crypto');
const { createDbPool, transaction } = require('./db');

const DEFAULT_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createRoomId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function normalizePositiveInt(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : fallback;
}

function toDate(ms) {
  return new Date(normalizePositiveInt(ms, Date.now()));
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeMessageLimit(value) {
  return normalizePositiveInt(value, 500);
}

function mapRoom(row) {
  if (!row) return null;
  return {
    createdAt: toMillis(row.created_at),
    creatorIp: row.creator_ip || '',
    emptySince: row.empty_since ? toMillis(row.empty_since) : null,
    id: row.id,
    isStatic: Boolean(row.is_static),
    messages: [],
    peers: new Map(),
    updatedAt: toMillis(row.updated_at)
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    createdAt: toMillis(row.created_at),
    expiresAt: row.expires_at ? toMillis(row.expires_at) : null,
    id: row.id,
    name: row.name || '',
    peerId: row.peer_id || '',
    roomId: row.room_id,
    text: row.text || ''
  };
}

function roomIdFrom(roomOrId) {
  return typeof roomOrId === 'string' ? roomOrId : roomOrId?.id;
}

function createRoomStore({
  databaseUrl,
  logger = console,
  maxMessagesPerRoom = 500,
  messageTtlMs = DEFAULT_MESSAGE_TTL_MS,
  pool,
  roomIdleTtlMs = 15 * 60 * 1000
} = {}) {
  let activePool = pool || null;
  const retainedMessageLimit = normalizeMessageLimit(maxMessagesPerRoom);
  function getPool() {
    if (!activePool) {
      activePool = createDbPool({ databaseUrl, logger });
    }
    return activePool;
  }

  async function createRoom({ roomId = createRoomId(), creatorIp, isStatic = false, now = Date.now() }) {
    const id = String(roomId || '').trim();
    if (!id) {
      throw new Error('Room id is required');
    }

    const result = await getPool().query(
      `INSERT INTO rooms (id, creator_ip, is_static, created_at, updated_at, empty_since)
       VALUES ($1, $2, $3, $4, $4, $4)
       RETURNING *`,
      [id, typeof creatorIp === 'string' ? creatorIp : '', Boolean(isStatic), toDate(now)]
    );
    return mapRoom(result.rows[0]);
  }

  async function createRoomWithQuota({
    roomId = createRoomId(),
    creatorIp,
    isStatic = false,
    maxQuotaRoomsPerIp = 0,
    maxRooms = 100,
    now = Date.now()
  }) {
    const id = String(roomId || '').trim();
    if (!id) {
      throw new Error('Room id is required');
    }

    return transaction(getPool(), async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['voice-room:create-room']);

      const normalizedCreatorIp = typeof creatorIp === 'string' ? creatorIp : '';
      if (maxQuotaRoomsPerIp > 0) {
        const quota = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM rooms
           WHERE creator_ip = $1
             AND deleted_at IS NULL
             AND (is_static = true OR empty_since IS NOT NULL)`,
          [normalizedCreatorIp]
        );
        if ((quota.rows[0]?.count || 0) >= maxQuotaRoomsPerIp) {
          return { room: null, status: 'quota_exceeded' };
        }
      }

      const capacity = await client.query(`SELECT COUNT(*)::int AS count FROM rooms WHERE deleted_at IS NULL`);
      if ((capacity.rows[0]?.count || 0) >= maxRooms) {
        return { room: null, status: 'capacity_exceeded' };
      }

      const inserted = await client.query(
        `INSERT INTO rooms (id, creator_ip, is_static, created_at, updated_at, empty_since)
         VALUES ($1, $2, $3, $4, $4, $4)
         RETURNING *`,
        [id, normalizedCreatorIp, Boolean(isStatic), toDate(now)]
      );
      return { room: mapRoom(inserted.rows[0]), status: 'created' };
    });
  }

  async function getRoom(roomId) {
    const result = await getPool().query(
      `SELECT * FROM rooms WHERE id = $1 AND deleted_at IS NULL`,
      [roomId]
    );
    return mapRoom(result.rows[0]);
  }

  async function deleteRoom(roomId, now = Date.now()) {
    const result = await getPool().query(
      `UPDATE rooms
       SET deleted_at = COALESCE(deleted_at, $2), updated_at = $2
       WHERE id = $1 AND deleted_at IS NULL`,
      [roomId, toDate(now)]
    );
    return result.rowCount > 0;
  }

  async function markRoomActive(roomOrId, now = Date.now()) {
    const roomId = roomIdFrom(roomOrId);
    if (!roomId) return null;
    const result = await getPool().query(
      `UPDATE rooms
       SET empty_since = NULL, updated_at = $2
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [roomId, toDate(now)]
    );
    return mapRoom(result.rows[0]);
  }

  async function markRoomEmpty(roomOrId, now = Date.now()) {
    const roomId = roomIdFrom(roomOrId);
    if (!roomId) return null;
    const result = await getPool().query(
      `UPDATE rooms
       SET empty_since = COALESCE(empty_since, $2), updated_at = $2
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [roomId, toDate(now)]
    );
    return mapRoom(result.rows[0]);
  }

  async function countRooms() {
    const result = await getPool().query(`SELECT COUNT(*)::int AS count FROM rooms WHERE deleted_at IS NULL`);
    return result.rows[0]?.count || 0;
  }

  async function countQuotaRoomsForIp(creatorIp) {
    const result = await getPool().query(
      `SELECT COUNT(*)::int AS count
       FROM rooms
       WHERE creator_ip = $1
         AND deleted_at IS NULL
         AND (is_static = true OR empty_since IS NOT NULL)`,
      [typeof creatorIp === 'string' ? creatorIp : '']
    );
    return result.rows[0]?.count || 0;
  }

  async function countEmptyRoomsForIp(creatorIp) {
    return countQuotaRoomsForIp(creatorIp);
  }

  async function pruneRooms(now = Date.now()) {
    const nowDate = toDate(now);
    const idleBefore = toDate(now - roomIdleTtlMs);
    return transaction(getPool(), async (client) => {
      const expiredMessages = await client.query(
        `UPDATE room_messages
         SET deleted_at = $1
         WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= $1`,
        [nowDate]
      );
      const expiredRooms = await client.query(
        `UPDATE rooms
         SET deleted_at = $1, updated_at = $1
         WHERE deleted_at IS NULL
           AND is_static = false
           AND empty_since IS NOT NULL
           AND empty_since <= $2`,
        [nowDate, idleBefore]
      );
      return expiredMessages.rowCount > 0 || expiredRooms.rowCount > 0;
    });
  }

  async function appendMessage(roomId, message, now = Date.now()) {
    const id = typeof message?.id === 'string' && message.id ? message.id : crypto.randomUUID();
    const createdAt = normalizePositiveInt(message?.createdAt, now);
    const expiresAt = normalizePositiveInt(message?.expiresAt, createdAt + messageTtlMs);
    if (!expiresAt || expiresAt <= now) return null;

    return transaction(getPool(), async (client) => {
      const room = await client.query(
        `SELECT id FROM rooms WHERE id = $1 AND deleted_at IS NULL`,
        [roomId]
      );
      if (room.rowCount === 0) return null;

      const inserted = await client.query(
        `INSERT INTO room_messages (id, room_id, peer_id, name, text, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          id,
          roomId,
          typeof message?.peerId === 'string' ? message.peerId : '',
          typeof message?.name === 'string' ? message.name : '',
          typeof message?.text === 'string' ? message.text : '',
          toDate(createdAt),
          toDate(expiresAt)
        ]
      );

      await client.query(`UPDATE rooms SET updated_at = $2 WHERE id = $1`, [roomId, toDate(now)]);

      if (retainedMessageLimit > 0) {
        await client.query(
          `WITH ranked AS (
             SELECT id, row_number() OVER (ORDER BY created_at DESC, id DESC) AS position
             FROM room_messages
             WHERE room_id = $1 AND deleted_at IS NULL
           )
           UPDATE room_messages
           SET deleted_at = $2
           WHERE id IN (SELECT id FROM ranked WHERE position > $3)`,
          [roomId, toDate(now), retainedMessageLimit]
        );
      }

      return mapMessage(inserted.rows[0]);
    });
  }

  async function listMessages(roomId, { limit = retainedMessageLimit, now = Date.now() } = {}) {
    await getPool().query(
      `UPDATE room_messages
       SET deleted_at = $2
       WHERE room_id = $1 AND deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= $2`,
      [roomId, toDate(now)]
    );
    const boundedLimit = Math.max(0, normalizePositiveInt(limit, retainedMessageLimit));
    if (boundedLimit === 0) return [];

    const result = await getPool().query(
      `SELECT *
       FROM room_messages
       WHERE room_id = $1
         AND deleted_at IS NULL
         AND (expires_at IS NULL OR expires_at > $2)
       ORDER BY created_at ASC, id ASC
       LIMIT $3`,
      [roomId, toDate(now), boundedLimit]
    );
    return result.rows.map(mapMessage);
  }

  async function close() {
    if (activePool) {
      await activePool.end();
    }
  }

  return {
    appendMessage,
    close,
    countEmptyRoomsForIp,
    countQuotaRoomsForIp,
    countRooms,
    createRoom,
    createRoomWithQuota,
    deleteRoom,
    getRoom,
    listMessages,
    markRoomActive,
    markRoomEmpty,
    pruneRooms
  };
}

module.exports = {
  createRoomId,
  createRoomStore,
  mapMessage,
  mapRoom
};
