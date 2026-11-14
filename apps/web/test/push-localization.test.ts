import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test } from 'vitest';
import { savePushSubscription, resetPushLocaleRegistration } from '../src/api/push';
import { useLocaleStore } from '../src/shared/i18n';
import { stubFetch } from './fixtures/fetch';

const version = '11111111-1111-4111-8111-111111111111';
const newerVersion = '22222222-2222-4222-8222-222222222222';
const subscription = { endpoint: 'https://push.example/locale', keys: { p256dh: 'key', auth: 'auth' } };

beforeEach(() => {
  setActivePinia(createPinia());
  resetPushLocaleRegistration();
});

test('a conditional registration reconciles a valid conflict using current locale', async () => {
  const locale = useLocaleStore();
  await locale.select('fr');
  let requests = 0;
  const { calls } = stubFetch({
    'POST /api/push/subscriptions': () => {
      requests += 1;
      return requests === 1
        ? {
            status: 409,
            body: {
              ok: false,
              error: 'conflict',
              code: 'push_registration_conflict',
              registration: { protocol: 1, locale: 'ru', version }
            }
          }
        : { status: 201, body: { ok: true, registration: { protocol: 1, locale: 'fr', version: newerVersion } } };
    }
  });
  await savePushSubscription(subscription);
  expect(calls).toHaveLength(2);
  expect(calls[0]?.body).toMatchObject({ localeState: { protocol: 1, locale: 'fr', expectedVersion: null } });
  expect(calls[1]?.body).toMatchObject({ localeState: { protocol: 1, locale: 'fr', expectedVersion: version } });
});

test('a legacy success disables locale extension until a new session probe', async () => {
  const { calls } = stubFetch({ 'POST /api/push/subscriptions': { status: 201, body: { ok: true } } });
  await savePushSubscription(subscription);
  await savePushSubscription(subscription);
  expect(calls).toHaveLength(2);
  expect(calls[0]?.body).toHaveProperty('localeState');
  expect(calls[1]?.body).not.toHaveProperty('localeState');
  resetPushLocaleRegistration();
  await savePushSubscription(subscription);
  expect(calls[2]?.body).toHaveProperty('localeState');
});

test('strict old-body rejection retries once without locale and does not loop', async () => {
  let requests = 0;
  const { calls } = stubFetch({
    'POST /api/push/subscriptions': () =>
      ++requests === 1
        ? { status: 400, body: { ok: false, error: 'old schema', code: 'invalid_request' } }
        : { status: 201, body: { ok: true } }
  });
  await savePushSubscription(subscription);
  expect(calls).toHaveLength(2);
  expect(calls[1]?.body).not.toHaveProperty('localeState');
});

test('a present malformed extension is invalid instead of legacy capability', async () => {
  const { calls } = stubFetch({
    'POST /api/push/subscriptions': { status: 201, body: { ok: true, registration: { protocol: 2 } } }
  });
  await expect(savePushSubscription(subscription)).rejects.toMatchObject({ code: 'invalid_response' });
  expect(calls).toHaveLength(1);
});

test('a malformed conflict cannot be retried using unvalidated state', async () => {
  const { calls } = stubFetch({
    'POST /api/push/subscriptions': {
      status: 409,
      body: { ok: false, error: 'conflict', code: 'push_registration_conflict' }
    }
  });
  await expect(savePushSubscription(subscription)).rejects.toMatchObject({ code: 'invalid_response' });
  expect(calls).toHaveLength(1);
});

test('an obsolete authentication intent cannot start or retry a request', async () => {
  let active = true;
  const { calls } = stubFetch({
    'POST /api/push/subscriptions': () => {
      active = false;
      return {
        status: 409,
        body: {
          ok: false,
          error: 'conflict',
          code: 'push_registration_conflict',
          registration: { protocol: 1, locale: 'ru', version }
        }
      };
    }
  });
  await savePushSubscription(subscription, () => active);
  expect(calls).toHaveLength(1);
  await savePushSubscription(subscription, () => active);
  expect(calls).toHaveLength(1);
});
