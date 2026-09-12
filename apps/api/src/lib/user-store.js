'use strict';

const crypto = require('node:crypto');
const { createDbPool, transaction } = require('./db');
const { hashPassword, verifyPassword } = require('./password');
const { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus } = require('@voice-room/shared/validation');
const {
  ONBOARDING_KEYS,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  describeUserAgent,
  normalizeOnboardingKey,
  normalizeRecoveryCode
} = require('@voice-room/shared/account-security');

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const USER_AGENT_MAX_LENGTH = 512;
const LOCATION_LABEL_MAX_LENGTH = 120;
const UNIQUE_VIOLATION = '23505';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    presenceStatus
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
      // Release announcements are for accounts that existed before the release;
      // a new account starts with all of them already behind it.
      const result = await getPool().query(
        `INSERT INTO users (id, login, display_name, password_hash, avatar_color_key, created_at, updated_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $6, jsonb_build_object('onboardingDismissed', to_jsonb($7::text[])))
         RETURNING *`,
        [id, login, displayName, passwordHash, assignedAvatarColorKey, toDate(now), [...ONBOARDING_KEYS]]
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
    const result = await getPool().query(
      `SELECT avatar_key FROM users WHERE avatar_key IS NOT NULL`
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
      if (!user) return { status: 'invalid', user: null, remaining: 0 };

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

  async function listDismissedOnboarding(userId) {
    const result = await getPool().query(
      `SELECT metadata->'onboardingDismissed' AS dismissed FROM users WHERE id = $1`,
      [userId]
    );
    const dismissed = result.rows[0]?.dismissed;
    return Array.isArray(dismissed) ? dismissed.map(normalizeOnboardingKey).filter(Boolean) : [];
  }

  async function dismissOnboarding({ userId, key, now = Date.now() }) {
    const onboardingKey = normalizeOnboardingKey(key);
    if (!onboardingKey) return { status: 'invalid', dismissed: [] };
    const result = await getPool().query(
      `UPDATE users
       SET metadata = jsonb_set(
             metadata,
             '{onboardingDismissed}',
             CASE
               WHEN jsonb_typeof(metadata->'onboardingDismissed') <> 'array' OR metadata->'onboardingDismissed' IS NULL
                 THEN jsonb_build_array($2::text)
               WHEN metadata->'onboardingDismissed' @> jsonb_build_array($2::text)
                 THEN metadata->'onboardingDismissed'
               ELSE (metadata->'onboardingDismissed') || jsonb_build_array($2::text)
             END,
             true
           ),
           updated_at = $3
       WHERE id = $1
       RETURNING metadata->'onboardingDismissed' AS dismissed`,
      [userId, onboardingKey, toDate(now)]
    );
    if (result.rowCount !== 1) return { status: 'not_found', dismissed: [] };
    const dismissed = result.rows[0].dismissed;
    return {
      status: 'dismissed',
      dismissed: Array.isArray(dismissed) ? dismissed.map(normalizeOnboardingKey).filter(Boolean) : []
    };
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
    dismissOnboarding,
    generateRecoveryCodes,
    getRecoveryCodesStatus,
    getSessionUser,
    getUserById,
    getUserByLogin,
    listAvatarKeys,
    listDismissedOnboarding,
    listSessions,
    pruneSessions,
    recoverWithCode,
    revokeOtherSessions,
    revokeSession,
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
