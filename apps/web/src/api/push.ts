import { Done } from '@voice-room/shared/contracts/http';
import { PushConfig, SubscribeBody, UnsubscribeBody } from '@voice-room/shared/contracts/notifications';
import { PushRegistrationConflict, PushRegistrationSuccess } from '@voice-room/shared/contracts/push-registration';
import { Value } from 'typebox/value';
import { getLocale } from '@/shared/i18n';
import { api, ApiError, failureBody, isJsonObject } from './client';
import { ERROR_TEXTS } from './error-texts';

export type { PushConfig };

export function fetchPushConfig(): Promise<PushConfig> {
  return api.get('/api/push/config', PushConfig);
}

const versions = new Map<string, string>();
const queues = new Map<string, Promise<void>>();
let localeCapability: boolean | null = null;

export function pushLocaleCapability(): boolean | null {
  return localeCapability;
}

/** A new authenticated session re-probes the server rather than retaining an old capability result. */
export function resetPushLocaleRegistration(): void {
  versions.clear();
  localeCapability = null;
}

function invalidRegistration(status = 201): ApiError {
  return new ApiError(ERROR_TEXTS.invalid_response, status, { code: 'invalid_response' });
}

async function saveNow(subscription: PushSubscriptionJSON, isCurrent: () => boolean): Promise<void> {
  const endpoint = subscription.endpoint ?? '';
  let legacyRetried = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!isCurrent()) return;
    const locale = getLocale();
    const localeState = { protocol: 1 as const, locale, expectedVersion: versions.get(endpoint) ?? null };
    try {
      const answer: unknown = await api.post(
        '/api/push/subscriptions',
        Done,
        localeCapability === false ? { subscription } : { subscription, localeState },
        { bodySchema: SubscribeBody }
      );
      if (!isCurrent()) return;
      if (Value.Check(PushRegistrationSuccess, answer)) {
        localeCapability = true;
        versions.set(endpoint, answer.registration.version);
        // A user choice made during the request is the next intent, never the captured old body.
        if (getLocale() !== locale || answer.registration.locale !== getLocale()) continue;
        return;
      }
      if (isJsonObject(answer) && !Object.hasOwn(answer, 'registration')) {
        localeCapability = false;
        return;
      }
      throw invalidRegistration();
    } catch (error) {
      if (!isCurrent()) return;
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 409 && error.details.code === 'push_registration_conflict') {
        const conflict = failureBody(error, PushRegistrationConflict);
        if (!conflict) throw invalidRegistration(error.status);
        if (conflict.registration) versions.set(endpoint, conflict.registration.version);
        else versions.delete(endpoint);
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      if (error.status === 400 && error.code === 'invalid_request' && localeCapability !== false && !legacyRetried) {
        legacyRetried = true;
        localeCapability = false;
        continue;
      }
      throw error;
    }
  }
  throw new ApiError(ERROR_TEXTS.push_registration_conflict, 409, { code: 'push_registration_conflict' });
}

export function savePushSubscription(
  subscription: PushSubscriptionJSON,
  isCurrent: () => boolean = () => true
): Promise<void> {
  const endpoint = subscription.endpoint ?? '';
  const previous = queues.get(endpoint) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => saveNow(subscription, isCurrent));
  queues.set(endpoint, pending);
  void pending
    .finally(() => {
      if (queues.get(endpoint) === pending) queues.delete(endpoint);
    })
    .catch(() => {});
  return pending;
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await api.delete('/api/push/subscriptions', Done, { endpoint }, { bodySchema: UnsubscribeBody });
  versions.delete(endpoint);
}
