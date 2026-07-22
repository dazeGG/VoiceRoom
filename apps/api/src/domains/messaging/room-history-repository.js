'use strict';

const { createDbPool } = require('../../lib/db');

const ROOM_MESSAGE_SELECT = `
  SELECT m.*,
         floor(extract(epoch FROM m.created_at) * 1000000)::bigint::text AS created_at_micros,
         COALESCE(NULLIF(u.display_name, ''), u.login, m.name) AS author_name,
         COALESCE(u.avatar_color_key, rpi.avatar_color_key) AS avatar_color_key,
         u.avatar_key,
         u.avatar_accent
  FROM room_messages m
  LEFT JOIN room_peer_identities rpi
    ON rpi.room_id = m.room_id AND rpi.peer_id = m.peer_id
  LEFT JOIN users u ON u.id = m.author_user_id`;

function boundedLimit(value) {
  return Math.max(1, Math.min(100, Number.isInteger(value) ? value : 50));
}

function anchorTimestamp(parameter) {
  return `TIMESTAMPTZ 'epoch' + $${parameter}::bigint * INTERVAL '1 microsecond'`;
}

function mapRoomMessage(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    peerId: row.peer_id || '',
    authorUserId: row.author_user_id || null,
    name: row.author_name || '',
    text: row.text || '',
    content: row.content || undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdAtMicros: row.created_at_micros,
    editedAt: row.edited_at || null,
    expiresAt: row.expires_at || null,
    avatarColorKey: row.avatar_color_key || null,
    avatarKey: row.avatar_key || null,
    avatarAccent: row.avatar_accent || null,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined
  };
}

function createRoomHistoryRepository({ databaseUrl, logger = console, pool } = {}) {
  let activePool = pool || null;

  function getPool() {
    if (!activePool) activePool = createDbPool({ databaseUrl, logger });
    return activePool;
  }

  async function roomExists(roomId) {
    const result = await getPool().query(
      'SELECT 1 FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
      [roomId]
    );
    return result.rowCount === 1;
  }

  async function getAnchor({ roomId, messageId }) {
    const result = await getPool().query(
      `SELECT id, floor(extract(epoch FROM created_at) * 1000000)::bigint::text AS created_at_micros
       FROM room_messages WHERE room_id = $1 AND id = $2 LIMIT 1`,
      [roomId, messageId]
    );
    return result.rows[0]
      ? { id: result.rows[0].id, createdAtMicros: result.rows[0].created_at_micros }
      : null;
  }

  async function querySide({ roomId, anchor, direction, limit, now }) {
    const operator = direction === 'before' ? '<' : direction === 'after' ? '>' : '>=';
    const order = direction === 'before' ? 'DESC' : 'ASC';
    const result = await getPool().query(
      `${ROOM_MESSAGE_SELECT}
       WHERE m.room_id = $1
         AND m.deleted_at IS NULL
         AND (m.expires_at IS NULL OR m.expires_at > $2)
         AND (m.created_at, m.id) ${operator} (${anchorTimestamp(3)}, $4)
       ORDER BY m.created_at ${order}, m.id ${order}
       LIMIT $5`,
      [roomId, now, anchor.createdAtMicros, anchor.id, limit]
    );
    return result.rows.map(mapRoomMessage);
  }

  async function listLatest({ roomId, limit, now }) {
    const result = await getPool().query(
      `${ROOM_MESSAGE_SELECT}
       WHERE m.room_id = $1
         AND m.deleted_at IS NULL
         AND (m.expires_at IS NULL OR m.expires_at > $2)
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $3`,
      [roomId, now, boundedLimit(limit) + 1]
    );
    const rows = result.rows.map(mapRoomMessage);
    const hasMoreBefore = rows.length > boundedLimit(limit);
    if (hasMoreBefore) rows.pop();
    rows.reverse();
    return { messages: rows, hasMoreBefore, hasMoreAfter: false };
  }

  async function listBefore({ roomId, anchor, limit, now }) {
    const size = boundedLimit(limit);
    const rows = await querySide({ roomId, anchor, direction: 'before', limit: size + 1, now });
    const hasMoreBefore = rows.length > size;
    if (hasMoreBefore) rows.pop();
    rows.reverse();
    return { messages: rows, hasMoreBefore, hasMoreAfter: true };
  }

  async function listAfter({ roomId, anchor, limit, now }) {
    const size = boundedLimit(limit);
    const rows = await querySide({ roomId, anchor, direction: 'after', limit: size + 1, now });
    const hasMoreAfter = rows.length > size;
    if (hasMoreAfter) rows.pop();
    return { messages: rows, hasMoreBefore: true, hasMoreAfter };
  }

  async function listAround({ roomId, anchor, limit, now }) {
    const size = boundedLimit(limit);
    const beforeSize = Math.floor(size / 2);
    const afterSize = size - beforeSize;
    let before = await querySide({ roomId, anchor, direction: 'before', limit: beforeSize + 1, now });
    let after = await querySide({ roomId, anchor, direction: 'at-or-after', limit: afterSize + 1, now });
    let hasMoreBefore = before.length > beforeSize;
    let hasMoreAfter = after.length > afterSize;
    if (hasMoreBefore) before.pop();
    if (hasMoreAfter) after.pop();

    if (before.length < beforeSize && hasMoreAfter) {
      const wanted = size - before.length;
      after = await querySide({ roomId, anchor, direction: 'at-or-after', limit: wanted + 1, now });
      hasMoreAfter = after.length > wanted;
      if (hasMoreAfter) after.pop();
    } else if (after.length < afterSize && hasMoreBefore) {
      const wanted = size - after.length;
      before = await querySide({ roomId, anchor, direction: 'before', limit: wanted + 1, now });
      hasMoreBefore = before.length > wanted;
      if (hasMoreBefore) before.pop();
    }

    before.reverse();
    return { messages: [...before, ...after], hasMoreBefore, hasMoreAfter };
  }

  async function close() {
    if (activePool && !pool) await activePool.end();
  }

  return { close, getAnchor, listAfter, listAround, listBefore, listLatest, roomExists };
}

module.exports = { createRoomHistoryRepository, mapRoomMessage };
