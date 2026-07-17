'use strict';

const crypto = require('node:crypto');
const { createDbPool, transaction } = require('./db');
const {
  AVATAR_COLOR_KEYS,
  cleanAvatarColorKey
} = require('@voice-room/shared/validation');

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
    avatarKey: row.avatar_key || null,
    createdAt: toMillis(row.created_at),
    creatorIp: row.creator_ip || '',
    emptySince: row.empty_since ? toMillis(row.empty_since) : null,
    id: row.id,
    isStatic: Boolean(row.is_static),
    lastMessageAt: Object.hasOwn(row, 'last_message_at')
      ? (row.last_message_at ? toMillis(row.last_message_at) : null)
      : undefined,
    messages: [],
    name: row.name || '',
    ownerId: row.owner_id || null,
    peers: new Map(),
    unreadCount: Object.hasOwn(row, 'unread_count') ? normalizePositiveInt(row.unread_count, 0) : undefined,
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

function mapRoomBan(row) {
  if (!row) return null;
  return {
    createdAt: toMillis(row.created_at),
    expiresAt: row.expires_at ? toMillis(row.expires_at) : null,
    id: row.id,
    ip: row.ip || '',
    metadata: row.metadata || {},
    roomId: row.room_id,
    userId: row.user_id || null
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    avatarAccent: row.avatar_accent || null,
    createdAt: toMillis(row.created_at),
    expiresAt: row.expires_at ? toMillis(row.expires_at) : null,
    id: row.id,
    avatarKey: row.avatar_key || null,
    avatarColorKey: row.avatar_color_key || avatarColorForPeerId(row.peer_id),
    editedAt: row.edited_at ? toMillis(row.edited_at) : null,
    name: row.name || '',
    peerId: row.peer_id || '',
    roomId: row.room_id,
    text: row.text || '',
    // 2.4.0: author for ownership (nullable for guests/legacy)
    authorUserId: row.author_user_id || null
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
    now = Date.now()
  }) {
    const id = String(roomId || '').trim();
    if (!id) {
      throw new Error('Room id is required');
    }

    const result = await getPool().query(
      `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name, created_at, updated_at, empty_since)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
       RETURNING *`,
      [
        id,
        typeof creatorIp === 'string' ? creatorIp : '',
        Boolean(isStatic),
        ownerId || null,
        typeof name === 'string' ? name : '',
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
        `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name, created_at, updated_at, empty_since)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
         RETURNING *`,
        [
          id,
          normalizedCreatorIp,
          Boolean(isStatic),
          ownerId || null,
          typeof name === 'string' ? name : '',
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

  async function roomIdExists(roomId) {
    const result = await getPool().query(
      `SELECT 1 FROM rooms WHERE id = $1 LIMIT 1`,
      [roomId]
    );
    return result.rowCount > 0;
  }

  async function updateRoom(roomId, { name = '' } = {}, now = Date.now()) {
    const result = await getPool().query(
      `UPDATE rooms
       SET name = $2, updated_at = $3
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [
        roomId,
        typeof name === 'string' ? name : '',
        toDate(now)
      ]
    );
    return mapRoom(result.rows[0]);
  }

  async function updateRoomAvatar(roomId, avatarKey = null, now = Date.now()) {
    const result = await getPool().query(
      `UPDATE rooms
       SET avatar_key = $2, updated_at = $3
       WHERE id = $1 AND deleted_at IS NULL AND is_static = true
       RETURNING *`,
      [roomId, avatarKey || null, toDate(now)]
    );
    return mapRoom(result.rows[0]);
  }

  async function swapRoomAvatar(roomId, avatarKey = null, now = Date.now()) {
    return transaction(getPool(), async (client) => {
      const current = await client.query(
        `SELECT avatar_key
         FROM rooms
         WHERE id = $1 AND deleted_at IS NULL AND is_static = true
         FOR UPDATE`,
        [roomId]
      );
      if (current.rowCount === 0) return { previousAvatarKey: null, room: null };
      const result = await client.query(
        `UPDATE rooms SET avatar_key = $2, updated_at = $3 WHERE id = $1 RETURNING *`,
        [roomId, avatarKey || null, toDate(now)]
      );
      return {
        previousAvatarKey: current.rows[0].avatar_key || null,
        room: mapRoom(result.rows[0])
      };
    });
  }

  async function listAvatarKeys() {
    const result = await getPool().query(
      `SELECT avatar_key
       FROM rooms
       WHERE avatar_key IS NOT NULL AND deleted_at IS NULL`
    );
    return result.rows.map((row) => row.avatar_key).filter(Boolean);
  }

  async function deleteRoom(roomId, now = Date.now()) {
    const result = await getPool().query(
      `UPDATE rooms
       SET deleted_at = COALESCE(deleted_at, $2), updated_at = $2
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [roomId, toDate(now)]
    );
    return mapRoom(result.rows[0]);
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

  async function invalidatePeerIdentity({ roomId, peerId, now = Date.now() } = {}) {
    if (!roomId || !peerId) return false;
    const invalidSessionTokenHash = hashPeerSessionToken(`invalidated:${createRowId()}`);
    const result = await getPool().query(
      `UPDATE room_peer_identities
       SET session_token_hash = $3, last_seen_at = $4
       WHERE room_id = $1 AND peer_id = $2`,
      [roomId, peerId, invalidSessionTokenHash, toDate(now)]
    );
    return result.rowCount > 0;
  }

  async function createRoomBan({ roomId, userId = null, ip = '', maxBans = 100, metadata = {}, now = Date.now() } = {}) {
    const normalizedUserId = typeof userId === 'string' && userId ? userId : null;
    // Account and IP bans are intentionally exclusive. Persisting both turns
    // an account moderation action into a shared-network ban.
    const normalizedIp = normalizedUserId ? '' : (typeof ip === 'string' ? ip : '');
    if (!roomId || (!normalizedUserId && !normalizedIp)) return { ban: null, status: 'invalid' };

    return transaction(getPool(), async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`voice-room:room-bans:${roomId}`]);

      const room = await client.query(
        `SELECT 1 FROM rooms WHERE id = $1 AND deleted_at IS NULL`,
        [roomId]
      );
      if (room.rowCount === 0) return { ban: null, status: 'not_found' };

      const limit = normalizePositiveInt(maxBans, 100);
      if (limit > 0) {
        const count = await client.query(
          `SELECT COUNT(*)::int AS count FROM room_bans WHERE room_id = $1`,
          [roomId]
        );
        if ((count.rows[0]?.count || 0) >= limit) {
          return { ban: null, status: 'cap_exceeded' };
        }
      }

      const inserted = await client.query(
        `INSERT INTO room_bans (id, room_id, user_id, ip, created_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          createRowId(),
          roomId,
          normalizedUserId,
          normalizedIp,
          toDate(now),
          metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
        ]
      );
      return { ban: mapRoomBan(inserted.rows[0]), status: 'created' };
    });
  }

  async function deleteRoomBan({ roomId, banId } = {}) {
    if (!roomId || !banId) return { ban: null, status: 'not_found' };
    const result = await getPool().query(
      `DELETE FROM room_bans WHERE room_id = $1 AND id = $2 RETURNING *`,
      [roomId, banId]
    );
    const ban = mapRoomBan(result.rows[0]);
    return { ban, status: ban ? 'deleted' : 'not_found' };
  }

  async function findActiveRoomBan({ roomId, userId = null, ip = '' } = {}) {
    const normalizedUserId = typeof userId === 'string' && userId ? userId : null;
    const normalizedIp = typeof ip === 'string' ? ip : '';
    if (!roomId || (!normalizedUserId && !normalizedIp)) return null;
    const result = await getPool().query(
      `SELECT *
       FROM room_bans
       WHERE room_id = $1
         AND (
           ($2::text IS NOT NULL AND user_id = $2)
           OR (user_id IS NULL AND $3::text <> '' AND ip = $3)
         )
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [roomId, normalizedUserId, normalizedIp]
    );
    return mapRoomBan(result.rows[0]);
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

  async function purgeDeleted({ olderThanMs = 30 * 24 * 60 * 60 * 1000, batchSize = 5000, now = Date.now() } = {}) {
    const cutoff = toDate(now - normalizePositiveInt(olderThanMs, 30 * 24 * 60 * 60 * 1000));
    const limit = Math.max(1, normalizePositiveInt(batchSize, 5000));
    return transaction(getPool(), async (client) => {
      const messages = await client.query(
        `WITH doomed AS (
           SELECT id FROM room_messages
           WHERE deleted_at IS NOT NULL AND deleted_at < $1
           ORDER BY deleted_at ASC
           LIMIT $2
         )
         DELETE FROM room_messages
         WHERE id IN (SELECT id FROM doomed)`,
        [cutoff, limit]
      );
      const rooms = await client.query(
        `WITH doomed AS (
           SELECT id FROM rooms
           WHERE deleted_at IS NOT NULL AND deleted_at < $1
           ORDER BY deleted_at ASC
           LIMIT $2
         )
         DELETE FROM rooms
         WHERE id IN (SELECT id FROM doomed)`,
        [cutoff, limit]
      );
      const identities = await client.query(
        `WITH doomed AS (
           SELECT id FROM room_peer_identities
           WHERE last_seen_at < $1
           ORDER BY last_seen_at ASC
           LIMIT $2
         )
         DELETE FROM room_peer_identities
         WHERE id IN (SELECT id FROM doomed)`,
        [cutoff, limit]
      );
      return { messages: messages.rowCount, rooms: rooms.rowCount, identities: identities.rowCount };
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
        `INSERT INTO room_messages (id, room_id, peer_id, name, text, created_at, expires_at, author_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          id,
          roomId,
          typeof message?.peerId === 'string' ? message.peerId : '',
          typeof message?.authorUserId === 'string'
            ? ''
            : (typeof message?.name === 'string' ? message.name : ''),
          typeof message?.text === 'string' ? message.text : '',
          toDate(createdAt),
          toDate(expiresAt),
          typeof message?.authorUserId === 'string' ? message.authorUserId : null
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
      `SELECT recent.*,
              COALESCE(NULLIF(u.display_name, ''), u.login, recent.name) AS name,
              COALESCE(u.avatar_color_key, rpi.avatar_color_key) AS avatar_color_key,
              u.avatar_key,
              u.avatar_accent
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
       LEFT JOIN users u
         ON u.id = recent.author_user_id
       ORDER BY recent.created_at ASC, recent.id ASC`,
      [roomId, toDate(now), boundedLimit]
    );
    return result.rows.map(mapMessage);
  }

  async function getMessage(roomId, messageId) {
    const result = await getPool().query(
      `SELECT m.*,
              COALESCE(NULLIF(u.display_name, ''), u.login, m.name) AS name,
              COALESCE(u.avatar_color_key, rpi.avatar_color_key) AS avatar_color_key,
              u.avatar_key,
              u.avatar_accent
       FROM room_messages m
       LEFT JOIN room_peer_identities rpi
         ON rpi.room_id = m.room_id AND rpi.peer_id = m.peer_id
       LEFT JOIN users u
         ON u.id = m.author_user_id
       WHERE m.room_id = $1 AND m.id = $2 AND m.deleted_at IS NULL
       LIMIT 1`,
      [roomId, messageId]
    );
    return mapMessage(result.rows[0] || null);
  }

  async function softDeleteMessage(roomId, messageId) {
    const result = await getPool().query(
      `UPDATE room_messages
       SET deleted_at = now()
       WHERE room_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [roomId, messageId]
    );
    return result.rowCount > 0;
  }

  async function editMessage(roomId, messageId, text) {
    const result = await getPool().query(
      `WITH updated AS (
         UPDATE room_messages
         SET text = $3, edited_at = current_timestamp
         WHERE room_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING *
       )
       SELECT updated.*,
              COALESCE(NULLIF(u.display_name, ''), u.login, updated.name) AS name,
              COALESCE(u.avatar_color_key, rpi.avatar_color_key) AS avatar_color_key,
              u.avatar_key,
              u.avatar_accent
       FROM updated
       LEFT JOIN room_peer_identities rpi
         ON rpi.room_id = updated.room_id AND rpi.peer_id = updated.peer_id
       LEFT JOIN users u
         ON u.id = updated.author_user_id`,
      [roomId, messageId, text]
    );
    return mapMessage(result.rows[0] || null);
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
       SELECT deduped.*,
              (
                SELECT MAX(m.created_at)
                FROM room_messages m
                WHERE m.room_id = deduped.id
                  AND m.deleted_at IS NULL
                  AND (m.expires_at IS NULL OR m.expires_at > current_timestamp)
              ) AS last_message_at,
              (
                SELECT COUNT(*)::int
                FROM room_messages m
                LEFT JOIN room_chat_reads rcr
                  ON rcr.room_id = m.room_id AND rcr.user_id = $1
                WHERE m.room_id = deduped.id
                  AND m.deleted_at IS NULL
                  AND (m.expires_at IS NULL OR m.expires_at > current_timestamp)
                  AND m.created_at > COALESCE(rcr.last_read_at, '-infinity'::timestamptz)
                  AND m.author_user_id IS DISTINCT FROM $1
              ) AS unread_count
       FROM deduped
       ORDER BY created_at DESC, id ASC`,
      [userId]
    );
    return result.rows.map((row) => withRelationship(mapRoom(row), row.relationship));
  }

  async function getRoomUnreadCount(roomId, userId, now = Date.now()) {
    if (!roomId || !userId) return 0;
    const result = await getPool().query(
      `SELECT COUNT(*)::int AS unread_count
       FROM room_messages m
       LEFT JOIN room_chat_reads rcr
         ON rcr.room_id = m.room_id AND rcr.user_id = $2
       WHERE m.room_id = $1
         AND m.deleted_at IS NULL
         AND (m.expires_at IS NULL OR m.expires_at > $3)
         AND m.created_at > COALESCE(rcr.last_read_at, '-infinity'::timestamptz)
         AND m.author_user_id IS DISTINCT FROM $2`,
      [roomId, userId, toDate(now)]
    );
    return normalizePositiveInt(result.rows[0]?.unread_count, 0);
  }

  async function markRoomChatRead(roomId, userId, now = Date.now()) {
    if (!roomId || !userId) return null;
    const result = await getPool().query(
      `INSERT INTO room_chat_reads (room_id, user_id, last_read_at)
       SELECT r.id, $2::varchar(36), $3::timestamptz
       FROM rooms r
       WHERE r.id = $1::varchar(48)
         AND r.deleted_at IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM room_memberships rm
             WHERE rm.room_id = r.id AND rm.user_id = $2::varchar(36) AND rm.role = 'owner'
           )
           OR EXISTS (
             SELECT 1 FROM room_bookmarks rb
             WHERE rb.room_id = r.id AND rb.user_id = $2::varchar(36)
           )
         )
       ON CONFLICT (room_id, user_id) DO UPDATE
       SET last_read_at = GREATEST(room_chat_reads.last_read_at, EXCLUDED.last_read_at)
       RETURNING last_read_at`,
      [roomId, userId, toDate(now)]
    );
    return result.rows[0]?.last_read_at ? toMillis(result.rows[0].last_read_at) : null;
  }

  async function listSummaryRecipientUserIds(roomId) {
    if (!roomId) return [];
    const result = await getPool().query(
      `WITH recipients AS (
         SELECT rm.user_id
         FROM room_memberships rm
         JOIN rooms r ON r.id = rm.room_id
         WHERE rm.room_id = $1
           AND rm.role = 'owner'
           AND r.deleted_at IS NULL
         UNION ALL
         SELECT rb.user_id
         FROM room_bookmarks rb
         JOIN rooms r ON r.id = rb.room_id
         WHERE rb.room_id = $1
           AND r.deleted_at IS NULL
       )
       SELECT DISTINCT user_id
       FROM recipients`,
      [roomId]
    );
    return result.rows.map((row) => row.user_id).filter(Boolean);
  }

  async function listNotificationRecipientUserIds(roomId) {
    if (!roomId) return [];
    const result = await getPool().query(
      `WITH recipients AS (
         SELECT rm.user_id
         FROM room_memberships rm
         JOIN rooms r ON r.id = rm.room_id
         WHERE rm.room_id = $1
           AND rm.role = 'owner'
           AND r.is_static = true
           AND r.deleted_at IS NULL
         UNION ALL
         SELECT rb.user_id
         FROM room_bookmarks rb
         JOIN rooms r ON r.id = rb.room_id
         WHERE rb.room_id = $1
           AND r.is_static = true
           AND r.deleted_at IS NULL
       )
       SELECT DISTINCT recipients.user_id
       FROM recipients`,
      [roomId]
    );
    return result.rows.map((row) => row.user_id).filter(Boolean);
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
    createRoomBan,
    createRoomWithQuota,
    deleteRoomBan,
    deleteRoom,
    editMessage,
    findActiveRoomBan,
    getOrCreatePeerIdentity,
    getRoom,
    listMessages,
    listAvatarKeys,
    getMessage,
    getRoomUnreadCount,
    softDeleteMessage,
    listRoomsForOwner,
    listVisibleRoomsForUser,
    listSummaryRecipientUserIds,
    listNotificationRecipientUserIds,
    addRoomBookmarkForUser,
    markActiveTemporaryRoomsEmpty,
    markRoomActive,
    markRoomChatRead,
    markRoomEmpty,
    invalidatePeerIdentity,
    pruneRooms,
    purgeDeleted,
    roomIdExists,
    swapRoomAvatar,
    updateRoom,
    updateRoomAvatar
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
  mapRoom
};
