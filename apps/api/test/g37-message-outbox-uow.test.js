'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createMessageOutboxRepository } = require('../src/domains/messaging/message-outbox-repository');

test('G37-A01 logical event identity deduplicates inside the active transaction', async () => {
  const calls = [];
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
  const client = { async query(text, values) { calls.push({ text, values }); return { rows: [{ event_id: values[0], logical_key: values[1], event_type: values[2], conversation_type: values[3], conversation_id: values[4], message_id: values[5], revision: values[6], payload: JSON.parse(values[7]), attempts: 0, claimed_fencing_token: null }] }; } };
  const repo = createMessageOutboxRepository({ pool });
  const input = { eventId: 'e1', type: 'message.created', conversation: { type: 'room', id: 'r' }, messageId: 'm', message: { id: 'm' } };
  const first = await repo.enqueue(client, input); const second = await repo.enqueue(client, { ...input, eventId: 'e2' });
  assert.equal(first.logicalKey, second.logicalKey); assert.match(calls[0].text, /ON CONFLICT \(logical_key\)/);
});

test('G37-A02 schema is inert, additive, lock-bounded and retains poison evidence', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/migrations/20260718125000_create_message_delivery_outbox.js'), 'utf8');
  assert.match(source, /SET LOCAL lock_timeout = '5s'/); assert.match(source, /status IN \('pending', 'processing', 'delivered', 'dead'\)/); assert.match(source, /logical_key[\s\S]*unique: true/);
});
