import webPush from 'web-push';
import { PLATFORM_CLASSES } from '@voice-room/shared/platform-class';
import { cleanPushEndpoint, describePushEndpoint } from './push-endpoint.ts';
import { LOG_EVENTS } from './log-events.ts';
import { createLogger } from './logger.ts';

type Env = NodeJS.ProcessEnv;
type PushLogger = { warn(...args: unknown[]): void };
type StoredSubscription = { endpoint: string; keys: { p256dh: string; auth: string }; platformClass?: string };

export interface PushSubscriptionStore {
  listByUserId(userId: string): Promise<StoredSubscription[]>;
  removeByEndpoint(endpoint: string): Promise<unknown>;
  markSuccess(endpoint: string): Promise<unknown>;
}

export interface WebPushClient {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(subscription: { endpoint: string; keys: StoredSubscription['keys'] }, payload: string, options?: { TTL: number }): Promise<unknown>;
}

export type PushConfig = { enabled: boolean; vapidPublicKey: string; privateKey: string; subject: string };
export type PushContext = { expiresAt?: unknown; ttl?: unknown; strictFailures?: boolean; [key: string]: unknown };
export type PushPreferences = { doNotDisturb?: boolean; mutedPeerIds?: string[]; mutedRoomIds?: string[] } | null | undefined;

function describePushError(input: unknown): { errorName: string; errorCode: string; statusCode: number | undefined } {
  const error = input as { name?: unknown; code?: unknown; statusCode?: unknown } | null | undefined;
  return {
    errorName: String(error?.name || 'Error').slice(0, 80),
    errorCode: String(error?.code || '').slice(0, 80),
    statusCode: Number.isInteger(error?.statusCode) ? error?.statusCode as number : undefined
  };
}

function readPushConfig(env: Env = process.env): PushConfig {
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

function shouldDeliverPush(preferences: PushPreferences, { peerUserId, roomId }: { peerUserId?: string; roomId?: string } = {}): boolean {
  if (preferences?.doNotDisturb) return false;
  if (peerUserId && preferences?.mutedPeerIds?.includes(peerUserId)) return false;
  if (roomId && preferences?.mutedRoomIds?.includes(roomId)) return false;
  return true;
}

function resolvePushTtl({ expiresAt, ttl }: { expiresAt?: unknown; ttl?: unknown } = {}, now: number = Date.now()): number | null | undefined {
  let resolvedTtl = Number.isFinite(ttl) ? Math.max(0, Math.floor(ttl as number)) : undefined;
  if (Number.isFinite(expiresAt)) {
    const remainingTtl = Math.ceil(((expiresAt as number) - now) / 1000);
    if (remainingTtl <= 0) return null;
    resolvedTtl = resolvedTtl === undefined ? remainingTtl : Math.min(resolvedTtl, remainingTtl);
  }
  return resolvedTtl;
}

function createPushService({ store, env = process.env, client = webPush, logger = createLogger({ name: 'api' }), now = Date.now }: {
  store?: PushSubscriptionStore;
  env?: Env;
  client?: WebPushClient;
  logger?: PushLogger;
  now?: () => number;
} = {}) {
  const config = readPushConfig(env);
  if (config.enabled) client.setVapidDetails(config.subject, config.vapidPublicKey, config.privateKey);

  async function sendToUser(userId: string, payload: unknown, context: PushContext = {}): Promise<{ enabled: boolean; sent: number; removed: number }> {
    if (!config.enabled || !userId) return { enabled: config.enabled, sent: 0, removed: 0 };
    const ttl = resolvePushTtl(context, now());
    if (ttl === null) return { enabled: true, sent: 0, removed: 0 };
    const subscriptionStore = store as PushSubscriptionStore;
    let subscriptions: StoredSubscription[];
    try {
      subscriptions = await subscriptionStore.listByUserId(userId);
    } catch (error) {
      logger.warn({ evt: LOG_EVENTS.PUSH_SUBSCRIPTION_LOAD_FAILED, err: error, userId }, 'failed to load push subscriptions');
      if (context.strictFailures) throw error;
      return { enabled: true, sent: 0, removed: 0 };
    }
    let sent = 0;
    let removed = 0;
    const failures: unknown[] = [];
    await Promise.all(subscriptions.map(async (subscription) => {
      if (subscription.platformClass === PLATFORM_CLASSES.mobile) return;
      const endpoint = cleanPushEndpoint(subscription.endpoint);
      if (!endpoint) {
        try {
          await subscriptionStore.removeByEndpoint(subscription.endpoint);
          removed += 1;
        } catch (cleanupError) {
          logger.warn({ evt: LOG_EVENTS.PUSH_SUBSCRIPTION_PRUNE_FAILED, reason: 'invalid', ...describePushError(cleanupError), ...describePushEndpoint(subscription.endpoint) }, 'failed to remove an invalid push subscription');
        }
        return;
      }
      try {
        await client.sendNotification(
          { endpoint, keys: subscription.keys },
          JSON.stringify(payload),
          Number.isFinite(ttl) ? { TTL: Math.max(0, Math.floor(ttl as number)) } : undefined
        );
        sent += 1;
        await subscriptionStore.markSuccess(endpoint);
      } catch (error) {
        const statusCode = (error as { statusCode?: unknown } | null | undefined)?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          try {
            await subscriptionStore.removeByEndpoint(endpoint);
            removed += 1;
          } catch (cleanupError) {
            logger.warn({ evt: LOG_EVENTS.PUSH_SUBSCRIPTION_PRUNE_FAILED, reason: 'expired', ...describePushError(cleanupError), ...describePushEndpoint(endpoint) }, 'failed to remove an expired push subscription');
          }
          return;
        }
        logger.warn({ evt: LOG_EVENTS.PUSH_SEND_FAILED, ...describePushError(error), ...describePushEndpoint(endpoint) }, 'push delivery failed');
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

export type PushService = ReturnType<typeof createPushService>;

export { createPushService, readPushConfig, resolvePushTtl, shouldDeliverPush };
