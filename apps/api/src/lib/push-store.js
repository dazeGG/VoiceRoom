'use strict';

const crypto = require('node:crypto');
const { createDbPool } = require('./db');

function createRowId() {
  return crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex');
}

function mapSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
    createdAt: row.created_at?.getTime?.() ?? (Number(row.created_at) || 0),
    lastSuccessAt: row.last_success_at?.getTime?.() ?? null,
    metadata: row.metadata || {}
  };
}

function createPushStore({ databaseUrl, logger = console, pool } = {}) {
  let activePool = pool || null;
  function getPool() {
    if (!activePool) activePool = createDbPool({ databaseUrl, logger });
    return activePool;
  }

  async function upsert({ userId, subscription, metadata = {} }) {
    const endpoint = String(subscription?.endpoint || '').trim();
    const p256dh = String(subscription?.keys?.p256dh || '').trim();
    const auth = String(subscription?.keys?.auth || '').trim();
    if (!userId || !endpoint || !p256dh || !auth) return null;
    const result = await getPool().query(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, metadata)
       VALUES ($1, $2, $3, $4, $5, current_timestamp, $6::jsonb)
       ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           metadata = EXCLUDED.metadata
       WHERE push_subscriptions.user_id = EXCLUDED.user_id
          OR (push_subscriptions.p256dh = EXCLUDED.p256dh
              AND push_subscriptions.auth = EXCLUDED.auth)
       RETURNING *`,
      [createRowId(), userId, endpoint, p256dh, auth, JSON.stringify(metadata || {})]
    );
    return mapSubscription(result.rows[0]);
  }

  async function remove({ userId, endpoint }) {
    const result = await getPool().query(
      `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
      [userId, String(endpoint || '').trim()]
    );
    return result.rowCount > 0;
  }

  async function removeByEndpoint(endpoint) {
    await getPool().query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  }

  async function listByUserId(userId) {
    const result = await getPool().query(
      `SELECT * FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    );
    return result.rows.map(mapSubscription);
  }

  async function markSuccess(endpoint) {
    await getPool().query(
      `UPDATE push_subscriptions SET last_success_at = current_timestamp WHERE endpoint = $1`,
      [endpoint]
    );
  }

  async function close() {
    if (activePool) await activePool.end();
  }

  return { close, listByUserId, markSuccess, remove, removeByEndpoint, upsert };
}

module.exports = { createPushStore, mapSubscription };
