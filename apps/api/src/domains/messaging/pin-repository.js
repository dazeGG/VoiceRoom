'use strict';

function requireQuery(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Pin repository requires a PostgreSQL query client');
  }
  return client;
}

function toMillis(value) {
  if (!value) return null;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function mapPin(row) {
  return {
    messageId: row.message_id,
    pinnedBy: row.pinned_by,
    pinnedByName: row.pinned_by_name || '',
    pinnedAt: toMillis(row.pinned_at),
    author: {
      peerId: row.peer_id || '',
      userId: row.author_user_id || null,
      name: row.name || ''
    },
    text: row.text || '',
    content: row.content || null,
    createdAt: toMillis(row.created_at)
  };
}

function createPinRepository({ client } = {}) {
  const defaultClient = client ? requireQuery(client) : null;
  const queryClient = (override) => requireQuery(override || defaultClient);

  async function transaction(callback) {
    if (typeof callback !== 'function') throw new TypeError('Transaction callback is required');
    if (typeof defaultClient?.connect !== 'function') return callback(queryClient());
    const db = await defaultClient.connect();
    try {
      await db.query('BEGIN');
      const result = await callback(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async function lockRoom({ roomId, client: override } = {}) {
    await queryClient(override).query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`voice-room:room-pins:${roomId}`]
    );
  }

  // Pinned messages, newest pin first. Deleted messages are dropped here rather
  // than in the service so the count and the list can never disagree.
  async function listPins({ roomId, limit = 50, client: override } = {}) {
    const result = await queryClient(override).query(
      `SELECT p.message_id,
              p.pinned_by,
              p.pinned_at,
              pinner.display_name AS pinned_by_name,
              m.peer_id,
              m.author_user_id,
              m.name,
              m.text,
              m.content,
              m.created_at
       FROM room_message_pins p
       JOIN room_messages m ON m.id = p.message_id
       LEFT JOIN users pinner ON pinner.id = p.pinned_by
       WHERE p.room_id = $1 AND m.deleted_at IS NULL
       ORDER BY p.pinned_at DESC, p.message_id DESC
       LIMIT $2`,
      [roomId, limit]
    );
    return result.rows.map(mapPin);
  }

  async function countPins({ roomId, client: override } = {}) {
    const result = await queryClient(override).query(
      `SELECT COUNT(*)::int AS count
       FROM room_message_pins p
       JOIN room_messages m ON m.id = p.message_id
       WHERE p.room_id = $1 AND m.deleted_at IS NULL`,
      [roomId]
    );
    return result.rows[0]?.count || 0;
  }

  // Resolves the message only when it actually belongs to the room and is still
  // visible, so a caller cannot pin someone else's message into their own room.
  async function findVisibleMessage({ roomId, messageId, client: override } = {}) {
    const result = await queryClient(override).query(
      `SELECT id FROM room_messages
       WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`,
      [messageId, roomId]
    );
    return result.rowCount > 0;
  }

  async function pin({ roomId, messageId, userId, client: override } = {}) {
    const result = await queryClient(override).query(
      `INSERT INTO room_message_pins (room_id, message_id, pinned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_id, message_id) DO NOTHING`,
      [roomId, messageId, userId]
    );
    return { changed: result.rowCount > 0 };
  }

  async function unpin({ roomId, messageId, client: override } = {}) {
    const result = await queryClient(override).query(
      `DELETE FROM room_message_pins WHERE room_id = $1 AND message_id = $2`,
      [roomId, messageId]
    );
    return { changed: result.rowCount > 0 };
  }

  return Object.freeze({ countPins, findVisibleMessage, listPins, lockRoom, pin, transaction, unpin });
}

module.exports = { createPinRepository };
