import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { LEASE_IDENTITY, createMessageDeliveryWorker } from '../src/workers/message-delivery.ts';

test('G38-A01 worker uses the shared lease runtime and the API listener starts no claim timer', () => {
  const worker = fs.readFileSync(path.resolve(import.meta.dirname, '../src/workers/message-delivery.ts'), 'utf8');
  const relay = fs.readFileSync(path.resolve(import.meta.dirname, '../src/domains/messaging/message-delivery-relay.ts'), 'utf8');
  assert.equal(LEASE_IDENTITY, 'message-delivery.G38');
  assert.match(worker, /from '\.\.\/platform\/lease-runtime\.ts'/);
  assert.equal((worker.match(/createLeaseRuntime/g) || []).length, 2);
  const start = relay.indexOf('async function startMessageDeliveryListener');
  const listener = relay.slice(start, relay.indexOf('async function stopMessageDeliveryListener'));
  assert.ok(start > 0);
  assert.doesNotMatch(listener, /setInterval|setTimeout/);
});

test('G38-A02 one claimed event is delivered and committed under its fencing token', async () => {
  const delivered = Promise.withResolvers(); let claimed = false; let marked;
  const outbox = {
    acquireLease: async () => ({ acquired: true, fencingToken: 7 }), renewLease: async () => ({ renewed: true }), releaseLease: async () => {}, recordHeartbeat: async () => true,
    claimBatch: async () => claimed ? [] : (claimed = true, [{ eventId: 'e', attempts: 1, payload: { type: 'message.created' } }]),
    markDelivered: async (eventId, lease) => { marked = { eventId, lease }; delivered.resolve(); }, reschedule: async () => {}, publishPostgres: async () => {}
  };
  const worker = createMessageDeliveryWorker({ outbox, idleMs: 5, leaseMs: 100, renewMs: 50, deliver: async () => {} });
  void worker.start(); await delivered.promise; await worker.stop();
  assert.equal(marked.eventId, 'e'); assert.equal(marked.lease.fencingToken, 7); assert.equal(marked.lease.identity, LEASE_IDENTITY);
});
