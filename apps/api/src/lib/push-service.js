'use strict';

const webPush = require('web-push');
const { PLATFORM_CLASSES } = require('@voice-room/shared/platform-class');
const { cleanPushEndpoint, describePushEndpoint } = require('./push-endpoint');

function describePushError(error) {
  return {
    errorName: String(error?.name || 'Error').slice(0, 80),
    errorCode: String(error?.code || '').slice(0, 80),
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : undefined
  };
}

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

function shouldDeliverPush(preferences, { peerUserId, roomId } = {}) {
  if (preferences?.doNotDisturb) return false;
  if (peerUserId && preferences?.mutedPeerIds?.includes(peerUserId)) return false;
  if (roomId && preferences?.mutedRoomIds?.includes(roomId)) return false;
  return true;
}

function resolvePushTtl({ expiresAt, ttl } = {}, now = Date.now()) {
  let resolvedTtl = Number.isFinite(ttl) ? Math.max(0, Math.floor(ttl)) : undefined;
  if (Number.isFinite(expiresAt)) {
    const remainingTtl = Math.ceil((expiresAt - now) / 1000);
    if (remainingTtl <= 0) return null;
    resolvedTtl = resolvedTtl === undefined ? remainingTtl : Math.min(resolvedTtl, remainingTtl);
  }
  return resolvedTtl;
}

function createPushService({ store, env = process.env, client = webPush, logger = console, now = Date.now } = {}) {
  const config = readPushConfig(env);
  if (config.enabled) client.setVapidDetails(config.subject, config.vapidPublicKey, config.privateKey);

  async function sendToUser(userId, payload, context = {}) {
    if (!config.enabled || !userId) return { enabled: config.enabled, sent: 0, removed: 0 };
    const ttl = resolvePushTtl(context, now());
    if (ttl === null) return { enabled: true, sent: 0, removed: 0 };
    let subscriptions;
    try {
      subscriptions = await store.listByUserId(userId);
    } catch (error) {
      logger.warn?.({ err: error, userId }, 'Failed to load push subscriptions');
      if (context.strictFailures) throw error;
      return { enabled: true, sent: 0, removed: 0 };
    }
    let sent = 0;
    let removed = 0;
    const failures = [];
    await Promise.all(subscriptions.map(async (subscription) => {
      if (subscription.platformClass === PLATFORM_CLASSES.mobile) return;
      const endpoint = cleanPushEndpoint(subscription.endpoint);
      if (!endpoint) {
        try {
          await store.removeByEndpoint(subscription.endpoint);
          removed += 1;
        } catch (cleanupError) {
          logger.warn?.({ ...describePushError(cleanupError), ...describePushEndpoint(subscription.endpoint) }, 'Failed to remove invalid push subscription');
        }
        return;
      }
      try {
        await client.sendNotification(
          { endpoint, keys: subscription.keys },
          JSON.stringify(payload),
          Number.isFinite(ttl) ? { TTL: Math.max(0, Math.floor(ttl)) } : undefined
        );
        sent += 1;
        await store.markSuccess(endpoint);
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          try {
            await store.removeByEndpoint(endpoint);
            removed += 1;
          } catch (cleanupError) {
            logger.warn?.({ ...describePushError(cleanupError), ...describePushEndpoint(endpoint) }, 'Failed to remove expired push subscription');
          }
          return;
        }
        logger.warn?.({ ...describePushError(error), ...describePushEndpoint(endpoint) }, 'Push delivery failed');
        failures.push(error);
      }
    }));
    if (context.strictFailures && failures.length > 0) {
      throw new AggregateError(failures, 'Push provider delivery failed');
    }
    return { enabled: true, sent, removed };
  }

  return {
    config: { enabled: config.enabled, vapidPublicKey: config.enabled ? config.vapidPublicKey : '' },
    sendToUser
  };
}

module.exports = { createPushService, readPushConfig, resolvePushTtl, shouldDeliverPush };
