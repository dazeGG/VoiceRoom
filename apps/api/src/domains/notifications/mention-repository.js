'use strict';

const crypto = require('node:crypto');

function executor(pool, client) { return client?.query ? client : pool; }

function mapMention(row) {
  return row ? {
    id: row.id, roomId: row.room_id, messageId: row.message_id,
    creatorUserId: row.creator_user_id, targetUserId: row.target_user_id,
    revision: Number(row.revision), createdAt: row.created_at, retractedAt: row.retracted_at
  } : null;
}

function createMentionRepository({ pool } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');

  async function replaceForMessage({ roomId, messageId, creatorUserId, targetUserIds = [], client } = {}) {
    const db = executor(pool, client);
    const unique = [...new Set(targetUserIds)];
    await db.query(
      `UPDATE room_message_mentions SET retracted_at = current_timestamp, revision = revision + 1
       WHERE message_id = $1 AND retracted_at IS NULL AND NOT (target_user_id = ANY($2::varchar[]))`,
      [messageId, unique]
    );
    const mentions = [];
    for (const targetUserId of unique) {
      const result = await db.query(
        `INSERT INTO room_message_mentions (id, room_id, message_id, creator_user_id, target_user_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (message_id, target_user_id) DO UPDATE
         SET retracted_at = NULL,
             revision = CASE WHEN room_message_mentions.retracted_at IS NULL THEN room_message_mentions.revision ELSE room_message_mentions.revision + 1 END
         RETURNING *`,
        [crypto.randomUUID(), roomId, messageId, creatorUserId, targetUserId]
      );
      mentions.push(mapMention(result.rows[0]));
    }
    return mentions;
  }

  async function listActive(messageId, { client } = {}) {
    const result = await executor(pool, client).query(
      'SELECT * FROM room_message_mentions WHERE message_id = $1 AND retracted_at IS NULL ORDER BY target_user_id',
      [messageId]
    );
    return result.rows.map(mapMention);
  }

  async function retractForMessage(messageId, { client } = {}) {
    const result = await executor(pool, client).query(
      `UPDATE room_message_mentions SET retracted_at = current_timestamp, revision = revision + 1
       WHERE message_id = $1 AND retracted_at IS NULL RETURNING *`, [messageId]
    );
    return result.rows.map(mapMention);
  }

  return { listActive, replaceForMessage, retractForMessage };
}

module.exports = { createMentionRepository, mapMention };
