'use strict';

const crypto = require('node:crypto');
const { transaction } = require('../../lib/db');
const { verifyPassword } = require('../../lib/password');
const {
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
} = require('@voice-room/shared/account-security');

const UNUSABLE_PASSWORD_HASH = '!';

function toDate(ms) {
  return new Date(ms);
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hashLogin(login) {
  return crypto.createHash('sha256').update(String(login || '').trim().toLowerCase()).digest('hex');
}

// Static rooms the account owns, each with the member who would inherit it:
// the longest-standing member who is neither leaving nor banned from the room.
const OWNED_ROOMS_WITH_HEIRS = `
  SELECT r.id, r.name, r.avatar_key,
         heir.user_id AS heir_user_id,
         hu.display_name AS heir_display_name,
         hu.login AS heir_login
  FROM rooms r
  LEFT JOIN LATERAL (
    SELECT m.user_id
    FROM room_memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.room_id = r.id
      AND m.user_id <> $1
      AND u.deletion_requested_at IS NULL
      AND u.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM room_bans b
        WHERE b.room_id = r.id
          AND b.user_id = m.user_id
          AND b.revoked_at IS NULL
          AND (b.expires_at IS NULL OR b.expires_at > $2)
      )
    ORDER BY m.created_at ASC, m.user_id ASC
    LIMIT 1
  ) heir ON true
  LEFT JOIN users hu ON hu.id = heir.user_id
  WHERE r.owner_id = $1
    AND r.is_static = true
    AND r.deleted_at IS NULL
  ORDER BY r.created_at ASC, r.id ASC`;

// Everything personal the finished deletion removes. Messages, reactions, pins
// and mentions stay: other people's conversations keep an anonymous author.
const PERSONAL_DATA_CLEANUP = Object.freeze([
  'DELETE FROM room_memberships WHERE user_id = $1',
  'DELETE FROM room_bookmarks WHERE user_id = $1',
  'DELETE FROM room_chat_reads WHERE user_id = $1',
  'DELETE FROM friendships WHERE user_a_id = $1 OR user_b_id = $1',
  'DELETE FROM friend_requests WHERE requester_id = $1 OR addressee_id = $1',
  'DELETE FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1',
  'DELETE FROM notification_preferences WHERE user_id = $1',
  'DELETE FROM notification_dm_mutes WHERE user_id = $1 OR peer_user_id = $1',
  'DELETE FROM notification_room_mutes WHERE user_id = $1',
  'DELETE FROM user_notifications WHERE recipient_user_id = $1',
  'DELETE FROM push_subscriptions WHERE user_id = $1',
  'DELETE FROM sessions WHERE user_id = $1',
  'DELETE FROM account_recovery_codes WHERE user_id = $1',
  'DELETE FROM account_login_events WHERE user_id = $1'
]);

// Owns the account deletion lifecycle, which spans tables owned by several
// stores: a request hides the account and keeps its profile aside for a restore
// during the grace period; the finish hands its rooms over, removes its personal
// data and anonymizes the row others' messages still point at.
function createAccountDeletionRepository({ pool, now: clock = Date.now } = {}) {
  if (!pool) throw new TypeError('pool is required');

  async function previewDeletion({ userId, now = clock() }) {
    const result = await pool.query(OWNED_ROOMS_WITH_HEIRS, [userId, toDate(now)]);
    return {
      graceDays: Math.round(ACCOUNT_DELETION_GRACE_MS / (24 * 60 * 60 * 1000)),
      rooms: result.rows.map((row) => ({
        roomId: row.id,
        name: row.name || '',
        heir: row.heir_user_id ? { displayName: row.heir_display_name || '', login: row.heir_login } : null
      }))
    };
  }

  async function requestDeletion({ userId, currentPassword, now = clock() }) {
    return transaction(pool, async (db) => {
      const found = await db.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const user = found.rows[0];
      if (!user || user.deleted_at) return { status: 'not_found' };
      if (user.deletion_requested_at) {
        return { status: 'already_requested', scheduledFor: toMillis(user.deletion_requested_at) + ACCOUNT_DELETION_GRACE_MS };
      }
      if (!await verifyPassword(currentPassword, user.password_hash)) return { status: 'invalid_password' };

      const deletedProfile = {
        displayName: user.display_name || '',
        avatarKey: user.avatar_key || null,
        avatarAccent: user.avatar_accent || null
      };
      await db.query(
        `UPDATE users
         SET deletion_requested_at = $2,
             display_name = $3,
             avatar_key = NULL,
             avatar_accent = NULL,
             metadata = jsonb_set(metadata, '{deletedProfile}', $4::jsonb, true),
             updated_at = $2
         WHERE id = $1`,
        [userId, toDate(now), DELETED_ACCOUNT_NAME, JSON.stringify(deletedProfile)]
      );
      await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await db.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
      return { status: 'requested', scheduledFor: now + ACCOUNT_DELETION_GRACE_MS };
    });
  }

  // Same answer for an unknown login and a wrong password; a password is
  // checked either way so neither is observably faster.
  async function restoreAccount({ login, password, now = clock() }) {
    return transaction(pool, async (db) => {
      const found = await db.query('SELECT * FROM users WHERE login = $1 FOR UPDATE', [login]);
      const user = found.rows[0];
      const pending = user && !user.deleted_at && user.deletion_requested_at;
      const passwordMatches = await verifyPassword(password, pending ? user.password_hash : UNUSABLE_PASSWORD_HASH);
      if (!pending || !passwordMatches) return { status: 'invalid', userId: null };
      if (toMillis(user.deletion_requested_at) + ACCOUNT_DELETION_GRACE_MS <= now) return { status: 'expired', userId: null };

      const profile = user.metadata?.deletedProfile || {};
      await db.query(
        `UPDATE users
         SET deletion_requested_at = NULL,
             display_name = $2,
             avatar_key = $3,
             avatar_accent = $4,
             metadata = metadata - 'deletedProfile',
             updated_at = $5
         WHERE id = $1`,
        [user.id, String(profile.displayName || ''), profile.avatarKey || null, profile.avatarAccent || null, toDate(now)]
      );
      return { status: 'restored', userId: user.id };
    });
  }

  async function listDueDeletions({ now = clock(), limit = 20 } = {}) {
    const result = await pool.query(
      `SELECT id
       FROM users
       WHERE deleted_at IS NULL
         AND deletion_requested_at IS NOT NULL
         AND deletion_requested_at <= $1
       ORDER BY deletion_requested_at ASC
       LIMIT $2`,
      [toDate(now - ACCOUNT_DELETION_GRACE_MS), limit]
    );
    return result.rows.map((row) => row.id);
  }

  async function finalizeDeletion({ userId, now = clock() }) {
    return transaction(pool, async (db) => {
      const found = await db.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const user = found.rows[0];
      if (
        !user
        || user.deleted_at
        || !user.deletion_requested_at
        || toMillis(user.deletion_requested_at) + ACCOUNT_DELETION_GRACE_MS > now
      ) {
        return { status: 'not_due' };
      }

      const transferredRooms = [];
      const deletedRooms = [];
      const owned = await db.query(OWNED_ROOMS_WITH_HEIRS, [userId, toDate(now)]);
      for (const room of owned.rows) {
        if (room.heir_user_id) {
          await db.query('UPDATE rooms SET owner_id = $2, updated_at = $3 WHERE id = $1', [room.id, room.heir_user_id, toDate(now)]);
          await db.query(
            `UPDATE room_memberships SET role = 'owner', updated_at = $3 WHERE room_id = $1 AND user_id = $2`,
            [room.id, room.heir_user_id, toDate(now)]
          );
          transferredRooms.push({ roomId: room.id, heirUserId: room.heir_user_id });
        } else {
          await db.query(
            'UPDATE rooms SET deleted_at = COALESCE(deleted_at, $2), updated_at = $2 WHERE id = $1',
            [room.id, toDate(now)]
          );
          deletedRooms.push({ roomId: room.id, avatarKey: room.avatar_key || null });
        }
      }

      for (const statement of PERSONAL_DATA_CLEANUP) await db.query(statement, [userId]);

      await db.query(
        'INSERT INTO reserved_logins (login_hash, reserved_at) VALUES ($1, $2) ON CONFLICT (login_hash) DO NOTHING',
        [hashLogin(user.login), toDate(now)]
      );
      const avatarKey = user.metadata?.deletedProfile?.avatarKey || user.avatar_key || null;
      await db.query(
        `UPDATE users
         SET login = $2,
             display_name = $3,
             password_hash = $4,
             avatar_key = NULL,
             avatar_accent = NULL,
             presence_status = 'offline',
             metadata = '{}'::jsonb,
             deleted_at = $5,
             updated_at = $5
         WHERE id = $1`,
        [
          userId,
          `${DELETED_LOGIN_PREFIX}${user.id.replace(/-/g, '').slice(0, 24)}`,
          DELETED_ACCOUNT_NAME,
          UNUSABLE_PASSWORD_HASH,
          toDate(now)
        ]
      );
      return { status: 'deleted', transferredRooms, deletedRooms, avatarKey };
    });
  }

  async function isLoginReserved(login) {
    const result = await pool.query('SELECT 1 FROM reserved_logins WHERE login_hash = $1', [hashLogin(login)]);
    return result.rowCount > 0;
  }

  return Object.freeze({
    finalizeDeletion,
    isLoginReserved,
    listDueDeletions,
    previewDeletion,
    requestDeletion,
    restoreAccount
  });
}

module.exports = { createAccountDeletionRepository, hashLogin };
