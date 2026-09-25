// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEASE_IDENTITY, createMessageDeliveryWorker } from '../src/workers/message-delivery.ts';

test('G38-A01 the worker claims under its own lease identity', () => {
  assert.equal(LEASE_IDENTITY, 'message-delivery.G38');
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
