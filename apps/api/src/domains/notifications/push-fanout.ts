// One push to every enabled provider: Web Push and the Android app. The
// dispatch and the notification worker send through this, so a recipient gets
// the push wherever they have a subscription or a token.

import { isArray } from '@voice-room/shared/guards';
import type { PushContext } from '../../lib/push-service.ts';
import { fieldOf } from '../../platform/record.ts';

type SendResult = { enabled: boolean; sent: number; removed: number };

const LOCAL_FAILURE = 'localPushFailure';

/**
 * A sender's own failure before it reached its provider, such as its token
 * store failing. The fan-out still throws it, but names no provider for it,
 * so the worker counts it like any other failure, not as a provider outage.
 */
export function localPushFailure(cause: unknown): Error {
  return Object.assign(new Error('Push sender failed before reaching its provider', { cause }), {
    [LOCAL_FAILURE]: true
  });
}

/** A push provider, named so a failure can say which one failed. */
export interface PushSender {
  name: string;
  config: { enabled: boolean };
  sendToUser(userId: string, payload: unknown, context?: PushContext): Promise<SendResult>;
}

/**
 * On while any provider is on; `sent` and `removed` are summed. Under
 * `strictFailures` it throws only when no provider sent anything and at least
 * one threw: an AggregateError of their errors, tagged with `failedProviders`,
 * the providers that threw anything but a `localPushFailure`.
 * A provider that still delivered means the recipient got the push, and a
 * retry would repeat it.
 */
export function createPushFanout(providers: () => readonly PushSender[]) {
  async function sendToUser(userId: string, payload: unknown, context: PushContext = {}): Promise<SendResult> {
    const senders = providers().filter((sender) => sender.config.enabled);
    const outcomes = await Promise.all(
      senders.map((sender) =>
        sender.sendToUser(userId, payload, context).then(
          (result) => ({ name: sender.name, result, error: null }),
          (error: unknown) => ({ name: sender.name, result: null, error })
        )
      )
    );
    let sent = 0;
    let removed = 0;
    const errors: unknown[] = [];
    const failedProviders: string[] = [];
    for (const { name, result, error } of outcomes) {
      if (result) {
        sent += result.sent;
        removed += result.removed;
      } else {
        errors.push(error);
        if (fieldOf(error, LOCAL_FAILURE) !== true) failedProviders.push(name);
      }
    }
    if (context.strictFailures && sent === 0 && errors.length > 0) {
      throw Object.assign(new AggregateError(errors, 'Push delivery failed'), { failedProviders });
    }
    return { enabled: senders.length > 0, sent, removed };
  }

  return {
    get config() {
      return { enabled: providers().some((sender) => sender.config.enabled) };
    },
    sendToUser
  };
}

export type PushFanout = ReturnType<typeof createPushFanout>;

/** The providers a failed fan-out names; empty for any other error. */
export function failedPushProviders(error: unknown): readonly string[] {
  const names = fieldOf(error, 'failedProviders');
  return isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [];
}
