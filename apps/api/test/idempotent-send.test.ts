import assert from 'node:assert/strict';
import { test } from 'node:test';
import fastify from 'fastify';
import type pg from 'pg';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import {
  createMessageIdempotencyRepository,
  IdempotencyConflictError
} from '../src/domains/messaging/message-idempotency.repository.ts';
import { fakeDb, result as rows } from './fakes/index.ts';

/** A ledger query result; the rows are whatever the scripted step returns. */
type Reply = pg.QueryResult<Record<string, unknown>>;

/** A client that answers each query with the next scripted result. */
function scripted(responses: Reply[]) {
  return fakeDb(() => responses.shift() ?? rows());
}

function identity(fingerprint = 'fp') {
  return { actorType: 'account', actorId: 'u', conversation: { type: 'room', id: 'r' }, key: '12345678', fingerprint };
}

test('G36-A01 completed same-key replay returns the original response', async () => {
  const responses: Reply[] = [
    rows(),
    rows(),
    rows([
      {
        fingerprint: 'fp',
        state: 'completed',
        message_id: 'm',
        response_status: 201,
        response_body: { message: { id: 'm' } }
      }
    ])
  ];
  const client = scripted(responses);
  const result = await createMessageIdempotencyRepository().reserve(client, identity());
  assert.equal(result.kind, 'replay');
  assert.deepEqual(result.response, { messageId: 'm', statusCode: 201, body: { message: { id: 'm' } } });
});

test('G36-A02 same key with a different fingerprint is a stable conflict', async () => {
  const responses: Reply[] = [rows(), rows(), rows([{ fingerprint: 'other', state: 'completed' }])];
  const client = scripted(responses);
  await assert.rejects(
    createMessageIdempotencyRepository().reserve(client, identity()),
    (error) => error instanceof IdempotencyConflictError && error.statusCode === 409
  );
});

test('idempotency refusals reach the wire with their own status and code', async (t) => {
  const app = fastify();
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  t.after(() => app.close());
  const reserveWith = (responses: Reply[], actorQuota?: number) => async () => {
    const client = scripted(responses);
    await createMessageIdempotencyRepository(actorQuota === undefined ? {} : { actorQuota }).reserve(
      client,
      identity()
    );
    return { ok: true };
  };
  app.get('/conflict', reserveWith([rows(), rows(), rows([{ fingerprint: 'other', state: 'completed' }])]));
  app.get('/quota', reserveWith([rows(), rows(), rows(), rows([{ count: 1 }])], 1));

  const conflict = await app.inject({ method: 'GET', url: '/conflict' });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json<{ code: string }>().code, 'idempotency_conflict');
  const quota = await app.inject({ method: 'GET', url: '/quota' });
  assert.equal(quota.statusCode, 429);
  assert.equal(quota.json<{ code: string }>().code, 'idempotency_quota_exceeded');
});
