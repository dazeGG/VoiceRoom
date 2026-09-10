'use strict';

const crypto = require('node:crypto');

function asDate(value) {
  if (value instanceof Date) return value;
  const number = Number(value);
  return new Date(Number.isFinite(number) ? number : Date.now());
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapModerationBan(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    subject: {
      kind: row.user_id ? 'account' : 'guest',
      userId: row.user_id || null
    },
    reason: row.reason || '',
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at || row.created_at),
    expiresAt: row.expires_at ? toMillis(row.expires_at) : null
  };
}

function createModerationRepository({ cursorCodec, pool } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  if (!cursorCodec?.encode || !cursorCodec?.decode) throw new TypeError('Cursor codec is required');
  const executor = (client) => client?.query ? client : pool;

  function encodeCursor(roomId, row) {
    if (!row?.created_at || !row?.id) return undefined;
    const createdAtMicros = row.created_at_micros
      ? String(row.created_at_micros)
      : (BigInt(new Date(row.created_at).getTime()) * 1000n).toString();
    return cursorCodec.encode({
      purpose: 'moderation-bans',
      context: `room:${roomId}`,
      tuple: {
        createdAtMicros,
        id: row.id
      }
    });
  }

  function decodeCursor(roomId, value) {
    if (!value) return null;
    try {
      return cursorCodec.decode(value, {
        purpose: 'moderation-bans',
        context: `room:${roomId}`
      });
    } catch {
      return null;
    }
  }

  async function isRoomOwner(roomId, userId, { client } = {}) {
    if (!roomId || !userId) return false;
    const result = await executor(client).query(
      'SELECT 1 FROM rooms WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL LIMIT 1',
      [roomId, userId]
    );
    return result.rowCount > 0;
  }

  async function countActive(roomId, { at = Date.now(), client } = {}) {
    const result = await executor(client).query(
      `SELECT COUNT(*)::int AS count
       FROM room_bans
       WHERE room_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > $2)`,
      [roomId, asDate(at)]
    );
    return Number(result.rows[0]?.count || 0);
  }

  async function findByIdempotencyKey(roomId, idempotencyKey, { client } = {}) {
    if (!roomId || !idempotencyKey) return null;
    const result = await executor(client).query(
      'SELECT * FROM room_bans WHERE room_id = $1 AND idempotency_key = $2 LIMIT 1',
      [roomId, idempotencyKey]
    );
    return mapModerationBan(result.rows[0]);
  }

  async function findActivePrincipal({ roomId, userId = null, guestIp = null, at = Date.now(), client } = {}) {
    const result = await executor(client).query(
      `SELECT *
       FROM room_bans
       WHERE room_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > $4)
         AND (($2::varchar(36) IS NOT NULL AND user_id = $2)
           OR ($2::varchar(36) IS NULL AND user_id IS NULL AND ip = $3))
       ORDER BY created_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [roomId, userId, guestIp || '', asDate(at)]
    );
    return result.rows[0] || null;
  }

  async function create({ roomId, userId = null, guestIp = null, expiresAt, reason = '', idempotencyKey, at = Date.now(), client } = {}) {
    const timestamp = asDate(at);
    const result = await executor(client).query(
      `INSERT INTO room_bans
         (id, room_id, user_id, ip, created_at, expires_at, metadata, reason, idempotency_key, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7, $8, $5)
       RETURNING *`,
      [crypto.randomUUID(), roomId, userId, userId ? '' : guestIp, timestamp,
        expiresAt == null ? null : asDate(expiresAt), reason, idempotencyKey]
    );
    return mapModerationBan(result.rows[0]);
  }

  async function updateActive({ id, expiresAt, reason = '', idempotencyKey, at = Date.now(), client } = {}) {
    const timestamp = asDate(at);
    const result = await executor(client).query(
      `UPDATE room_bans
       SET expires_at = $2, reason = $3, idempotency_key = $4, updated_at = $5
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING *`,
      [id, expiresAt == null ? null : asDate(expiresAt), reason, idempotencyKey, timestamp]
    );
    return mapModerationBan(result.rows[0]);
  }

  async function listActive({ roomId, cursor = null, limit = 50, at = Date.now(), client } = {}) {
    const after = cursor ? decodeCursor(roomId, cursor) : null;
    if (cursor && !after) {
      const error = new Error('Invalid moderation cursor');
      error.code = 'invalid_cursor';
      throw error;
    }
    const result = await executor(client).query(
      `SELECT *, FLOOR(EXTRACT(EPOCH FROM created_at) * 1000000)::bigint::text AS created_at_micros
       FROM room_bans
       WHERE room_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > $2)
         AND ($3::bigint IS NULL OR (created_at, id) < (
           TIMESTAMPTZ 'epoch' + $3::bigint * INTERVAL '1 microsecond', $4::varchar(36)
         ))
       ORDER BY created_at DESC, id DESC
       LIMIT $5`,
      [roomId, asDate(at), after?.createdAtMicros || null, after?.id || null, limit + 1]
    );
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    return {
      bans: rows.map(mapModerationBan),
      hasMore,
      nextCursor: hasMore ? encodeCursor(roomId, rows.at(-1)) : undefined
    };
  }

  async function revoke({ roomId, banId, at = Date.now(), client } = {}) {
    const result = await executor(client).query(
      `UPDATE room_bans
       SET revoked_at = COALESCE(revoked_at, $3),
           expires_at = CASE WHEN revoked_at IS NULL THEN $3 ELSE expires_at END,
           updated_at = CASE WHEN revoked_at IS NULL THEN $3 ELSE updated_at END
       WHERE room_id = $1 AND id = $2
       RETURNING *`,
      [roomId, banId, asDate(at)]
    );
    return result.rows[0] ? { ban: mapModerationBan(result.rows[0]), found: true } : { ban: null, found: false };
  }

  return Object.freeze({
    countActive,
    create,
    decodeCursor,
    findActivePrincipal,
    findByIdempotencyKey,
    isRoomOwner,
    listActive,
    mapModerationBan,
    revoke,
    updateActive
  });
}

module.exports = { createModerationRepository, mapModerationBan };
