'use strict';

const { createDbPool } = require('../../lib/db');

function boundedLimit(value) {
  return Math.max(1, Math.min(100, Number.isInteger(value) ? value : 50));
}

function anchorTimestamp(parameter) {
  return `TIMESTAMPTZ 'epoch' + $${parameter}::bigint * INTERVAL '1 microsecond'`;
}

function mapDirectMessage(row) {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdAtMicros: row.created_at_micros,
    editedAt: row.edited_at || null,
    readAt: row.read_at || null,
    metadata: row.metadata || {},
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined
  };
}

function createDmHistoryRepository({ databaseUrl, logger = console, pool } = {}) {
  let activePool = pool || null;

  function getPool() {
    if (!activePool) activePool = createDbPool({ databaseUrl, logger });
    return activePool;
  }

  async function canReadThread({ userId, peerId }) {
    if (!userId || !peerId || userId === peerId) return false;
    const [low, high] = userId < peerId ? [userId, peerId] : [peerId, userId];
    const result = await getPool().query(
      'SELECT 1 FROM friendships WHERE user_a_id = $1 AND user_b_id = $2 LIMIT 1',
      [low, high]
    );
    return result.rowCount === 1;
  }

  async function querySide({ userId, peerId, anchor, direction, limit }) {
    const operator = direction === 'before' ? '<' : direction === 'after' ? '>' : '>=';
    const order = direction === 'before' ? 'DESC' : 'ASC';
    const result = await getPool().query(
      `SELECT thread.*,
              floor(extract(epoch FROM thread.created_at) * 1000000)::bigint::text AS created_at_micros
       FROM (
         (SELECT m.*
          FROM direct_messages m
          WHERE m.sender_id = $1 AND m.recipient_id = $2
            AND m.deleted_at IS NULL
            AND (m.created_at, m.id) ${operator} (${anchorTimestamp(3)}, $4)
          ORDER BY m.created_at ${order}, m.id ${order}
          LIMIT $5)
         UNION ALL
         (SELECT m.*
          FROM direct_messages m
          WHERE m.sender_id = $2 AND m.recipient_id = $1
            AND m.deleted_at IS NULL
            AND (m.created_at, m.id) ${operator} (${anchorTimestamp(3)}, $4)
          ORDER BY m.created_at ${order}, m.id ${order}
          LIMIT $5)
       ) thread
       ORDER BY thread.created_at ${order}, thread.id ${order}
       LIMIT $5`,
      [userId, peerId, anchor.createdAtMicros, anchor.id, limit]
    );
    return result.rows.map(mapDirectMessage);
  }

  async function listLatest({ userId, peerId, limit }) {
    const size = boundedLimit(limit);
    const result = await getPool().query(
      `SELECT thread.*,
              floor(extract(epoch FROM thread.created_at) * 1000000)::bigint::text AS created_at_micros
       FROM (
         (SELECT m.*
          FROM direct_messages m
          WHERE m.sender_id = $1 AND m.recipient_id = $2 AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT $3)
         UNION ALL
         (SELECT m.*
          FROM direct_messages m
          WHERE m.sender_id = $2 AND m.recipient_id = $1 AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT $3)
       ) thread
       ORDER BY thread.created_at DESC, thread.id DESC
       LIMIT $3`,
      [userId, peerId, size + 1]
    );
    const rows = result.rows.map(mapDirectMessage);
    const hasMoreBefore = rows.length > size;
    if (hasMoreBefore) rows.pop();
    rows.reverse();
    return { messages: rows, hasMoreBefore, hasMoreAfter: false };
  }

  async function listBefore({ userId, peerId, anchor, limit }) {
    const size = boundedLimit(limit);
    const rows = await querySide({ userId, peerId, anchor, direction: 'before', limit: size + 1 });
    const hasMoreBefore = rows.length > size;
    if (hasMoreBefore) rows.pop();
    rows.reverse();
    return { messages: rows, hasMoreBefore, hasMoreAfter: true };
  }

  async function listAfter({ userId, peerId, anchor, limit }) {
    const size = boundedLimit(limit);
    const rows = await querySide({ userId, peerId, anchor, direction: 'after', limit: size + 1 });
    const hasMoreAfter = rows.length > size;
    if (hasMoreAfter) rows.pop();
    return { messages: rows, hasMoreBefore: true, hasMoreAfter };
  }

  async function listAround({ userId, peerId, anchor, limit }) {
    const size = boundedLimit(limit);
    const beforeSize = Math.floor(size / 2);
    const afterSize = size - beforeSize;
    let before = await querySide({ userId, peerId, anchor, direction: 'before', limit: beforeSize + 1 });
    let after = await querySide({ userId, peerId, anchor, direction: 'at-or-after', limit: afterSize + 1 });
    let hasMoreBefore = before.length > beforeSize;
    let hasMoreAfter = after.length > afterSize;
    if (hasMoreBefore) before.pop();
    if (hasMoreAfter) after.pop();

    if (before.length < beforeSize && hasMoreAfter) {
      const wanted = size - before.length;
      after = await querySide({ userId, peerId, anchor, direction: 'at-or-after', limit: wanted + 1 });
      hasMoreAfter = after.length > wanted;
      if (hasMoreAfter) after.pop();
    } else if (after.length < afterSize && hasMoreBefore) {
      const wanted = size - after.length;
      before = await querySide({ userId, peerId, anchor, direction: 'before', limit: wanted + 1 });
      hasMoreBefore = before.length > wanted;
      if (hasMoreBefore) before.pop();
    }

    before.reverse();
    return { messages: [...before, ...after], hasMoreBefore, hasMoreAfter };
  }

  async function close() {
    if (activePool && !pool) await activePool.end();
  }

  return { canReadThread, close, listAfter, listAround, listBefore, listLatest };
}

module.exports = { createDmHistoryRepository, mapDirectMessage };
