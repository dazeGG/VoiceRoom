import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fastify, { type FastifyBaseLogger } from 'fastify';
import pino from 'pino';

import type { ApiContext } from '../src/app/context.ts';
import { registerAdmissionRoutes } from '../src/domains/admission/admission.routes.ts';
import type {
  AdmissionRequest,
  AdmissionResult,
  AdmissionService
} from '../src/domains/admission/admission.service.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import { isRecord } from '../src/platform/record.ts';
import { fake, storedUser } from './fakes/index.ts';

const JOIN = { roomId: 'room-secret', peerId: 'peer-secret', sessionToken: 's'.repeat(32), name: 'Guest' };
const CREDENTIALS = {
  gateCredentialId: 'credential-secret',
  room: 'voice-room-room-secret',
  token: 'jwt',
  ttlSeconds: 600,
  url: 'wss://gate.example.test',
  capabilities: { screenShare: false, camera: true, chat: 'none' as const, maxPeers: 12 }
};

function admissionApp(
  t: TestContext,
  surface: 'main' | 'widget',
  outcome: AdmissionResult = { status: 'issued', admission: CREDENTIALS }
) {
  const logs: string[] = [];
  const logger: FastifyBaseLogger = pino({ level: 'info' }, { write: (line) => logs.push(line) });
  const app = fastify({ loggerInstance: logger });
  t.after(() => app.close());
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const inputs: AdmissionRequest[] = [];
  let sessionLookups = 0;
  const user = storedUser({ id: 'account-cookie-owner' });
  registerAdmissionRoutes(
    app,
    fake<ApiContext>({
      resolveSession: async () => {
        sessionLookups += 1;
        return { user };
      },
      clientIp: () => '203.0.113.9'
    }),
    fake<AdmissionService>({
      async admit(input) {
        inputs.push(input);
        input.log.warn(
          { roomId: input.roomId, peerId: input.peerId, credentialId: 'credential-secret', err: new Error('secret') },
          'admission diagnostic'
        );
        return outcome;
      }
    }),
    surface
  );
  const call = (payload: object = JOIN) =>
    app.inject({
      method: 'POST',
      url: surface === 'widget' ? '/api/widget/livekit-token' : '/api/livekit-token',
      headers: { cookie: 'session=existing-account-cookie' },
      payload
    });
  return { app, call, inputs, logs, user, sessionLookups: () => sessionLookups };
}

test('widget media admission ignores account cookies and returns guest credentials', async (t) => {
  const harness = admissionApp(t, 'widget');
  const response = await harness.call();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json<unknown>(), { ok: true, ...CREDENTIALS });
  assert.equal(harness.sessionLookups(), 0);
  assert.equal(harness.inputs.length, 1);
  const [input] = harness.inputs;
  assert.ok(input);
  assert.equal(input.surface, 'widget');
  assert.equal(input.user, null);
  assert.equal(input.clientIp, '203.0.113.9');
  assert.equal(input.sessionToken, JOIN.sessionToken);
});

test('widget admission diagnostics redact room, peer, credential and error details', async (t) => {
  const harness = admissionApp(t, 'widget', { status: 'refused', reason: 'invalid_session' });
  const response = await harness.call();
  assert.equal(response.statusCode, 403);
  assert.equal(response.json<{ code: string }>().code, 'invalid_session');
  const diagnostic = harness.logs.find((line) => line.includes('admission diagnostic'));
  assert.ok(diagnostic, 'the real request logger must emit the diagnostic');
  const record: unknown = JSON.parse(diagnostic);
  assert.ok(isRecord(record));
  for (const field of ['roomId', 'peerId', 'credentialId', 'err']) {
    assert.equal(Object.hasOwn(record, field), false, `${field} must not escape widget admission logging`);
  }
});

test('main media admission still resolves the signed-in account', async (t) => {
  const harness = admissionApp(t, 'main');
  assert.equal((await harness.call()).statusCode, 200);
  assert.equal(harness.sessionLookups(), 1);
  const [input] = harness.inputs;
  assert.ok(input);
  assert.equal(input.surface, 'main');
  assert.deepEqual(input.user, harness.user);
});

test('widget admission exposes a banned-room refusal with the room id', async (t) => {
  const harness = admissionApp(t, 'widget', { status: 'refused', reason: 'room_banned' });
  const response = await harness.call();
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json<unknown>(), {
    ok: false,
    error: 'Вы заблокированы в этой комнате',
    code: 'room_banned',
    roomId: JOIN.roomId
  });
});

test('widget admission rejects reserved account peer ids before resolving sessions or issuing credentials', async (t) => {
  const harness = admissionApp(t, 'widget');
  const response = await harness.call({ ...JOIN, peerId: 'auth-account-cookie-owner' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json<{ code: string }>().code, 'invalid_request');
  assert.equal(harness.sessionLookups(), 0);
  assert.deepEqual(harness.inputs, []);
});
