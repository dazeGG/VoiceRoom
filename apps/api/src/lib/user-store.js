'use strict';

const crypto = require('node:crypto');
const { createDbPool } = require('./db');
const { hashPassword, verifyPassword } = require('./password');
const { AVATAR_COLOR_KEYS, cleanAvatarColorKey } = require('@voice-room/shared/validation');

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = '23505';

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
  return {
    avatarColorKey: cleanAvatarColorKey(row.avatar_color_key) || 'blurple',
    createdAt: toMillis(row.created_at),
    displayName: row.display_name || '',
    id: row.id,
    login: row.login,
    passwordHash: row.password_hash
  };
}

// What we ever send back to a client: never the password hash.
function publicUser(user) {
  if (!user) return null;
  return {
    createdAt: user.createdAt,
    avatarColorKey: user.avatarColorKey || 'blurple',
    displayName: user.displayName || '',
    id: user.id,
    login: user.login
  };
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('base64url');
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
      const result = await getPool().query(
        `INSERT INTO users (id, login, display_name, password_hash, avatar_color_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING *`,
        [id, login, displayName, passwordHash, assignedAvatarColorKey, toDate(now)]
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

  // Password change always re-verifies the current password first so a leaked
  // session alone can't rotate the credential. Status mirrors the createUser
  // shape so the route layer can branch without inspecting errors.
  async function changePassword({ userId, currentPassword, newPassword, now = Date.now() }) {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      const user = mapUser(userResult.rows[0]);
      if (!user) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }

      const ok = await verifyPassword(currentPassword, user.passwordHash);
      if (!ok) {
        await client.query('ROLLBACK');
        return { status: 'invalid_password' };
      }

      const passwordHash = await hashPassword(newPassword);
      await client.query(
        `UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1`,
        [userId, passwordHash, toDate(now)]
      );
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      await client.query('COMMIT');
      return { status: 'updated' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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

  async function createSession({ userId, now = Date.now(), token = createSessionToken() }) {
    const expiresAt = now + sessionTtlMs;
    const tokenHash = hashSessionToken(token);
    await getPool().query(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $3, $4)`,
      [tokenHash, userId, toDate(now), toDate(expiresAt)]
    );
    return { token, expiresAt };
  }

  async function getSessionUser(token, now = Date.now()) {
    if (typeof token !== 'string' || !token) return null;
    const tokenHash = hashSessionToken(token);
    const result = await getPool().query(
      `SELECT u.*, s.expires_at AS session_expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > $2`,
      [tokenHash, toDate(now)]
    );
    const row = result.rows[0];
    if (!row) return null;

    // Best-effort sliding touch; failures here must not block the request.
    getPool()
      .query(`UPDATE sessions SET last_seen_at = $2 WHERE id = $1`, [tokenHash, toDate(now)])
      .catch((error) => logger.error('Failed to touch session:', error));

    return { session: { expiresAt: toMillis(row.session_expires_at), token }, user: mapUser(row) };
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
    getSessionUser,
    getUserById,
    getUserByLogin,
    pruneSessions,
    updateDisplayName,
    verifyCredentials
  };
}

module.exports = {
  createUserStore,
  hashSessionToken,
  mapUser,
  publicUser,
  randomAvatarColorKey
};
