import webPush from 'web-push';
import { PLATFORM_CLASSES } from '@voice-room/shared/platform-class';
import { cleanPushEndpoint, describePushEndpoint } from './push-endpoint.ts';
import { LOG_EVENTS } from './log-events.ts';
import { createLogger } from './logger.ts';
import { readPushConfig, type PushConfig } from '../app/config.ts';
import { fieldOf } from '../platform/record.ts';

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
  sendNotification(
    subscription: { endpoint: string; keys: StoredSubscription['keys'] },
    payload: string,
    options?: { TTL: number }
  ): Promise<unknown>;
}

export type PushContext = { expiresAt?: unknown; ttl?: unknown; strictFailures?: boolean; [key: string]: unknown };
export type PushPreferences =
  { doNotDisturb?: boolean; mutedPeerIds?: string[]; mutedRoomIds?: string[] } | null | undefined;

// A name or code is logged as text; anything that is not a string or a number is left out.
function errorText(value: unknown, fallback: string): string {
  return (typeof value === 'string' || typeof value === 'number') && value ? String(value) : fallback;
}

function describePushError(error: unknown): { errorName: string; errorCode: string; statusCode: number | undefined } {
  const statusCode = fieldOf(error, 'statusCode');
  return {
    errorName: errorText(fieldOf(error, 'name'), 'Error').slice(0, 80),
    errorCode: errorText(fieldOf(error, 'code'), '').slice(0, 80),
    statusCode: typeof statusCode === 'number' && Number.isInteger(statusCode) ? statusCode : undefined
  };
}

function shouldDeliverPush(
  preferences: PushPreferences,
  { peerUserId, roomId }: { peerUserId?: string; roomId?: string } = {}
): boolean {
  if (preferences?.doNotDisturb) return false;
  if (peerUserId && preferences?.mutedPeerIds?.includes(peerUserId)) return false;
  if (roomId && preferences?.mutedRoomIds?.includes(roomId)) return false;
  return true;
}

function resolvePushTtl(
  { expiresAt, ttl }: { expiresAt?: unknown; ttl?: unknown } = {},
  now: number = Date.now()
): number | null | undefined {
  let resolvedTtl = typeof ttl === 'number' && Number.isFinite(ttl) ? Math.max(0, Math.floor(ttl)) : undefined;
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    const remainingTtl = Math.ceil((expiresAt - now) / 1000);
    if (remainingTtl <= 0) return null;
    resolvedTtl = resolvedTtl === undefined ? remainingTtl : Math.min(resolvedTtl, remainingTtl);
  }
  return resolvedTtl;
}

function createPushService({
  store,
  env = process.env,
  config = readPushConfig(env),
  client = webPush,
  logger = createLogger({ name: 'api' }),
  now = Date.now
}: {
  store?: PushSubscriptionStore | undefined;
  env?: Env | undefined;
  /** The VAPID settings; read from env when not given. */
  config?: PushConfig | undefined;
  client?: WebPushClient | undefined;
  logger?: PushLogger | undefined;
  now?: () => number;
} = {}) {
  if (config.enabled) client.setVapidDetails(config.subject, config.vapidPublicKey, config.privateKey);

  async function sendToUser(
    userId: string,
    payload: unknown,
    context: PushContext = {}
  ): Promise<{ enabled: boolean; sent: number; removed: number }> {
    if (!config.enabled || !userId) return { enabled: config.enabled, sent: 0, removed: 0 };
    const ttl = resolvePushTtl(context, now());
    if (ttl === null) return { enabled: true, sent: 0, removed: 0 };
    let subscriptions: StoredSubscription[];
    try {
      if (!store) throw new Error('No push subscription store is installed');
      subscriptions = await store.listByUserId(userId);
    } catch (error) {
      logger.warn(
        { evt: LOG_EVENTS.PUSH_SUBSCRIPTION_LOAD_FAILED, err: error, userId },
        'failed to load push subscriptions'
      );
      if (context.strictFailures) throw error;
      return { enabled: true, sent: 0, removed: 0 };
    }
    let sent = 0;
    let removed = 0;
    const failures: unknown[] = [];
    await Promise.all(
      subscriptions.map(async (subscription) => {
        if (subscription.platformClass === PLATFORM_CLASSES.mobile) return;
        const endpoint = cleanPushEndpoint(subscription.endpoint);
        if (!endpoint) {
          try {
            await store.removeByEndpoint(subscription.endpoint);
            removed += 1;
          } catch (cleanupError) {
            logger.warn(
              {
                evt: LOG_EVENTS.PUSH_SUBSCRIPTION_PRUNE_FAILED,
                reason: 'invalid',
                ...describePushError(cleanupError),
                ...describePushEndpoint(subscription.endpoint)
              },
              'failed to remove an invalid push subscription'
            );
          }
          return;
        }
        try {
          await client.sendNotification(
            { endpoint, keys: subscription.keys },
            JSON.stringify(payload),
            typeof ttl === 'number' && Number.isFinite(ttl) ? { TTL: Math.max(0, Math.floor(ttl)) } : undefined
          );
          sent += 1;
          await store.markSuccess(endpoint);
        } catch (error) {
          const statusCode = fieldOf(error, 'statusCode');
          if (statusCode === 404 || statusCode === 410) {
            try {
              await store.removeByEndpoint(endpoint);
              removed += 1;
            } catch (cleanupError) {
              logger.warn(
                {
                  evt: LOG_EVENTS.PUSH_SUBSCRIPTION_PRUNE_FAILED,
                  reason: 'expired',
                  ...describePushError(cleanupError),
                  ...describePushEndpoint(endpoint)
                },
                'failed to remove an expired push subscription'
              );
            }
            return;
          }
          logger.warn(
            { evt: LOG_EVENTS.PUSH_SEND_FAILED, ...describePushError(error), ...describePushEndpoint(endpoint) },
            'push delivery failed'
          );
          failures.push(error);
        }
      })
    );
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
export type { PushConfig };

export { createPushService, readPushConfig, resolvePushTtl, shouldDeliverPush };
