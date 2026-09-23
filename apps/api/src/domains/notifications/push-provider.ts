import { createPushService } from '../../lib/push-service.js';

type SendResult = { enabled: boolean; sent: number; removed: number };

export interface NotificationPushService {
  config?: { enabled?: boolean };
  sendToUser(userId: string, payload: unknown, options: { strictFailures: boolean; ttl: number }): Promise<SendResult>;
}

export type PushDelivery =
  | { delivered: false; suppressed: true; reason: 'provider_disabled' }
  | { delivered: boolean; suppressed: boolean; sent: number; removed: number };

function createNotificationPushProvider({ pushService, store, env, client, logger }: {
  pushService?: NotificationPushService;
  store?: unknown;
  env?: NodeJS.ProcessEnv;
  client?: unknown;
  logger?: unknown;
} = {}) {
  // push-service.js is untyped and its inferred options miss `store`; typed with lib/ in PR 10g.
  const service: NotificationPushService = pushService || createPushService({ store, env, client, logger } as Parameters<typeof createPushService>[0]);
  return Object.freeze({
    enabled: Boolean(service.config?.enabled),
    async deliver(job: { recipientUserId: string; payload: unknown }): Promise<PushDelivery> {
      const result = await service.sendToUser(job.recipientUserId, job.payload, { strictFailures: true, ttl: 3600 });
      if (!result.enabled) return { delivered: false, suppressed: true, reason: 'provider_disabled' };
      return { delivered: result.sent > 0, suppressed: result.sent === 0, sent: result.sent, removed: result.removed };
    }
  });
}

export { createNotificationPushProvider };
