// POST and DELETE /api/push/devices over HTTP: the routes, the real service and
// an in-memory token store. Who may register, which tokens are refused and
// how, the 503 while RuStore is off, and the shared push rate limit.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import { Done, Failure } from '@voice-room/shared/contracts/http';

import type { ApiContext, ResolvedSession } from '../src/app/context.ts';
import type { DeviceTokenRepository } from '../src/domains/notifications/device-token.repository.ts';
import { createDeviceTokenService } from '../src/domains/notifications/device-token.service.ts';
import { registerDeviceTokenRoutes } from '../src/domains/notifications/device-tokens.routes.ts';
import { AJV_OPTIONS, registerHttpKit } from '../src/platform/http/http-kit.ts';
import { fake, storedUser } from './fakes/index.ts';
import { checked } from './helpers/checked.ts';

const ANDROID = 'VoiceRoom-Android/1.2.3 (Linux; Android 12)';
const TOKEN = 'rustore-token-1';

type Stored = { userId: string; sessionId: string; provider: string; token: string; appVersion: string | null };

function signedIn(userId: string, tokenHash: string): ResolvedSession {
  return { user: storedUser({ id: userId, login: userId }), session: { publicId: `public-${tokenHash}`, tokenHash } };
}

function harness(
  t: TestContext,
  {
    enabled = true,
    allowed = true,
    session = signedIn('ada', 'session-1')
  }: { enabled?: boolean; allowed?: boolean; session?: ResolvedSession | null } = {}
) {
  const stored = new Map<string, Stored>();
  const limiterKeys: string[] = [];
  const tokens = fake<DeviceTokenRepository>({
    async upsert(input) {
      stored.set(`${input.provider}:${input.token}`, input);
    },
    async remove({ userId, provider, token }) {
      const key = `${provider}:${token}`;
      if (stored.get(key)?.userId !== userId) return false;
      return stored.delete(key);
    }
  });
  const service = createDeviceTokenService({
    tokens: () => tokens,
    enabled: () => enabled,
    limiter: {
      check(key) {
        limiterKeys.push(key);
        return allowed ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: 42 };
      }
    }
  });
  const app = fastify({ ajv: AJV_OPTIONS });
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  let current = session;
  registerDeviceTokenRoutes(
    app,
    {
      logger: fake<ApiContext['logger']>(),
      clientIp: () => 'ip',
      resolveSession: async () => current,
      hashIp: (ip: string) => ip
    },
    service
  );
  t.after(() => app.close());

  async function call(method: 'POST' | 'DELETE', payload: unknown, userAgent = ANDROID) {
    const response = await app.inject({
      method,
      url: '/api/push/devices',
      headers: { 'user-agent': userAgent, 'content-type': 'application/json' },
      payload: JSON.stringify(payload)
    });
    const body: unknown = response.json();
    return { status: response.statusCode, body, retryAfter: response.headers['retry-after'] };
  }
  const refusal = async (method: 'POST' | 'DELETE', payload: unknown) => {
    const { status, body } = await call(method, payload);
    return { status, code: checked(Failure, body, 'refusal').code };
  };

  return {
    stored,
    limiterKeys,
    call,
    refusal,
    signIn: (next: ResolvedSession | null) => {
      current = next;
    }
  };
}

test('a signed-in app registers its token with its session and version', async (t) => {
  const { stored, limiterKeys, call } = harness(t);

  const answer = await call('POST', { provider: 'rustore', token: TOKEN });
  assert.equal(answer.status, 201);
  checked(Done, answer.body, 'answer');
  assert.deepEqual(
    [...stored.values()],
    [{ userId: 'ada', sessionId: 'session-1', provider: 'rustore', token: TOKEN, appVersion: '1.2.3' }]
  );
  assert.deepEqual(limiterKeys, ['device-token:ada']);
});

test('registering again moves the token to the new session', async (t) => {
  const { stored, call, signIn } = harness(t);
  await call('POST', { provider: 'rustore', token: TOKEN });
  signIn(signedIn('ada', 'session-2'));
  assert.equal((await call('POST', { provider: 'rustore', token: TOKEN })).status, 201);
  assert.deepEqual(
    [...stored.values()].map((one) => one.sessionId),
    ['session-2']
  );
});

test('a version that is not plain x.y.z, or no app at all, stores no version', async (t) => {
  const { stored, call } = harness(t);
  await call('POST', { provider: 'rustore', token: 'a' }, 'VoiceRoom-Android/1.2.3-beta');
  await call('POST', { provider: 'rustore', token: 'b' }, 'okhttp/4.12.0');
  assert.deepEqual(
    [...stored.values()].map((one) => one.appVersion),
    [null, null]
  );
});

test('without a session both routes answer 401 authentication_required', async (t) => {
  const { stored, refusal } = harness(t, { session: null });
  assert.deepEqual(await refusal('POST', { provider: 'rustore', token: TOKEN }), {
    status: 401,
    code: 'authentication_required'
  });
  assert.deepEqual(await refusal('DELETE', { provider: 'rustore', token: TOKEN }), {
    status: 401,
    code: 'authentication_required'
  });
  assert.equal(stored.size, 0);

  // A user without the session record it signed in with is not signed in either.
  const { refusal: halfSignedIn } = harness(t, { session: { user: storedUser({ id: 'ada' }) } });
  assert.equal((await halfSignedIn('POST', { provider: 'rustore', token: TOKEN })).status, 401);
});

test('an unknown provider, an empty token or one over 1024 characters is an invalid request', async (t) => {
  const { stored, refusal } = harness(t);
  for (const body of [
    { provider: 'fcm', token: TOKEN },
    { provider: 'rustore', token: '' },
    { provider: 'rustore', token: 'x'.repeat(1025) },
    { provider: 'rustore' },
    {}
  ]) {
    assert.deepEqual(await refusal('POST', body), { status: 400, code: 'invalid_request' }, JSON.stringify(body));
    assert.deepEqual(await refusal('DELETE', body), { status: 400, code: 'invalid_request' }, JSON.stringify(body));
  }
  assert.equal(stored.size, 0);
});

test('a token with whitespace or a control character is an invalid device token', async (t) => {
  const { stored, refusal, call } = harness(t);
  for (const token of ['two words', 'tab\there', 'line\nbreak', 'nul\u0000byte', 'bell\u0007', ' padded']) {
    assert.deepEqual(
      await refusal('POST', { provider: 'rustore', token }),
      { status: 400, code: 'invalid_device_token' },
      JSON.stringify(token)
    );
  }
  assert.equal(stored.size, 0);
  assert.equal((await call('POST', { provider: 'rustore', token: 'x'.repeat(1024) })).status, 201);
});

test('while RuStore is off, registering answers 503 push_disabled and removing still works', async (t) => {
  const { stored, refusal, call } = harness(t, { enabled: false });
  assert.deepEqual(await refusal('POST', { provider: 'rustore', token: TOKEN }), {
    status: 503,
    code: 'push_disabled'
  });
  assert.equal(stored.size, 0);
  assert.equal((await call('DELETE', { provider: 'rustore', token: TOKEN })).status, 200);
});

test('over the limit both routes answer 429 push_rate_limited with Retry-After', async (t) => {
  const { stored, call } = harness(t, { allowed: false });
  for (const method of ['POST', 'DELETE'] as const) {
    const answer = await call(method, { provider: 'rustore', token: TOKEN });
    const body = checked(Failure, answer.body, 'refusal');
    assert.equal(answer.status, 429, method);
    assert.equal(body.code, 'push_rate_limited');
    assert.equal(body.retryAfterSeconds, 42);
    assert.equal(answer.retryAfter, '42');
  }
  assert.equal(stored.size, 0);
});

test("removing takes only the caller's own token and answers 200 for a missing one", async (t) => {
  const { stored, call, signIn } = harness(t);
  await call('POST', { provider: 'rustore', token: 'ada-phone' });
  signIn(signedIn('bob', 'session-9'));
  await call('POST', { provider: 'rustore', token: 'bob-phone' });

  const missing = await call('DELETE', { provider: 'rustore', token: 'ada-phone' });
  assert.equal(missing.status, 200);
  checked(Done, missing.body, 'answer');
  assert.deepEqual([...stored.keys()].sort(), ['rustore:ada-phone', 'rustore:bob-phone']);

  assert.equal((await call('DELETE', { provider: 'rustore', token: 'bob-phone' })).status, 200);
  assert.deepEqual([...stored.keys()], ['rustore:ada-phone']);
  assert.equal((await call('DELETE', { provider: 'rustore', token: 'never-registered' })).status, 200);
});
