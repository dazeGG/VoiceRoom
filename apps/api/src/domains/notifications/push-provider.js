'use strict';

const { createPushService } = require('../../lib/push-service');

function createNotificationPushProvider({ pushService, store, env, client, logger } = {}) {
  const service = pushService || createPushService({ store, env, client, logger });
  return Object.freeze({
    enabled: Boolean(service.config?.enabled),
    async deliver(job) {
      const result = await service.sendToUser(job.recipientUserId, job.payload, { strictFailures: true, ttl: 3600 });
      if (!result.enabled) return { delivered: false, suppressed: true, reason: 'provider_disabled' };
      return { delivered: result.sent > 0, suppressed: result.sent === 0, sent: result.sent, removed: result.removed };
    }
  });
}

module.exports = { createNotificationPushProvider };
