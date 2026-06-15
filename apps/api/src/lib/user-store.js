'use strict';

const crypto = require('node:crypto');
const { createDbPool } = require('./db');
const { hashPassword, verifyPassword } = require('./password');

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

function mapUser(row) {
  if (!row) return null;
  return {
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
    displayName: user.displayName || '',
    id: user.id,
    login: user.login
  };
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createUserStore({ databaseUrl, logger = console, pool, sessionTtlMs = DEFAULT_SESSION_TTL_MS } = {}) {
  let activePool = pool || null;
  function getPool() {
    if (!activePool) {
      activePool = createDbPool({ databaseUrl, logger });
    }
    return activePool;
  }

  async function createUser({ login, displayName = '', password, now = Date.now() }) {
    if (!login) throw new Error('Login is required');
    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();

    try {
      const result = await getPool().query(
        `INSERT INTO users (id, login, display_name, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING *`,
        [id, login, displayName, passwordHash, toDate(now)]
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
    await getPool().query(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $3, $4)`,
      [token, userId, toDate(now), toDate(expiresAt)]
    );
    return { token, expiresAt };
  }

  async function getSessionUser(token, now = Date.now()) {
    if (typeof token !== 'string' || !token) return null;
    const result = await getPool().query(
      `SELECT u.*, s.expires_at AS session_expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > $2`,
      [token, toDate(now)]
    );
    const row = result.rows[0];
    if (!row) return null;

    // Best-effort sliding touch; failures here must not block the request.
    getPool()
      .query(`UPDATE sessions SET last_seen_at = $2 WHERE id = $1`, [token, toDate(now)])
      .catch((error) => logger.error('Failed to touch session:', error));

    return { session: { expiresAt: toMillis(row.session_expires_at), token }, user: mapUser(row) };
  }

  async function deleteSession(token) {
    if (typeof token !== 'string' || !token) return false;
    const result = await getPool().query(`DELETE FROM sessions WHERE id = $1`, [token]);
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
    close,
    createSession,
    createUser,
    deleteSession,
    getSessionUser,
    getUserById,
    getUserByLogin,
    pruneSessions,
    verifyCredentials
  };
}

module.exports = {
  createUserStore,
  mapUser,
  publicUser
};
