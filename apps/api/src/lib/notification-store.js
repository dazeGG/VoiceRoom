'use strict';

const crypto = require('node:crypto');
const { cleanPresenceStatus } = require('@voice-room/shared/validation');
const { createDbPool, transaction } = require('./db');

const DEFAULT_AUTOMATIC_PRESENCE_LEASE_MS = 3 * 60 * 1000;

function createRowId() {
  return crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex');
}

function mapPreferences({
  doNotDisturb = false,
  presenceStatus = '',
  presenceStatusAutomatic = false,
  privateNotifications = false,
  mutedPeerIds = [],
  mutedRoomIds = []
} = {}) {
  const normalizedPresenceStatus = cleanPresenceStatus(presenceStatus) || (doNotDisturb ? 'dnd' : 'online');
  return {
    doNotDisturb: normalizedPresenceStatus === 'dnd',
    mutedPeerIds: [...new Set(mutedPeerIds)].sort(),
    mutedRoomIds: [...new Set(mutedRoomIds)].sort(),
    presenceStatus: normalizedPresenceStatus,
    presenceStatusAutomatic: normalizedPresenceStatus === 'away' && Boolean(presenceStatusAutomatic),
    privateNotifications: Boolean(privateNotifications)
  };
}

function createNotificationStore({
  automaticPresenceLeaseMs = DEFAULT_AUTOMATIC_PRESENCE_LEASE_MS,
  databaseUrl,
  logger = console,
  pool
} = {}) {
  let activePool = pool || null;
  const activeLeaseMs = Number.isFinite(automaticPresenceLeaseMs) && automaticPresenceLeaseMs > 0
    ? Math.floor(automaticPresenceLeaseMs)
    : DEFAULT_AUTOMATIC_PRESENCE_LEASE_MS;
  function getPool() {
    if (!activePool) {
      activePool = createDbPool({ databaseUrl, logger });
    }
    return activePool;
  }

  async function getPreferences(userId, client = getPool()) {
    if (!userId) return mapPreferences();
    const preferences = await client.query(
      `SELECT u.dnd, u.presence_status, u.presence_status_automatic, np.private_notifications
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
    const roomMutes = await client.query(
      `SELECT room_id
       FROM notification_room_mutes
       WHERE user_id = $1
       ORDER BY room_id`,
      [userId]
    );
    return mapPreferences({
      doNotDisturb: preferences.rows[0]?.dnd || false,
      presenceStatus: preferences.rows[0]?.presence_status,
      presenceStatusAutomatic: preferences.rows[0]?.presence_status_automatic,
      privateNotifications: preferences.rows[0]?.private_notifications || false,
      mutedPeerIds: dmMutes.rows.map((row) => row.peer_user_id),
      mutedRoomIds: roomMutes.rows.map((row) => row.room_id)
    });
  }

  async function userExists(userId, client) {
    const result = await client.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
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
         SET dnd = $2,
             presence_status = $3,
             presence_status_automatic = false,
             presence_active_until = CASE
               WHEN $2 THEN NULL
               ELSE current_timestamp + ($4 * interval '1 millisecond')
             END,
             updated_at = current_timestamp
         WHERE id = $1`,
        [userId, Boolean(doNotDisturb), doNotDisturb ? 'dnd' : 'online', activeLeaseMs]
      );
      if (updated.rowCount === 0) return { status: 'not_found', preferences: mapPreferences() };
      return { status: 'updated', preferences: await getPreferences(userId, client) };
    });
  }

  async function setPresenceStatus({ userId, presenceStatus, automatic = false }) {
    const normalizedPresenceStatus = cleanPresenceStatus(presenceStatus);
    if (!userId) return { status: 'not_found', preferences: mapPreferences() };
    if (!normalizedPresenceStatus) return { status: 'invalid', preferences: mapPreferences() };
    if (typeof automatic !== 'boolean') return { status: 'invalid', preferences: mapPreferences() };
    if (automatic && normalizedPresenceStatus !== 'away' && normalizedPresenceStatus !== 'online') {
      return { status: 'invalid', preferences: mapPreferences() };
    }
    return transaction(getPool(), async (client) => {
      const current = await client.query(
        `SELECT presence_status,
                presence_status_automatic,
                presence_active_until > current_timestamp AS presence_has_active_lease
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [userId]
      );
      if (current.rowCount === 0) return { status: 'not_found', preferences: mapPreferences() };

      const currentStatus = cleanPresenceStatus(current.rows[0]?.presence_status) || 'online';
      const currentAutomatic = currentStatus === 'away' && Boolean(current.rows[0]?.presence_status_automatic);
      const hasActiveLease = Boolean(current.rows[0]?.presence_has_active_lease);
      let nextStatus = normalizedPresenceStatus;
      let nextAutomatic = false;

      if (automatic) {
        const shouldEnterAway = normalizedPresenceStatus === 'away'
          && currentStatus === 'online'
          && !hasActiveLease;
        const shouldRenewOnline = normalizedPresenceStatus === 'online' && currentStatus === 'online';
        const shouldResumeOnline = normalizedPresenceStatus === 'online'
          && currentStatus === 'away'
          && currentAutomatic;
        if (shouldRenewOnline) {
          await client.query(
            `UPDATE users
             SET presence_active_until = current_timestamp + ($2 * interval '1 millisecond')
             WHERE id = $1`,
            [userId, activeLeaseMs]
          );
          return { status: 'unchanged', preferences: await getPreferences(userId, client) };
        }
        if (!shouldEnterAway && !shouldResumeOnline) {
          return { status: 'unchanged', preferences: await getPreferences(userId, client) };
        }
        nextAutomatic = shouldEnterAway;
      }

      if (currentStatus === nextStatus && currentAutomatic === nextAutomatic) {
        if (nextStatus === 'online') {
          await client.query(
            `UPDATE users
             SET presence_active_until = current_timestamp + ($2 * interval '1 millisecond')
             WHERE id = $1`,
            [userId, activeLeaseMs]
          );
        }
        return { status: 'unchanged', preferences: await getPreferences(userId, client) };
      }

      const updated = await client.query(
        `UPDATE users
         SET presence_status = $2,
             dnd = $3,
             presence_status_automatic = $4,
             presence_active_until = CASE
               WHEN $2 = 'online' THEN current_timestamp + ($5 * interval '1 millisecond')
               ELSE NULL
             END,
             updated_at = current_timestamp
         WHERE id = $1`,
        [userId, nextStatus, nextStatus === 'dnd', nextAutomatic, activeLeaseMs]
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

  async function setRoomMute({ userId, roomId, muted }) {
    if (!userId || !roomId) return { status: 'not_found', preferences: mapPreferences() };

    return transaction(getPool(), async (client) => {
      if (!(await userExists(userId, client))) {
        return { status: 'not_found', preferences: mapPreferences() };
      }
      const room = await client.query(
        `SELECT is_static
         FROM rooms
         WHERE id = $1 AND deleted_at IS NULL`,
        [roomId]
      );
      if (room.rowCount === 0) {
        return { status: 'not_found', preferences: await getPreferences(userId, client) };
      }
      if (!room.rows[0]?.is_static) {
        return { status: 'temporary_room', preferences: await getPreferences(userId, client) };
      }
      const saved = await client.query(
        `SELECT 1
         FROM (
           SELECT user_id FROM room_memberships WHERE room_id = $1 AND role = 'owner'
           UNION ALL
           SELECT user_id FROM room_bookmarks WHERE room_id = $1
         ) saved_rooms
         WHERE user_id = $2
         LIMIT 1`,
        [roomId, userId]
      );
      if (saved.rowCount === 0) {
        return { status: 'not_saved_room', preferences: await getPreferences(userId, client) };
      }

      if (muted) {
        await client.query(
          `INSERT INTO notification_room_mutes (id, user_id, room_id, created_at, updated_at)
           VALUES ($1, $2, $3, current_timestamp, current_timestamp)
           ON CONFLICT (user_id, room_id) DO UPDATE
           SET updated_at = current_timestamp`,
          [createRowId(), userId, roomId]
        );
      } else {
        await client.query(
          `DELETE FROM notification_room_mutes
           WHERE user_id = $1 AND room_id = $2`,
          [userId, roomId]
        );
      }

      return { status: muted ? 'muted' : 'unmuted', preferences: await getPreferences(userId, client) };
    });
  }

  async function isRoomMuted({ userId, roomId }) {
    if (!userId || !roomId) return false;
    const result = await getPool().query(
      `SELECT 1
       FROM notification_room_mutes
       WHERE user_id = $1 AND room_id = $2`,
      [userId, roomId]
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
    isRoomMuted,
    setDmMute,
    setRoomMute,
    setDoNotDisturb,
    setPresenceStatus,
    setPrivateNotifications
  };
}

module.exports = {
  createNotificationStore,
  mapPreferences
};
