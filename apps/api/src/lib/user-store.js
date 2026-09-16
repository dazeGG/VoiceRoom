'use strict';

const crypto = require('node:crypto');
const { createDbPool, transaction } = require('./db');
const { hashPassword, verifyPassword } = require('./password');
const { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus } = require('@voice-room/shared/validation');
const {
  LOGIN_ALERT_TTL_MS,
  LOGIN_FAMILIARITY_WINDOW_MS,
  RECOVERY_CODES_REMINDER_SNOOZE_MS,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  WHATS_NEW_VERSION,
  describeUserAgent,
  normalizeRecoveryCode,
  normalizeReleaseVersion
} = require('@voice-room/shared/account-security');

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const USER_AGENT_MAX_LENGTH = 512;
const LOCATION_LABEL_MAX_LENGTH = 120;
const UNIQUE_VIOLATION = '23505';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Longer than the familiarity window, so a device keeps vouching for itself
// for the whole window after its last sign-in.
const LOGIN_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function toDate(ms) {
  const next = Number(ms);
  return new Date(Number.isFinite(next) && next >= 0 ? next : Date.now());
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function randomAvatarColorKey() {
  return AVATAR_COLOR_KEYS[crypto.randomInt(AVATAR_COLOR_KEYS.length)];
}

function mapUser(row) {
  if (!row) return null;
  const presenceStatus = cleanPresenceStatus(row.presence_status) || (row.dnd ? 'dnd' : 'online');
  return {
    avatarAccent: row.avatar_accent || null,
    avatarColorKey: cleanAvatarColorKey(row.avatar_color_key) || 'blurple',
    avatarKey: row.avatar_key || null,
    createdAt: toMillis(row.created_at),
    displayName: row.display_name || '',
    doNotDisturb: presenceStatus === 'dnd',
    id: row.id,
    login: row.login,
    passwordHash: row.password_hash,
    presenceStatus,
    deletionRequestedAt: row.deletion_requested_at ? toMillis(row.deletion_requested_at) : null,
    deletedAt: row.deleted_at ? toMillis(row.deleted_at) : null
  };
}

// What we ever send back to a client: never the password hash.
function publicUser(user) {
  if (!user) return null;
  const presenceStatus = cleanPresenceStatus(user.presenceStatus) || (user.doNotDisturb ? 'dnd' : 'online');
  return {
    avatarAccent: user.avatarAccent || null,
    createdAt: user.createdAt,
    avatarColorKey: user.avatarColorKey || 'blurple',
    avatarUrl: user.avatarKey ? `/api/avatars/${encodeURIComponent(user.avatarKey)}` : null,
    displayName: user.displayName || '',
    dnd: presenceStatus === 'dnd',
    doNotDisturb: presenceStatus === 'dnd',
    id: user.id,
    login: user.login,
    presenceStatus
  };
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('base64url');
}

function createRecoveryCode() {
  let code = '';
  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    code += RECOVERY_CODE_ALPHABET[crypto.randomInt(RECOVERY_CODE_ALPHABET.length)];
  }
  return code;
}

// Bound to the account so the same code on two accounts never shares a hash.
function hashRecoveryCode(userId, code) {
  return crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

function cleanUserAgent(value) {
  return typeof value === 'string' ? value.slice(0, USER_AGENT_MAX_LENGTH) : '';
}

function cleanLocationLabel(value) {
  return typeof value === 'string' ? value.trim().slice(0, LOCATION_LABEL_MAX_LENGTH) : '';
}

// What a device is shown by; the session it opened stays server-side.
function mapLoginAlert(row) {
  return {
    id: row.id,
    kind: row.kind,
    client: row.client || '',
    os: row.os || '',
    location: row.location_label || '',
    createdAt: toMillis(row.created_at)
  };
}

function createUserStore({ databaseUrl, logger = console, pool, sessionTtlMs = DEFAULT_SESSION_TTL_MS } = {}) {
  let activePool = pool || null;
  function getPool() {
    if (!activePool) {
      activePool = createDbPool({ databaseUrl, logger });
    }
    return activePool;
  }

  async function createUser({ login, avatarColorKey = '', displayName = '', password, now = Date.now() }) {
    if (!login) throw new Error('Login is required');
    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();
    const assignedAvatarColorKey = cleanAvatarColorKey(avatarColorKey) || randomAvatarColorKey();

    try {
      // "What's new" is for people who used an earlier release; a new account
      // starts at the current announcement.
      const result = await getPool().query(
        `INSERT INTO users (id, login, display_name, password_hash, avatar_color_key, created_at, updated_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $6, jsonb_build_object('whatsNewSeen', $7::text))
         RETURNING *`,
        [id, login, displayName, passwordHash, assignedAvatarColorKey, toDate(now), WHATS_NEW_VERSION]
      );
      return { status: 'created', user: mapUser(result.rows[0]) };
    } catch (error) {
      if (error && error.code === UNIQUE_VIOLATION) {
        return { status: 'login_taken', user: null };
      }
      throw error;
    }
  }

  async function getUserByLogin(login) {
    const result = await getPool().query(`SELECT * FROM users WHERE login = $1`, [login]);
    return mapUser(result.rows[0]);
  }

  async function getUserById(id) {
    const result = await getPool().query(`SELECT * FROM users WHERE id = $1`, [id]);
    return mapUser(result.rows[0]);
  }

  // Rename: the display name is the only mutable identity field. An empty value
  // is allowed (the room then falls back to the login). Returns the updated
  // public-shaped user, or null when the account no longer exists.
  async function updateDisplayName({ userId, displayName = '', now = Date.now() }) {
    const result = await getPool().query(
      `UPDATE users SET display_name = $2, updated_at = $3 WHERE id = $1 RETURNING *`,
      [userId, displayName, toDate(now)]
    );
    return mapUser(result.rows[0]);
  }

  async function updateAvatar({ userId, avatarKey = null, avatarAccent = null, now = Date.now() }) {
    const result = await getPool().query(
      `UPDATE users
       SET avatar_key = $2, avatar_accent = $3, updated_at = $4
       WHERE id = $1
       RETURNING *`,
      [userId, avatarKey || null, avatarAccent || null, toDate(now)]
    );
    return mapUser(result.rows[0]);
  }

  async function swapAvatar({ userId, avatarKey = null, avatarAccent = null, now = Date.now() }) {
    return transaction(getPool(), async (client) => {
      const current = await client.query(
        `SELECT avatar_key FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );
      if (current.rowCount === 0) return { previousAvatarKey: null, user: null };
      const result = await client.query(
        `UPDATE users
         SET avatar_key = $2, avatar_accent = $3, updated_at = $4
         WHERE id = $1
         RETURNING *`,
        [userId, avatarKey || null, avatarAccent || null, toDate(now)]
      );
      return {
        previousAvatarKey: current.rows[0].avatar_key || null,
        user: mapUser(result.rows[0])
      };
    });
  }

  async function listAvatarKeys() {
    // An account waiting to be deleted keeps its avatar aside for a restore, so
    // avatar reconciliation must not treat that file as unused.
    const result = await getPool().query(
      `SELECT avatar_key FROM users WHERE avatar_key IS NOT NULL
       UNION
       SELECT metadata->'deletedProfile'->>'avatarKey' AS avatar_key
       FROM users
       WHERE metadata->'deletedProfile'->>'avatarKey' IS NOT NULL`
    );
    return result.rows.map((row) => row.avatar_key).filter(Boolean);
  }

  // Every way of replacing a password ends the same: the old credential stops
  // working everywhere, so all sessions and push subscriptions go with it.
  async function replacePasswordInTransaction(client, { userId, newPassword, now }) {
    const passwordHash = await hashPassword(newPassword);
    await client.query(
      `UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1`,
      [userId, passwordHash, toDate(now)]
    );
    await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [userId]);
  }

  // Password change always re-verifies the current password first so a leaked
  // session alone can't rotate the credential. Status mirrors the createUser
  // shape so the route layer can branch without inspecting errors.
  async function changePassword({ userId, currentPassword, newPassword, now = Date.now() }) {
    return transaction(getPool(), async (client) => {
      const userResult = await client.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      const user = mapUser(userResult.rows[0]);
      if (!user) return { status: 'not_found' };

      const ok = await verifyPassword(currentPassword, user.passwordHash);
      if (!ok) return { status: 'invalid_password' };

      await replacePasswordInTransaction(client, { userId, newPassword, now });
      return { status: 'updated' };
    });
  }

  async function verifyCredentials(login, password) {
    const user = await getUserByLogin(login);
    if (!user) {
      // Spend a comparable amount of time so a missing login isn't observably
      // faster than a wrong password.
      await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==');
      return null;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    return ok ? user : null;
  }

  async function createSession({
    userId,
    now = Date.now(),
    token = createSessionToken(),
    userAgent = '',
    locationLabel = ''
  }) {
    const expiresAt = now + sessionTtlMs;
    const tokenHash = hashSessionToken(token);
    const result = await getPool().query(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, location_label)
       VALUES ($1, $2, $3, $3, $4, $5, $6)
       RETURNING public_id`,
      [tokenHash, userId, toDate(now), toDate(expiresAt), cleanUserAgent(userAgent), cleanLocationLabel(locationLabel)]
    );
    return { expiresAt, publicId: result.rows[0]?.public_id || null, token, tokenHash };
  }

  // `userAgent` and `resolveLocation` only feed the hourly touch, so a request
  // never waits on a location lookup and an unchanged session is not rewritten.
  async function getSessionUser(token, now = Date.now(), { userAgent, resolveLocation } = {}) {
    if (typeof token !== 'string' || !token) return null;
    const tokenHash = hashSessionToken(token);
    const result = await getPool().query(
      `SELECT u.*, s.expires_at AS session_expires_at, s.last_seen_at AS session_last_seen_at,
              s.public_id AS session_public_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > $2`,
      [tokenHash, toDate(now)]
    );
    const row = result.rows[0];
    if (!row) return null;

    if (toMillis(row.session_last_seen_at) <= now - SESSION_TOUCH_INTERVAL_MS) {
      void touchSession({ tokenHash, now, userAgent, resolveLocation })
        .catch((error) => logger.error('Failed to touch session:', error));
    }

    return {
      session: {
        expiresAt: toMillis(row.session_expires_at),
        publicId: row.session_public_id,
        token,
        tokenHash
      },
      user: mapUser(row)
    };
  }

  // Best-effort sliding touch: extends the server-side TTL and refreshes what
  // the devices list shows. An empty location keeps the previous label, so a
  // missing GeoIP database does not erase what an earlier lookup found.
  async function touchSession({ tokenHash, now, userAgent, resolveLocation }) {
    let locationLabel = '';
    if (typeof resolveLocation === 'function') {
      try {
        locationLabel = cleanLocationLabel(await resolveLocation());
      } catch (error) {
        logger.error('Failed to resolve session location:', error);
      }
    }
    await getPool().query(
      `UPDATE sessions
       SET last_seen_at = $2,
           expires_at = GREATEST(expires_at, $3),
           user_agent = CASE WHEN $5 = '' THEN user_agent ELSE $5 END,
           location_label = CASE WHEN $6 = '' THEN location_label ELSE $6 END
       WHERE id = $1
         AND last_seen_at <= $4`,
      [
        tokenHash,
        toDate(now),
        toDate(now + sessionTtlMs),
        toDate(now - SESSION_TOUCH_INTERVAL_MS),
        cleanUserAgent(userAgent),
        locationLabel
      ]
    );
  }

  async function deleteSession(token) {
    if (typeof token !== 'string' || !token) return false;
    const result = await getPool().query(`DELETE FROM sessions WHERE id = $1`, [hashSessionToken(token)]);
    return result.rowCount > 0;
  }

  async function pruneSessions(now = Date.now()) {
    const result = await getPool().query(`DELETE FROM sessions WHERE expires_at <= $1`, [toDate(now)]);
    return result.rowCount;
  }

  async function listSessions({ userId, currentTokenHash = '', now = Date.now() }) {
    const result = await getPool().query(
      `SELECT id, public_id, user_agent, location_label, last_seen_at
       FROM sessions
       WHERE user_id = $1 AND expires_at > $2
       ORDER BY last_seen_at DESC, created_at DESC`,
      [userId, toDate(now)]
    );
    return result.rows.map((row) => ({
      id: row.public_id,
      current: Boolean(currentTokenHash) && row.id === currentTokenHash,
      ...describeUserAgent(row.user_agent),
      location: row.location_label || '',
      lastSeenAt: toMillis(row.last_seen_at)
    }));
  }

  // Returns the token hash so the caller can close whatever that session still
  // holds open (sockets, voice); the hash itself never reaches a client.
  async function revokeSession({ userId, publicId }) {
    if (typeof publicId !== 'string' || !UUID_PATTERN.test(publicId)) return { status: 'not_found', tokenHash: null };
    const result = await getPool().query(
      `DELETE FROM sessions WHERE user_id = $1 AND public_id = $2 RETURNING id`,
      [userId, publicId.toLowerCase()]
    );
    return result.rowCount === 1
      ? { status: 'revoked', tokenHash: result.rows[0].id }
      : { status: 'not_found', tokenHash: null };
  }

  async function revokeOtherSessions({ userId, keepTokenHash }) {
    const result = await getPool().query(
      `DELETE FROM sessions WHERE user_id = $1 AND id <> $2 RETURNING id`,
      [userId, String(keepTokenHash || '')]
    );
    return { tokenHashes: result.rows.map((row) => row.id) };
  }

  // Generating a set proves the password again, like a password change, so a
  // stolen session cannot mint itself a permanent way back into the account.
  async function generateRecoveryCodes({ userId, currentPassword, now = Date.now() }) {
    return transaction(getPool(), async (client) => {
      const userResult = await client.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      const user = mapUser(userResult.rows[0]);
      if (!user) return { status: 'not_found', codes: [] };
      if (!await verifyPassword(currentPassword, user.passwordHash)) return { status: 'invalid_password', codes: [] };

      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, createRecoveryCode);
      await client.query(`DELETE FROM account_recovery_codes WHERE user_id = $1`, [userId]);
      await client.query(
        `INSERT INTO account_recovery_codes (user_id, code_hash, created_at)
         SELECT $1, hash, $3 FROM unnest($2::text[]) AS hash`,
        [userId, codes.map((code) => hashRecoveryCode(userId, code)), toDate(now)]
      );
      return { status: 'generated', codes, generatedAt: now };
    });
  }

  async function getRecoveryCodesStatus(userId) {
    const result = await getPool().query(
      `SELECT count(*) FILTER (WHERE used_at IS NULL)::int AS remaining, max(created_at) AS generated_at
       FROM account_recovery_codes
       WHERE user_id = $1`,
      [userId]
    );
    const row = result.rows[0] || {};
    return {
      remaining: Number(row.remaining) || 0,
      generatedAt: row.generated_at ? toMillis(row.generated_at) : null
    };
  }

  // Both failure paths (unknown login, wrong or spent code) return before the
  // password hash is computed, so neither is observably slower than the other.
  async function recoverWithCode({ login, code, newPassword, now = Date.now() }) {
    const normalizedCode = normalizeRecoveryCode(code);
    if (!login || !normalizedCode) return { status: 'invalid', user: null, remaining: 0 };
    return transaction(getPool(), async (client) => {
      const userResult = await client.query(`SELECT * FROM users WHERE login = $1 FOR UPDATE`, [login]);
      const user = mapUser(userResult.rows[0]);
      // An account waiting to be deleted comes back through a restore, not a code.
      if (!user || user.deletionRequestedAt || user.deletedAt) return { status: 'invalid', user: null, remaining: 0 };

      const spent = await client.query(
        `UPDATE account_recovery_codes
         SET used_at = $3
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
         RETURNING id`,
        [user.id, hashRecoveryCode(user.id, normalizedCode), toDate(now)]
      );
      if (spent.rowCount !== 1) return { status: 'invalid', user: null, remaining: 0 };

      await replacePasswordInTransaction(client, { userId: user.id, newPassword, now });
      const remaining = await client.query(
        `SELECT count(*)::int AS remaining FROM account_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
        [user.id]
      );
      return { status: 'recovered', user, remaining: Number(remaining.rows[0]?.remaining) || 0 };
    });
  }

  // Per-account state of the nudges the lobby shows: the last "what's new"
  // announcement seen and how long the recovery codes reminder stays hidden.
  async function getAccountNotices(userId) {
    const result = await getPool().query(
      `SELECT metadata->>'whatsNewSeen' AS whats_new_seen,
              metadata->'recoveryCodesReminderSnoozedUntil' AS reminder_snoozed_until
       FROM users
       WHERE id = $1`,
      [userId]
    );
    const row = result.rows[0];
    const snoozedUntil = Number(row?.reminder_snoozed_until);
    return {
      whatsNewSeen: normalizeReleaseVersion(row?.whats_new_seen) || null,
      recoveryCodesReminderSnoozedUntil: Number.isSafeInteger(snoozedUntil) && snoozedUntil > 0 ? snoozedUntil : null
    };
  }

  // Only the current announcement can be recorded, so a stale client cannot
  // pin an account to an older release.
  async function markWhatsNewSeen({ userId, now = Date.now() }) {
    const result = await getPool().query(
      `UPDATE users
       SET metadata = jsonb_set(metadata, '{whatsNewSeen}', to_jsonb($2::text), true),
           updated_at = $3
       WHERE id = $1`,
      [userId, WHATS_NEW_VERSION, toDate(now)]
    );
    return result.rowCount === 1
      ? { status: 'seen', whatsNewSeen: WHATS_NEW_VERSION }
      : { status: 'not_found', whatsNewSeen: null };
  }

  async function snoozeRecoveryCodesReminder({ userId, now = Date.now() }) {
    const snoozedUntil = now + RECOVERY_CODES_REMINDER_SNOOZE_MS;
    const result = await getPool().query(
      `UPDATE users
       SET metadata = jsonb_set(metadata, '{recoveryCodesReminderSnoozedUntil}', to_jsonb($2::bigint), true),
           updated_at = $3
       WHERE id = $1`,
      [userId, snoozedUntil, toDate(now)]
    );
    return result.rowCount === 1
      ? { status: 'snoozed', snoozedUntil }
      : { status: 'not_found', snoozedUntil: null };
  }

  // A sign-in needs the account's attention when it comes from a device (browser
  // and system) and city the account has not used in the familiarity window.
  // Only answered or unflagged sign-ins vouch for a device: an unanswered
  // question must not let the same stranger sign in again quietly. The first
  // sign-in an account records with nothing else open just sets the baseline.
  async function recordLogin({
    userId,
    sessionPublicId = null,
    kind = 'login',
    userAgent = '',
    locationLabel = '',
    now = Date.now()
  }) {
    const device = describeUserAgent(userAgent);
    const location = cleanLocationLabel(locationLabel);
    const sameDevice = (entry) => entry.client === device.client && entry.os === device.os && entry.location === location;
    return transaction(getPool(), async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:login-events:${userId}`]);
      let alert = false;
      if (kind !== 'register') {
        const history = await db.query(
          `SELECT client, os, location_label, alert, resolution, created_at
           FROM account_login_events
           WHERE user_id = $1 AND created_at > $2`,
          [userId, toDate(now - LOGIN_FAMILIARITY_WINDOW_MS)]
        );
        const sessions = await db.query(
          `SELECT s.user_agent, s.location_label
           FROM sessions s
           LEFT JOIN account_login_events e ON e.session_public_id = s.public_id
           WHERE s.user_id = $1
             AND s.expires_at > $2
             AND s.public_id IS DISTINCT FROM $3::uuid
             AND NOT (COALESCE(e.alert, false) AND (e.resolution IS NULL OR e.resolution = 'denied'))`,
          [userId, toDate(now), sessionPublicId]
        );
        const vouchedByHistory = history.rows.some((row) => (!row.alert || row.resolution === 'confirmed')
          && sameDevice({ client: row.client, os: row.os, location: row.location_label }));
        const vouchedBySession = sessions.rows.some((row) => sameDevice({
          ...describeUserAgent(row.user_agent),
          location: row.location_label || ''
        }));
        // Only an account that never signed in sets a baseline. Judging by the
        // window alone would let any sign-in after a month away pass quietly.
        const signedInBefore = history.rowCount > 0 || (await db.query(
          'SELECT 1 FROM account_login_events WHERE user_id = $1 LIMIT 1',
          [userId]
        )).rowCount > 0;
        const baseline = !signedInBefore && sessions.rowCount === 0;
        alert = !baseline && !vouchedByHistory && !vouchedBySession;
      }
      const inserted = await db.query(
        `INSERT INTO account_login_events (user_id, session_public_id, kind, client, os, location_label, alert, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [userId, sessionPublicId, kind, device.client, device.os, location, alert, toDate(now)]
      );
      return { alert: alert ? mapLoginAlert(inserted.rows[0]) : null };
    });
  }

  // Unanswered questions about sign-ins, except the one this very session made.
  async function listPendingLoginAlerts({ userId, excludeSessionPublicId = null, now = Date.now() }) {
    const result = await getPool().query(
      `SELECT *
       FROM account_login_events
       WHERE user_id = $1
         AND alert
         AND resolved_at IS NULL
         AND created_at > $2
         AND session_public_id IS DISTINCT FROM $3::uuid
       ORDER BY created_at ASC
       LIMIT 20`,
      [userId, toDate(now - LOGIN_ALERT_TTL_MS), excludeSessionPublicId]
    );
    return result.rows.map(mapLoginAlert);
  }

  // "Это не я" ends the session that sign-in opened in the same transaction and
  // hands back its token hash so its sockets and voice can be closed too.
  async function resolveLoginAlert({ userId, alertId, resolution, currentSessionPublicId = null, now = Date.now() }) {
    if (!UUID_PATTERN.test(String(alertId || '')) || !['confirmed', 'denied'].includes(resolution)) {
      return { status: 'not_found', revokedTokenHash: null };
    }
    return transaction(getPool(), async (db) => {
      const resolved = await db.query(
        `UPDATE account_login_events
         SET resolved_at = $4, resolution = $3
         WHERE id = $1
           AND user_id = $2
           AND alert
           AND resolved_at IS NULL
           AND created_at > $5
           AND session_public_id IS DISTINCT FROM $6::uuid
         RETURNING session_public_id`,
        [String(alertId).toLowerCase(), userId, resolution, toDate(now), toDate(now - LOGIN_ALERT_TTL_MS), currentSessionPublicId]
      );
      if (resolved.rowCount !== 1) return { status: 'not_found', revokedTokenHash: null };
      const sessionPublicId = resolved.rows[0].session_public_id;
      if (resolution !== 'denied' || !sessionPublicId) return { status: 'resolved', revokedTokenHash: null };
      const deleted = await db.query(
        `DELETE FROM sessions WHERE user_id = $1 AND public_id = $2 RETURNING id`,
        [userId, sessionPublicId]
      );
      return { status: 'resolved', revokedTokenHash: deleted.rows[0]?.id || null };
    });
  }

  async function pruneLoginEvents(now = Date.now()) {
    const result = await getPool().query(
      `DELETE FROM account_login_events WHERE created_at <= $1`,
      [toDate(now - LOGIN_EVENT_RETENTION_MS)]
    );
    return result.rowCount;
  }

  async function close() {
    if (activePool) {
      await activePool.end();
    }
  }

  return {
    changePassword,
    close,
    createSession,
    createUser,
    deleteSession,
    generateRecoveryCodes,
    getAccountNotices,
    getRecoveryCodesStatus,
    getSessionUser,
    getUserById,
    getUserByLogin,
    listAvatarKeys,
    listPendingLoginAlerts,
    listSessions,
    markWhatsNewSeen,
    pruneLoginEvents,
    pruneSessions,
    recordLogin,
    recoverWithCode,
    resolveLoginAlert,
    revokeOtherSessions,
    revokeSession,
    snoozeRecoveryCodesReminder,
    swapAvatar,
    updateAvatar,
    updateDisplayName,
    verifyCredentials
  };
}

module.exports = {
  createUserStore,
  hashRecoveryCode,
  hashSessionToken,
  mapUser,
  publicUser,
  randomAvatarColorKey
};
