'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessageIdempotencyRepository, IdempotencyConflictError } = require('../src/domains/messaging/message-idempotency-repository');

function identity(fingerprint = 'fp') { return { actorType: 'account', actorId: 'u', conversation: { type: 'room', id: 'r' }, key: '12345678', fingerprint }; }

test('G36-A01 completed same-key replay returns the original response', async () => {
  const responses = [{ rows: [], rowCount: 0 }, { rows: [], rowCount: 0 }, { rows: [{ fingerprint: 'fp', state: 'completed', message_id: 'm', response_status: 201, response_body: { message: { id: 'm' } } }], rowCount: 1 }];
  const client = { query: async () => responses.shift() };
  const result = await createMessageIdempotencyRepository().reserve(client, identity());
  assert.equal(result.kind, 'replay'); assert.deepEqual(result.response, { messageId: 'm', statusCode: 201, body: { message: { id: 'm' } } });
});

test('G36-A02 same key with a different fingerprint is a stable conflict', async () => {
  const responses = [{ rows: [], rowCount: 0 }, { rows: [], rowCount: 0 }, { rows: [{ fingerprint: 'other', state: 'completed' }], rowCount: 1 }];
  const client = { query: async () => responses.shift() };
  await assert.rejects(createMessageIdempotencyRepository().reserve(client, identity()), (error) => error instanceof IdempotencyConflictError && error.statusCode === 409);
});
