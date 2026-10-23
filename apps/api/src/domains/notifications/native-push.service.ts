// Push to the Android app: the same payload Web Push sends, delivered to each
// of the account's live RuStore tokens. It answers like the web push service,
// so the fan-out can sum both. A token is forgotten only when RuStore says it
// is gone; a refused message or a bad service key keeps every token.

import type { DevicePushProvider } from '@voice-room/shared/contracts/devices';
import { isVersionBelow } from '@voice-room/shared/client-version';
import type { PushPayload } from '@voice-room/shared/notifications';
import { isRecord } from '@voice-room/shared/guards';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { createLogger } from '../../lib/logger.ts';
import { resolvePushTtl, type PushContext } from '../../lib/push-service.ts';
import { buildRuStoreMessage, type RuStorePushClient, type RuStoreSendResult } from '../../lib/rustore-push.ts';
import type { RuStorePushConfig } from '../../app/config.ts';
import type { DeviceTokenRepository } from './device-token.repository.ts';
import { localPushFailure } from './push-fanout.ts';

type SendResult = { enabled: boolean; sent: number; removed: number };
type NativePushLogger = {
  info?(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

const PROVIDER: DevicePushProvider = 'rustore';

// The payload as the dispatch or the outbox handed it over, read field by field.
function pushPayloadOf(value: unknown): PushPayload {
  if (!isRecord(value)) return {};
  const text = (key: string): string | undefined => {
    const field = value[key];
    return typeof field === 'string' ? field : undefined;
  };
  const payload: PushPayload = {
    title: text('title'),
    body: text('body'),
    url: text('url'),
    dedupeKey: text('dedupeKey'),
    notificationId: text('notificationId'),
    type: text('type')
  };
  if (typeof value.expiresAt === 'number') payload.expiresAt = value.expiresAt;
  return payload;
}

// The context's extra data keys; anything that is not a string is left out.
function nativeDataOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const data: Record<string, string> = {};
  for (const [key, field] of Object.entries(value)) if (typeof field === 'string') data[key] = field;
  return data;
}

export function createNativePushService({
  config,
  tokens,
  client,
  logger = createLogger({ name: 'api' }),
  now = Date.now,
  minVersion = ''
}: {
  config: RuStorePushConfig;
  tokens: () => Pick<DeviceTokenRepository, 'listByUserId' | 'removeToken'>;
  client: Pick<RuStorePushClient, 'send'>;
  logger?: NativePushLogger | undefined;
  now?: () => number;
  /** Rings skip apps below this version, or of an unknown one; empty sets no bound. */
  minVersion?: string;
}) {
  async function sendToUser(userId: string, payload: unknown, context: PushContext = {}): Promise<SendResult> {
    if (!config.enabled || !userId || context.skipNative === true) {
      return { enabled: config.enabled, sent: 0, removed: 0 };
    }
    const ttl = resolvePushTtl(context, now());
    if (ttl === null) return { enabled: true, sent: 0, removed: 0 };
    const push = pushPayloadOf(payload);
    const nativeData = nativeDataOf(context.nativeData);
    let targets: Awaited<ReturnType<DeviceTokenRepository['listByUserId']>>;
    try {
      targets = await tokens().listByUserId(userId, now());
    } catch (error) {
      logger.warn(
        { evt: LOG_EVENTS.PUSH_SUBSCRIPTION_LOAD_FAILED, provider: PROVIDER, err: error, userId },
        'failed to load device tokens'
      );
      // A database fault is not a RuStore outage; the worker counts it as any failure.
      if (context.strictFailures) throw localPushFailure(error);
      return { enabled: true, sent: 0, removed: 0 };
    }
    // An outdated app cannot join the room a ring leads to; every other push
    // still reaches it, since its version refreshes only when it next starts.
    const live = targets.filter(
      (target) =>
        target.provider === PROVIDER && (push.type !== 'ring' || !isVersionBelow(target.appVersion, minVersion))
    );
    let sent = 0;
    let removed = 0;
    const unauthorized: RuStoreSendResult[] = [];
    const failures: Error[] = [];
    await Promise.all(
      live.map(async ({ token }) => {
        const message = buildRuStoreMessage({ token, payload: push, nativeData, ttlSeconds: ttl });
        if (!message) {
          logger.error({ evt: LOG_EVENTS.PUSH_NATIVE_TOO_LARGE, userId, type: push.type }, 'native push too large');
          return;
        }
        const result = await client.send(message);
        const details = { userId, httpStatus: result.httpStatus, status: result.status };
        switch (result.outcome) {
          case 'sent':
            sent += 1;
            return;
          case 'expired_token':
            try {
              await tokens().removeToken({ provider: PROVIDER, token });
              removed += 1;
              logger.info?.({ evt: LOG_EVENTS.PUSH_NATIVE_TOKEN_PRUNED, ...details }, 'native push token pruned');
            } catch (cleanupError) {
              logger.warn(
                { evt: LOG_EVENTS.PUSH_SUBSCRIPTION_PRUNE_FAILED, provider: PROVIDER, ...details, err: cleanupError },
                'failed to remove an expired device token'
              );
            }
            return;
          case 'rejected':
            logger.error(
              { evt: LOG_EVENTS.PUSH_NATIVE_REJECTED, ...details, message: result.message },
              'native push rejected'
            );
            return;
          case 'unauthorized':
            unauthorized.push(result);
            return;
          case 'retryable':
            logger.warn(
              { evt: LOG_EVENTS.PUSH_NATIVE_SEND_FAILED, ...details, message: result.message },
              'native push failed'
            );
            failures.push(new Error(`RuStore push failed: ${result.status || result.httpStatus}`));
            return;
        }
      })
    );
    // Every token of the call meets the same bad key: one line, not one per token.
    const [denied] = unauthorized;
    if (denied) {
      logger.error(
        {
          evt: LOG_EVENTS.PUSH_NATIVE_UNAUTHORIZED,
          userId,
          httpStatus: denied.httpStatus,
          status: denied.status,
          message: denied.message,
          tokens: unauthorized.length
        },
        'native push unauthorized'
      );
    }
    // A push one phone already got is not retried for the others: a retry would repeat it.
    if (context.strictFailures && sent === 0 && failures.length > 0) {
      throw new AggregateError(failures, 'RuStore push delivery failed');
    }
    return { enabled: true, sent, removed };
  }

  return { name: PROVIDER, config: { enabled: config.enabled }, sendToUser };
}

export type NativePushService = ReturnType<typeof createNativePushService>;
