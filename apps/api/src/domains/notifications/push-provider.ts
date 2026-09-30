import { createPushService } from '../../lib/push-service.ts';
import type { PushSubscriptionStore, WebPushClient } from '../../lib/push-service.ts';

type SendResult = { enabled: boolean; sent: number; removed: number };

export interface NotificationPushService {
  config?: { enabled?: boolean };
  sendToUser(userId: string, payload: unknown, options: { strictFailures: boolean; ttl: number }): Promise<SendResult>;
}

export type PushDelivery =
  | { delivered: false; suppressed: true; reason: 'provider_disabled' }
  | { delivered: boolean; suppressed: boolean; sent: number; removed: number };

function createNotificationPushProvider({
  pushService,
  store,
  env,
  client,
  logger
}: {
  pushService?: NotificationPushService;
  store?: PushSubscriptionStore;
  env?: NodeJS.ProcessEnv;
  client?: WebPushClient;
  logger?: { warn(...args: unknown[]): void };
} = {}) {
  const service: NotificationPushService = pushService || createPushService({ store, env, client, logger });
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
