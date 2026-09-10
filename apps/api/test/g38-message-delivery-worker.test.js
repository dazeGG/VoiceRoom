'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { LEASE_IDENTITY, createMessageDeliveryWorker } = require('../src/workers/message-delivery');

test('G38-A01 worker uses the shared lease runtime and the API listener starts no claim timer', () => {
  const worker = fs.readFileSync(path.resolve(__dirname, '../src/workers/message-delivery.js'), 'utf8');
  const server = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
  assert.equal(LEASE_IDENTITY, 'message-delivery.G38');
  assert.match(worker, /require\('\.\.\/platform\/lease-runtime'\)/);
  assert.equal((worker.match(/createLeaseRuntime/g) || []).length, 2);
  const listener = server.slice(server.indexOf('async function startMessageDeliveryListener'), server.indexOf('async function stopMessageDeliveryListener'));
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
