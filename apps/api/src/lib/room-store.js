'use strict';

const crypto = require('node:crypto');
const { createDbPool, transaction } = require('./db');

const DEFAULT_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createRowId() {
  return crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex');
}

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
    emoji: row.emoji || '',
    emptySince: row.empty_since ? toMillis(row.empty_since) : null,
    id: row.id,
    isStatic: Boolean(row.is_static),
    messages: [],
    name: row.name || '',
    ownerId: row.owner_id || null,
    peers: new Map(),
    updatedAt: toMillis(row.updated_at)
  };
}

function withRelationship(room, relationship) {
  return room ? { ...room, relationship: relationship || '' } : null;
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

  async function createRoom({
    roomId = createRoomId(),
    creatorIp,
    isStatic = false,
    ownerId = null,
    name = '',
    emoji = '',
    now = Date.now()
  }) {
    const id = String(roomId || '').trim();
    if (!id) {
      throw new Error('Room id is required');
    }

    const result = await getPool().query(
      `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name, emoji, created_at, updated_at, empty_since)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
       RETURNING *`,
      [
        id,
        typeof creatorIp === 'string' ? creatorIp : '',
        Boolean(isStatic),
        ownerId || null,
        typeof name === 'string' ? name : '',
        typeof emoji === 'string' ? emoji : '',
        toDate(now)
      ]
    );
    return mapRoom(result.rows[0]);
  }

  async function createRoomWithQuota({
    roomId = createRoomId(),
    creatorIp,
    isStatic = false,
    ownerId = null,
    name = '',
    emoji = '',
    maxOwnedStaticRoomsPerUser = 3,
    maxQuotaRoomsPerIp = 0,
    maxRooms = 100,
    maxTempRoomsPerIp = maxQuotaRoomsPerIp,
    now = Date.now()
  }) {
    const id = String(roomId || '').trim();
    if (!id) {
      throw new Error('Room id is required');
    }

    return transaction(getPool(), async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['voice-room:create-room']);

      const normalizedCreatorIp = typeof creatorIp === 'string' ? creatorIp : '';
      if (isStatic && !ownerId) {
        return { room: null, status: 'auth_required' };
      }
      if (isStatic && maxOwnedStaticRoomsPerUser > 0) {
        const ownedQuota = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM room_memberships rm
           JOIN rooms r ON r.id = rm.room_id
           WHERE rm.user_id = $1
             AND rm.role = 'owner'
             AND r.is_static = true
             AND r.deleted_at IS NULL`,
          [ownerId]
        );
        if ((ownedQuota.rows[0]?.count || 0) >= maxOwnedStaticRoomsPerUser) {
          return { room: null, status: 'quota_exceeded' };
        }
      }
      if (!isStatic && maxTempRoomsPerIp > 0) {
        const quota = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM rooms
           WHERE creator_ip = $1
             AND deleted_at IS NULL
             AND is_static = false`,
          [normalizedCreatorIp]
        );
        if ((quota.rows[0]?.count || 0) >= maxTempRoomsPerIp) {
          return { room: null, status: 'quota_exceeded' };
        }
      }

      const capacity = await client.query(`SELECT COUNT(*)::int AS count FROM rooms WHERE deleted_at IS NULL`);
      if ((capacity.rows[0]?.count || 0) >= maxRooms) {
        return { room: null, status: 'capacity_exceeded' };
      }

      const inserted = await client.query(
        `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name, emoji, created_at, updated_at, empty_since)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
         RETURNING *`,
        [
          id,
          normalizedCreatorIp,
          Boolean(isStatic),
          ownerId || null,
          typeof name === 'string' ? name : '',
          typeof emoji === 'string' ? emoji : '',
          toDate(now)
        ]
      );
      if (isStatic && ownerId) {
        await client.query(
          `INSERT INTO room_memberships (id, room_id, user_id, role, created_at, updated_at)
           VALUES ($1, $2, $3, 'owner', $4, $4)
           ON CONFLICT (room_id, user_id) DO UPDATE
           SET role = 'owner', updated_at = EXCLUDED.updated_at`,
          [createRowId(), id, ownerId, toDate(now)]
        );
      }

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
         AND is_static = false`,
      [typeof creatorIp === 'string' ? creatorIp : '']
    );
    return result.rows[0]?.count || 0;
  }

  async function countOwnedStaticRoomsForUser(userId) {
    if (!userId) return 0;
    const result = await getPool().query(
      `SELECT COUNT(*)::int AS count
       FROM room_memberships rm
       JOIN rooms r ON r.id = rm.room_id
       WHERE rm.user_id = $1
         AND rm.role = 'owner'
         AND r.is_static = true
         AND r.deleted_at IS NULL`,
      [userId]
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

  async function listRoomsForOwner(ownerId) {
    if (!ownerId) return [];
    const result = await getPool().query(
      `SELECT r.*
       FROM room_memberships rm
       JOIN rooms r ON r.id = rm.room_id
       WHERE rm.user_id = $1
         AND rm.role = 'owner'
         AND r.deleted_at IS NULL
       ORDER BY r.created_at DESC`,
      [ownerId]
    );
    return result.rows.map(mapRoom);
  }

  async function listVisibleRoomsForUser(userId) {
    if (!userId) return [];
    const result = await getPool().query(
      `WITH visible AS (
         SELECT r.*, 'owner'::text AS relationship, 1 AS priority
         FROM room_memberships rm
         JOIN rooms r ON r.id = rm.room_id
         WHERE rm.user_id = $1
           AND rm.role = 'owner'
           AND r.is_static = true
           AND r.deleted_at IS NULL
         UNION ALL
         SELECT r.*, 'bookmarked'::text AS relationship, 2 AS priority
         FROM room_bookmarks rb
         JOIN rooms r ON r.id = rb.room_id
         WHERE rb.user_id = $1
           AND r.is_static = true
           AND r.deleted_at IS NULL
       ), deduped AS (
         SELECT DISTINCT ON (id) *
         FROM visible
         ORDER BY id, priority ASC, created_at DESC
       )
       SELECT * FROM deduped
       ORDER BY created_at DESC, id ASC`,
      [userId]
    );
    return result.rows.map((row) => withRelationship(mapRoom(row), row.relationship));
  }

  async function addRoomBookmarkForUser(userId, roomId, now = Date.now()) {
    if (!userId || !roomId) return { room: null, status: 'not_found' };
    return transaction(getPool(), async (client) => {
      const roomResult = await client.query(
        `SELECT * FROM rooms WHERE id = $1 AND deleted_at IS NULL`,
        [roomId]
      );
      const room = mapRoom(roomResult.rows[0]);
      if (!room) return { room: null, status: 'not_found' };
      if (!room.isStatic) return { room: null, status: 'temporary_room' };

      await client.query(
        `INSERT INTO room_bookmarks (id, room_id, user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (user_id, room_id) DO UPDATE
         SET updated_at = EXCLUDED.updated_at`,
        [createRowId(), room.id, userId, toDate(now)]
      );

      const owner = await client.query(
        `SELECT 1 FROM room_memberships
         WHERE room_id = $1 AND user_id = $2 AND role = 'owner'
         LIMIT 1`,
        [room.id, userId]
      );
      return {
        room: withRelationship(room, owner.rowCount > 0 ? 'owner' : 'bookmarked'),
        status: 'bookmarked'
      };
    });
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
    countOwnedStaticRoomsForUser,
    countQuotaRoomsForIp,
    countRooms,
    createRoom,
    createRoomWithQuota,
    deleteRoom,
    getRoom,
    listMessages,
    listRoomsForOwner,
    listVisibleRoomsForUser,
    addRoomBookmarkForUser,
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
