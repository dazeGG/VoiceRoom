'use strict';

const crypto = require('node:crypto');
const { createDbPool, transaction } = require('./db');
const { classifyPlatform, PLATFORM_CLASSES } = require('@voice-room/shared/platform-class');

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
    platformClass: row.platform_class || PLATFORM_CLASSES.unknown,
    metadata: row.metadata || {}
  };
}

const PLATFORM_SIGNAL_METADATA_KEYS = new Set([
  'desktopBridge',
  'maxTouchPoints',
  'platform',
  'platformClass',
  'userAgent',
  'userAgentData',
  'userAgentDataMobile'
]);

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};

  const sanitized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (PLATFORM_SIGNAL_METADATA_KEYS.has(key)) continue;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function normalizePlatformClass(value) {
  return Object.values(PLATFORM_CLASSES).includes(value) ? value : PLATFORM_CLASSES.unknown;
}

function resolvePlatformClass(metadata) {
  const explicit = normalizePlatformClass(metadata?.platformClass);
  if (explicit !== PLATFORM_CLASSES.unknown || metadata?.platformClass === PLATFORM_CLASSES.unknown) return explicit;

  return classifyPlatform({
    desktopBridge: metadata?.desktopBridge === true,
    userAgentDataMobile: typeof metadata?.userAgentDataMobile === 'boolean' ? metadata.userAgentDataMobile : undefined,
    userAgent: typeof metadata?.userAgent === 'string' ? metadata.userAgent : '',
    platform: typeof metadata?.platform === 'string' ? metadata.platform : '',
    maxTouchPoints: Number.isFinite(metadata?.maxTouchPoints) ? Number(metadata.maxTouchPoints) : 0
  });
}

function createPushStore({ databaseUrl, logger = console, pool, maxSubscriptionsPerUser = 10 } = {}) {
  const subscriptionLimit = Math.max(1, Math.floor(Number(maxSubscriptionsPerUser) || 10));
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
    const platformClass = resolvePlatformClass(metadata);
    const safeMetadata = sanitizeMetadata(metadata);
    return transaction(getPool(), async (client) => {
      await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      const result = await client.query(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, metadata, platform_class)
         VALUES ($1, $2, $3, $4, $5, current_timestamp, $6::jsonb, $7::push_subscription_platform_class)
         ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth,
             created_at = current_timestamp,
             metadata = EXCLUDED.metadata,
             platform_class = EXCLUDED.platform_class
         WHERE push_subscriptions.user_id = EXCLUDED.user_id
            OR (push_subscriptions.p256dh = EXCLUDED.p256dh
                AND push_subscriptions.auth = EXCLUDED.auth)
         RETURNING *`,
        [createRowId(), userId, endpoint, p256dh, auth, JSON.stringify(safeMetadata), platformClass]
      );
      const stored = result.rows[0];
      if (!stored) return null;
      await client.query(
        `DELETE FROM push_subscriptions
         WHERE id IN (
           SELECT id
           FROM push_subscriptions
           WHERE user_id = $1
           ORDER BY CASE WHEN endpoint = $2 THEN 0 ELSE 1 END, created_at DESC, id DESC
           OFFSET $3
         )`,
        [userId, endpoint, subscriptionLimit]
      );
      return mapSubscription(stored);
    });
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

module.exports = {
  createPushStore,
  mapSubscription,
  resolvePlatformClass,
  sanitizeMetadata
};
