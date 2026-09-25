// The shared error handler: every failure a route did not answer itself
// still leaves with a catalogued code, and a server fault stays private.

import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import { Type } from '@fastify/type-provider-typebox';
import { AJV_OPTIONS, registerHttpKit } from '../src/platform/http/http-kit.ts';

function kitApp(t: test.TestContext, failures: unknown[] = []) {
  const app = fastify({ ajv: AJV_OPTIONS });
  t.after(() => app.close());
  registerHttpKit(app, {
    securityHeaders: () => ({}),
    recordRequest() {},
    logRequest() {},
    logHandlerFailure: (_request, _route, error) => failures.push(error)
  });
  app.post('/typed', { schema: { body: Type.Object({ muted: Type.Boolean() }) } }, async () => ({ ok: true }));
  app.get('/thrown/:kind', async (request) => {
    const { kind } = request.params as { kind: string };
    if (kind === 'coded') throw Object.assign(new Error('Too big'), { statusCode: 413, code: 'avatar_too_large' });
    if (kind === 'foreign') throw Object.assign(new Error('Nope'), { statusCode: 429, code: 'FST_SOMETHING' });
    throw new Error('database password is hunter2');
  });
  return app;
}

test('a mistyped body names the field, and nothing is coerced', async (t) => {
  const response = await kitApp(t).inject({ method: 'POST', url: '/typed', payload: { muted: 'true' } });
  assert.deepEqual(
    [response.statusCode, response.json()],
    [400, { ok: false, error: 'muted must be a boolean', code: 'invalid_request' }]
  );
});

test('a thrown error keeps a catalogued code; any other falls back by status', async (t) => {
  const app = kitApp(t);
  const coded = await app.inject({ method: 'GET', url: '/thrown/coded' });
  assert.deepEqual([coded.statusCode, coded.json()], [413, { ok: false, error: 'Too big', code: 'avatar_too_large' }]);
  const foreign = await app.inject({ method: 'GET', url: '/thrown/foreign' });
  assert.deepEqual([foreign.statusCode, foreign.json()], [429, { ok: false, error: 'Nope', code: 'rate_limited' }]);
});

test('a server fault answers a private message and is reported', async (t) => {
  const failures: unknown[] = [];
  const crashed = await kitApp(t, failures).inject({ method: 'GET', url: '/thrown/crash' });
  assert.deepEqual(
    [crashed.statusCode, crashed.json()],
    [500, { ok: false, error: 'Internal server error', code: 'internal_error' }]
  );
  assert.equal(failures.length, 1);
});
