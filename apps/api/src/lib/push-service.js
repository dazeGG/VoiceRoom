'use strict';

const webPush = require('web-push');

function readPushConfig(env = process.env) {
  const vapidPublicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.VAPID_SUBJECT || '').trim();
  return {
    enabled: Boolean(vapidPublicKey && privateKey && subject),
    vapidPublicKey,
    privateKey,
    subject
  };
}

function shouldDeliverPush(preferences, { peerUserId } = {}) {
  if (preferences?.doNotDisturb) return false;
  if (peerUserId && preferences?.mutedPeerIds?.includes(peerUserId)) return false;
  return true;
}

function createPushService({ store, env = process.env, client = webPush, logger = console } = {}) {
  const config = readPushConfig(env);
  if (config.enabled) client.setVapidDetails(config.subject, config.vapidPublicKey, config.privateKey);

  async function sendToUser(userId, payload, { ttl } = {}) {
    if (!config.enabled || !userId) return { enabled: config.enabled, sent: 0, removed: 0 };
    let subscriptions;
    try {
      subscriptions = await store.listByUserId(userId);
    } catch (error) {
      logger.warn?.({ err: error, userId }, 'Failed to load push subscriptions');
      return { enabled: true, sent: 0, removed: 0 };
    }
    let sent = 0;
    let removed = 0;
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await client.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          JSON.stringify(payload),
          Number.isFinite(ttl) ? { TTL: Math.max(0, Math.floor(ttl)) } : undefined
        );
        sent += 1;
        await store.markSuccess(subscription.endpoint);
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          try {
            await store.removeByEndpoint(subscription.endpoint);
            removed += 1;
          } catch (cleanupError) {
            logger.warn?.({ err: cleanupError, endpoint: subscription.endpoint }, 'Failed to remove expired push subscription');
          }
          return;
        }
        logger.warn?.({ err: error, endpoint: subscription.endpoint }, 'Push delivery failed');
      }
    }));
    return { enabled: true, sent, removed };
  }

  return {
    config: { enabled: config.enabled, vapidPublicKey: config.enabled ? config.vapidPublicKey : '' },
    sendToUser
  };
}

module.exports = { createPushService, readPushConfig, shouldDeliverPush };
