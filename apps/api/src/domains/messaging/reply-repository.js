'use strict';

const crypto = require('node:crypto');
const { projectReplyPreview, projectReplyTombstone } = require('./reply-projector');

function requireQuery(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Reply repository requires a PostgreSQL query client');
  }
  return client;
}

function mapRoomTarget(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    peerId: row.peer_id,
    authorUserId: row.author_user_id,
    name: row.author_name || row.name,
    text: row.text,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at,
    metadata: row.metadata,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined
  };
}

function mapDirectTarget(row) {
  if (!row) return null;
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    name: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    metadata: row.metadata,
    invite: row.metadata?.kind === 'room-invite' ? row.metadata : null,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined
  };
}

function createReplyRepository({ client } = {}) {
  const defaultClient = client ? requireQuery(client) : null;

  function queryClient(override) {
    return requireQuery(override || defaultClient);
  }

  async function lockRoomTarget({ roomId, messageId, client: override } = {}) {
    const result = await queryClient(override).query(
      `SELECT m.*,
              COALESCE(NULLIF(u.display_name, ''), u.login, m.name) AS author_name
       FROM room_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
       WHERE m.room_id = $1 AND m.id = $2
       FOR UPDATE OF m`,
      [roomId, messageId]
    );
    return mapRoomTarget(result.rows[0] || null);
  }

  async function lockDirectTarget({ userId, peerId, messageId, client: override } = {}) {
    const result = await queryClient(override).query(
      `SELECT m.*, COALESCE(NULLIF(u.display_name, ''), u.login) AS author_name
       FROM direct_messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1
         AND ((m.sender_id = $2 AND m.recipient_id = $3)
           OR (m.sender_id = $3 AND m.recipient_id = $2))
       FOR UPDATE OF m`,
      [messageId, userId, peerId]
    );
    return mapDirectTarget(result.rows[0] || null);
  }

  async function getRoomPreview({ roomId, messageId, client: override, now } = {}) {
    const result = await queryClient(override).query(
      `SELECT m.*,
              COALESCE(NULLIF(u.display_name, ''), u.login, m.name) AS author_name
       FROM room_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
       WHERE m.room_id = $1 AND m.id = $2`,
      [roomId, messageId]
    );
    const target = mapRoomTarget(result.rows[0] || null);
    return target ? projectReplyPreview(target, { now }) : projectReplyTombstone(messageId);
  }

  async function getDirectPreview({ userId, peerId, messageId, client: override, now } = {}) {
    const target = await locklessDirectTarget({ userId, peerId, messageId, client: override });
    return target ? projectReplyPreview(target, { now }) : projectReplyTombstone(messageId);
  }

  async function insertRoomReply({ roomId, targetMessageId, message, client: override } = {}) {
    const db = queryClient(override);
    const id = message?.id || crypto.randomUUID();
    const result = await db.query(
      `INSERT INTO room_messages (
         id, room_id, peer_id, name, text, created_at, expires_at, author_user_id, reply_to_message_id
       )
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, current_timestamp), $7, $8, $9)
       RETURNING *`,
      [
        id,
        roomId,
        message?.peerId || '',
        message?.authorUserId ? '' : (message?.name || ''),
        message?.text || '',
        message?.createdAt ? new Date(message.createdAt) : null,
        message?.expiresAt ? new Date(message.expiresAt) : null,
        message?.authorUserId || null,
        targetMessageId
      ]
    );
    return mapRoomTarget(result.rows[0] || null);
  }

  async function insertDirectReply({ senderId, recipientId, targetMessageId, body, id, client: override } = {}) {
    const db = queryClient(override);
    const result = await db.query(
      `INSERT INTO direct_messages (
         id, sender_id, recipient_id, body, created_at, metadata, reply_to_message_id
       )
       VALUES ($1, $2, $3, $4, current_timestamp, '{}'::jsonb, $5)
       RETURNING *`,
      [id || crypto.randomUUID(), senderId, recipientId, body, targetMessageId]
    );
    return mapDirectTarget(result.rows[0] || null);
  }

  async function locklessDirectTarget({ userId, peerId, messageId, client: override } = {}) {
    const result = await queryClient(override).query(
      `SELECT m.*, COALESCE(NULLIF(u.display_name, ''), u.login) AS author_name
       FROM direct_messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1
         AND ((m.sender_id = $2 AND m.recipient_id = $3)
           OR (m.sender_id = $3 AND m.recipient_id = $2))`,
      [messageId, userId, peerId]
    );
    return mapDirectTarget(result.rows[0] || null);
  }

  return Object.freeze({
    getDirectPreview,
    getRoomPreview,
    insertDirectReply,
    insertRoomReply,
    lockDirectTarget,
    lockRoomTarget
  });
}

module.exports = { createReplyRepository };
