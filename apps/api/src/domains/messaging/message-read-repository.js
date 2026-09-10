'use strict';

const { createDbPool, transaction } = require('../../lib/db');

function createMessageReadRepository({ databaseUrl, logger = console, pool } = {}) {
  let activePool = pool || null;
  const getPool = () => activePool || (activePool = createDbPool({ databaseUrl, logger }));

  // Timestamps are bound as the cursor's exact microseconds, never as the
  // created_at node-pg hands back: that arrives as a JS Date, which keeps only
  // milliseconds. Direct messages are stored to the microsecond, so a bound of
  // 09:57:28.853 excluded the very message at 09:57:28.853795 — the newest one
  // never got read_at and its unread badge came back on every reload. The
  // SELECT above each write has already matched created_at to these exact
  // micros, so reusing them names the same instant.
  async function advanceRoom({ roomId, userId, tuple }) {
    return transaction(getPool(), async (client) => {
      const message = await client.query(
        `SELECT created_at, id FROM room_messages
         WHERE room_id = $1 AND id = $2 AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > current_timestamp)
           AND created_at = TIMESTAMPTZ 'epoch' + $3::bigint * INTERVAL '1 microsecond'
         FOR SHARE`,
        [roomId, tuple.id, tuple.createdAtMicros]
      );
      if (!message.rowCount) return null;
      const result = await client.query(
        // room_chat_reads has no updated_at column: 20260718122000 gave one only
        // to the new direct_message_read_cursors table. Writing it here made every
        // cursor-based room read fail in the database, so nothing was ever stored
        // and the unread count came back on reload.
        `INSERT INTO room_chat_reads (
           room_id, user_id, last_read_at, last_read_message_created_at, last_read_message_id
         ) VALUES (
           $1, $2,
           TIMESTAMPTZ 'epoch' + $3::bigint * INTERVAL '1 microsecond',
           TIMESTAMPTZ 'epoch' + $3::bigint * INTERVAL '1 microsecond',
           $4
         )
         ON CONFLICT (room_id, user_id) DO UPDATE SET
           last_read_at = GREATEST(room_chat_reads.last_read_at, EXCLUDED.last_read_at),
           last_read_message_created_at = EXCLUDED.last_read_message_created_at,
           last_read_message_id = EXCLUDED.last_read_message_id
         WHERE room_chat_reads.last_read_message_created_at IS NULL
            OR (room_chat_reads.last_read_message_created_at, room_chat_reads.last_read_message_id)
               < (EXCLUDED.last_read_message_created_at, EXCLUDED.last_read_message_id)
         RETURNING last_read_message_created_at, last_read_message_id`,
        [roomId, userId, tuple.createdAtMicros, message.rows[0].id]
      );
      return result.rows[0] || { unchanged: true };
    });
  }

  async function advanceDm({ peerId, userId, tuple }) {
    return transaction(getPool(), async (client) => {
      const message = await client.query(
        `SELECT created_at, id FROM direct_messages
         WHERE id = $1 AND deleted_at IS NULL
           AND ((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))
           AND created_at = TIMESTAMPTZ 'epoch' + $4::bigint * INTERVAL '1 microsecond'
         FOR SHARE`,
        [tuple.id, userId, peerId, tuple.createdAtMicros]
      );
      if (!message.rowCount) return null;
      const result = await client.query(
        `INSERT INTO direct_message_read_cursors (
           user_id, peer_user_id, last_read_message_created_at, last_read_message_id, updated_at
         ) VALUES ($1, $2, TIMESTAMPTZ 'epoch' + $3::bigint * INTERVAL '1 microsecond', $4, current_timestamp)
         ON CONFLICT (user_id, peer_user_id) DO UPDATE SET
           last_read_message_created_at = EXCLUDED.last_read_message_created_at,
           last_read_message_id = EXCLUDED.last_read_message_id,
           updated_at = current_timestamp
         WHERE (direct_message_read_cursors.last_read_message_created_at, direct_message_read_cursors.last_read_message_id)
            < (EXCLUDED.last_read_message_created_at, EXCLUDED.last_read_message_id)
         RETURNING last_read_message_created_at, last_read_message_id`,
        [userId, peerId, tuple.createdAtMicros, message.rows[0].id]
      );
      await client.query(
        `UPDATE direct_messages SET read_at = COALESCE(read_at, current_timestamp)
         WHERE sender_id = $1 AND recipient_id = $2 AND deleted_at IS NULL
           AND (created_at, id) <= (TIMESTAMPTZ 'epoch' + $3::bigint * INTERVAL '1 microsecond', $4)`,
        [peerId, userId, tuple.createdAtMicros, message.rows[0].id]
      );
      return result.rows[0] || { unchanged: true };
    });
  }

  return Object.freeze({ advanceDm, advanceRoom });
}

module.exports = { createMessageReadRepository };
