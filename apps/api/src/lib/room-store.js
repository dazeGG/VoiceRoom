'use strict';

const crypto = require('node:crypto');
const { createDbPool, transaction } = require('./db');
const {
  AVATAR_COLOR_KEYS,
  ROOM_PRESETS,
  cleanAvatarColorKey,
  cleanRoomColorKey,
  cleanRoomEmoji,
  cleanRoomIconKey,
  cleanRoomPresetKey,
  getRoomPreset
} = require('@voice-room/shared/validation');

const DEFAULT_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_ROOM_PRESET = ROOM_PRESETS[0];

function presetFromEmoji(emoji) {
  return ROOM_PRESETS.find((preset) => preset.emoji === emoji) || null;
}

function presetFromVisualKeys(iconKey, colorKey) {
  return ROOM_PRESETS.find((preset) => preset.iconKey === iconKey && preset.colorKey === colorKey) || null;
}

function emojiFromIconKey(iconKey) {
  return ROOM_PRESETS.find((preset) => preset.iconKey === iconKey)?.emoji || DEFAULT_ROOM_PRESET.emoji;
}

function normalizeRoomVisuals({ emoji = '', roomColorKey = '', roomIconKey = '', roomPresetKey = '' } = {}) {
  const legacyEmoji = cleanRoomEmoji(emoji);
  const explicitIconKey = cleanRoomIconKey(roomIconKey);
  const explicitColorKey = cleanRoomColorKey(roomColorKey);
  const preset = getRoomPreset(cleanRoomPresetKey(roomPresetKey));
  const legacyPreset = presetFromEmoji(legacyEmoji);
  const iconKey = explicitIconKey || preset?.iconKey || legacyPreset?.iconKey || DEFAULT_ROOM_PRESET.iconKey;
  const colorKey = explicitColorKey || preset?.colorKey || legacyPreset?.colorKey || DEFAULT_ROOM_PRESET.colorKey;
  const matchedPreset = presetFromVisualKeys(iconKey, colorKey);
  const hasExplicitVisualKey = Boolean(explicitIconKey || explicitColorKey || preset);
  return {
    emoji: matchedPreset?.emoji || (hasExplicitVisualKey ? emojiFromIconKey(iconKey) : legacyEmoji) || DEFAULT_ROOM_PRESET.emoji,
    roomColorKey: colorKey,
    roomIconKey: iconKey,
    roomPresetKey: matchedPreset?.key || ''
  };
}


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
  const visuals = normalizeRoomVisuals({
    emoji: row.emoji || '',
    roomColorKey: row.room_color_key || '',
    roomIconKey: row.room_icon_key || ''
  });
  return {
    createdAt: toMillis(row.created_at),
    creatorIp: row.creator_ip || '',
    emoji: visuals.emoji,
    emptySince: row.empty_since ? toMillis(row.empty_since) : null,
    id: row.id,
    isStatic: Boolean(row.is_static),
    messages: [],
    name: row.name || '',
    ownerId: row.owner_id || null,
    peers: new Map(),
    roomColorKey: visuals.roomColorKey,
    roomIconKey: visuals.roomIconKey,
    roomPresetKey: visuals.roomPresetKey,
    updatedAt: toMillis(row.updated_at)
  };
}

function withRelationship(room, relationship) {
  return room ? { ...room, relationship: relationship || '' } : null;
}

function hashPeerSessionToken(sessionToken) {
  return crypto.createHash('sha256').update(String(sessionToken || '')).digest('hex');
}

function hashesMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string' || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function avatarColorForPeerId(peerId) {
  const digest = crypto.createHash('sha256').update(String(peerId || '')).digest();
  return AVATAR_COLOR_KEYS[digest[0] % AVATAR_COLOR_KEYS.length];
}

function mapPeerIdentity(row) {
  if (!row) return null;
  return {
    avatarColorKey: row.avatar_color_key || avatarColorForPeerId(row.peer_id),
    createdAt: toMillis(row.created_at),
    displayName: row.display_name || '',
    lastSeenAt: toMillis(row.last_seen_at),
    peerId: row.peer_id || '',
    roomId: row.room_id,
    sessionTokenHash: row.session_token_hash || ''
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    createdAt: toMillis(row.created_at),
    expiresAt: row.expires_at ? toMillis(row.expires_at) : null,
    id: row.id,
    avatarColorKey: row.avatar_color_key || avatarColorForPeerId(row.peer_id),
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
    roomColorKey = '',
    roomIconKey = '',
    roomPresetKey = '',
    now = Date.now()
  }) {
    const id = String(roomId || '').trim();
    if (!id) {
      throw new Error('Room id is required');
    }

    const visuals = normalizeRoomVisuals({ emoji, roomColorKey, roomIconKey, roomPresetKey });
    const result = await getPool().query(
      `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name, emoji, room_icon_key, room_color_key, created_at, updated_at, empty_since)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9)
       RETURNING *`,
      [
        id,
        typeof creatorIp === 'string' ? creatorIp : '',
        Boolean(isStatic),
        ownerId || null,
        typeof name === 'string' ? name : '',
        visuals.emoji,
        visuals.roomIconKey,
        visuals.roomColorKey,
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
    roomColorKey = '',
    roomIconKey = '',
    roomPresetKey = '',
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

      const visuals = normalizeRoomVisuals({ emoji, roomColorKey, roomIconKey, roomPresetKey });
      const inserted = await client.query(
        `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name, emoji, room_icon_key, room_color_key, created_at, updated_at, empty_since)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9)
         RETURNING *`,
        [
          id,
          normalizedCreatorIp,
          Boolean(isStatic),
          ownerId || null,
          typeof name === 'string' ? name : '',
          visuals.emoji,
          visuals.roomIconKey,
          visuals.roomColorKey,
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

  async function getOrCreatePeerIdentity({ roomId, peerId, sessionToken, displayName = '', avatarColorKey = '', now = Date.now() }) {
    if (!roomId || !peerId || !sessionToken) return { identity: null, status: 'invalid' };
    const sessionTokenHash = hashPeerSessionToken(sessionToken);
    const seenAt = toDate(now);
    const nextDisplayName = typeof displayName === 'string' ? displayName : '';
    const preferredAvatarColorKey = cleanAvatarColorKey(avatarColorKey);

    async function reuseExisting(client, status = 'reused') {
      const existing = await client.query(
        `SELECT * FROM room_peer_identities WHERE room_id = $1 AND peer_id = $2 FOR UPDATE`,
        [roomId, peerId]
      );
      const identity = existing.rows[0];
      if (!identity) return null;
      if (!hashesMatch(identity.session_token_hash, sessionTokenHash)) {
        return { identity: mapPeerIdentity(identity), status: 'token_mismatch' };
      }
      const updated = await client.query(
        `UPDATE room_peer_identities
         SET display_name = $4,
             last_seen_at = $3,
             avatar_color_key = CASE WHEN $5 <> '' THEN $5 ELSE avatar_color_key END,
             metadata = COALESCE(metadata, '{}'::jsonb)
         WHERE room_id = $1 AND peer_id = $2
         RETURNING *`,
        [roomId, peerId, seenAt, nextDisplayName, preferredAvatarColorKey]
      );
      return { identity: mapPeerIdentity(updated.rows[0]), status };
    }

    return transaction(getPool(), async (client) => {
      const existingResult = await reuseExisting(client);
      if (existingResult) return existingResult;

      const inserted = await client.query(
        `INSERT INTO room_peer_identities (id, room_id, peer_id, session_token_hash, avatar_color_key, display_name, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (room_id, peer_id) DO NOTHING
         RETURNING *`,
        [
          createRowId(),
          roomId,
          peerId,
          sessionTokenHash,
          preferredAvatarColorKey || avatarColorForPeerId(`${roomId}:${peerId}:${sessionTokenHash}`),
          nextDisplayName,
          seenAt
        ]
      );
      if (inserted.rows[0]) return { identity: mapPeerIdentity(inserted.rows[0]), status: 'created' };
      return reuseExisting(client, 'reused');
    });
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

  async function markActiveTemporaryRoomsEmpty(now = Date.now()) {
    const result = await getPool().query(
      `UPDATE rooms
       SET empty_since = $1, updated_at = $1
       WHERE deleted_at IS NULL
         AND is_static = false
         AND empty_since IS NULL`,
      [toDate(now)]
    );
    return result.rowCount;
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
      `SELECT recent.*, rpi.avatar_color_key
       FROM (
         SELECT *
         FROM room_messages
         WHERE room_id = $1
           AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > $2)
         ORDER BY created_at DESC, id DESC
         LIMIT $3
       ) recent
       LEFT JOIN room_peer_identities rpi
         ON rpi.room_id = recent.room_id
        AND rpi.peer_id = recent.peer_id
       ORDER BY recent.created_at ASC, recent.id ASC`,
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
    getOrCreatePeerIdentity,
    getRoom,
    listMessages,
    listRoomsForOwner,
    listVisibleRoomsForUser,
    addRoomBookmarkForUser,
    markActiveTemporaryRoomsEmpty,
    markRoomActive,
    markRoomEmpty,
    pruneRooms
  };
}

module.exports = {
  createRoomId,
  createRoomStore,
  avatarColorForPeerId,
  hashPeerSessionToken,
  hashesMatch,
  mapMessage,
  mapPeerIdentity,
  mapRoom,
  normalizeRoomVisuals
};
