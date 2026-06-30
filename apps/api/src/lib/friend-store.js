'use strict';

const crypto = require('node:crypto');
const { createDbPool, transaction } = require('./db');
const { cleanAvatarColorKey } = require('@voice-room/shared/validation');

function toMillis(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Public shape for a user row joined from the `users` table (snake_case). Never
// leaks the password hash; mirrors user-store's publicUser fields.
function mapPublicUser(row) {
  if (!row) return null;
  return {
    avatarColorKey: cleanAvatarColorKey(row.avatar_color_key) || 'blurple',
    createdAt: toMillis(row.created_at),
    displayName: row.display_name || '',
    id: row.id,
    login: row.login
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: toMillis(row.created_at),
    readAt: toMillis(row.read_at)
  };
}

// friendships store the pair ordered so a single row is canonical.
function orderedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

// Escape LIKE wildcards in user-supplied search terms (we use ESCAPE '\').
function escapeLike(term) {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function createFriendStore({ databaseUrl, logger = console, pool } = {}) {
  let activePool = pool || null;
  function getPool() {
    if (!activePool) {
      activePool = createDbPool({ databaseUrl, logger });
    }
    return activePool;
  }

  // --- Friendship lookups -------------------------------------------------

  async function getFriendIds(userId, client = getPool()) {
    const result = await client.query(
      `SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END AS friend_id
       FROM friendships
       WHERE user_a_id = $1 OR user_b_id = $1`,
      [userId]
    );
    return result.rows.map((row) => row.friend_id);
  }

  async function areFriends(a, b, client = getPool()) {
    const [low, high] = orderedPair(a, b);
    const result = await client.query(
      `SELECT 1 FROM friendships WHERE user_a_id = $1 AND user_b_id = $2`,
      [low, high]
    );
    return result.rowCount > 0;
  }

  // Friend list enriched with the last DM and unread count, ready for the
  // sidebar/home. Online status is layered on at the route level from the
  // in-memory presence registry.
  async function listFriends(userId) {
    const pool = getPool();
    const friendsResult = await pool.query(
      `SELECT u.*
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END
       WHERE f.user_a_id = $1 OR f.user_b_id = $1
       ORDER BY lower(coalesce(u.display_name, u.login))`,
      [userId]
    );

    const unreadResult = await pool.query(
      `SELECT sender_id, COUNT(*)::int AS count
       FROM direct_messages
       WHERE recipient_id = $1 AND read_at IS NULL
       GROUP BY sender_id`,
      [userId]
    );
    const unread = new Map(unreadResult.rows.map((row) => [row.sender_id, row.count]));

    const lastResult = await pool.query(
      `SELECT DISTINCT ON (peer) peer, id, body, created_at, sender_id
       FROM (
         SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS peer,
                id, body, created_at, sender_id
         FROM direct_messages
         WHERE sender_id = $1 OR recipient_id = $1
       ) t
       ORDER BY peer, created_at DESC, id DESC`,
      [userId]
    );
    const lastMessage = new Map(
      lastResult.rows.map((row) => [
        row.peer,
        { id: row.id, body: row.body, createdAt: toMillis(row.created_at), fromMe: row.sender_id === userId }
      ])
    );

    return friendsResult.rows.map((row) => ({
      user: mapPublicUser(row),
      unreadCount: unread.get(row.id) || 0,
      lastMessage: lastMessage.get(row.id) || null
    }));
  }

  // --- Search -------------------------------------------------------------

  async function searchUsers({ query, excludeUserId, limit = 20 }) {
    const term = String(query || '').trim();
    if (!term) return [];
    const pattern = `%${escapeLike(term.toLowerCase())}%`;
    const result = await getPool().query(
      `SELECT * FROM users
       WHERE id <> $1
         AND (lower(login) LIKE $2 ESCAPE '\\' OR lower(display_name) LIKE $2 ESCAPE '\\')
       ORDER BY lower(login)
       LIMIT $3`,
      [excludeUserId, pattern, limit]
    );
    return result.rows.map(mapPublicUser);
  }

  // --- Requests -----------------------------------------------------------

  // Send a friend request to a login or explicit user id. Auto-accepts when a
  // reverse pending request already exists, so two people who request each
  // other become friends without an extra accept step. Returns a discriminated
  // status. The user-id path supports in-room social actions without exposing
  // logins in room presence payloads.
  async function sendRequest({ requesterId, addresseeLogin = '', addresseeUserId = '' }) {
    return transaction(getPool(), async (client) => {
      const userResult = addresseeUserId
        ? await client.query(`SELECT * FROM users WHERE id = $1`, [addresseeUserId])
        : await client.query(`SELECT * FROM users WHERE login = $1`, [addresseeLogin]);
      const addressee = userResult.rows[0];
      if (!addressee) return { status: 'not_found' };
      if (addressee.id === requesterId) return { status: 'self' };

      if (await areFriends(requesterId, addressee.id, client)) {
        return { status: 'already_friends', user: mapPublicUser(addressee) };
      }

      // Reverse pending request -> accept it.
      const reverse = await client.query(
        `SELECT * FROM friend_requests
         WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'
         FOR UPDATE`,
        [addressee.id, requesterId]
      );
      if (reverse.rowCount > 0) {
        await client.query(
          `UPDATE friend_requests SET status = 'accepted', responded_at = current_timestamp WHERE id = $1`,
          [reverse.rows[0].id]
        );
        await insertFriendship(client, requesterId, addressee.id);
        return { status: 'accepted', user: mapPublicUser(addressee) };
      }

      // Existing forward pending request -> idempotent.
      const forward = await client.query(
        `SELECT * FROM friend_requests
         WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
        [requesterId, addressee.id]
      );
      if (forward.rowCount > 0) {
        return { status: 'already_sent', user: mapPublicUser(addressee) };
      }

      // The pre-check above is racy under READ COMMITTED: two concurrent sends
      // (double-click, two tabs) both pass it, then collide on the partial
      // unique index `friend_requests_pending_unique_idx`. ON CONFLICT over that
      // index's predicate makes the loser a no-op so we return an idempotent
      // already_sent instead of bubbling a 23505 up as a 500.
      const id = crypto.randomUUID();
      const inserted = await client.query(
        `INSERT INTO friend_requests (id, requester_id, addressee_id, status, created_at)
         VALUES ($1, $2, $3, 'pending', current_timestamp)
         ON CONFLICT (requester_id, addressee_id) WHERE status = 'pending' DO NOTHING
         RETURNING id`,
        [id, requesterId, addressee.id]
      );
      if (inserted.rowCount === 0) {
        return { status: 'already_sent', user: mapPublicUser(addressee) };
      }
      return { status: 'sent', requestId: id, user: mapPublicUser(addressee) };
    });
  }

  async function insertFriendship(client, a, b) {
    const [low, high] = orderedPair(a, b);
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO friendships (id, user_a_id, user_b_id, created_at)
       VALUES ($1, $2, $3, current_timestamp)
       ON CONFLICT (user_a_id, user_b_id) DO NOTHING`,
      [id, low, high]
    );
  }

  // Pending incoming + outgoing requests, each joined with the other user and a
  // count of mutual friends (used by the design's "N общих друга" line).
  async function listRequests(userId) {
    const pool = getPool();
    // Alias the request columns: `u.*` also exposes `id`/`created_at`, and a
    // duplicate column name makes node-postgres keep the last one — without the
    // aliases `row.id` would be the requester's user id, not the request id, so
    // accept/decline would hit the wrong row ("Заявка не найдена").
    const incoming = await pool.query(
      `SELECT fr.id AS request_id, fr.created_at AS request_created_at, u.*,
              (SELECT COUNT(*)::int FROM friendships fa
               JOIN friendships fb
                 ON (CASE WHEN fb.user_a_id = u.id THEN fb.user_b_id ELSE fb.user_a_id END)
                  = (CASE WHEN fa.user_a_id = $1 THEN fa.user_b_id ELSE fa.user_a_id END)
               WHERE (fa.user_a_id = $1 OR fa.user_b_id = $1)
                 AND (fb.user_a_id = u.id OR fb.user_b_id = u.id)) AS mutual
       FROM friend_requests fr
       JOIN users u ON u.id = fr.requester_id
       WHERE fr.addressee_id = $1 AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
      [userId]
    );
    const outgoing = await pool.query(
      `SELECT fr.id AS request_id, fr.created_at AS request_created_at, u.*
       FROM friend_requests fr
       JOIN users u ON u.id = fr.addressee_id
       WHERE fr.requester_id = $1 AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
      [userId]
    );
    return {
      incoming: incoming.rows.map((row) => ({
        id: row.request_id,
        createdAt: toMillis(row.request_created_at),
        mutualFriends: row.mutual || 0,
        user: mapPublicUser(row)
      })),
      outgoing: outgoing.rows.map((row) => ({
        id: row.request_id,
        createdAt: toMillis(row.request_created_at),
        user: mapPublicUser(row)
      }))
    };
  }

  // Accept or decline an incoming request the user owns (addressee).
  async function countIncomingRequests(userId) {
    const result = await getPool().query(
      `SELECT COUNT(*)::int AS count FROM friend_requests
       WHERE addressee_id = $1 AND status = 'pending'`,
      [userId]
    );
    return result.rows[0]?.count || 0;
  }

  async function respondRequest({ userId, requestId, action }) {
    return transaction(getPool(), async (client) => {
      const result = await client.query(
        `SELECT * FROM friend_requests
         WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
         FOR UPDATE`,
        [requestId, userId]
      );
      const request = result.rows[0];
      if (!request) return { status: 'not_found' };

      if (action === 'accept') {
        await client.query(
          `UPDATE friend_requests SET status = 'accepted', responded_at = current_timestamp WHERE id = $1`,
          [requestId]
        );
        await insertFriendship(client, userId, request.requester_id);
        const userResult = await client.query(`SELECT * FROM users WHERE id = $1`, [request.requester_id]);
        return { status: 'accepted', requesterId: request.requester_id, user: mapPublicUser(userResult.rows[0]) };
      }

      await client.query(
        `UPDATE friend_requests SET status = 'declined', responded_at = current_timestamp WHERE id = $1`,
        [requestId]
      );
      return { status: 'declined', requesterId: request.requester_id };
    });
  }

  // Cancel an outgoing request the user sent (requester).
  async function cancelRequest({ userId, requestId }) {
    const result = await getPool().query(
      `UPDATE friend_requests
       SET status = 'cancelled', responded_at = current_timestamp
       WHERE id = $1 AND requester_id = $2 AND status = 'pending'
       RETURNING addressee_id`,
      [requestId, userId]
    );
    if (result.rowCount === 0) return { status: 'not_found' };
    return { status: 'cancelled', addresseeId: result.rows[0].addressee_id };
  }

  async function removeFriend({ userId, friendId }) {
    const [low, high] = orderedPair(userId, friendId);
    const result = await getPool().query(
      `DELETE FROM friendships WHERE user_a_id = $1 AND user_b_id = $2`,
      [low, high]
    );
    if (result.rowCount === 0) return { status: 'not_found' };
    return { status: 'removed' };
  }

  // --- Direct messages ----------------------------------------------------

  async function listThread({ userId, peerId, limit = 100 }) {
    const result = await getPool().query(
      `SELECT * FROM direct_messages
       WHERE (sender_id = $1 AND recipient_id = $2)
          OR (sender_id = $2 AND recipient_id = $1)
       ORDER BY created_at ASC, id ASC
       LIMIT $3`,
      [userId, peerId, limit]
    );
    return result.rows.map(mapMessage);
  }

  async function sendMessage({ senderId, recipientId, body }) {
    const id = crypto.randomUUID();
    const result = await getPool().query(
      `INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at)
       VALUES ($1, $2, $3, $4, current_timestamp)
       RETURNING *`,
      [id, senderId, recipientId, body]
    );
    return mapMessage(result.rows[0]);
  }

  // Mark every message from peer -> user as read. Returns the number marked so
  // the caller can decide whether to broadcast a read receipt.
  async function markRead({ userId, peerId }) {
    const result = await getPool().query(
      `UPDATE direct_messages
       SET read_at = current_timestamp
       WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL`,
      [userId, peerId]
    );
    return { count: result.rowCount };
  }

  async function getUnreadCounts(userId) {
    const result = await getPool().query(
      `SELECT sender_id, COUNT(*)::int AS count
       FROM direct_messages
       WHERE recipient_id = $1 AND read_at IS NULL
       GROUP BY sender_id`,
      [userId]
    );
    return Object.fromEntries(result.rows.map((row) => [row.sender_id, row.count]));
  }

  async function close() {
    if (activePool) {
      await activePool.end();
    }
  }

  return {
    areFriends,
    cancelRequest,
    close,
    countIncomingRequests,
    getFriendIds,
    getUnreadCounts,
    listFriends,
    listRequests,
    listThread,
    markRead,
    removeFriend,
    respondRequest,
    searchUsers,
    sendMessage,
    sendRequest
  };
}

module.exports = {
  createFriendStore,
  mapPublicUser,
  mapMessage,
  orderedPair
};
