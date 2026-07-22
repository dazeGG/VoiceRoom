'use strict';

const crypto = require('node:crypto');

function toDate(value) {
  if (value instanceof Date) return value;
  const numeric = Number(value);
  return new Date(Number.isFinite(numeric) ? numeric : Date.now());
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapActiveBan(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id || null,
    ip: row.ip || '',
    createdAt: toMillis(row.created_at),
    expiresAt: row.expires_at ? toMillis(row.expires_at) : null,
    metadata: row.metadata || {}
  };
}

function normalizePrincipal({ userId = null, ip = '' } = {}) {
  const accountId = typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  return {
    userId: accountId,
    ip: accountId ? '' : (typeof ip === 'string' ? ip.trim() : '')
  };
}

function createActiveBanRepository({ pool, now = Date.now } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required');

  function executor(client) {
    return client && typeof client.query === 'function' ? client : pool;
  }

  async function findActive({ roomId, userId = null, ip = '', at = now(), client } = {}) {
    const normalizedUserId = typeof userId === 'string' && userId.trim() ? userId.trim() : null;
    const normalizedIp = typeof ip === 'string' ? ip.trim() : '';
    if (!roomId || (!normalizedUserId && !normalizedIp)) return null;
    const result = await executor(client).query(
      `SELECT *
       FROM room_bans
       WHERE room_id = $1
         AND (expires_at IS NULL OR expires_at > $4)
         AND (
           ($2::varchar(36) IS NOT NULL AND user_id = $2)
           OR (user_id IS NULL AND $3::text <> '' AND ip = $3)
         )
       ORDER BY CASE WHEN user_id IS NOT NULL THEN 0 ELSE 1 END,
                created_at DESC,
                id DESC
       LIMIT 1`,
      [roomId, normalizedUserId, normalizedIp, toDate(at)]
    );
    return mapActiveBan(result.rows[0]);
  }

  async function countActive(roomId, { at = now(), client } = {}) {
    if (!roomId) return 0;
    const result = await executor(client).query(
      `SELECT COUNT(*)::int AS count
       FROM room_bans
       WHERE room_id = $1
         AND (expires_at IS NULL OR expires_at > $2)`,
      [roomId, toDate(at)]
    );
    return Number(result.rows[0]?.count || 0);
  }

  async function insert({ roomId, userId = null, ip = '', expiresAt = null, metadata = {}, at = now(), client } = {}) {
    const principal = normalizePrincipal({ userId, ip });
    if (!roomId || (!principal.userId && !principal.ip)) return null;
    const result = await executor(client).query(
      `INSERT INTO room_bans (id, room_id, user_id, ip, created_at, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        crypto.randomUUID(),
        roomId,
        principal.userId,
        principal.ip,
        toDate(at),
        expiresAt == null ? null : toDate(expiresAt),
        metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
      ]
    );
    return mapActiveBan(result.rows[0]);
  }

  return { countActive, findActive, insert, mapActiveBan, normalizePrincipal };
}

module.exports = { createActiveBanRepository, mapActiveBan, normalizePrincipal };
