'use strict';

const crypto = require('node:crypto');
const { createDbPool, transaction } = require('./db');

function createRowId() {
  return crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex');
}

function mapPreferences({ doNotDisturb = false, privateNotifications = false, mutedPeerIds = [] } = {}) {
  return {
    doNotDisturb: Boolean(doNotDisturb),
    mutedPeerIds: [...new Set(mutedPeerIds)].sort(),
    privateNotifications: Boolean(privateNotifications)
  };
}

function createNotificationStore({ databaseUrl, logger = console, pool } = {}) {
  let activePool = pool || null;
  function getPool() {
    if (!activePool) {
      activePool = createDbPool({ databaseUrl, logger });
    }
    return activePool;
  }

  async function getPreferences(userId, client = getPool()) {
    if (!userId) return mapPreferences();
    const preferences = await client.query(
      `SELECT u.dnd, np.private_notifications
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    const dmMutes = await client.query(
      `SELECT peer_user_id
       FROM notification_dm_mutes
       WHERE user_id = $1
       ORDER BY peer_user_id`,
      [userId]
    );
    return mapPreferences({
      doNotDisturb: preferences.rows[0]?.dnd || false,
      privateNotifications: preferences.rows[0]?.private_notifications || false,
      mutedPeerIds: dmMutes.rows.map((row) => row.peer_user_id)
    });
  }

  async function userExists(userId, client) {
    const result = await client.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    return result.rowCount > 0;
  }

  async function areFriends(userId, peerUserId, client) {
    const result = await client.query(
      `SELECT 1
       FROM friendships
       WHERE (user_a_id = $1 AND user_b_id = $2)
          OR (user_a_id = $2 AND user_b_id = $1)`,
      [userId, peerUserId]
    );
    return result.rowCount > 0;
  }

  async function setPrivateNotifications({ userId, privateNotifications }) {
    if (!userId) return { status: 'not_found', preferences: mapPreferences() };
    return transaction(getPool(), async (client) => {
      if (!(await userExists(userId, client))) {
        return { status: 'not_found', preferences: mapPreferences() };
      }
      await client.query(
        `INSERT INTO notification_preferences (user_id, private_notifications, created_at, updated_at)
         VALUES ($1, $2, current_timestamp, current_timestamp)
         ON CONFLICT (user_id) DO UPDATE
         SET private_notifications = EXCLUDED.private_notifications,
             updated_at = current_timestamp`,
        [userId, Boolean(privateNotifications)]
      );
      return { status: 'updated', preferences: await getPreferences(userId, client) };
    });
  }

  async function setDoNotDisturb({ userId, doNotDisturb }) {
    if (!userId) return { status: 'not_found', preferences: mapPreferences() };
    return transaction(getPool(), async (client) => {
      const updated = await client.query(
        `UPDATE users
         SET dnd = $2, updated_at = current_timestamp
         WHERE id = $1`,
        [userId, Boolean(doNotDisturb)]
      );
      if (updated.rowCount === 0) return { status: 'not_found', preferences: mapPreferences() };
      return { status: 'updated', preferences: await getPreferences(userId, client) };
    });
  }

  async function setDmMute({ userId, peerUserId, muted }) {
    if (!userId || !peerUserId) return { status: 'not_found', preferences: mapPreferences() };
    if (userId === peerUserId) return { status: 'self', preferences: mapPreferences() };

    return transaction(getPool(), async (client) => {
      if (!(await userExists(userId, client))) {
        return { status: 'not_found', preferences: mapPreferences() };
      }
      if (!(await userExists(peerUserId, client))) {
        return { status: 'not_found', preferences: await getPreferences(userId, client) };
      }
      if (!(await areFriends(userId, peerUserId, client))) {
        return { status: 'not_friends', preferences: await getPreferences(userId, client) };
      }

      if (muted) {
        await client.query(
          `INSERT INTO notification_dm_mutes (id, user_id, peer_user_id, created_at, updated_at)
           VALUES ($1, $2, $3, current_timestamp, current_timestamp)
           ON CONFLICT (user_id, peer_user_id) DO UPDATE
           SET updated_at = current_timestamp`,
          [createRowId(), userId, peerUserId]
        );
      } else {
        await client.query(
          `DELETE FROM notification_dm_mutes
           WHERE user_id = $1 AND peer_user_id = $2`,
          [userId, peerUserId]
        );
      }

      return { status: muted ? 'muted' : 'unmuted', preferences: await getPreferences(userId, client) };
    });
  }

  async function isDmMuted({ userId, peerUserId }) {
    if (!userId || !peerUserId) return false;
    const result = await getPool().query(
      `SELECT 1
       FROM notification_dm_mutes
       WHERE user_id = $1 AND peer_user_id = $2`,
      [userId, peerUserId]
    );
    return result.rowCount > 0;
  }

  async function close() {
    if (activePool) {
      await activePool.end();
    }
  }

  return {
    close,
    getPreferences,
    isDmMuted,
    setDmMute,
    setDoNotDisturb,
    setPrivateNotifications
  };
}

module.exports = {
  createNotificationStore,
  mapPreferences
};
