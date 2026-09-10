'use strict';

const crypto = require('node:crypto');

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapMembership(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    role: row.role === 'owner' ? 'owner' : 'member',
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at),
    metadata: row.metadata || {}
  };
}

function mapDirectoryMember(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    displayName: row.display_name || '',
    login: row.login || '',
    avatarColorKey: row.avatar_color_key || '',
    avatarUrl: row.avatar_key ? `/api/avatars/${encodeURIComponent(row.avatar_key)}` : null,
    avatarAccent: row.avatar_accent || null,
    role: row.role === 'owner' ? 'owner' : 'member',
    joinedAt: toMillis(row.created_at),
    cursorTuple: {
      createdAtMicros: String(row.created_at_micros),
      id: row.user_id
    }
  };
}

function createMembershipRepository({ pool } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required');
  const executor = (client) => client && typeof client.query === 'function' ? client : pool;

  async function getActive(roomId, userId, { client } = {}) {
    if (!roomId || !userId) return null;
    const result = await executor(client).query(
      `SELECT * FROM room_memberships WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [roomId, userId]
    );
    return mapMembership(result.rows[0]);
  }

  async function isActive(roomId, userId, options) {
    return Boolean(await getActive(roomId, userId, options));
  }

  async function deleteActive(roomId, userId, { client } = {}) {
    if (!roomId || !userId) return null;
    const result = await executor(client).query(
      `DELETE FROM room_memberships
       WHERE room_id = $1 AND user_id = $2
       RETURNING *`,
      [roomId, userId]
    );
    return mapMembership(result.rows[0]);
  }

  async function deleteBookmark(roomId, userId, { client } = {}) {
    if (!roomId || !userId) return false;
    const result = await executor(client).query(
      `DELETE FROM room_bookmarks
       WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId]
    );
    return result.rowCount > 0;
  }

  async function upsertActive({ roomId, userId, role = 'member', metadata = {}, at = Date.now(), client } = {}) {
    if (!roomId || !userId) return null;
    const normalizedRole = role === 'owner' ? 'owner' : 'member';
    const date = new Date(Number.isFinite(Number(at)) ? Number(at) : Date.now());
    const result = await executor(client).query(
      `INSERT INTO room_memberships (id, room_id, user_id, role, created_at, updated_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $5, $6)
       ON CONFLICT (room_id, user_id) DO UPDATE
       SET role = CASE
                    WHEN room_memberships.role = 'owner' THEN 'owner'
                    ELSE EXCLUDED.role
                  END,
           updated_at = EXCLUDED.updated_at,
           metadata = room_memberships.metadata || EXCLUDED.metadata
       RETURNING *`,
      [crypto.randomUUID(), roomId, userId, normalizedRole, date, metadata && typeof metadata === 'object' ? metadata : {}]
    );
    return mapMembership(result.rows[0]);
  }

  async function listDirectoryPage({ roomId, query = '', limit, after = null, client } = {}) {
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
    const normalizedQuery = typeof query === 'string' ? query.trim().slice(0, 80) : '';
    const afterMicros = after?.createdAtMicros || '0';
    const afterId = after?.id || '';
    const result = await executor(client).query(
      `SELECT rm.user_id,
              rm.role,
              rm.created_at,
              floor(extract(epoch FROM rm.created_at) * 1000000)::numeric(20, 0) AS created_at_micros,
              u.login,
              u.display_name,
              u.avatar_color_key,
              u.avatar_key,
              u.avatar_accent
       FROM room_memberships rm
       JOIN users u ON u.id = rm.user_id
       JOIN rooms r ON r.id = rm.room_id
       WHERE rm.room_id = $1
         AND r.deleted_at IS NULL
         AND ($2::text = '' OR lower(COALESCE(NULLIF(u.display_name, ''), u.login)) LIKE lower($2) || '%' OR lower(u.login) LIKE lower($2) || '%')
         AND (
           $3::numeric = 0
           OR (rm.created_at, rm.user_id) > (to_timestamp($3::numeric / 1000000.0), $4::varchar(36))
         )
       ORDER BY rm.created_at ASC, rm.user_id ASC
       LIMIT $5`,
      [roomId, normalizedQuery, afterMicros, afterId, pageSize + 1]
    );
    const hasMore = result.rows.length > pageSize;
    const rows = hasMore ? result.rows.slice(0, pageSize) : result.rows;
    return { members: rows.map(mapDirectoryMember), hasMore };
  }

  return { deleteActive, deleteBookmark, getActive, isActive, listDirectoryPage, mapDirectoryMember, mapMembership, upsertActive };
}

module.exports = { createMembershipRepository, mapDirectoryMember, mapMembership };
